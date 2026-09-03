"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can, getCapabilities, getDbRole } from "@/lib/permissions-server";
import { invitableRoles } from "@/lib/permissions";
import { inviteLetter } from "@/lib/email/invite-letter";
import { sendEmail } from "@/lib/email/send";
import { normEmail } from "@/lib/integrations/match";
import { PROVIDER_LABEL } from "@/lib/staff/query";
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
  /** Null when nothing could give us a name that is a name — see
      inviterDisplayName. The letter names the company instead. */
  inviterName: string | null;
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
    inviterName: await inviterDisplayName(orgId, userId, session?.user?.name),
    inviterEmail: email,
  };
}

/** A name is a name. Never an address, whatever column it arrived in. */
function asPersonName(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  /* THE GUARD THAT MATTERS, and it is on the VALUE, not the source. Auth0's
     `name` claim is the sign-in address for identities that never set one, so
     `profiles.name` — written from that claim on every login — holds an email
     for those people too. The first invitation ever sent went out reading
     "isaacsmithnz1@gmail.com has invited you", auto-linked by the mail client,
     while its reply-to carried a DIFFERENT address (the account's real one).
     Two addresses, neither labelled, one of them wrong. */
  if (!s || s.includes("@")) return null;
  return s;
}

/* Who the letter says invited you.

   ORDER IS BY WHO DECIDED IT. The staff card is the org's own answer to who
   this person is — typed by someone here, correctable here — so it wins over
   anything the identity provider relayed. `profiles.name` and the session
   claim are the same value from Auth0 and come after it, and each is dropped
   if it turns out to be an address.

   NULL IS A SUPPORTED ANSWER. When nothing survives, the letter names the
   COMPANY as the inviter instead of printing an address where a person should
   be — see inviteLetter. Reply-to still carries the real human either way. */
async function inviterDisplayName(
  orgId: string,
  userId: string,
  sessionName: unknown
): Promise<string | null> {
  const { data: card } = await supabaseAdmin
    .from("staff_profiles")
    .select("full_name, first_name, last_name")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  const fromCard =
    asPersonName(card?.full_name) ??
    asPersonName([card?.first_name, card?.last_name].filter(Boolean).join(" "));
  if (fromCard) return fromCard;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("name")
    .eq("user_id", userId)
    .maybeSingle();

  return asPersonName(profile?.name) ?? asPersonName(sessionName);
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

/* IS THIS ADDRESS ALREADY SOMEBODY'S LOGIN HERE?

   THE MEMBERSHIP IS THE ANSWER, NOT THE STAFF CARD. A card can hold a work
   address its owner never signs in with, and — as production showed — a member
   can have no card at all (`isaacsmithnz@gmail.com` holds a staff membership in
   the live org with no `staff_profiles` row). So a check that reads cards misses
   real members in both directions, which is exactly how an invitation came to be
   created for somebody who was already in the workspace.

   ORG-SCOPED, THEN COMPARED IN JS. `profiles.email` is written straight from
   the session on every login and is NOT normalised, so an `eq` misses the
   mixed-case rows and `ilike` would treat the `_` in a real address as a
   wildcard. The roster is team-sized; the addresses are compared with the same
   normEmail both sides that the accept route uses. */
async function memberWithEmail(
  orgId: string,
  wanted: string
): Promise<{ userId: string; name: string | null } | null> {
  const { data: members } = await supabaseAdmin
    .from("memberships")
    .select("user_id")
    .eq("org_id", orgId);
  const ids = (members ?? []).map((m) => m.user_id as string);
  if (ids.length === 0) return null;

  const { data: profs } = await supabaseAdmin
    .from("profiles")
    .select("user_id, email, name")
    .in("user_id", ids);

  const hit = ((profs ?? []) as { user_id: string; email: string | null; name: string | null }[])
    .find((p) => normEmail(p.email) === wanted);
  if (!hit) return null;
  return { userId: hit.user_id, name: asPersonName(hit.name) };
}

/* Who the letter greets.

   THE CARD WINS, AND THAT IS THE SAME ORDER AS THE INVITER'S NAME. An invite
   that claims a staff card carries no name of its own on purpose: the card is
   the org's own answer to who this person is — imported or typed by someone
   here, and correctable here — so a second copy on the invitation would be a
   second thing to keep in step, and the two would disagree the first time
   anybody fixed a spelling.

   IT RESOLVES ON EVERY SEND, NOT ONCE. renewInvite posts the letter again, so
   reading the card here rather than at creation means a name corrected in the
   directory is the name the renewed letter carries.

   NULL IS A SUPPORTED ANSWER — every invitation written before this column
   existed has no name, and the letter simply does not greet them, exactly as
   it did not yesterday. */
async function inviteeDisplayName(
  orgId: string,
  invite: { name: string | null; staff_profile_id: string | null }
): Promise<string | null> {
  const typed = asPersonName(invite.name);
  if (typed) return typed;
  if (!invite.staff_profile_id) return null;

  const { data: card } = await supabaseAdmin
    .from("staff_profiles")
    .select("full_name, preferred_name")
    .eq("org_id", orgId)
    .eq("id", invite.staff_profile_id)
    .maybeSingle();
  return (
    asPersonName(card?.preferred_name) ?? asPersonName(card?.full_name) ?? null
  );
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
  invite: {
    email: string;
    role: string;
    token: string;
    expires_at: string;
    name: string | null;
    staff_profile_id: string | null;
  }
): Promise<InviteDelivery> {
  const [origin, company, invitee] = await Promise.all([
    appOrigin(),
    companyName(ctx.orgId),
    inviteeDisplayName(ctx.orgId, invite),
  ]);

  const { subject, html } = inviteLetter({
    baseUrl: origin,
    token: invite.token,
    company,
    inviterName: ctx.inviterName,
    inviterEmail: ctx.inviterEmail,
    role: invite.role === "admin" ? "Admin" : "Staff",
    email: invite.email,
    inviteeName: invitee,
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

/* Everything the letter needs, named once.

   RENEW IS THE ONE THAT BITES. It re-posts the letter through the same
   `deliver`, and its result is cast to deliver's parameter type — so a column
   added to the create path and forgotten here compiles clean and silently
   drops the greeting from every renewed invitation. One constant, both
   call sites. */
const INVITE_LETTER_COLUMNS = "email, role, token, expires_at, name, staff_profile_id";

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
  /** The person, as the inviter knows them. Optional: an invitation with no
      name is what every invitation was until now, and still works. Ignored
      when `staffProfileId` is set — the card already holds the answer. */
  name?: string;
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

  /* A NAME IS OPTIONAL, AND AN ADDRESS IS NOT A NAME. Same guard the inviter's
     name goes through, on the value rather than the source, because a Name
     field is exactly where somebody pastes an email by reflex. Dropping it
     to null costs the greeting; storing it would put an address back in the
     column this whole change exists to empty. */
  const name = input.staffProfileId ? null : asPersonName(input.name);

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

  /* ALREADY A MEMBER — REFUSE, because accepting would REWRITE THEIR ROLE.

     The accept route upserts `memberships` on (user_id, org_id), so an
     invitation aimed at an address somebody already signs in with is a role
     assignment wearing an invitation's clothes: send an existing admin a
     `staff` invite, they press the button in good faith, and they are demoted.
     `invitableRoles` exists precisely to keep role changes owner-only, and a
     delegated inviter holding `invites` can only create `staff` invites — so
     without this check that limit is the attack, not the guard.

     Found in production: an invitation had been created for an address that
     already held a staff membership, and nothing anywhere refused it. The
     accept route now leaves an existing membership's role alone as well; this
     is the half that stops the invitation being written in the first place. */
  const member = await memberWithEmail(ctx.orgId, email);
  if (member) {
    return {
      ok: false,
      error: member.name
        ? `${member.name} already has an account here.`
        : "That address already has an account here.",
    };
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
      // Spread for the same reason as the line above: an invitation nobody
      // named writes the payload it always wrote.
      ...(name ? { name } : {}),
    })
    .select(INVITE_LETTER_COLUMNS)
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
    .select(INVITE_LETTER_COLUMNS)
    .maybeSingle();
  if (error) return { ok: false, error: "Couldn't renew that invite." };
  /* No row means it was accepted between the check above and this write — the
     guard doing its job, not a failure to report as one. */
  if (!renewed) return { ok: false, error: "That invite has already been accepted." };

  const delivery = await deliver(ctx, renewed as Parameters<typeof deliver>[1]);

  revalidatePath("/dashboard/team");
  return { ok: true, delivery };
}

/* WHAT THAT ADDRESS ALREADY MEANS HERE — the modal's resolution.

   The invite screen used to take an address and say nothing about it until
   after the invite was pressed, when the action would refuse with "they
   already have an account here" or "that address already has a pending
   invite". Worse, an unclaimed card holding that address — someone imported
   from ServiceM8, or pre-seeded before onboarding — was invisible, so the
   only way to attach an invite to their card was to remember to start from
   the row in the directory rather than the button at the top. Two doors, and
   the difference between them was a duplicate person.

   Now the field resolves as it is typed and says what it found, before
   anything is committed. It reveals nothing createInvite's own refusals do
   not already reveal to the same caller — except the NAME, which is gated on
   `team`, the capability that governs reading other people's cards.

   AMBIGUITY IS REPORTED, NOT GUESSED. Two unclaimed cards holding one address
   is an admin mess this cannot resolve, and the accept route already refuses
   to pick between them (it creates fresh instead). Saying so is the whole
   value; blocking would leave the reader stuck with no way forward. */

export type InviteeLookup =
  /** Nothing known — a genuinely new person. */
  | { kind: "new" }
  /** An unclaimed card holds this address; the invite will attach to it. */
  | { kind: "card"; staffProfileId: string; name: string | null; importedFrom: string | null }
  /** More than one unclaimed card holds it. Nothing will attach. */
  | { kind: "ambiguous"; count: number }
  /** They already have an account in this workspace. */
  | { kind: "member"; name: string | null }
  /** An invitation is already open for this address. */
  | { kind: "pending" };

export async function lookupInvitee(email: string): Promise<InviteeLookup> {
  const ctx = await inviterContext();
  if (!ctx) return { kind: "new" };

  const wanted = normEmail(email);
  if (!wanted) return { kind: "new" };

  /* Names are the one thing here that is not already discoverable through
     createInvite's refusals, so they ride on `team` — the capability that
     governs reading other people's cards. An inviter without it still gets
     the resolution, just not the person. */
  const mayName = await can("team");

  const { data: open } = await supabaseAdmin
    .from("invitations")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("email", wanted)
    .is("accepted_at", null)
    .limit(1);
  if (open?.[0]) return { kind: "pending" };

  /* THE MEMBERSHIP IS ASKED FIRST, and asking it at all is the fix. This read
     used to be the claimed-card scan below, which misses a member who has no
     card — and the live workspace has one. So the screen said "new" about
     somebody who was already in the org, and createInvite went on to write the
     invitation. Same check the action makes, so the warning and the refusal
     cannot disagree. */
  const member = await memberWithEmail(ctx.orgId, wanted);
  if (member) return { kind: "member", name: mayName ? member.name : null };

  /* Compared in JS, not with `ilike`: `_` is a wildcard there and common in
     real addresses, and normEmail on both sides beats trusting every writer
     to have lowercased. Team-sized list. Mirrors the accept route exactly —
     the two must agree on what "this person's card" means. */
  const { data: cards } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, user_id, contact_email, full_name")
    .eq("org_id", ctx.orgId);

  const rows = (cards ?? []) as {
    id: string;
    user_id: string | null;
    contact_email: string | null;
    full_name: string | null;
  }[];
  const holders = rows.filter((r) => normEmail(r.contact_email) === wanted);

  const claimed = holders.find((r) => r.user_id);
  if (claimed) return { kind: "member", name: mayName ? claimed.full_name : null };

  const unclaimed = holders.filter((r) => !r.user_id);
  if (unclaimed.length > 1) return { kind: "ambiguous", count: unclaimed.length };
  if (unclaimed.length === 1) {
    const card = unclaimed[0];
    const { data: link } = await supabaseAdmin
      .from("integration_links")
      .select("provider")
      .eq("org_id", ctx.orgId)
      .eq("staff_profile_id", card.id)
      .limit(1);
    return {
      kind: "card",
      staffProfileId: card.id,
      name: mayName ? card.full_name : null,
      importedFrom: PROVIDER_LABEL[(link?.[0]?.provider as string) ?? ""] ?? null,
    };
  }

  return { kind: "new" };
}
