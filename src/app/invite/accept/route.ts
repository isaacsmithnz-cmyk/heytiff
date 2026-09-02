import { type NextRequest, NextResponse } from "next/server";
import { auth0, ensureStaffCard } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normEmail } from "@/lib/integrations/match";

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

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) return NextResponse.redirect(new URL("/dashboard", request.url));

  /* SIGN-UP, NOT SIGN-IN, is the screen an invitation should open.

     This redirected to Auth0's login tab, which is the wrong half of the
     widget for almost everybody who follows an invite link: they are being
     invited to join, so they do not have an account yet, and the screen asked
     them for a password they had never set. Nothing said "create one" — the
     way through was to notice the small link under the form.

     `screen_hint=signup` opens the other tab, and Auth0's signup screen keeps
     its own "Already have an account? Log in" for the minority who do. That
     minority is the reason this is a hint rather than a separate route: we
     cannot know from here whether the address has an account without asking
     the Management API on anonymous traffic, and being one click from the
     right tab beats a lookup on every invite click. */
  const session = await auth0.getSession();
  if (!session) {
    /* AND THE ADDRESS IS FILLED IN FOR THEM.

       An invitation is BOUND to one address — the check below refuses any
       other signed-in identity — and the screen it opens was asking the
       invitee to type it from memory, with a refusal at the end of the flow
       if they reached for a different one of their own. The invite knows the
       answer, so the screen should too.

       `login_hint` is the OIDC parameter for it, and it needs no plumbing:
       the SDK forwards every /auth/login query param except `returnTo`
       straight into the authorize call (auth-client.js, the same path
       `screen_hint` already rides). It is Auth0's own field, so the address
       leaves us only to the identity provider that is about to ask for it.

       BEST EFFORT, AND SILENT WHEN IT MISSES. A token that matches nothing
       falls through to exactly the old redirect rather than an error: the
       hint is a convenience, and this branch runs on anonymous traffic where
       a dead token should still land on the same screen it always did. The
       row is read by token alone — no filter on expiry or acceptance —
       because a spent invitation's address is still the right one to prefill,
       and it is the guard further down, not this hint, that decides whether
       the invitation works. */
    const { data: invited } = await supabaseAdmin
      .from("invitations")
      .select("email")
      .eq("token", token)
      .maybeSingle();

    const to = new URL("/auth/login", request.url);
    to.searchParams.set("screen_hint", "signup");
    const hint = invited?.email as string | undefined;
    if (hint) to.searchParams.set("login_hint", hint);
    // set LAST and via searchParams, so its own `?token=` is encoded rather
    // than read as another parameter of this URL
    to.searchParams.set("returnTo", `/invite/accept?token=${token}`);
    return NextResponse.redirect(to);
  }

  const errRedirect = (msg: string) =>
    NextResponse.redirect(new URL(`/invite/error?msg=${encodeURIComponent(msg)}`, request.url));

  const { data: invite, error } = await supabaseAdmin
    .from("invitations")
    .select("*")
    .eq("token", token)
    .single();

  if (error || !invite) return errRedirect("Invite not found or already used.");
  if (invite.accepted_at) return errRedirect("This invite has already been accepted.");
  if (new Date(invite.expires_at) < new Date()) return errRedirect("This invite has expired.");
  // Case-insensitive: the row is stored lowercased, but Auth0 relays the
  // identity provider's casing. Only the comparison normalises — the error
  // message below shows each address as its own side spelt it.
  if (invite.email.toLowerCase() !== session.user.email?.toLowerCase()) {
    return errRedirect(
      `This invite was sent to ${invite.email}. You're signed in as ${session.user.email}.`
    );
  }

  /* AN INVITATION MAY NOT REWRITE AN EXISTING MEMBERSHIP'S ROLE.

     This was a bare upsert on (user_id, org_id), which made an invitation aimed
     at somebody already in the workspace into a role assignment: send an
     existing admin a `staff` invite, they press the button in good faith, and
     they are demoted. Role changes are owner-only by `invitableRoles`, and a
     delegated inviter holding `invites` can create `staff` invites — so the
     bare upsert turned that limit into the attack.

     createInvite refuses to write such an invitation now, but that only helps
     invitations written from today: one was already open in production when
     this was found, and a token in an inbox outlives the code that minted it.
     So the role is decided HERE, where the membership can actually be seen.

     The invite is still consumed and the card still adopted — they followed a
     real link and it should stop working afterwards — they simply keep the
     role they already had. */
  const { data: already } = await supabaseAdmin
    .from("memberships")
    .select("role")
    .eq("org_id", invite.org_id)
    .eq("user_id", session.user.sub)
    .maybeSingle();

  const role = (already?.role as string | undefined) ?? invite.role;

  if (!already) {
    await supabaseAdmin
      .from("memberships")
      .upsert(
        { user_id: session.user.sub, org_id: invite.org_id, role: invite.role },
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
  await adoptStaffCard(invite.org_id, session.user.sub, invite);

  /* The staff card has to exist before they land on /dashboard. `updateSession`
     below writes the cookie directly and does NOT run `beforeSessionSaved`, so
     nothing else creates it until their NEXT sign-in — and without it
     `staffProfileIdFor` returns null, which silently refuses commenting,
     reacting, RSVPing, poll votes and every document upload ("No staff record
     for this account"), and leaves them out of the team list so they can't even
     be assigned a task. That's the whole first session for every invited
     employee, which is the one path every real staff member takes. */
  await ensureStaffCard(invite.org_id, session.user.sub, session);

  /* The role they ACTUALLY hold, which is not the invited one when they were
     already a member — the session must not claim otherwise. (Every gate reads
     the DB per request anyway, so a wrong value here would be a lie the screens
     tell rather than an escalation; it is still a lie.) */
  await auth0.updateSession({
    ...session,
    orgId: invite.org_id,
    orgRole: role,
  });

  return NextResponse.redirect(new URL("/dashboard", request.url));
}
