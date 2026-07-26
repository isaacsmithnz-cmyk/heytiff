"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getCapabilities, getDbRole } from "@/lib/permissions-server";
import { invitableRoles } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";

/* Invitations — created, renewed and revoked from the Team page.

   Two separate checks, both server-side: MAY they invite at all, and may they
   invite AT THIS ROLE. The modal only offers permitted roles, but a direct call
   can say anything — a delegated inviter asking for "admin" is a role
   assignment, and those are owner-only (invitableRoles).

   Email sending isn't wired up, so an invite is only ever as good as its link:
   "resend" would be a lie, and renew + copy the link is the honest version of
   the same act. Renew and revoke re-run the same gate, and both are org-scoped
   — an id from another org matches nothing. */

export type InviteResult = { ok: true } | { ok: false; error: string };

/* Matches the DB default on invitations.expires_at, `now() + '7 days'`.
   Not exported: a "use server" module may only export async functions, and a
   stray const here fails the build rather than the type-check. */
const INVITE_WINDOW_DAYS = 7;

const NO_PERMISSION = "You don't have permission to invite people.";

type Ctx = { orgId: string; userId: string; allowedRoles: Role[] };

async function inviterContext(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;

  const [actorRole, caps] = await Promise.all([getDbRole(), getCapabilities()]);
  const allowedRoles = invitableRoles(actorRole, caps);
  if (allowedRoles.length === 0) return null;
  return { orgId, userId, allowedRoles };
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

export async function createInvite(input: { email: string; role: string }): Promise<InviteResult> {
  const ctx = await inviterContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (!ctx.allowedRoles.includes(input.role as Role)) {
    return { ok: false, error: "You can't invite someone at that role." };
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

  const { error } = await supabaseAdmin.from("invitations").insert({
    org_id: ctx.orgId,
    email,
    role: input.role,
    invited_by: ctx.userId,
    // Written rather than left to the column default, so renewInvite extends by
    // the same window this granted — one number, in one place.
    expires_at: expiryFrom(),
  });
  if (error) return { ok: false, error: "Couldn't create that invite." };

  // TODO: send the invite email via Resend when it's wired up. Until then the
  // Pending tab's Copy link is how an invite actually reaches anyone.
  revalidatePath("/dashboard/team");
  return { ok: true };
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

/** Give an invitation a fresh window — the same one createInvite grants. */
export async function renewInvite(id: string): Promise<InviteResult> {
  const ctx = await inviterContext();
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const open = await openInvite(ctx, id);
  if (!open.ok) return open;

  const { error } = await supabaseAdmin
    .from("invitations")
    .update({ expires_at: expiryFrom() })
    .eq("org_id", ctx.orgId)
    .eq("id", id)
    .is("accepted_at", null);
  if (error) return { ok: false, error: "Couldn't renew that invite." };

  revalidatePath("/dashboard/team");
  return { ok: true };
}
