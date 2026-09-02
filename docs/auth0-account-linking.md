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

### Why there is a redirect in the middle

Linking mid-login does not change who the login is *for*. Auth0's own note:
it "does not automatically change to the correct primary user after Account
Linking." Left there, the person finishes signed in as the throwaway Google
user — which by then has no identities of its own — and lands on `/start`,
having gained nothing.

`api.authentication.setPrimaryUser()` is the fix, and it is **only callable
from `onContinuePostLogin`**, which only runs after the Action has sent the
browser out and got it back. So the flow bounces through
[`/link-account`](../src/app/link-account/route.ts) — a route that renders
nothing and exists solely to hand Auth0's `state` to `/continue`. The person
sees a redirect flash.

**The first version did not bounce.** It linked, then refused the login with
*"press Continue with Google once more"* — which worked, cost no endpoint, and
spent a click of every person's patience to save one file. One route handler
is cheaper than a click each, forever.

### The bounce is the open-redirect surface, and is treated as one

`/link-account` takes a value off the query string and puts it in a URL it
redirects to. That is the shape of every open redirect ever written, so two
independent guards keep the host out of the caller's hands:

- `state` must match `^[A-Za-z0-9._~-]{1,512}$` — no `:`, `/`, `@` or `#` can
  survive it, and it is bounded so it cannot amplify a URL
- the destination is built from `AUTH0_DOMAIN` and a fixed path, with the
  state set as a query **value** via `searchParams`, never interpolated into
  the string

Either alone defeats the attack; removing one still leaves the tests green on
the host assertion, which is the point of having both. `?state=https://evil.test`,
`//evil.test`, `abc@evil.test` and a CRLF injection are each pinned by a test.

**`AUTH0_DOMAIN`, not `AUTH0_TENANT_DOMAIN`** — `/continue` belongs to the
login transaction, so it lives on whichever domain the person is
authenticating against. The tenant domain is for the Management API alone
(see `lib/integrations/auth0-tenant-domain.ts`).

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
| **Secrets** | `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `APP_BASE_URL` |
| **Dependencies** | `auth0` (latest) |

Those credentials need **`read:users`** and **`update:users`**. `read:users`
is not on the app's existing grant — and this is a good reason to give the
Action **its own M2M application** rather than reuse the app's, the same
argument as `docs/auth0-branding.md` makes about `update:branding`: the
running web server has no need to read every user in the tenant.

`APP_BASE_URL` is the origin the redirect bounces through —
`https://go.hey-tiff.com`. It must also be listed in the tenant's **Allowed
Web Origins**, or Auth0 will refuse the round trip.

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
