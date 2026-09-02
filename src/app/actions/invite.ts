"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getCapabilities, getDbRole } from "@/lib/permissions-server";
import { invitableRoles } from "@/lib/permissions";
import { inviteLetter } from "@/lib/email/invite-letter";
import { sendEmail } from "@/lib/email/send";
import type { Role } from "@/lib/roles-shared";

/* Invitations — created, renewed and revoked from the Team page.

   Two separate checks, both server-side: MAY they invite at all, and may they
   invite AT THIS ROLE. The modal only offers permitted roles, but a direct call
   can say anything — a delegated inviter asking for "admin" is a role
   assignment, and those are owner-only (invitableRoles).

   THE LETTER IS SENT NOW. It used to say here that email "isn't wired up", so
   an invite was only ever as good as a link somebody copied out of the Pending
   tab and pasted into a chat — which put the whole flow's success on the
   inviter remembering a manual step, and made "resend" a lie. Both are real
   acts today (lib/email): create sends, renew sends again.

   DELIVERY IS REPORTED, NEVER ASSUMED. The row IS the invitation; the letter
   is only how it travels, and the two fail independently. A local checkout has
   no API key, and a provider can refuse an address — in both cases the invite
   still exists and the link still works, so the action says what happened and
   Copy link stays exactly where it was. An action that swallowed a failed send
   would be the same class of bug as the one above, just quieter.

   Renew and revoke re-run the same gate, and both are org-scoped — an id from
   another org matches nothing.

   An invite may also NAME a staff card (staffProfileId): accepting it then
   binds the login to that card instead of minting a fresh one — the claim
   path for people imported from ServiceM8/Xero or pre-seeded ahead of
   onboarding. One open invite per card, backed by a partial unique index the
   same way addresses are (docs/migrations/staff_claim_path.sql). */

/** What became of the letter. Absent where no letter was due (revoke). */
export type InviteDelivery = {
  sent: boolean;
  /** Who it went to, so the screen can name them rather than say "them". */
  to: string;
  /** Why not — `unconfigured` is an environment without a key, which is
      expected locally and says something different to the reader than a
      provider refusal. */
  reason?: "unconfigured" | "failed";
};

export type InviteResult =
  | { ok: true; delivery?: InviteDelivery }
  | { ok: false; error: string };

/* Matches the DB default on invitations.expires_at, `now() + '7 days'`.
   Not exported: a "use server" module may only export async functions, and a
   stray const here fails the build rather than the type-check. */
const INVITE_WINDOW_DAYS = 7;

const NO_PERMISSION = "You don't have permission to invite people.";

type Ctx = {
  orgId: string;
  userId: string;
  allowedRoles: Role[];
  /* The inviter as a PERSON, carried because the letter names them and sets
     them as its reply-to. A cold invitation from a no-reply address with no
     human attached is indistinguishable from a phish, and "your administrator
     has invited you" is the wording that makes it one. */
  inviterName: string;
  inviterEmail: string | null;
};

async function inviterContext(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;

  const [actorRole, caps] = await Promise.all([getDbRole(), getCapabilities()]);
  const allowedRoles = invitableRoles(actorRole, caps);
  if (allowedRoles.length === 0) return null;

  const email = (session?.user?.email as string | undefined) ?? null;
  return {
    orgId,
    userId,
    allowedRoles,
    inviterName: (session?.user?.name as string | undefined) ?? email ?? "Someone",
    inviterEmail: email,
  };
}

/* The origin the accept link is built from.

   APP_BASE_URL first, exactly as the Team page does it — and for the same
   reason: a link is only worth sending if it points at the right deployment,
   and a preview URL baked into somebody's inbox outlives the preview. The
   request headers are the fallback so a local run still produces a link that
   works, rather than one to production. */
async function appOrigin(): Promise<string> {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

/** The company as the recipient should read it. `name` is the legacy signup
    seed — somebody's email address often enough to be the last resort. */
async function companyName(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("trading_name, legal_name, name")
    .eq("id", orgId)
    .maybeSingle();
  return (
    (data?.trading_name as string | null) ||
    (data?.legal_name as string | null) ||
    (data?.name as string | null) ||
    null
  );
}

/* Post the letter for an invitation row. Never throws and never decides
   anything: the caller has already committed the invite, and this only
   reports what the post did. */
async function deliver(
  ctx: Ctx,
  invite: { email: string; role: string; token: string; expires_at: string }
): Promise<InviteDelivery> {
  const [origin, company] = await Promise.all([appOrigin(), companyName(ctx.orgId)]);

  const { subject, html } = inviteLetter({
    baseUrl: origin,
    token: invite.token,
    company,
    inviterName: ctx.inviterName,
    inviterEmail: ctx.inviterEmail,
    role: invite.role === "admin" ? "Admin" : "Staff",
    email: invite.email,
    expiresAt: invite.expires_at,
  });

  const res = await sendEmail({
    to: invite.email,
    subject,
    html,
    replyTo: ctx.inviterEmail ?? undefined,
  });

  if (res.ok) return { sent: true, to: invite.email };
  if (res.reason === "unconfigured") {
    return { sent: false, to: invite.email, reason: "unconfigured" };
  }
  // the provider's own words go to the log, never to the screen
  console.error("Failed to send invite email:", res.detail);
  return { sent: false, to: invite.email, reason: "failed" };
}

/** now + the invite window, as an ISO timestamp. */
function expiryFrom(now = new Date()): string {
  return new Date(now.getTime() + INVITE_WINDOW_DAYS * 86_400_000).toISOString();
}

/** An invitation of this org that nobody has accepted yet — the only kind
    renew and revoke may touch. An accepted row is history: the membership it
    created is real, and deleting the row would erase how that person got in. */
async function openInvite(ctx: Ctx, id: string): Promise<InviteResult> {
  const { data, error } = await supabaseAdmin
    .from("invitations")
    .select("id, accepted_at")
    .eq("org_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return { ok: false, error: "That invite no longer exists." };
  if (data.accepted_at) return { ok: false, error: "That invite has already been accepted." };
  return { ok: true };
}

export async function createInvite(input: {
  email: string;
  role: string;
  /** Unclaimed staff card this invite claims on acceptance — the bridge from
      an imported or pre-seeded card to a real login. Org-scoped below. */
  staffProfileId?: string;
}): Promise<InviteResult> {
  const ctx = await inviterContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (!ctx.allowedRoles.includes(input.role as Role)) {
    return { ok: false, error: "You can't invite someone at that role." };
  }

  /* A card-claiming invite: the card must be OURS and still unclaimed. A
     claimed card means that person already has an account — re-inviting them
     is a membership question, not a card one, so refuse rather than half-work. */
  if (input.staffProfileId) {
    const { data: card } = await supabaseAdmin
      .from("staff_profiles")
      .select("id, user_id")
      .eq("org_id", ctx.orgId)
      .eq("id", input.staffProfileId)
      .maybeSingle();
    if (!card) return { ok: false, error: "That staff card no longer exists." };
    if (card.user_id) return { ok: false, error: "They already have an account here." };

    /* One open invite per card — same shape as the address check below, same
       partial-index backstop against the race (staff_claim_path.sql). */
    const { data: openForCard } = await supabaseAdmin
      .from("invitations")
      .select("id")
      .eq("org_id", ctx.orgId)
      .eq("staff_profile_id", input.staffProfileId)
      .is("accepted_at", null)
      .limit(1);
    if (openForCard?.[0]) {
      return {
        ok: false,
        error: "That person already has a pending invite — renew it from the Pending tab instead.",
      };
    }
  }

  /* One open invite per address. The Pending tab already shows this person —
     expired or not — with Renew and Copy link right there, so a second row
     would only double them up. A partial unique index backs this against
     races (docs/migrations/invitations_one_open_per_email.sql). */
  const { data: existing } = await supabaseAdmin
    .from("invitations")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("email", email)
    .is("accepted_at", null)
    .limit(1);
  if (existing?.[0]) {
    return {
      ok: false,
      error: "That address already has a pending invite — renew it from the Pending tab instead.",
    };
  }

  /* The token comes back from the INSERT rather than being read after it: it
     is a column default (gen_random_bytes), so a second read would be a second
     chance to fetch the wrong row, and the letter needs the exact secret this
     write minted. expires_at rides along for the same reason. */
  const { data: created, error } = await supabaseAdmin
    .from("invitations")
    .insert({
      org_id: ctx.orgId,
      email,
      role: input.role,
      invited_by: ctx.userId,
      // Written rather than left to the column default, so renewInvite extends by
      // the same window this granted — one number, in one place.
      expires_at: expiryFrom(),
      // Spread, not always-null: a plain invite's insert payload stays exactly
      // what it was before cards could be claimed.
      ...(input.staffProfileId ? { staff_profile_id: input.staffProfileId } : {}),
    })
    .select("email, role, token, expires_at")
    .single();
  if (error || !created) return { ok: false, error: "Couldn't create that invite." };

  const delivery = await deliver(ctx, created as Parameters<typeof deliver>[1]);

  revalidatePath("/dashboard/team");
  return { ok: true, delivery };
}

/** Withdraw an invitation nobody has accepted. */
export async function revokeInvite(id: string): Promise<InviteResult> {
  const ctx = await inviterContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const open = await openInvite(ctx, id);
  if (!open.ok) return open;

  const { error } = await supabaseAdmin
    .from("invitations")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", id)
    // repeated on the write, not just the read: they can accept in between
    .is("accepted_at", null);
  if (error) return { ok: false, error: "Couldn't revoke that invite." };

  revalidatePath("/dashboard/team");
  return { ok: true };
}

/* Give an invitation a fresh window — the same one createInvite grants — and
   send the letter again.

   RENEWING AND RESENDING ARE ONE ACT, deliberately. They were separable only
   while there was no mailer: an expired invite whose link had been pasted into
   a chat somewhere could be extended in place, and the person still had the
   URL. Now the link arrives by post, so extending the window without posting
   it again leaves a live invitation nobody has been told about — and the
   reader of the Pending tab pressing Renew plainly means "try again". The
   token is unchanged, so any link already sent keeps working. */
export async function renewInvite(id: string): Promise<InviteResult> {
  const ctx = await inviterContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const open = await openInvite(ctx, id);
  if (!open.ok) return open;

  const { data: renewed, error } = await supabaseAdmin
    .from("invitations")
    .update({ expires_at: expiryFrom() })
    .eq("org_id", ctx.orgId)
    .eq("id", id)
    .is("accepted_at", null)
    .select("email, role, token, expires_at")
    .maybeSingle();
  if (error) return { ok: false, error: "Couldn't renew that invite." };
  /* No row means it was accepted between the check above and this write — the
     guard doing its job, not a failure to report as one. */
  if (!renewed) return { ok: false, error: "That invite has already been accepted." };

  const delivery = await deliver(ctx, renewed as Parameters<typeof deliver>[1]);

  revalidatePath("/dashboard/team");
  return { ok: true, delivery };
}
