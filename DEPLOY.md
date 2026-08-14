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
| `ANTHROPIC_API_KEY` | Claude, server-side: fleet valuations, receipt reading, and the Smart Notes brain. Optional — unset, those features say so instead of failing. Never `NEXT_PUBLIC_`. |
| `ELEVENLABS_API_KEY` | See **Smart Notes** below. Optional — unset, **notes still work**: the mic simply isn't offered and the paste box does everything. Never `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_VOICE_REALTIME` | `1` streams dictation live instead of transcribing on stop. Optional, off by default, build-time. Holds no secret — see **Live transcription** below. |
| `INTEGRATIONS_TOKEN_KEY` | 32-byte key that seals OAuth tokens before they reach the database. Required to connect anything — without it the Connect button is switched off rather than storing tokens in plaintext. |
| `SELF_SERVE_SIGNUP` | `1` lets a first login with **no invitation** create its own organisation and own it. **Unset ⇒ off**, which is what you want for a single-company deployment: without it, anyone who reaches the site and signs in lands on `/no-org` instead of silently becoming the owner of an empty company nobody can get them out of. Turn it on only when strangers signing themselves up is the intended front door. |
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

1. **Register a Developer account first — this is a separate form on
   servicem8.com, NOT a section inside the app**:
   <https://www.servicem8.com/developer-registration>. You accept their
   Developer Agreement here. **Until this is done there is no Developer menu to
   find**, which is exactly how this step gets missed — the menu appears only
   once ServiceM8 has created the developer account. Their add-on-types doc is
   the authority: sign up for a Developer account, *then* create a Store Item
   in the Developer menu. Whether it is instant or reviewed is undocumented, so
   watch for their email before assuming something is broken.

   **Observed 2026-07-29: it is NOT self-serve.** You submit the form and
   ServiceM8 emails you back — so budget for a wait rather than expecting the
   Developer menu to appear on a refresh.

   Do this on the **HeyTiff-owned ServiceM8 account** — not a customer's. That
   account owns the add-on permanently, and every customer connects *to it*.
2. **Developer menu → Add Item** to create the add-on (ServiceM8's docs call it
   a "Store Item"). Type: a **Public Integration** — the OAuth 2.0 kind that
   reaches the REST API. Not a Private Integration (that's an API key for a
   single company) and not an Add-on SDK item (those put buttons inside
   ServiceM8's own UI).
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

## 3d. Smart Notes voice (optional — the mic on the Workboard)

**Unset, nothing breaks.** The mic button isn't rendered, the paste box is still
there, and a typed note goes through the identical brain → review card → apply
path. This key buys dictation, not the feature.

1. Create an ElevenLabs account, then an API key at
   <https://elevenlabs.io/app/settings/api-keys>.
2. **Restrict the key** — their keys support scope restriction, a credit quota
   and IP allowlisting. Limit it to **speech-to-text** and set a **credit
   quota**. A transcription key that can also synthesise voices is a bigger
   blast radius than this feature needs, and the quota is what turns a runaway
   loop into a failed request instead of a bill.
3. `ELEVENLABS_API_KEY` in Vercel (and `.env.local`). Server-side only — a
   `NEXT_PUBLIC_` prefix would hand the key to every browser. **Redeploy**: env
   vars only reach a running deployment through a new build.
4. `ANTHROPIC_API_KEY` must also be set, or the mic records and transcribes and
   then has nothing to route with.

The adapter is `src/lib/voice/transcribe.ts`: `POST /v1/speech-to-text`,
`xi-api-key` header, `model_id=scribe_v2`. Keyterms are built per request from
the roster and client book — "tell Luke" only becomes a task for Luke if the
transcriber heard Luke. ElevenLabs allows **1000 keyterms of 50 chars** in batch
mode; **we cap at 60 deliberately**, because past 100 they bill a 20-second
minimum per request and site notes are often shorter than that.

Audio is transcribed and **dropped** — only the transcript is stored. It is the
evidence for what was applied; the recording is a voice in someone's house.

**One vendor, no runtime failover.** The adapter exists so the vendor can be
swapped, not so a second one can be kept warm. When transcription fails the UI
keeps the recording client-side, offers a retry, and falls through to the paste
box.

### Live transcription — `NEXT_PUBLIC_VOICE_REALTIME` (off by default)

Set it to `1` and dictation streams to **Scribe v2 Realtime** instead of
uploading when you stop: words appear in the box as they're said, and stopping
costs a flush rather than a whole upload-and-transcribe round trip. Unset — or
any value but `1` — is the batch path above, unchanged.

`NEXT_PUBLIC_` because it is read in the browser to pick a transport, and it is
a **build-time** value: flipping it means a redeploy, same as
`NEXT_PUBLIC_STUDIO_SIM`. It carries no secret. `ELEVENLABS_API_KEY` is still
what decides whether a mic is offered at all; this only changes how the audio
travels.

**The browser opens the socket, not us** — Vercel Hobby functions can't hold a
WebSocket for the length of a sentence. `POST /api/workboard/transcribe/token`
(gated on `workboard`, like the audio route) mints a vendor **single-use token**
— 15 minutes, consumed on use — and returns it with the org's keyterms. The real
key never leaves the server.

**The recorder keeps running in both modes.** Token refused, handshake failed,
socket dropped, vendor error, empty transcript — every one of them falls back to
uploading the clip the old way, and the person sees a normal transcription. That
is what makes the flag safe to leave on.

Costs differ and it is worth knowing which meter you're on: batch bills
**$0.22/hr of audio**, realtime **$0.39/hr**, keyterms **+$0.05/hr** — but
elevenlabs.io/pricing also describes STT as **330 credits/minute** against the
plan's credit pool, which is roughly 16× the hourly rate. Check the workspace's
own usage page before assuming which applies. Realtime also bills **socket
wall-clock, not speech**, so an open mic in a quiet room costs money; the socket
uses the vendor's `vad` commit strategy and `dictation.tsx` closes it the moment
recording stops.

**The live transport is the one to use.** Measured on production 2026-08-04,
on the FREE plan, four consecutive notes: **0.82 / 0.92 / 0.84 / 0.84 s** to a
finished transcript, against **2.3–5.2 s** for batch. Words appear while you
are still speaking. Turn it on with `NEXT_PUBLIC_VOICE_REALTIME=1`.

One recording that day did come back with nothing, and it was briefly written
up here as the transport being broken. That was an overreaction to a single
failure — one bad note against four clean ones, and the log evidence behind
the diagnosis turned out to have been read off the wrong end of a
newest-first list. What that note DID expose was real and is fixed: an empty
recording used to return in complete silence, so a one-off hiccup was
indistinguishable from a broken feature. It now says so and logs.

**Comparing the two without a redeploy.** A build-time flag can't be A/B'd —
every swap would redeploy production — so `?voice=live` and `?voice=batch`
beat the flag, but **only for the page load carrying them**. Nothing is
stored; lose the query string and you are back on the default.

That is deliberate, and it is the other half of the 2026-08-04 failure. The
override originally lived in sessionStorage so it would survive navigation —
and an hour later a plain-looking URL was still quietly on the live
transport, producing nothing, which read as the whole feature being broken.
**A measuring switch you can't see in the address bar is a trap.** Keep the
parameter in the URL while you compare.

Each note prints one line to the console:

```
[voice] live · heard 0.41s · routed 8.12s · TOTAL 8.53s
```

`heard` is the transport — the only part the flag changes. `routed` is the
Opus 5 call in `note-brain.ts`. Both are printed because the second is
usually the larger, and "live is three seconds faster" means very little if
routing spends eight seconds afterwards either way.

Realtime keyterms are capped tighter than batch — **50 terms of 20 characters**
against 1000 of 50 — so `prepareKeyterms` takes the limits from its caller, and
the token route passes **staff names first**: a misheard name routes a task to
nobody.

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
