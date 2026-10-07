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
4. **Skew Protection** (Pro or Enterprise). Every deploy gives the server
   actions new ids, so a tab left open across a deploy presses an action the
   new deploy doesn't have ("Failed to find Server Action" in the log). Skew
   Protection sends that tab's requests to the deploy it was served from.
   Settings → Advanced → **Skew Protection** on, with **Enable access to
   System Environment Variables** on too, then redeploy production; only
   deploys built after that are protected. Set **Maximum Age** past how long a
   tab stays open (the default is one day; the ceiling is the retention
   policy). Nothing in `next.config.ts`: Next 14.1.4+ reads the deployment id
   Vercel gives the build, and a `deploymentId` set there that differs from it
   fails the build. With it off, a press from such a tab says "HeyTiff was
   updated. Reload the page to carry on." (`src/lib/stale-deploy.ts`, which
   knows Next's own rejection). Past the maximum age Vercel answers the old
   tab with its own 404 instead, which that line does not recognise, so the
   press says its usual failure: keep the maximum age long.

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
| `HQ_USER_IDS` | comma-separated allowlist of Auth0 account ids (a profile's `user_id`) for the hidden `/hq` portal — ids, not emails, so a changed sign-in address keeps access (`src/lib/hq/allow.ts`). **Unset ⇒ `/hq` 404s for everyone** (fail-closed). |
| `GOOGLE_MAPS_API_KEY` | Google Places key behind the address autocomplete on the staff and Organisation address fields. **Optional — unset, those fields are plain text inputs and nothing else changes.** Server-side only: it is read in the `/api/address` proxy and must never be given a `NEXT_PUBLIC_` prefix, which would ship it to every browser. |
| `XERO_CLIENT_ID` | See **Xero** below. Optional — unset, Admin → Integrations renders but says connecting isn't available. |
| `XERO_CLIENT_SECRET` | Same. Server-side only, never `NEXT_PUBLIC_`. |
| `SM8_CLIENT_ID` | See **ServiceM8** below. ServiceM8 calls it the **App ID**. Optional — unset, the ServiceM8 screen renders but says connecting isn't available. |
| `SM8_CLIENT_SECRET` | Same — ServiceM8's **App Secret**. Server-side only, never `NEXT_PUBLIC_`. |
| `SM8_WRITES` | The kinds of write this deployment may make to ServiceM8 (see **Writing to ServiceM8** below): `1` means files, which is what it has always meant; otherwise a comma list of kinds: `attachment` is files, `note` is notes, so `attachment,note` enables notes beside files, and `1` still means files only. **Leave it at `1` until phase 1's live walk is done** (see **Notes to ServiceM8** below). **Unset, empty or `0` ⇒ nothing is ever written** (fail-closed), and the ServiceM8 screen shows no sending setting. Set it on **Production only**: a preview build can be given the same database keys, and a branch must never be able to write to a customer's ServiceM8. |
| `ANTHROPIC_API_KEY` | Claude, server-side: fleet valuations, receipt reading, and the Smart Notes brain. Optional — unset, those features say so instead of failing. Never `NEXT_PUBLIC_`. |
| `ELEVENLABS_API_KEY` | See **Smart Notes** below. Optional — unset, **notes still work**: the mic simply isn't offered and the paste box does everything. Never `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_VOICE_REALTIME` | `1` streams dictation live instead of transcribing on stop. Optional, off by default, build-time. Holds no secret — see **Live transcription** below. |
| `RESEND_API_KEY` | Resend key for the app's own mail — today that is the staff invitation. Optional: **unset, an invite is still created and still works**, and the Team page says the letter didn't go so you copy its link instead. The sending domain `mail.hey-tiff.com` is already verified (it is what Auth0's letters go through — `docs/auth0-branding.md`). Server-side only, never `NEXT_PUBLIC_`. |
| `MAIL_FROM` | Overrides the sender on those letters. Optional — defaults to `HeyTiff <no-reply@mail.hey-tiff.com>`. Must be an address on a **verified** Resend domain, or every send is refused. |
| `INTEGRATIONS_TOKEN_KEY` | 32-byte key that seals OAuth tokens before they reach the database. Required to connect anything — without it the Connect button is switched off rather than storing tokens in plaintext. |
| `CRON_SECRET` | Guards the scheduled routes (`/api/cron/*`). **You create it**: Vercel → Settings → Environment Variables, Production, a random string of at least 16 characters. Once it exists, Vercel sends it as `Authorization: Bearer <CRON_SECRET>` on every scheduled call. **Unset ⇒ every cron request is refused** (fail-closed): the routes run with no session and service-role access, so the secret is the only gate. |
| `HOME_DESK` | **Gone — nothing reads it.** It switched the new Home on (`off`, `owner`, `on`) while it was built; it was set to `on` on 2026-09-26, and the switch went with the old Home. The new Home, the Tiff modal and the ServiceM8 asks' tasks are everyone's with or without it. Delete it from Vercel whenever convenient. |

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

Set `CRON_SECRET` first (see the table above); without it every run is
refused. Apply `docs/migrations/integration_drift.sql` before merging.

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
   `workboard_projects.sql` + `workboard_maintenance.sql`), then
   `docs/migrations/sm8_staying_connected.sql`. **Before merging the code
   that needs it**, run the two read-only checks in that file's header; both
   must return no rows. Check 2 is a hard stop: a workspace whose connection
   names a different account from its `sm8_vendor` row is read by the first
   sync as a change of account, which clears that workspace's mirror and
   cached photos and switches its sending off.
7. Sign in as an **owner** → **Admin → Integrations → ServiceM8 → Connect to
   ServiceM8**.

The ten scopes are read-only and listed, with the reason for each, on that screen;
`src/lib/integrations/providers.ts` is the single source both it and the consent
URL read from. Badges are deliberately absent — ServiceM8's only badge scope is a
write scope, and a jest test pins it out.

**No store submission is needed to use your own add-on.** The Add-on Store review
applies to listing it publicly; connecting your own ServiceM8 account to your own
add-on does not require approval.

**One ServiceM8 account per workspace.** ServiceM8's rate limit is per
account, and two workspaces writing to one account would double every note, so
connecting an account another HeyTiff workspace already holds is refused and
nothing is saved (a unique index is the backstop). Connecting a
*different* account — by Reconnect, or by Disconnect and then Connect —
replaces the old one: HeyTiff clears its copy of the old
account (the mirror, and its cached photos with what was read off them),
cancels anything still waiting to go to it, switches sending off, and the
ServiceM8 screen says so and keeps the old account's name as "Previous
account". Reconnecting the same account changes nothing but the tokens.

**Staying connected.** A token that runs out mid-sync, or a network blip on
the refresh, no longer asks the owner to reconnect: a refused request gets one
renewal and one more try, and only ServiceM8 saying the grant is dead flags
it. The refresh log line (`[sm8] token refresh <status>: <body>`) records
every refusal, with our secret and tokens struck out, which is how to check
the rule on a real removed add-on.

**Disconnecting is only half a revocation.** ServiceM8 publishes no token-revoke
endpoint, so Disconnect deletes HeyTiff's sealed tokens (and wipes the mirror);
finishing the job means removing the add-on inside ServiceM8 itself. The screen
says so at the point of use. The cached photos, what was read off them, and
the account's own name (`sm8_vendor`) stay, so reconnecting the same account
doesn't pay to read them again, and connecting a different one clears them.

### Writing to ServiceM8

The mirror only reads. The first thing HeyTiff writes back is a **file on a
job**: the office ticks papers and uploads on a job card's Documents tab and
presses **Send to ServiceM8**. Three switches must all be on before anything is
written, and each is re-read before every send:

1. **The deployment's** — `SM8_WRITES=1` in Vercel, Production only. It is
   the operator's allow-list of kinds; with one kind there is nothing to
   choose between.
2. **The owner's** — Admin → Integrations → ServiceM8 → **Sending files to
   ServiceM8**: Off (where every business starts), **Trial run** (the office can
   press the button and each send is checked and listed there, but nothing
   reaches ServiceM8), **Paused** (nothing goes, nothing waiting is lost), or
   **On**. Switching to Off cancels what is waiting, and says how many.
3. **ServiceM8's** — On asks for one extra permission, `manage_attachments`, at
   the next **Reconnect**, and the screen says so until it has been approved.
   Paused keeps asking for it, so switching back on needs no reconnect. Off
   and Trial run never ask for it. If ServiceM8 refuses a file for want of
   that permission, files wait until the next reconnect.

Apply `docs/migrations/sm8_writes.sql` first: it adds the owner's switch to the
connection and the queue every write goes through (`sm8_writes`). Then
`docs/migrations/sm8_writes_safety.sql`, **before the deploy that needs it**
(the old code runs happily on it): Paused, the per-kind refusals, one row per
thing written, the claim a sender must still hold to record an answer, and the
record that a person pressed. Its header lists read-only checks for before
and after, and a **merge gate** to run on a Supabase branch: the press's
upsert names the generated `dedupe_key` as its conflict target, and only a
real Postgres behind a real PostgREST proves that works. Until the file is
applied, a deployment that writes (`SM8_WRITES` set) can't read the
ServiceM8 settings, so it holds every file and **refuses Connect and
Reconnect** with the settings error; a deployment that doesn't write
connects as before.

**After that deploy is live, not before**, drop the old one-row-per-thing
index, which nothing names as a conflict target any more (the code before
it does, so dropping it first breaks every press on that code):

```sql
drop index if exists public.sm8_writes_subject_uniq;
```

While it stands beside the new one, two presses of one file on one job at
the same instant can meet on it and raise a unique violation; the code reads
that as "already on its way", so nothing is lost, but the drop ends it.

A write that meets a busy or unreachable ServiceM8 waits in the queue and goes
on the next page load, or with the nightly sweep below. A press answers within
20 seconds whatever ServiceM8 is doing; what isn't done by then carries on
behind the answer. A file ServiceM8 left unfinished goes again under a new
id, twice at most. The ServiceM8 screen lists every write still waiting or
failed, and the last 30 days of the rest, with **Retry failed files**.

**Only a person's press queues a write**, and **one ServiceM8 account takes at
most 60 an hour**: the 61st press pauses sending (Paused, "by HeyTiff") and
the owner's bell says so, with how many are waiting. Nothing waiting is lost;
the owner switches it back on. The bell also says when files are waiting for
a **reconnect**, or on a ServiceM8 account that **isn't in good standing**
(an unpaid ServiceM8 bill holds every file for 12 hours at a time).

#### Notes to ServiceM8 (two-way phase 2)

The second kind of write is a **note**: a reply to a note that mentions you, a
diary entry sent with **Also in ServiceM8**, a flagged note marked done, a
task's Done, and the take-back of any of them. Each goes **as the person who
pressed it** (ServiceM8's `x-impersonate-uuid`), so each person first
confirms "Is <ServiceM8 name> you?" once. The owner's card is then headed
**Sending to ServiceM8**, and under Off / Trial run / Paused / On it carries
**Files** and **Notes**, each Off or On (`integration_connections.write_kinds`).
**Notes starts Off.** Notes need one more permission, `publish_job_notes`,
asked for at a reconnect only while the owner has Notes On.

Apply `docs/migrations/sm8_notes_queue.sql` **before the deploy that reads
it** (it adds the note columns to `sm8_writes`, the tombstone and the Done
columns to `workboard_notes`, the owner's per-kind switch, and the link
confirmation). With `SM8_WRITES=1` nothing about notes changes: no screen,
no read and no write.

**On the job card** (PR B), apply `docs/migrations/sm8_notes_job_card.sql`
before its deploy too, after A's: one index, for "has anybody replied to
this note from HeyTiff?". Once notes are offered, a ServiceM8 note that
@mentions you offers **Reply** in the diary and on the strip; the pen gains
**Also in ServiceM8**; your own entry offers **Send to ServiceM8**; **Undo**
(or **Remove**, on a diary entry) takes a note back whatever state it is in;
and a flagged note offers **Mark done**, as you. **The link question:** the
first time you'd send, the card asks "Is <your ServiceM8 name> you?" — in
the reply box, beside the tick box, or on a saved note's line — with **Yes**
and **Not me**. Yes never sends anything by itself; on a saved note's line
it then sends that note. Not me is kept, and the owner's people card on the
ServiceM8 screen says "Says this isn't them." beside that link, which is
where it gets fixed (a relink asks again). With `SM8_WRITES=1` the card is
exactly as it was, and every one of these actions answers before any read.

**Done and Undo** (PR C): apply `docs/migrations/task_done_sm8.sql` before
its deploy, after A's. It adds the one-Done rule (a unique index: one live
Done per task) and three indexes. Once notes are offered, **ticking a task
made from a ServiceM8 mention by hand** (on Home: Your day's Mark done,
the list's tick, the Tasks face; the bell; the Workboard's Urgent tab)
files "@<asker> Done." in the job's diary,
threaded under the note that asked, and sends it to ServiceM8 as whoever
ticked. **Reopen** takes it back: if it hadn't gone, it never goes; if it
went, it is taken out of ServiceM8. Only whoever sent it can; anyone else's
Reopen still reopens the task and is told whose Done it is. A reply that
closes its task posts that reply and no Done, and Reopen never takes a
reply back. The task's page says where its Done stands, with Send again or
Try again; if it didn't go, the ticker's bell says so and opens the task
(`/dashboard?task=<id>`). Deleting a task never touches its Done: it stays
in the diary, where its sender can still Undo it. The Tasks face's **Done**
group lists what you ticked for somebody else too, so its Done's line is
there for you to read. With `SM8_WRITES=1` a tick is exactly the one read
and one write it always was. Home's Tasks face is handed each task's Done
lines, Home opens at `?task=<id>`, and every tick on it (Your day's Mark
done, the list's tick, the Tasks face) and every Undo or Not done yet pass
`postDone` and `takeBackDone`. `task-sm8-callers.test.ts` holds all
three. (The old Home, with its own Tasks face and day band, went on
2026-09-26 with the `HOME_DESK` switch.) Isaac walks live test 13 ("A Done
by ticking, then Reopen") on Home, bell item included. Its
diary's ServiceM8 conversations aren't on screen yet; when they are, a
reply HeyTiff sent is an echo there (mentions-query leaves ours out), so
it has to be threaded from its `workboard_notes` row before notes go on.

**The order, word for word:**

1. Apply A's migration, then B's, then C's. Each goes before the deploy that reads it. Once phase 3's `sm8_bookings_queue.sql` is applied, **never re-run `sm8_notes_queue.sql`**: it would narrow the kind check back to files and notes, and refuse every booking.
2. Deploy. With `SM8_WRITES=1` nothing new shows.
3. **Only after phase 1's live walk** (files on the real account), set `SM8_WRITES=attachment,note`. That needs a redeploy. Do it while Isaac isn't designing, because a redeploy reloads open tabs.
4. The owner sets **Paused**.
5. The owner turns **Notes On**.
6. The owner presses **Reconnect**. A reconnect while Paused still asks for the write scopes. **Never Reconnect in Trial:** it asks for reads only and drops `manage_attachments`.
7. Each linked person confirms "Is {name} you?".
8. **Trial run.**
9. **On.**

**Rollback, word for word, including the SQL:**

1. **If Files are Off, set sending Off** (or Paused) first. Old code has no Files switch, and would offer and send files again.
2. **Notes Off.** This cancels waiting notes: creates, flag changes and take-backs.
3. **Set `SM8_WRITES=1` and redeploy.** Then wait two minutes, the longest lease, so no note row is mid-send.
4. **Run the rollback SQL** in the Supabase SQL editor:
   ```sql
   begin;
   -- every note row that could still move: old code would count it as a
   -- waiting or failed file, and could never send or settle it
   update public.sm8_writes
      set status = 'cancelled',
          last_error = 'Sending notes to ServiceM8 was switched off before it went.',
          lease_until = null, claim_id = null, updated_at = now()
    where kind = 'note' and status in ('queued', 'sending', 'failed', 'trial');
   -- the note words in the queue: files-only code never clears them, and a
   -- press on new code puts them back from HeyTiff's own row
   update public.sm8_writes
      set note_text = null, text_cleared_at = now(), remote_message = null
    where kind = 'note' and note_text is not null;
   -- taken-back rows: old code's diary and journal read status = 'applied'
   -- and ignore removed_at, so this hides them there. Old code's brain
   -- (brain/tools.ts:100) reads every row on a target whatever its status,
   -- as it already does for dismissed notes, so it still reads their words.
   -- New code reads a removed row whatever its status, so nothing here
   -- needs undoing on the way back.
   update public.workboard_notes
      set status = 'dismissed'
    where removed_at is not null and status = 'applied';
   commit;
   ```
   The trigger doesn't fire: no update names `requested_by`.
5. **Revert the code.**
6. **Tell Isaac** what old code shows until new code returns:
   - each note HeyTiff sent shows twice on its job (HeyTiff's row and ServiceM8's copy, because old code has no echo filter);
   - a Done shows as a diary note;
   - a note whose take-back hadn't finished shows once, as ServiceM8's copy, because it is still in ServiceM8;
   - **don't Remove a note that went to ServiceM8, or was queued for it, while rolled back.** The database keeps it (the `note_id` key refuses the delete, and old code's Remove quietly does nothing), and it can be taken out of ServiceM8 once new code returns. A note that never went anywhere removes as today;
   - old code's Retry failed files leaves every note row alone (the trigger refuses it), and after step 4 none is failed;
   - **the brain still reads a taken-back note's words.** Old code's router grounding (brain/tools.ts:100) reads the last five rows on a job whatever their status, dismissed ones included, as it does today. So a note someone took back can still inform what Tiff proposes on that job until new code returns. It shows nowhere.

**Returning to new code** needs nothing undone. A note the rollback cancelled
before anything of it could land shows "Not sent to ServiceM8. Sending notes
to ServiceM8 was switched off before it went." with Send again; one whose
answer had been lost shows "HeyTiff can't tell whether this reached
ServiceM8. Look there before you send it again." with Send again and Undo; a
cancelled take-back shows "Still in ServiceM8" with Try again.

A note's words are kept on its queue row only while they may be needed:
they leave the queue 30 days after the row settles (the nightly cron, and a
page load that finds some due), and at once on a disconnect or for the
account a switch left behind. HeyTiff's own row keeps them.

**Rolling back** past this: switch any workspace that is **Paused** to On or
Off first. The old code reads Paused as Off, and Off cancels what is waiting.
If `sm8_writes_subject_uniq` has been dropped, re-run its `create unique
index` from `docs/migrations/sm8_writes.sql` first: the old code's press
names it.

**Try it on a ServiceM8 account that isn't a live business first**, or use Trial
run on the live one. A file sent to a job is visible to everyone who can open
that job in ServiceM8.

#### Bookings to ServiceM8 (two-way phase 3)

The third kind of write is a **booking**. **Book in** on a job card books
people on the job in ServiceM8, one booking per person and time, and first
makes a Quote a Work Order when **Make it a Work Order** is ticked. **Undo**
takes one of those bookings back, and **Clear** removes a future booking
left on a Completed or Unsuccessful job. A booking goes as the app, never as
a person. The owner's card carries **Bookings** beside Files and Notes, each
Off or On (`integration_connections.write_kinds`). **Bookings starts Off.**
Bookings need two more permissions, `manage_schedule` and `manage_jobs`,
asked for at a reconnect only while the owner has Bookings On. The migration
`docs/migrations/sm8_bookings_queue.sql` adds the kind, its columns on
`sm8_writes`, one shape check for every kind, and the owner's third switch.
With `SM8_WRITES` not naming `booking` nothing about bookings changes: no
screen, no read and no write.

**The order, word for word:**

1. Apply `docs/migrations/sm8_bookings_queue.sql` before PR A's deploy. Run its read-only checks before and after. **Never re-run `sm8_notes_queue.sql` after it.**
2. Deploy A to E as they merge. With `SM8_WRITES` not naming `booking`, nothing new shows.
3. **Only after P0 to P6, the notes walk, and PR D:** set `SM8_WRITES=attachment,note,booking` (DECISIONS 14: notes are walked before bookings). That needs a redeploy. Do it while Isaac isn't designing, because a redeploy reloads open tabs.
4. The owner sets **Paused**, then **Bookings On**.
5. The owner presses **Reconnect** and approves `manage_schedule` and `manage_jobs`. **Never Reconnect in Trial.**
6. **Trial run**, then L1.
7. **On**, then L2 to L13.
8. PR F's flips, in order, each after Isaac's word.

**Rollback, word for word:**

1. The owner turns **Bookings Off**. This cancels every waiting booking row: creates, status changes, take-backs and clears.
2. Set `SM8_WRITES` without `booking` and redeploy. Wait two minutes, the longest lease.
3. Run in the Supabase SQL editor:

   ```sql
   begin;
   -- any booking row that could still move: old code can't send or settle it
   update public.sm8_writes
      set status = 'cancelled',
          last_error = 'Sending bookings to ServiceM8 was switched off before it went.',
          lease_until = null, claim_id = null, updated_at = now()
    where kind = 'booking' and status in ('queued', 'sending', 'failed', 'trial');
   commit;
   ```

4. Revert the code. The migration stays: old code never reads the new columns, and the widened checks allow every old row.
5. **Tell Isaac:**
   - bookings HeyTiff sent are real ServiceM8 bookings, and stay; remove any in ServiceM8 if needed (**Cancel booking**, H16);
   - until the next sync, Home may list a job as still to book, because old code has no overlay;
   - a status change that went stays a Work Order;
   - a status change whose answer was lost may be a Work Order in ServiceM8 with no booking. The lead lists them with QW: `op = 'update'` rows with `maybe_landed`, or with a uuid in `verify_uuids`. Isaac looks at each of those jobs in ServiceM8.

**Returning to new code** needs nothing undone:
- a row the rollback cancelled reads "Not booked. Sending bookings to ServiceM8 was switched off before it went." with Try again;
- one whose answer had been lost reads the unsure line.

#### Leave to ServiceM8

The fourth kind of write is **leave**. When a manager approves leave in
HeyTiff it goes onto the person's day on ServiceM8's dispatch board as
ServiceM8's own staff leave (`availability.json`, `staff-annual-leave`):
**"Sick leave"** for personal leave, **"Leave"** for annual and unpaid leave
and for a casual's day they can't work (Isaac, 2026-09-28). Whole days, first
day 00:00:00 to last day 23:59:59, on the account's wall clock. Cancelling
approved leave, or taking a day off down, takes it off the board. Leave goes
as the app, for the person the owner linked on the ServiceM8 screen: someone
not linked stays off the board, and the approver is told so beside the
approval. The owner's card carries **Leave** beside Files, Notes and
Bookings. **Leave starts Off**, and switching it on puts nothing on the board
by itself: leave approved before then stays where the office keyed it.
Leave needs `manage_schedule` only, which the Bookings grant already holds,
so switching Leave on needs **no reconnect** where Bookings is on. The
migration `docs/migrations/sm8_leave_queue.sql` adds the kind, three columns
on `sm8_writes`, leave's branch of the shape check, and the owner's fourth
switch. With `SM8_WRITES` not naming `leave` nothing about leave changes: no
screen, no read and no write.

**The order:**

1. Apply `docs/migrations/sm8_leave_queue.sql` before the deploy. Run its read-only checks before and after. **Never re-run `sm8_bookings_queue.sql` after it.**
2. Deploy. With `SM8_WRITES` not naming `leave`, nothing new shows.
3. Set `SM8_WRITES=attachment,note,booking,leave` and redeploy, while Isaac isn't designing (a redeploy reloads open tabs).
4. The owner turns **Leave On** on the ServiceM8 screen.
5. The office stops keying leave into ServiceM8 by hand: from here HeyTiff puts it there.

**Rollback:**

1. The owner turns **Leave Off**. This cancels every waiting leave row.
2. Set `SM8_WRITES` without `leave` and redeploy. Wait two minutes, the longest lease.
3. Run in the Supabase SQL editor:

   ```sql
   begin;
   update public.sm8_writes
      set status = 'cancelled',
          last_error = 'Sending leave to ServiceM8 was switched off before it went.',
          lease_until = null, claim_id = null, updated_at = now()
    where kind = 'leave' and status in ('queued', 'sending', 'failed', 'trial');
   commit;
   ```

4. Revert the code. The migration stays: old code never reads the new columns.
5. **Tell Isaac:** leave HeyTiff put on the board stays there; leave cancelled after the rollback has to come off the board by hand.

#### New jobs to ServiceM8

The fifth kind of write is **job**. The Workboard's New job form starts a job
in ServiceM8 as a **Quote**: one queued row, sent as up to three requests in
order, each under a uuid HeyTiff chose when the row was queued — a new client
or a new site under a builder (`company.json`), the job (`job.json`), and the
person to ring (`jobcontact.json`, type `JOB`). A step whose answer was lost
is read back, never made twice; a Create pressed twice is one job. **A trial
run sends nothing at all.** ServiceM8's reference warns that creating jobs
may incur account charges, as it does for jobs started there; the switch says
so. The owner's card carries **New jobs** beside the other kinds, and it
**starts Off**. It needs three permissions no other kind asks for —
`create_jobs`, `manage_customers` and `manage_job_contacts` — so switching it
on **needs a reconnect**. The migration `docs/migrations/sm8_new_job_queue.sql`
adds the kind, eight columns on `sm8_writes`, the job's branch of the shape
check, and the owner's fifth switch. With `SM8_WRITES` not naming `job`
nothing about new jobs changes: no screen, no read, no write, and no new
permission asked for.

**The order:**

1. Apply `docs/migrations/sm8_new_job_queue.sql` before the deploy. Run its read-only checks before and after. **Never re-run `sm8_leave_queue.sql` after it.**
2. Deploy. With `SM8_WRITES` not naming `job`, nothing new shows.
3. Set `SM8_WRITES=attachment,note,booking,leave,job` (or the current list plus `job`) and redeploy, while Isaac isn't designing (a redeploy reloads open tabs).
4. The owner turns **New jobs On** on the ServiceM8 screen, then **Reconnect** and approves the three new permissions on ServiceM8's screen.
5. Start one test job from the form and check it in ServiceM8: the client, the job as a Quote at the right address, and its contact.

**Rollback:**

1. The owner turns **New jobs Off**. This cancels every waiting job row.
2. Set `SM8_WRITES` without `job` and redeploy. Wait two minutes, the longest lease.
3. First, in the Supabase SQL editor, list the clients that were made without their job, so the office can tidy them in ServiceM8:

   ```sql
   select id, job_company_uuid, job_draft->>'companyName' as client
     from public.sm8_writes
    where kind = 'job' and job_done @> array['company'] and not (job_done @> array['job']);
   ```

4. Then cancel what's left:

   ```sql
   begin;
   update public.sm8_writes
      set status = 'cancelled',
          last_error = 'Sending new jobs to ServiceM8 was switched off before it went.',
          lease_until = null, claim_id = null, updated_at = now()
    where kind = 'job' and status in ('queued', 'sending', 'failed', 'trial');
   commit;
   ```

5. Revert the code. The migration stays: old code never reads the new columns.
6. **Tell Isaac:** jobs HeyTiff started stay in ServiceM8.

#### Customer details to ServiceM8

The sixth kind of write is **customer**. The job card's Contacts block gets
**Edit**, which opens a dialog: the client's name and address, the job's
contacts each with their role (Job contact, Billing contact, Site contact,
Property manager, Property owner, Tenant), and the job's billing address with
**Same as the site**. Saving sends only what changed, one row per record: a
contact added under our uuid (`jobcontact.json`), a record changed with only
its changed fields (`company/{uuid}.json` with its live `name`,
`job/{uuid}.json` with its live `status`, `jobcontact/{uuid}.json`), a
contact removed (`DELETE jobcontact/{uuid}.json`, sent only after a live
read finds it active, never a second time). The billing address is read live
from ServiceM8 when the dialog opens; the mirror still doesn't keep it. The
owner's card carries **Customer details**, starting **Off**. It needs
`manage_job_contacts`, `manage_customers` and `manage_jobs` — all asked for
already by New jobs and Bookings — so where those are approved it needs **no
further reconnect**. The migration `docs/migrations/sm8_customer_queue.sql`
adds the kind, two columns and its shape branch.

**The order:**

1. Apply `docs/migrations/sm8_customer_queue.sql` before the deploy. **Never re-run `sm8_new_job_queue.sql` after it.**
2. Deploy. With `SM8_WRITES` not naming `customer`, nothing new shows.
3. Add `customer` to `SM8_WRITES` and redeploy (with `job`, if New jobs goes on at the same time: one redeploy, one reconnect).
4. The owner turns **Customer details On**.
5. Edit one test job's contact and check it in ServiceM8.

**Rollback:** Customer details Off (cancels waiting rows); `SM8_WRITES` without `customer`, redeploy, wait two minutes; cancel what's left with `update public.sm8_writes set status = 'cancelled', last_error = 'Sending customer changes to ServiceM8 was switched off before it went.', lease_until = null, claim_id = null, updated_at = now() where kind = 'customer' and status in ('queued', 'sending', 'failed', 'trial');`; revert the code. Changes already made stay in ServiceM8.

#### Accepted quotes to ServiceM8

The seventh kind of write is **quote** (Isaac, 2026-10-05). Once an option
is marked accepted, the job card's Quote section shows **To ServiceM8** —
exactly what will go — and, where the owner has it on, **Send to ServiceM8
as a work order**. One press is one row per record: the job's invoice
description (`work_done_description`) and its status to Work Order when it
was a Quote (`job/{uuid}.json`, with the live status sent back unchanged
when it's already a Work Order); each line that was on the job taken off
(`DELETE jobmaterial/{uuid}.json`, sent only after a live read finds it
active, never a second time); each of the quote's lines added under our
uuid (`jobmaterial.json`) — one per accepted option at its total, "…, as per
quote", when the business shows customers totals only (Admin → Quoting,
"What the customer sees"), or every line with labour by the person-day when
it shows line items. Lines carry a unit price and cost ex GST on the tax rate
the business's own lines already use. The press first checks the job hasn't
changed in ServiceM8 since the quote was reviewed (the mirror's edit date the
card saw, the mirror's now, and ServiceM8's live one). A quote with anything
left to price, an invoiced job, or a job past Work Order is refused. The
owner's card carries **Accepted quotes**, starting **Off**. It needs
`manage_jobs` (asked already) and **`manage_job_materials`, which is new: a
reconnect**. The migration `docs/migrations/sm8_quote_queue.sql` adds the
kind and its shape branch, keeping its record and fields in the customer
change's two columns (no new columns).

**The order:**

1. Apply `docs/migrations/sm8_quote_queue.sql` before the deploy. **Never re-run `sm8_customer_queue.sql` after it.**
2. Deploy. With `SM8_WRITES` not naming `quote`, the card shows **To ServiceM8** as a preview and nothing else.
3. Add `quote` to `SM8_WRITES` and redeploy.
4. The owner turns **Accepted quotes On** with sending on **Trial run** first: a press checks and logs every row, and nothing reaches ServiceM8.
5. Reconnect ServiceM8 and approve `manage_job_materials`; switch sending **On**; send one throwaway job and check its lines and a draft invoice in ServiceM8.

**Rollback:** Accepted quotes Off (cancels waiting rows); `SM8_WRITES` without `quote`, redeploy, wait two minutes; cancel what's left with `update public.sm8_writes set status = 'cancelled', last_error = 'Sending accepted quotes to ServiceM8 was switched off before it went.', lease_until = null, claim_id = null, updated_at = now() where kind = 'quote' and status in ('queued', 'sending', 'failed', 'trial');`; revert the code. Lines already sent stay in ServiceM8; lines taken off are inactive there and can be put back from ServiceM8.

#### Time off on the Schedule (leave to ServiceM8, part two)

The sync reads ServiceM8's Availability (`availability.json`) into
`sm8_availability`: every person's time off and every public holiday or
closed day, under the `read_schedule` grant every connection already holds,
so **no reconnect**. It is blocked-out time in the business's own words
("SICK", "TAFE"), never read back into HeyTiff as leave. The Workboard's
Schedule tab lays it on the day — a lane for somebody off with nothing
booked, a strip under a working person's bookings, the holiday named over
the board — and the Book in panel warns, never refuses, when a booking lands
on it. Both say nothing until the mirror's first read of it has finished.
No switch and no `SM8_WRITES` change: this is a read.

**The order:**

1. Apply `docs/migrations/sm8_availability.sql` before the deploy (its read-only checks before and after). Without the table, a sync that reaches the new object can't store it and says so on the ServiceM8 screen.
2. Deploy. The next sync reads the whole of it (~250 rows, one page).

**Rollback:** revert the code. Old code never names the table; drop it and its
`sm8_sync_state` row by hand if wanted (the SQL is in the migration's header).

### Calls, echo and freshness

Apply `docs/migrations/sm8_calls_echo_freshness.sql` **before the deploy that
needs it** (the code on main never reads it; the new code runs without it,
uncounted). **First run `docs/migrations/sm8_calls_echo_freshness.test.sql`
whole**: it applies the call counter and the keep-newer guard inside one
transaction, checks them, and ends in `ROLLBACK`, so it is safe against
production. A check that fails raises and names what it saw. The migration's
header lists the checks for after.

- **One call counter per ServiceM8 account.** Every request to ServiceM8's
  API takes a turn from it: at most about 140 calls in any minute (ServiceM8
  allows 180), and each kind of caller stops at its own daily cap, under
  ServiceM8's 20,000. The sync leaves the most room behind, so a person's
  Send always finds some; when there is none the sync pauses ("Paused to
  leave room in ServiceM8's call limit") and a file waits a minute ("Waiting
  for room in ServiceM8's call limit"). A 429 from ServiceM8 holds every
  caller for a minute, or an hour for the daily limit.
- **A file HeyTiff sent shows once.** Its copy in the mirror is left off the
  job card, the photo bank and the downloads, found by the uuid HeyTiff sent
  it under.
- **Opening Home refreshes ServiceM8**: what is waiting to go is sent, then a
  stale mirror synced, all behind the page. So do the Workboard and the
  ServiceM8 screen, and every press of Send, Retry failed files, Sync now or
  switching sending on sends what is waiting behind its answer.
- **A record edited mid-sync, or in April's repeated hour, is no longer
  skipped**, and an older copy of a record never replaces a newer one. One
  exception, once a year: a record edited in both passes of April's repeated
  hour (2 to 3 am) can keep its first-pass copy until its next edit, because
  the second pass's stamp reads as older and nothing in a stamp without a
  zone tells the two apart.

### The daily mirror top-up

`vercel.json` schedules `/api/cron/sm8-sync` for **20:00 UTC daily** — 6am on the
east-coast AU clock, so the board is true before anyone starts. It sends what
is waiting to go to ServiceM8 first, then syncs.

It is **daily, not hourly, because this project is on Vercel's Hobby tier**, which
fails the deployment outright for any cron that would run more than once a day
(`0 * * * *` is named in their docs as an example that does). That costs nothing:
freshness comes from looking — opening Home, the Workboard or the ServiceM8
screen tops ServiceM8 up behind the response — and this run only covers the
hours nobody is looking. On Pro, one line in `vercel.json` and one in the route
header make it hourly.

It runs only once `CRON_SECRET` is set (section 3). **How to tell it ran.** The
owner's ServiceM8 screen says *Last overnight sync* with its day and time, or
*The overnight sync hasn't run.* Only Vercel's scheduled calls count, not one
triggered by hand. Vercel → Settings → Cron Jobs → View Logs lists each call; a
401 there means `CRON_SECRET` is missing or different. On Hobby the run can land
anywhere in the 20:00 UTC hour, and Vercel says a night can occasionally be
missed or run twice.

**Phase 0 isn't finished until the overnight run is proven:** set `CRON_SECRET`
in Vercel Production, redeploy, and after the next 20:00 UTC hour see a 200 for
`/api/cron/sm8-sync` in the cron logs and *Last overnight sync* on the ServiceM8
screen. Until then the overnight top-up does nothing at all.

### Live updates from ServiceM8 (two-way phase 4)

ServiceM8 pings HeyTiff when a job, booking, payment, note, client or
attachment changes, and HeyTiff reads that record back through the one door
into the same mirror, so changes show in minutes rather than at the next
sync. A ping is a doorbell: HeyTiff reads only which record it names, then
fetches the record itself. The syncs are unchanged, and pings never start
one. The address ServiceM8 calls carries a secret; only its SHA-256 is
stored, and a Reconnect rotates it (the old one keeps working 72 hours,
ServiceM8's retry window).

**The switch is `SM8_WEBHOOKS`, on Production only**
(`src/lib/integrations/sm8-hooks-switch.ts`): `1` is on, `gone` answers 410
to every hook address (which unsubscribes), and anything else, or any
deployment that isn't Production, is off. Unset, nothing changes: no
subscription, no route, no read, no write (`sm8-hooks-prod.test`).

**The order, word for word:**

1. Apply `docs/migrations/sm8_webhooks.sql` **before PR B deploys** (PR B
   writes its new `sm8_sync_runs` columns; without them it keeps today's
   lease, logged once). Run the header's read-only BEFORE check first
   (`t, t, t, t, 0`).
2. Run `docs/migrations/sm8_webhooks.test.sql` whole. It is one transaction
   that ends in `ROLLBACK`, safe against production; each check raises on
   failure. Then the header's AFTER checks.
3. Merge A to F in order. Each changes nothing observable while the switch
   is off.
4. Before the walk: record this month's Vercel usage (provisioned memory,
   active CPU, invocations), and confirm under Vercel → Firewall that no
   challenge mode or bot rule covers `/api/integrations/servicem8/webhook/`.
5. Set `SM8_WEBHOOKS=1` on **Production only** and redeploy, while Isaac
   isn't designing (a redeploy reloads open tabs). Then the walk.

**Rollback, word for word:**

1. Set `SM8_WEBHOOKS=gone` and redeploy. Every ping is answered 410, so
   ServiceM8 unsubscribes at once.
2. After 3 days, unset it.
3. The mirror needs nothing: live updates only ever wrote ServiceM8's own
   values.
4. Optionally, `delete from public.sm8_webhook_pings;`.

---

## 3d. Smart Notes voice (optional — the mic on the Workboard)

**Unset, nothing breaks.** The mic button isn't rendered, the Tiff modal opens
on its reply box instead of listening, and a typed note goes through the
identical brain → Tiff → file path. This key buys dictation, not the feature.

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
the roster and client book — "tell Lyle" only becomes a task for Lyle if the
transcriber heard Lyle. ElevenLabs allows **1000 keyterms of 50 chars** in batch
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

## 3e. Compliance certificates (the job card's Documents face)

The installer's certificate a builder asks for at the end of a job:
docs/certificates-plan.md is the design.

1. Apply `docs/migrations/certificates.sql` **before the deploy that reads it**.
   It is additive (six new tables nothing reads yet), so applying it early is
   safe. Without it, the Create certificate button opens a wizard that can't
   read the job and says so. **Applied to production 2026-10-03** (migration
   `certificates`).
2. Nothing new in Vercel. Issuing prints the PDF through the same headless
   Chromium as the Studio's Send to job (`@sparticuz/chromium`, `APP_BASE_URL`,
   `AUTH0_SECRET` for the print ticket), and reading a certifier's list or an
   older job's description uses `ANTHROPIC_API_KEY`. Without that key
   everything works except the reads: the list says Tiff isn't set up, and a
   description keeps the rule reader's draft.
3. Apply `docs/migrations/certificate_wording.sql` before the deploy that
   writes it: one nullable column (`cert_template_approvals.wording`, the
   statements as the owner read them) and the one earlier approval back-filled.
   **Applied to production 2026-10-03** (migration
   `certificate_wording_snapshot`).
4. Before the first certificate can be issued, in the app:
   - the owner reads and approves the wording in Admin → Templates →
     Mechanical Compliance Certificate
     (`/dashboard/admin/templates/certificate`; the bell asks until they
     do);
   - whoever signs has a current ARC licence and contractor licence **with
     expiry dates** on their staff card, and draws their signature there
     (Licences, Signature).
5. A business's own templates (Admin → Templates: the quote's notes and
   payment terms, the project checklist and its handover checks, the
   documents email) live in `public.org_templates`, one row per template a
   business has changed (`docs/migrations/org_templates.sql`). No row means
   the standard wording, so nothing needs seeding. **Applied to production
   2026-10-03** (migration `org_templates`).
6. `docs/migrations/drop_unused_cert_tables.sql` drops `certifier_profiles`,
   `fan_models` and `certificate_versions.certifier_profile_id`, which nothing
   reads or writes. **Applied to production 2026-10-05** (migration
   `drop_unused_cert_tables`).

## 3f. Analytics (Operations, owner-tier)

What the business's own jobs say about its quoting, at `/dashboard/analytics`:
docs/job-analytics-plan.md is the design.

1. Overview and Quotes need nothing new: they read ServiceM8's copy and
   `quote_drafts`, and show only to people with `workboard_money`.
2. Apply `docs/migrations/job_analytics_decisions.sql` **before the deploy
   that writes it**. It is additive (one new table nothing reads yet), so
   applying it early is safe. Without it, the To decide tab still asks its
   questions but offers no answers and says they can't be kept yet, and the
   figures read as if nothing had been decided. **Applied to production
   2026-10-07** (migration `job_analytics_decisions`).

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
