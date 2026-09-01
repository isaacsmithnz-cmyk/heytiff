# The Auth0 Management API grant

The **Sign-in** section on `/dashboard/profile` lets a person change the
address they sign in with. Until the step below is done, it renders fine and
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

If the send fails the change still succeeds and the screen says so, rather than
reporting failure for an address that has in fact already moved — the worst of
both, because the person would not go looking for the mail either.

## The consequence worth knowing before you use it

For a database connection the sign-in address **is** the username. There is no
verify-then-switch dance available without a mailer, so the address changes on
submit. The guard is that the new address must be typed twice; past that,
getting it wrong means being unable to sign in.

The session cookie is not reissued, either — it carries the old address until
the next sign-in. The card shows the new one from its own state after a
successful change, because the stale prop would otherwise print the old
address directly above the message saying it had changed.
