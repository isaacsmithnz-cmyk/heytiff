import { ensureStaffCard } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normEmail } from "@/lib/integrations/match";

/* Accepting an invitation, for every door that accepts one: the emailed link
   (app/invite/accept) and the phone's Join (app/api/mobile/start). One copy,
   so the four writes happen in the same order whichever door it was. */

/* A staff card can predate its login — imported from ServiceM8/Xero, or
   created ahead of onboarding — sitting with user_id null until its person
   arrives. Accepting an invite is the ONE moment the two can be bound: miss
   it and ensureStaffCard mints a duplicate, and every later feature has two
   answers to who this person is.

   Which card is theirs, in order of proof:
   1. the invite NAMES it (staff_profile_id, set when the invite was created
      from an unclaimed card) — immune to work-address-vs-personal-login
      drift, because the token itself is the claim;
   2. exactly ONE unclaimed card holds the invite's address as contact_email.
      Two holding it is an admin mess this route must not guess about — it
      creates fresh and leaves both visible instead.

   Every adopt carries `user_id is null` IN THE WRITE, so a claimed card can
   never be re-claimed, and staff_profiles' (org_id, user_id) unique means a
   racing double-accept cannot leave one person holding two cards. Someone who
   already has a card here keeps it — a stale pointer (card deleted → the FK
   nulled it; card claimed meanwhile → the guarded update matches nothing)
   falls through to ensureStaffCard's fresh card, exactly today's behaviour. */
async function adoptStaffCard(
  orgId: string,
  userId: string,
  invite: { staff_profile_id?: string | null; email: string }
): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from("staff_profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return;

  if (invite.staff_profile_id) {
    const { data: adopted } = await supabaseAdmin
      .from("staff_profiles")
      .update({ user_id: userId })
      .eq("org_id", orgId)
      .eq("id", invite.staff_profile_id)
      .is("user_id", null)
      .select("id");
    if (adopted?.length) return;
  }

  /* The address comparison happens in JS on purpose: normEmail on both sides
     rather than trusting every writer to have lowercased, and no `ilike` —
     which treats `_`, common in real addresses, as a wildcard that can invent
     a match. The list is team-sized. */
  const { data: unclaimed } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, contact_email")
    .eq("org_id", orgId)
    .is("user_id", null)
    .not("contact_email", "is", null);
  const wanted = normEmail(invite.email);
  const holders = ((unclaimed ?? []) as { id: string; contact_email: string | null }[]).filter(
    (r) => normEmail(r.contact_email) === wanted
  );
  if (holders.length !== 1) return;

  await supabaseAdmin
    .from("staff_profiles")
    .update({ user_id: userId })
    .eq("org_id", orgId)
    .eq("id", holders[0].id)
    .is("user_id", null);
}

export type Invitation = {
  id: string;
  org_id: string;
  email: string;
  role: string;
  name?: string | null;
  staff_profile_id?: string | null;
  accepted_at?: string | null;
  expires_at: string;
};

/* ACCEPTING, ONCE, FOR BOTH DOORS. A signed-in invitee accepts here after the
   address check below; a brand-new invitee accepts the moment they click,
   against the login this route has just created for them (see
   `setPasswordRedirect`). Same four writes either way, in the same order.

   Returns the role they actually hold, which is not the invited one when they
   were already a member — see the note in GET on why an invitation may not
   rewrite a membership. */
export async function acceptInvitation(
  invite: Invitation,
  userId: string,
  identity: { user: { name?: unknown; email?: string | null; picture?: unknown } }
): Promise<string> {
  const { data: already } = await supabaseAdmin
    .from("memberships")
    .select("role")
    .eq("org_id", invite.org_id)
    .eq("user_id", userId)
    .maybeSingle();

  const role = (already?.role as string | undefined) ?? invite.role;

  if (!already) {
    await supabaseAdmin
      .from("memberships")
      .upsert(
        { user_id: userId, org_id: invite.org_id, role: invite.role },
        { onConflict: "user_id,org_id" }
      );
  }

  await supabaseAdmin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  /* Bind the login to its pre-seeded card, if one is waiting. Best-effort by
     the same doctrine as ensureStaffCard below: any failure here degrades to
     a fresh card, never to an error page. */
  await adoptStaffCard(invite.org_id, userId, invite);

  /* The staff card has to exist before they land on /dashboard. `updateSession`
     in GET writes the cookie directly and does NOT run `beforeSessionSaved`, so
     nothing else creates it until their NEXT sign-in — and without it
     `staffProfileIdFor` returns null, which silently refuses commenting,
     reacting, RSVPing, poll votes and every document upload ("No staff record
     for this account"), and leaves them out of the team list so they can't even
     be assigned a task. That's the whole first session for every invited
     employee, which is the one path every real staff member takes. */
  await ensureStaffCard(invite.org_id, userId, identity, invite.name);

  return role;
}

