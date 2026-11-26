import { supabaseAdmin } from "@/lib/supabase-server";
import { ensureStaffCard } from "@/lib/auth0";
import { acceptInvitation, type Invitation } from "@/lib/invite-accept";
import { sendVerificationEmail } from "@/lib/integrations/auth0-management";
import { pushToStaff } from "./push";
import { ROLE_COPY, type Role } from "@/lib/roles-shared";
import type { MobileIdentity } from "./identity";

/* THE PHONE'S FIRST DOOR, for someone signed in who belongs nowhere yet (bug
   101; the mock https://claude.ai/artifact/QbyZeRc2drw5FcVWZnySZj, "Yes, build
   it", 26 November 2026). The web's /start answers the same question for a
   browser (app/start/page.tsx); this is that page's reading, and its two
   presses, for the phone:

     an invitation waiting for this address  → Join it
     one that has run out                     → ask the inviter for a new one
     nothing for this address                 → set up a business, or sign out
     an address Auth0 hasn't verified yet     → confirm it first

   EVERY DECISION IS MADE AGAIN ON THE PRESS. The phone names which invitation
   it is joining, and that id is looked up again here under THIS person's
   verified address, so an id from anywhere else matches nothing. */

export type StartState =
  | {
      kind: "invite";
      id: string;
      company: string | null;
      role: string;
      roleBlurb: string;
      inviter: string | null;
      invitedOn: string;
    }
  | { kind: "expired"; id: string; company: string | null; inviter: string | null; invitedOn: string }
  | { kind: "member" }
  | { kind: "confirm" }
  | { kind: "none" };

type InviteRow = Invitation & { created_at: string; invited_by: string | null };

const COLUMNS = "id, org_id, email, role, name, staff_profile_id, accepted_at, expires_at, created_at, invited_by";

const companyOf = (o: { trading_name?: string | null; legal_name?: string | null } | null): string | null =>
  o?.trading_name?.trim() || o?.legal_name?.trim() || null;

/** The inviter as a person, never an address standing in for one. */
async function inviterName(orgId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("full_name, first_name, last_name")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  const d = data as { full_name?: string | null; first_name?: string | null; last_name?: string | null } | null;
  const name = d?.full_name?.trim() || [d?.first_name, d?.last_name].filter(Boolean).join(" ").trim();
  return name && !name.includes("@") ? name : null;
}

async function isMember(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from("memberships").select("org_id").eq("user_id", userId).limit(1);
  return !!data?.[0];
}

/** The newest open invitation to this address. */
async function newestInvite(email: string): Promise<InviteRow | null> {
  const { data } = await supabaseAdmin
    .from("invitations")
    .select(COLUMNS)
    .eq("email", email)
    .is("accepted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? []) as InviteRow[])[0] ?? null;
}

const live = (i: { expires_at: string }) => new Date(i.expires_at) > new Date();

export async function readStart(who: MobileIdentity): Promise<StartState> {
  if (await isMember(who.userId)) return { kind: "member" };
  if (!who.email) return who.shownEmail ? { kind: "confirm" } : { kind: "none" };
  const invite = await newestInvite(who.email);
  if (!invite) return { kind: "none" };
  const [{ data: org }, inviter] = await Promise.all([
    supabaseAdmin.from("organizations").select("trading_name, legal_name").eq("id", invite.org_id).maybeSingle(),
    inviterName(invite.org_id, invite.invited_by),
  ]);
  const company = companyOf(org as { trading_name?: string | null; legal_name?: string | null } | null);
  if (!live(invite)) return { kind: "expired", id: invite.id, company, inviter, invitedOn: invite.created_at };
  const role = (invite.role === "admin" ? "admin" : "staff") as Role;
  return {
    kind: "invite",
    id: invite.id,
    company,
    role: ROLE_COPY[role].label,
    roleBlurb: ROLE_COPY[role].blurb,
    inviter,
    invitedOn: invite.created_at,
  };
}

export type StartDone = { ok: true } | { ok: false; status: number; error: string };

/** This person's own invitation, by id, under their verified address. */
async function ownInvite(who: MobileIdentity, id: unknown): Promise<InviteRow | null> {
  if (!who.email || typeof id !== "string" || !id) return null;
  const { data } = await supabaseAdmin.from("invitations").select(COLUMNS).eq("id", id).eq("email", who.email).maybeSingle();
  return (data as InviteRow | null) ?? null;
}

/** Join: the emailed link's own accept, for someone who proved the address by signing in with it. */
export async function joinInvite(who: MobileIdentity, id: unknown): Promise<StartDone> {
  const invite = await ownInvite(who, id);
  if (!invite) return { ok: false, status: 404, error: "That invitation isn't for this address." };
  if (invite.accepted_at) return (await isMember(who.userId)) ? { ok: true } : { ok: false, status: 409, error: "That invitation has already been used." };
  if (!live(invite)) return { ok: false, status: 410, error: "That invitation has run out." };
  await acceptInvitation(invite, who.userId, { user: { email: who.email, name: who.name } });
  return { ok: true };
}

/** Set up a business: the web's /start button. Never a second one: someone
    already in a workspace is told so, and nothing is made. */
export async function startBusiness(who: MobileIdentity): Promise<StartDone> {
  if (await isMember(who.userId)) return { ok: true };
  const { data: orgId, error } = await supabaseAdmin.rpc("create_org_for_owner", {
    p_user_id: who.userId,
    p_name: who.shownEmail ?? who.userId,
  });
  if (error || !orgId) {
    console.error("[mobile start] couldn't create the business:", error);
    return { ok: false, status: 500, error: "Couldn't set up the business. Try again in a moment." };
  }
  await ensureStaffCard(orgId as string, who.userId, { user: { email: who.shownEmail, name: who.name } });
  return { ok: true };
}

/** Ask the inviter for a new invitation: a notification on their phone that
    opens Team, where Resend is. The invitee can't renew it themselves: letting
    it run out may have been the inviter's answer. */
export async function askForNewInvite(who: MobileIdentity, id: unknown): Promise<StartDone> {
  const invite = await ownInvite(who, id);
  if (!invite || invite.accepted_at) return { ok: false, status: 404, error: "That invitation isn't for this address." };
  if (!invite.invited_by) return { ok: false, status: 409, error: "Nobody is named on that invitation to ask." };
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id")
    .eq("org_id", invite.org_id)
    .eq("user_id", invite.invited_by)
    .maybeSingle();
  const staffId = (data as { id: string } | null)?.id;
  const asker = invite.name?.trim() || who.name || who.email;
  const sent = staffId
    ? await pushToStaff(invite.org_id, [staffId], {
        title: `${asker} asked for a new invitation`,
        body: "Theirs ran out. Resend it from Team.",
        path: "/team",
      })
    : 0;
  return sent > 0 ? { ok: true } : { ok: false, status: 409, error: "Couldn't reach them on the app. Ask them to resend it from Team." };
}

/** Send Auth0's confirm-your-address email again. */
export async function resendConfirm(who: MobileIdentity): Promise<StartDone> {
  const r = await sendVerificationEmail(who.userId);
  return r.ok ? { ok: true } : { ok: false, status: 503, error: "Couldn't send it just now. Try again." };
}
