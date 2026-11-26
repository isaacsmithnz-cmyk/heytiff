import { type NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { acceptInvitation, type Invitation } from "@/lib/invite-accept";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  createPasswordTicket,
  createPasswordUser,
  findUsersByEmail,
} from "@/lib/integrations/auth0-management";
import { setInviteeHint } from "@/lib/invite-hint";
import type { InviteProblemReason } from "@/components/start/invite-problem";

/** Auth0's sign-in screen with the invited address filled in, coming back here
    to accept. For somebody who already has a login. */
function signInRedirect(request: NextRequest, email: string, token: string): NextResponse {
  const to = new URL("/auth/login", request.url);
  to.searchParams.set("login_hint", email);
  // set LAST and via searchParams, so its own `?token=` is encoded rather
  // than read as another parameter of this URL
  to.searchParams.set("returnTo", `/invite/accept?token=${token}`);
  return NextResponse.redirect(to);
}

/* THE INVITEE'S OWN DOOR — "Set your password", two boxes, and they are in.

   Isaac, on the sign-up screen an invitation used to open: it said "create
   your account", took the password once, and looked either like signing in or
   like founding a company. Auth0 cannot change that screen per person on this
   plan — its words are one global string shared with the founder at the front
   door — but its password screen is exactly the right shape, and a ticket
   opens it for one user. So, for somebody who has never signed in:

     1. find the logins holding the invited address
     2. anyone who HAS signed in before gets the sign-in screen instead — a
        ticket is never minted for a login that has been used, because that
        would be a password reset handed to whoever holds the link
     3. otherwise create the login (or reuse the unused one an earlier click
        made), mint its ticket, and ACCEPT NOW — Isaac, 2026-09-16: "accept at
        the click". The token in their inbox is the proof, exactly as it is for
        the signed-in door. Accepting before the password means that when the
        ticket's finished screen sends them to sign in, the membership is
        already there and they land in the workspace, not on /start.
     4. redirect to the ticket

   THE ADDRESS IS THE INVITATION'S, NEVER THE REQUEST'S. Everything below reads
   `invite.email` off the row this route looked up by token.

   NULL MEANS "USE THE OLD DOOR", and every failure returns it. No grant, no
   tenant, Auth0 down, an invitation already dead: the invitee falls back to the
   sign-up screen with their address filled in, which is exactly what they got
   before this existed. The ticket failing AFTER a login was created is the one
   exception — that login exists now, so the old sign-up screen would refuse the
   address; they get the sign-in screen, whose reset link still works. */
async function setPasswordRedirect(
  request: NextRequest,
  invite: Invitation,
  token: string
): Promise<NextResponse | null> {
  // A dead invitation creates nobody. The old door leads to the same refusal.
  const expired = new Date(invite.expires_at) < new Date();
  if (!invite.accepted_at && expired) return null;

  const found = await findUsersByEmail(invite.email);
  if (!found.ok) return null;
  if (found.value.some((u) => u.loginsCount > 0)) {
    return signInRedirect(request, invite.email, token);
  }

  let userId = found.value.find((u) => u.userId.startsWith("auth0|"))?.userId ?? null;
  if (!userId) {
    const created = await createPasswordUser({ email: invite.email, name: invite.name });
    if (created.ok) {
      userId = created.value.userId;
    } else if (created.error === "EMAIL_IN_USE") {
      // two clicks at once — the other one made the login; use it
      const again = await findUsersByEmail(invite.email);
      userId = again.ok ? (again.value.find((u) => u.userId.startsWith("auth0|"))?.userId ?? null) : null;
    }
    if (!userId) return null;
  }

  const ticket = await createPasswordTicket(userId);
  if (!ticket.ok) return signInRedirect(request, invite.email, token);

  // Accepted once, by whichever click got here first; a second click on an
  // accepted invitation only mints a fresh ticket.
  if (!invite.accepted_at) {
    await acceptInvitation(invite, userId, { user: { email: invite.email } });
  }

  /* Their address rides a cookie past Auth0's password screen, so the sign-in
     its button opens is filled in (lib/invite-hint.ts). */
  return setInviteeHint(NextResponse.redirect(ticket.value), invite.email);
}

/** The invitation screen that says why this link cannot be accepted. The
    REASON travels, never the words or an address — the page reads those off
    the invitation itself (app/invite/error/page.tsx). */
function problemRedirect(request: NextRequest, reason: InviteProblemReason, token: string): NextResponse {
  const to = new URL("/invite/error", request.url);
  to.searchParams.set("reason", reason);
  to.searchParams.set("token", token);
  return NextResponse.redirect(to);
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

       The row is read by token alone — no filter on expiry or acceptance —
       because an accepted invitation's address is still the right one to
       prefill; what a dead or expired one gets is decided just below. */
    const { data: invited } = await supabaseAdmin
      .from("invitations")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    /* A LINK THAT CANNOT WORK SAYS SO BEFORE ANYBODY MAKES AN ACCOUNT.

       A dead token, or an invitation that ran out before anyone accepted it,
       used to fall through to the sign-up screen — so a new person chose a
       password, made a login, and only then met "This invite has expired".
       Neither answer depends on who is asking, so it is given here, first.
       An ACCEPTED invitation still goes on: its unused login gets a fresh
       ticket, and anyone else is sent to sign in. */
    if (!invited) return problemRedirect(request, "not_found", token);
    if (!invited.accepted_at && new Date(invited.expires_at as string) < new Date()) {
      return problemRedirect(request, "expired", token);
    }

    const door = await setPasswordRedirect(request, invited as Invitation, token);
    if (door) return door;

    const to = new URL("/auth/login", request.url);
    to.searchParams.set("screen_hint", "signup");
    to.searchParams.set("login_hint", invited.email as string);
    // set LAST and via searchParams, so its own `?token=` is encoded rather
    // than read as another parameter of this URL
    to.searchParams.set("returnTo", `/invite/accept?token=${token}`);
    return NextResponse.redirect(to);
  }

  const { data: invite, error } = await supabaseAdmin
    .from("invitations")
    .select("*")
    .eq("token", token)
    .single();

  if (error || !invite) return problemRedirect(request, "not_found", token);
  if (invite.accepted_at) return problemRedirect(request, "used", token);
  if (new Date(invite.expires_at) < new Date()) return problemRedirect(request, "expired", token);
  // Case-insensitive: the row is stored lowercased, but Auth0 relays the
  // identity provider's casing. Only the comparison normalises — the screen
  // shows each address as its own side spelt it.
  if (invite.email.toLowerCase() !== session.user.email?.toLowerCase()) {
    return problemRedirect(request, "wrong_account", token);
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
  const role = await acceptInvitation(invite as Invitation, session.user.sub, session);

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
