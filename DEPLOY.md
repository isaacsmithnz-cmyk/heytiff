# Deploying HeyTiff to Vercel

This assumes a Vercel project named **`heytiff`**, giving the production URL
**`https://heytiff.vercel.app`**. If that name is taken and Vercel gives you a
different URL, substitute it everywhere below (Auth0 URLs + `APP_BASE_URL`).

---

## 1. Auth0 dashboard — allow the production URL

Auth0 → **Applications → [your HeyTiff app] → Settings**. Add the production URL
alongside the existing localhost ones (comma-separated, keep both so dev still works):

| Field | Value |
|---|---|
| **Allowed Callback URLs** | `http://localhost:3000/auth/callback, https://heytiff.vercel.app/auth/callback` |
| **Allowed Logout URLs** | `http://localhost:3000, https://heytiff.vercel.app` |
| **Allowed Web Origins** | `http://localhost:3000, https://heytiff.vercel.app` |

Scroll down and **Save Changes**.

---

## 2. Vercel — import the repo

1. vercel.com → **Add New → Project** → import `isaacsmithnz-cmyk/heytiff`.
2. Set the **Project Name** to `heytiff` (this decides the `.vercel.app` URL).
3. Framework preset: **Next.js** (auto-detected). Leave build/output defaults.

---

## 3. Vercel — environment variables

Project → **Settings → Environment Variables**. Add each of these (copy the values from
your local `.env.local`), scope = **Production** (and Preview if you want preview builds):

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | same as local |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same as local |
| `AUTH0_DOMAIN` | same as local |
| `AUTH0_CLIENT_ID` | same as local |
| `AUTH0_CLIENT_SECRET` | same as local |
| `AUTH0_SECRET` | same as local |
| `APP_BASE_URL` | **`https://heytiff.vercel.app`** ← the one value that differs from local |
| `SUPABASE_SERVICE_ROLE_KEY` | same as local |
| `SUPABASE_JWT_SECRET` | same as local |
| `HQ_EMAILS` | comma-separated allowlist of staff logins for the hidden `/hq` portal (see `docs/hq-portal.md`). **Unset ⇒ `/hq` 404s for everyone** (fail-closed). |
| `GOOGLE_MAPS_API_KEY` | Google Places key behind the address autocomplete on the staff and Organisation address fields. **Optional — unset, those fields are plain text inputs and nothing else changes.** Server-side only: it is read in the `/api/address` proxy and must never be given a `NEXT_PUBLIC_` prefix, which would ship it to every browser. |
| `XERO_CLIENT_ID` | See **Xero** below. Optional — unset, Admin → Integrations renders but says connecting isn't available. |
| `XERO_CLIENT_SECRET` | Same. Server-side only, never `NEXT_PUBLIC_`. |
| `SM8_CLIENT_ID` | See **ServiceM8** below. ServiceM8 calls it the **App ID**. Optional — unset, the ServiceM8 screen renders but says connecting isn't available. |
| `SM8_CLIENT_SECRET` | Same — ServiceM8's **App Secret**. Server-side only, never `NEXT_PUBLIC_`. |
| `INTEGRATIONS_TOKEN_KEY` | 32-byte key that seals OAuth tokens before they reach the database. Required to connect anything — without it the Connect button is switched off rather than storing tokens in plaintext. |
| `CRON_SECRET` | Guards the scheduled routes (`/api/cron/*`). **Vercel sets and sends this itself** once a `crons` entry exists in `vercel.json` — you only need to add it manually if you want to trigger a sweep by hand. **Unset ⇒ every cron request is refused** (fail-closed): the routes run with no session and service-role access, so the secret is the only gate. |

---

## 3b. Xero (optional — Admin → Integrations)

**ONE Xero app serves every HeyTiff customer.** These credentials are the
platform's, set once here — a customer never supplies a client id, secret or key.
All they do is press **Connect to Xero**, sign in to their own Xero, and approve;
what gets stored per workspace is only the grant that produces.

Until this section is done, Admin → Integrations still renders and tells owners
the feature isn't switched on yet — it never asks them for credentials.

1. **developer.xero.com → My Apps → New app**, type **Web app**.
2. **Redirect URI** — must match exactly what the code builds from `APP_BASE_URL`:
   | Where | Value |
   |---|---|
   | Production | `https://heytiff.vercel.app/api/integrations/xero/callback` |
   | Local dev | `http://localhost:3000/api/integrations/xero/callback` |

   Xero allows several, so add both.
3. Copy the **Client id** and generate a **Client secret** → `XERO_CLIENT_ID` /
   `XERO_CLIENT_SECRET` in Vercel (and `.env.local`).
4. Generate the token key and set it as `INTEGRATIONS_TOKEN_KEY`:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

   **Set it once and don't rotate it casually.** Tokens already stored were sealed
   with the old key; changing it makes them unreadable and every connection has to
   be reconnected (the app detects this and says so — it never fails silently).
5. Apply `docs/migrations/integration_connections.sql` to Supabase.
6. Sign in as an **owner** → **Admin → Integrations → Xero → Connect to Xero**.

Scopes are read-only and are listed, with the reason for each, on that screen —
`src/lib/integrations/providers.ts` is the single source both it and the consent
URL read from.

### The weekly drift sweep

`vercel.json` schedules `/api/cron/xero-drift` for **Monday 06:00 UTC**. Xero
publishes no payroll webhook, so nothing tells HeyTiff when a pay rate changes
over there — this is what notices. It:

- asks Xero **what changed since last time** (`If-Modified-Since`), so a quiet
  week costs **one API call per workspace**, not one per employee;
- recomputes every linked person's wage only when something actually moved;
- stores **a count and a timestamp** — never the rates, which stay behind the
  `financials`-gated *Check pay rates* read;
- surfaces one advisory line on Time & Pay when wages disagree.

It writes nothing to Xero and changes no wage. Adopting a rate is still a human
tap. A side effect worth knowing: the weekly call keeps the refresh token from
ever hitting Xero's 60-day idle expiry.

Nothing to configure — Vercel manages `CRON_SECRET` itself. Apply
`docs/migrations/integration_drift.sql` before merging.

---

## 3c. ServiceM8 (optional — Admin → Integrations, and the Workboard)

**ONE ServiceM8 add-on serves every HeyTiff customer**, exactly like Xero: these
credentials are the platform's, set once here, and a customer only ever presses
**Connect to ServiceM8** and approves in their own account.

Until this section is done, the ServiceM8 screen says the feature isn't switched
on yet, and the **Workboard still works** — projects and maintenance are typed in
by hand and a connection only enriches them.

1. **Sign up as a developer.** In ServiceM8, open the main menu → the account
   section → **Developer**. (This is a one-off registration on the HeyTiff-owned
   ServiceM8 account — not on a customer's.)
2. **Developer → Add Item** to create the add-on. Type: a **Public Integration**
   — the OAuth 2.0 kind that reaches the REST API. Not a Private Integration
   (that's an API key for a single company) and not an Add-on SDK item (those
   put buttons inside ServiceM8's own UI).
3. **Return URL** — set it in the add-on's **Store Connect** settings. ServiceM8
   requires the redirect it is handed at consent time to be **the same host** as
   this value, and the code builds that redirect from `APP_BASE_URL`:

   | Where | Value |
   |---|---|
   | Production | `https://heytiff.vercel.app/api/integrations/servicem8/callback` |
   | Local dev | `http://localhost:3000/api/integrations/servicem8/callback` |

   Only the **host** has to match, so a Return URL of `https://heytiff.vercel.app`
   is enough for production.
4. Saving the add-on issues an **App ID** and **App Secret** on its Store Connect
   page → `SM8_CLIENT_ID` / `SM8_CLIENT_SECRET` in Vercel (and `.env.local`).
   The secret is a password: never commit it, never prefix it `NEXT_PUBLIC_`.
5. `INTEGRATIONS_TOKEN_KEY` is **shared with Xero** — if step 3b is done, there is
   nothing to do here. It seals ServiceM8's tokens the same way.
6. Apply `docs/migrations/sm8_mirror.sql` (and, for the Workboard itself,
   `workboard_projects.sql` + `workboard_maintenance.sql`).
7. Sign in as an **owner** → **Admin → Integrations → ServiceM8 → Connect to
   ServiceM8**.

The ten scopes are read-only and listed, with the reason for each, on that screen;
`src/lib/integrations/providers.ts` is the single source both it and the consent
URL read from. Badges are deliberately absent — ServiceM8's only badge scope is a
write scope, and a jest test pins it out.

**No store submission is needed to use your own add-on.** The Add-on Store review
applies to listing it publicly; connecting your own ServiceM8 account to your own
add-on does not require approval.

**Disconnecting is only half a revocation.** ServiceM8 publishes no token-revoke
endpoint, so Disconnect deletes HeyTiff's sealed tokens (and wipes the mirror);
finishing the job means removing the add-on inside ServiceM8 itself. The screen
says so at the point of use.

### The daily mirror top-up

`vercel.json` schedules `/api/cron/sm8-sync` for **20:00 UTC daily** — 6am on the
east-coast AU clock, so the board is true before anyone starts.

It is **daily, not hourly, because this project is on Vercel's Hobby tier**, which
fails the deployment outright for any cron that would run more than once a day
(`0 * * * *` is named in their docs as an example that does). That costs nothing:
freshness is the page-load kick — opening the Workboard tops the mirrors up behind
the response — and this run only covers the hours nobody is looking. On Pro, one
line in `vercel.json` and one in the route header make it hourly.

---

## 4. Deploy & verify

1. **Deploy**. Wait for the build to finish.
2. Visit `https://heytiff.vercel.app` → you should be sent to Auth0 login.
3. Sign in → you land on `/dashboard`.

If the assigned URL is NOT `heytiff.vercel.app`, update the Auth0 URLs (step 1) and
the `APP_BASE_URL` env var (step 3) to match, then redeploy.

---

## Notes

- `.env.local` is gitignored — secrets are never pushed. Vercel env vars are the
  production source of truth.
- **Preview deployments** (per-branch URLs) won't pass Auth0 login unless you also add
  their URLs to Auth0. Production is what matters for now.
- Supabase needs no change — it's already cloud-hosted and the keys are environment-based.

---

## Why `vercel.json` pins the region to `sin1`

Every screen in this app is server-rendered per request and reads Supabase
several times before it can paint. **What a page waits for is the depth of its
await chain × the distance to the database** — so the functions are pinned to
the same city as the database.

Before pinning, the response header read `x-vercel-id: syd1::iad1::…`. That is
two different regions: the **edge** that took the request was Sydney, but the
**function that ran the page was `iad1` — Washington DC.** Vercel's default
function region is US East, and nothing had ever overridden it. So an
Australian user's request crossed the Pacific to Virginia, and every Supabase
query it then made crossed *back* to Singapore and returned.

| | Before | After |
|---|---|---|
| Supabase | `ap-southeast-1` (Singapore) | unchanged |
| Vercel function | `iad1` (Washington DC) | **`sin1` (Singapore)** |
| User → function | ~200ms | ~90ms |
| Function → each query | ~230ms | ~2ms |

**Both sides improve** — this is not the usual latency trade-off, because the
old region was far from the users *and* far from the data. A page whose await
chain is four deep was spending roughly a second on distance alone.

Static assets are unaffected either way: they come off Vercel's global edge
CDN, not the function region.

**If the business ever moves off Singapore Supabase, change this too.** Pinning
compute to a region the database is not in is worse than not pinning at all —
that is exactly the state this replaced. The genuinely best end state is both
in Sydney (`ap-southeast-2` + `syd1`), which needs a Supabase project
migration: not attempted, and worth far less than this change was.

**To check it is still in effect:** any dynamic route's response header should
read `x-vercel-id: <edge>::sin1::…`. If the middle segment is missing or says
something else, the pin is not applying.
