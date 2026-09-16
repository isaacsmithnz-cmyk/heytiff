# The Auth0 Management API grant

The **Change** action on the Email row of `/dashboard/profile` → Personal lets
a person change the address they sign in with. Until the step below is done, it renders fine and
every attempt comes back with:

> HeyTiff isn't allowed to change sign-in addresses yet — the Auth0
> application needs the Management API grant with `update:users`.

That sentence is deliberate. This is configuration, not a bug, and the message
names the exact thing that is missing so nobody goes looking in the code.

## Why it is needed at all

`profiles.email` is **not a fact this app owns**. `beforeSessionSaved` in
[`src/lib/auth0.ts`](../src/lib/auth0.ts) re-upserts it from the Auth0 session
on *every* login, so writing a new address into our own table changes what the
app shows until the next sign-in and nothing after that. The address lives in
Auth0, and the Management API is the only way to move it.

## The step

Auth0 dashboard → **Applications → APIs → Auth0 Management API →
Machine to Machine Applications** → find the HeyTiff application (the one whose
client id is `AUTH0_CLIENT_ID`) → toggle it **Authorized** → expand it and tick:

| scope | what it is for |
| --- | --- |
| `update:users` | moving the address — `PATCH /api/v2/users/{id}` |
| `read:users` | an invitation: does this address already have a login, and has it been used — `GET /api/v2/users-by-email` |
| `create:users` | an invitation: the invitee's password login — `POST /api/v2/users` |
| `create:user_tickets` | an invitation: the "Set your password" link — `POST /api/v2/tickets/password-change` |

The last three were ticked on 2026-09-16, under **Client Access** on the
application's **API Access** tab (the dashboard's current name for the grant),
together with the application's **Application Login URI** set to
`https://go.hey-tiff.com/auth/login` — see *Invitations* below for why both.

`POST /api/v2/jobs/verification-email` is covered by the same grant.

**No new secrets.** Auth0 lets a Regular Web Application hold a Management API
grant, so this reuses the `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET` that
already run the login. There is deliberately no second application and no
extra environment variable to leak.

## What the grant lets the app do, and what stops it

`update:users` can change **any** user's email in the tenant. The only thing
standing between that and an account-takeover endpoint is that
`changeMySignInEmail` takes the user id **from the session and from nowhere
else** — it is not a parameter, and there is no admin version. An owner who
could move a colleague's sign-in address could take their account, so "the
owner can do anything" is deliberately not true of identity here.

See [`src/lib/integrations/auth0-management.ts`](../src/lib/integrations/auth0-management.ts)
and [`src/app/actions/account.ts`](../src/app/actions/account.ts).

## Verification email

The new address is written with `email_verified: false` — an address nobody
has proved they can read is not yet an identity — and Auth0 is then asked to
send its own verification mail.

**It has to be Auth0's, because this app cannot send email.** Resend was never
wired (see the TODO in [`src/app/actions/invite.ts`](../src/app/actions/invite.ts)),
which is also why an invite is a copied link rather than a message. So the mail
depends on the tenant's own email provider:

- A tenant still on Auth0's **development** provider will send it, but that
  provider is rate-limited and explicitly not for production use.
- Configure a real provider under **Branding → Email Provider** before anyone
  relies on it.

That provider is also what unblocks the *look* of the mail: Auth0 refuses a
custom email template on the built-in provider, so until it is configured the
HeyTiff-branded verification letter in `src/lib/brand/auth0/` cannot be pushed
at all. See [the branding doc](./auth0-branding.md).

If the send fails the change still succeeds and the screen says so, rather than
reporting failure for an address that has in fact already moved — the worst of
both, because the person would not go looking for the mail either.

## The consequence worth knowing before you use it

For a database connection the sign-in address **is** the username. There is no
verify-then-switch dance available without a mailer, so the address changes on
submit. The guard is that the new address must be typed twice; past that,
getting it wrong means being unable to sign in.

The session cookie is not reissued by Auth0 either — `session.user.email` is a
claim minted at LOGIN. The action rewrites the cookie itself via
`auth0.updateSession` so the whole app sees the new address immediately;
before that was added, a real change looked like it had silently failed:
Auth0 had the new address, `profiles` had it, and every screen still rendered
the old one until the person signed out and back in.

## Invitations: "Set your password" instead of the sign-up screen

An invitation used to open Auth0's **sign-up** screen, which on this plan is one
set of words shared with the founder at the front door, one password box, and
"Create your account" — it read as signing in, or as founding a company. Since
2026-09-16 [`/invite/accept`](../src/app/invite/accept/route.ts) does this for an
anonymous visitor holding a live invitation:

1. `GET /users-by-email` for the **invitation's** address.
2. Any login there that has **been used** (`logins_count > 0`) → the sign-in
   screen with the address filled in. Nothing is created and no ticket is ever
   minted for it.
3. Otherwise → create the password login (or reuse the unused one an earlier
   click made), `POST /tickets/password-change` for it, **accept the invitation
   there and then** (Isaac: "accept at the click"), and redirect to the ticket.
4. Every failure falls back to the old sign-up door, except a ticket that fails
   after the login exists, which goes to sign-in (the sign-up screen would now
   refuse the address; "Forgot password?" still works).

The ticket opens Auth0's **reset-password** screen — reworded in
[`prompts.ts`](../src/lib/brand/auth0/prompts.ts) to words true for both an
invitee and a forgotten password: *Set your password*, two boxes, *Set password*.

**The Application Login URI is load-bearing.** On the New Universal Login a
ticket's `result_url` is ignored; the finished screen's button goes to the
application's Login URI instead, and only because the ticket carries
`client_id`. Unset, the invitee finishes on "Password set" with nowhere to go.

### What these scopes can do, and what stops it

`create:user_tickets` can mint a password reset for **any** account in the
tenant — the same class of power `update:users` already had. Two things keep it
from being an account-takeover endpoint:

- The address is read off the invitation row the **token** found, never from
  the request. Holding a live invitation token was already enough to join that
  workspace; it grants nothing more here.
- A ticket is only ever minted for a login that has **never been used**. A
  login somebody has signed in with — a password one or a Google one — gets the
  sign-in screen. `src/app/invite/__tests__/accept.test.ts` holds this, and the
  test was checked to fail with the guard removed.

