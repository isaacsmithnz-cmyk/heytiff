import { authorised } from "@/lib/integrations/cron-auth";
import { recordSm8CronVisit, runSm8Sync, sweepableSm8Orgs } from "@/lib/integrations/sm8-sync";
import {
  clearDisconnectedSm8NoteText,
  clearSm8NoteText,
  orgsWithDueSm8Writes,
  runSm8Writes,
} from "@/lib/integrations/sm8-writes";
import { WRITE_LEASE_MARGIN_MS, WRITE_LEASE_MS } from "@/lib/integrations/sm8-write-plan";
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { NOTE_TEXT_DAYS } from "@/lib/integrations/sm8-note-plan";

/* The nightly ServiceM8 top-up — the BACKSTOP, not the primary path.

   Freshness normally comes from looking: opening Home, the Workboard or the
   ServiceM8 screen sends what is waiting and syncs a stale mirror behind the
   response (sm8-freshness). This cron exists for the hours nobody is
   looking — overnight visits ticking into "overdue", a file whose job card
   nobody opens again, and a rotating refresh token that would otherwise sit
   unexercised — so an unopened board still tells the truth at 7am.

   WHY IT IS SAFE TO RUN AS NOBODY: it moves ServiceM8's data into that same
   org's own mirror rows, sends only what a person pressed Send on, and
   returns counts. No org ids, no client names, no job numbers leave it.

   WHY IT IS STILL LOCKED: it walks every connected workspace through the
   service-role client, so an open version would be a way to spend somebody
   else's ServiceM8 rate limit. CRON_SECRET is the only gate and it fails
   closed when unset — see lib/integrations/cron-auth. A refused call
   writes nothing: not even the overnight trace.

   HOW TO TELL IT RAN. Vercel's scheduler marks its own calls with the
   x-vercel-cron-schedule header ("Every cron job request includes" it —
   Vercel's Managing Cron Jobs page, read 2026-09-25). Such a call,
   once past the secret, records last_cron_at for each workspace it syncs,
   and the owner's ServiceM8 screen says when. A refused one logs one line,
   because a scheduler refused every night is exactly what an unset
   CRON_SECRET looks like. A call triggered by hand runs, and records
   nothing.

   COST: a quiet night is ~14 calls per org (one page per object answering
   "nothing changed"); the engine's own budgets (PAGE_BUDGET per run,
   DAILY_CALL_BUDGET per org per day) bound the loud ones. The engine's lease
   makes an overlap with a user-triggered sync a no-op, not a double-spend. */

/* SCHEDULE: daily at 20:00 UTC ("0 20 * * *") — 6am on the east-coast AU
   clock, so the board is true before anyone starts. It lives in vercel.json,
   which Vercel validates against a strict schema that rejects unknown keys
   (including the "//" comment idiom), so the reasoning lives here instead.

   DAILY BECAUSE THE PLAN SAYS SO, LITERALLY: Vercel's Hobby tier refuses any
   cron that would run more than once a day — "0 * * * *" fails the DEPLOYMENT
   outright, which is how this was found. That costs this route nothing,
   because it was never the freshness path. Hobby also only promises the hour,
   not the minute (±59 min), which a backstop can afford. On Pro, one line
   here and one in vercel.json make it hourly again. */

/** Workspaces per run. Each org's slice is bounded by the engine's page
    budget, so the cap is about staying inside one serverless window even if
    every org has a loud day.

    THE CAP IS A ROTATION, NOT A CUT-OFF: sweepableSm8Orgs orders
    least-recently-swept first, so the eleventh workspace is picked up on a
    later night rather than never. That ordering is load-bearing now the run
    is daily — see the note on that function. */
const ORG_CAP = 10;

export const maxDuration = 300;

/** One workspace's write run stops CLAIMING after this. */
const CRON_WRITE_BUDGET_MS = 30_000;

/** A workspace's sync starts only while one of its leases (120 s) and a
    margin still fit before maxDuration; one that doesn't waits for the next
    night, first in line (sweepableSm8Orgs is least-recently-swept first). */
const SYNC_LEASE_MS = 120_000;
const CRON_SYNC_START_BY_MS = maxDuration * 1000 - SYNC_LEASE_MS - WRITE_LEASE_MARGIN_MS;

/** THE WRITES' ONE BUDGET, across every workspace, counted from the start
    of the request. Writes go FIRST, so a file waiting since yesterday isn't
    behind ten syncs; and they share one budget, so the syncs after them
    still have the night's window.

    A run's budget only stops it CLAIMING: a send claimed at the last moment
    can hold its row for a whole lease (WRITE_LEASE_MS). So the writes stop
    claiming a lease before the first sync must start: however slow the last
    send, the first workspace still syncs — and records the overnight visit
    — rather than every sync being put off to the next night while the
    screen says the overnight run never came. 45 s. Past it, what is left
    waits for the next page load or the next night. */
const CRON_WRITE_TOTAL_MS = CRON_SYNC_START_BY_MS - WRITE_LEASE_MS;

/** Whether Vercel's scheduler made this call, rather than a person. */
function fromScheduler(request: Request): boolean {
  return request.headers.has("x-vercel-cron-schedule");
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const scheduled = fromScheduler(request);
  if (!authorised(request.headers.get("authorization"))) {
    if (scheduled) {
      console.warn("[cron] sm8-sync: Vercel's call was refused — CRON_SECRET is unset or different");
    }
    // No detail: an unauthorised caller learns nothing about whether the
    // secret is set, only that they don't have it.
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }

  /* WRITES FIRST. A file somebody sent to ServiceM8 that met a busy or
     unreachable ServiceM8 retries on the next page load; this is for the one
     whose job card nobody opens again. Workspaces with nothing waiting cost
     one query between them, and none of this runs on a deployment that
     doesn't write (orgsWithDueSm8Writes returns none). */
  let writesSent = 0;
  let writesFailed = 0;
  let writesDeferred = 0;
  const writers = await orgsWithDueSm8Writes(ORG_CAP);
  for (const orgId of writers) {
    const left = startedAt + CRON_WRITE_TOTAL_MS - Date.now();
    if (left <= 0) {
      writesDeferred += 1;
      continue;
    }
    try {
      const run = await runSm8Writes(orgId, "cron", { budgetMs: Math.min(CRON_WRITE_BUDGET_MS, left) });
      writesSent += run.sent;
      writesFailed += run.failed;
    } catch {
      writesFailed += 1;
    }
  }

  /* NOTE WORDS LEAVE THE QUEUE: every note row settled more than 30 days
     ago, across every workspace, and every settled note row of a workspace
     with no ServiceM8 connection any more (a send that finished after a
     disconnect, which the page-load clear can't reach). HeyTiff's own rows
     keep the words. Only on a deployment that sends notes: on one that
     sends files alone neither makes a query. */
  let notesCleared = 0;
  if (sm8NotesAllowed()) {
    try {
      notesCleared += await clearSm8NoteText({ olderThanDays: NOTE_TEXT_DAYS }, Date.now());
      notesCleared += await clearDisconnectedSm8NoteText(Date.now());
    } catch {
      /* the backstop's backstop: the next night tries again */
    }
  }

  /* Connected orgs only, longest-waiting first — needs_reauth rows are
     skipped because the engine would refuse them anyway, and each refusal
     costs a lease dance. */
  const orgs = await sweepableSm8Orgs(ORG_CAP);

  let ran = 0;
  let busy = 0;
  let completed = 0;
  let pages = 0;
  let rows = 0;
  let failed = 0;
  let deferred = 0;

  for (const orgId of orgs) {
    if (Date.now() - startedAt > CRON_SYNC_START_BY_MS) {
      deferred += 1;
      continue;
    }
    /* One workspace's failure must not end the run — one revoked grant would
       otherwise stop every customer after it from syncing, silently. */
    try {
      /* the scheduler came: recorded BEFORE the sync, so a night where
         another sync held the lease still counts as the overnight run */
      if (scheduled) await recordSm8CronVisit(orgId, Date.now());
      const outcome = await runSm8Sync(orgId, "cron");
      if (outcome.ran) {
        ran += 1;
        pages += outcome.pagesUsed;
        rows += outcome.rowsPulled;
        if (outcome.complete) completed += 1;
      } else {
        busy += 1;
      }
    } catch {
      failed += 1;
    }
  }

  /* Counts only — enough to see the top-up is alive in the Vercel logs, and
     useless to anybody else. */
  return Response.json({
    orgs: orgs.length,
    ran,
    completed,
    busy,
    failed,
    deferred,
    pages,
    rows,
    capped: orgs.length === ORG_CAP,
    writes: { orgs: writers.length, sent: writesSent, failed: writesFailed, deferred: writesDeferred },
    ...(sm8NotesAllowed() ? { notesCleared } : {}),
  });
}
