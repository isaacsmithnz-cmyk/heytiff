# One person, one account — password or Google

Auth0 treats a Google login and a password login as **two different users**,
even on the same address. Somebody who signed up with a password and later
reaches for Google — because they forgot it, or because the button is right
there — arrives as a brand-new user with no membership, no staff card and no
history.

Before [#603](https://github.com/isaacsmithnz-cmyk/heytiff/pull/603) the app
then *founded them a company*. Now they land on `/start`, which is honest but
is still not their account, and pressing "create a company" there produces the
phantom org all over again.

It is not hypothetical. On 2026-09-02 the tenant held four orgs and three were
phantoms of exactly this shape — Isaac had two identities, Bruce had two.

## The fix

`auth0/actions/link-google-to-password.js`, a **post-login Action**. On a
Google login whose email Google has verified, if exactly one database user
already holds that address, it links the Google identity into that user.

From then on the Google identity **is** that user: same `sub`, same
membership, same staff card, nothing to choose and nothing to explain.

### Why it asks for a second click

Linking mid-login does not change who the login is *for*. Auth0's own note:
it "does not automatically change to the correct primary user after Account
Linking."

The supported fix is `api.authentication.setPrimaryUser()` — but that is
**only available inside `onContinuePostLogin`**, which means redirecting out
to a page we host and back, with a session token to validate. That is an
endpoint and a class of bug to own forever, and Auth0 publishes a support
article about the primary-user update getting lost between those redirects.

So the Action links, then stops, and the person presses Continue with Google
once more. The second attempt needs no special handling at all — by then the
Google identity genuinely belongs to the primary account.

**Cost: one extra click, once, per person who ever uses Google.** It renders
as an error page, which is a shame for what is actually a success, so the copy
carries the whole meaning:

> Your Google sign-in is now connected to your HeyTiff account. Press Continue
> with Google once more to finish.

## The security argument

Auth0 advises **against** automatic linking on a verified email, on the
grounds that a verified email is not proof the person can still authenticate
to the other account. That is right in general, and is why the guards are
narrow.

It is accepted here on one specific ground: **the only identities linked are
ones Google has verified.** Whoever holds that inbox can already take the
password account by asking for a reset — the letter lands in the same place.
So the link grants no access that the same attacker did not already have,
while refusing to link costs a support call every time a tradie on a roof
forgets a password.

That reasoning does not extend past its edges, and each edge is refused in
code rather than left to judgement:

| situation | behaviour |
| --- | --- |
| Google, `email_verified: true`, one database account | **link** |
| `email_verified: false` | refuse — the guard everything rests on |
| two accounts hold the address | refuse — picking one is guessing whose company to hand over |
| another social provider | refuse — that is somebody else's verification policy |
| no database account | refuse — a genuinely new person, `/start` is correct |
| the match is the caller itself | refuse |

Every one of those is a test in `auth0/actions/__tests__/`.

**Linking failure never blocks a login.** A Management outage, a revoked grant
or a rate limit leaves the person exactly where they were before the Action
existed — signed in, sent to `/start` — with a line in the Auth0 log stream.

## Installing it

Auth0 → **Actions → Library → Build Custom** → *post-login*, paste the file
in, then under the Action's own settings:

| | |
| --- | --- |
| **Secrets** | `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` |
| **Dependencies** | `auth0` (latest) |

Those credentials need **`read:users`** and **`update:users`**. `read:users`
is not on the app's existing grant — and this is a good reason to give the
Action **its own M2M application** rather than reuse the app's, the same
argument as `docs/auth0-branding.md` makes about `update:branding`: the
running web server has no need to read every user in the tenant.

Then drag it into the **Login** flow and Apply.

## What it does not fix

- **Existing split identities.** The Action fires on a *login*. Isaac's Google
  identity currently has no membership at all, so linking it by hand once
  (`POST /api/v2/users/{id}/identities`) is still the way to join it to the
  Diamond Air owner — or he can simply sign in with Google and let the Action
  do it.
- **Two database accounts on one address.** Refused deliberately. An admin
  merges those by hand.
- **`createInvite` has no existing-member guard**, so inviting somebody who is
  already in the org is possible and always wrong. Separate fix.
