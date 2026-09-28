import { settleMentionAsks } from "@/lib/dashboard/mention-settle";
import { authorised } from "@/lib/integrations/cron-auth";
import { recordSm8CronVisit, runSm8Sync, sweepableSm8Orgs } from "@/lib/integrations/sm8-sync";
import {
  clearDisconnectedSm8NoteText,
  clearSm8NoteText,
  orgsWithDueSm8Writes,
  runSm8Writes,
} from "@/lib/integrations/sm8-writes";
import { WRITE_LEASE_MARGIN_MS, WRITE_LEASE_MS } from "@/lib/integrations/sm8-write-plan";
import { SYNC_LEASE_MS, whenSm8LeaseFree } from "@/lib/integrations/sm8-lease";
import {
  BACKSTOP_DRAIN_MS,
  ENSURE_BUDGET_MS,
  ENSURE_FINISH_MARGIN_MS,
  HOOK_LEASE_MS,
  functionDeadline,
} from "@/lib/integrations/sm8-hook-plan";
import { sm8WebhooksState } from "@/lib/integrations/sm8-hooks-switch";
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { NOTE_TEXT_DAYS } from "@/lib/integrations/sm8-note-plan";
import { EVICT_BUDGET_MS, evictStaleSm8Files, type EvictResult } from "@/lib/integrations/sm8-file-cache";

/* The nightly ServiceM8 top-up — the BACKSTOP, not the primary path.

   Freshness normally comes from looking: opening Home, the Workboard or the
   ServiceM8 screen sends what is waiting and syncs a stale mirror behind the
   response (sm8-freshness). This cron exists for the hours nobody is
   looking — overnight visits ticking into "overdue", a file whose job card
   nobody opens again, and a rotating refresh token that would otherwise sit
   unexercised — so an unopened board still tells the truth at 7am.

   WHY IT IS SAFE TO RUN AS NOBODY: it moves ServiceM8's data into that same
   org's own mirror rows, sends only what a person pressed Send on, makes
   each new ask of a person the new Home is on into that person's one task
   (in that same org, never sent anywhere), and returns counts. No org ids,
   no client names, no job numbers leave it.

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
const CRON_SYNC_START_BY_MS = maxDuration * 1000 - SYNC_LEASE_MS - WRITE_LEASE_MARGIN_MS;

/** A workspace whose lease is held is tried this many times, this far
    apart, before it counts as busy for the night. */
const CRON_SYNC_TRIES = 12;
const CRON_SYNC_WAIT_MS = 2_000;

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

/** THE ASKS GO LAST (dashboard/mention-settle: each ServiceM8 ask of a
    person the new Home is on becomes one task). After every sync, in what
    is left of the night's window, workspace by workspace in the sweep's
    order: a sync is what brings an ask in, and one workspace's reading
    must never put off another's sync. The settle measures each read
    against the budget it is handed, less this margin; what doesn't fit
    waits for the next page load or the next night. Nothing it does is
    sent to ServiceM8. */
const CRON_SETTLE_MARGIN_MS = WRITE_LEASE_MARGIN_MS;

/** LIVE UPDATES' NIGHTLY RECONCILE (two-way phase 4), between the note
    clearing and the syncs: one list per swept workspace, plus whatever
    repair it finds — a turned-off subscription re-POSTed, a missing one
    made, a rotation a connect left owed. The whole step has
    ENSURE_BUDGET_MS, and a workspace's starts only while that much still
    ends before the first sync's start-by, so it can never put a sync off.
    What doesn't fit goes on a page load or the next night. Then the hooks
    past their 72 hours are tidied away. Only with SM8_WEBHOOKS on: off,
    the machinery isn't loaded and the answer is as it was. */
type HookNight = { ensured: number; subscribed: number; deferred: number; failed: number; expired: number };

async function reconcileHooks(orgs: readonly string[], startedAt: number): Promise<HookNight> {
  const { dropExpiredSm8Hooks, ensureSm8Webhooks } = await import("@/lib/integrations/sm8-hooks");
  const night: HookNight = { ensured: 0, subscribed: 0, deferred: 0, failed: 0, expired: 0 };
  /* less the margin each reconcile's own last writes need */
  const stepEnd = Math.min(Date.now() + ENSURE_BUDGET_MS, startedAt + CRON_SYNC_START_BY_MS) - ENSURE_FINISH_MARGIN_MS;
  for (const orgId of orgs) {
    const now = Date.now();
    if (now - startedAt + ENSURE_BUDGET_MS > CRON_SYNC_START_BY_MS || now >= stepEnd) {
      night.deferred += 1;
      continue;
    }
    const out = await ensureSm8Webhooks(orgId, { budgetMs: stepEnd - now });
    if (!out.ran) {
      if (out.why === "failed") night.failed += 1;
      continue;
    }
    night.ensured += 1;
    if (out.subscribed) night.subscribed += 1;
  }
  night.expired = await dropExpiredSm8Hooks(Date.now());
  return night;
}

/** The asks' own time, kept back from the leftover drains: however many
    workspaces have a queue, the settle after them still gets this much. */
const CRON_ASKS_RESERVE_MS = 20_000;

/** LIVE UPDATES' LEFTOVER DRAINS (two-way phase 4), after every sync:
    whatever the route's own drains left in a swept workspace's queue is
    read, BACKSTOP_DRAIN_MS each, never sleeping for a record to go quiet.
    THE WHOLE STEP HAS ONE BUDGET, and it keeps back what comes after it:
    the file cache's EVICT_BUDGET_MS, the asks' CRON_ASKS_RESERVE_MS and
    their margin. A workspace's drain starts only while its 20 s still end
    inside that, and never once a whole hook lease (HOOK_LEASE_MS) no longer
    fits before the function's deadline. After the syncs, so a drain never
    holds the lease a sync wants; a drain that finds a sync asking stands
    aside anyway. Only with SM8_WEBHOOKS on: off, the machinery isn't loaded
    and the answer is as it was. */
type DrainNight = { drained: number; read: number; written: number; handed: number; deferred: number; failed: number };

async function leftoverDrains(orgs: readonly string[], startedAt: number): Promise<DrainNight> {
  const { drainSm8Hooks } = await import("@/lib/integrations/sm8-hook-drain");
  const night: DrainNight = { drained: 0, read: 0, written: 0, handed: 0, deferred: 0, failed: 0 };
  const deadline = functionDeadline(startedAt, maxDuration);
  const stepEnd = startedAt + maxDuration * 1000 - CRON_SETTLE_MARGIN_MS - EVICT_BUDGET_MS - CRON_ASKS_RESERVE_MS;
  const lastStart = Math.min(stepEnd - BACKSTOP_DRAIN_MS, deadline - HOOK_LEASE_MS);
  for (const orgId of orgs) {
    if (Date.now() > lastStart) {
      night.deferred += 1;
      continue;
    }
    try {
      const out = await drainSm8Hooks(orgId, {
        deadline,
        maxMs: BACKSTOP_DRAIN_MS,
        wait: false,
      });
      if (out.ran) night.drained += 1;
      if (out.stopped === "threw" || out.stopped === "db") night.failed += 1;
      night.read += out.read;
      night.written += out.written;
      night.handed += out.handed;
    } catch {
      night.failed += 1;
    }
  }
  return night;
}

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

  const hooks =
    sm8WebhooksState() === "on"
      ? await reconcileHooks(orgs, startedAt).catch(
          (): HookNight => ({ ensured: 0, subscribed: 0, deferred: 0, failed: orgs.length, expired: 0 })
        )
      : null;

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
      /* A workspace whose lease is held gets a few more tries, each asking
         for it (so a drain holding it stands aside), rather than missing
         its night; never past the start-by. Its sync may extend its lease
         while a whole one still ends inside this function. */
      const outcome = await whenSm8LeaseFree(
        () => runSm8Sync(orgId, "cron", Date.now(), { deadline: functionDeadline(startedAt, maxDuration) }),
        { tries: CRON_SYNC_TRIES, waitMs: CRON_SYNC_WAIT_MS, startBy: startedAt + CRON_SYNC_START_BY_MS }
      );
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

  /* The leftover drains, after every sync (leftoverDrains). */
  const drains = sm8WebhooksState() === "on" ? await leftoverDrains(orgs, startedAt) : null;

  /* THE FILE CACHE'S 30-DAY CAP (lib/integrations/sm8-file-cache): copies
     of ServiceM8's own files nobody has been shown in 30 days leave the
     bucket, and the next open brings them back. Starred photos stay; no
     other kind of document is ever read here. AFTER THE SYNCS, because
     eviction is housekeeping and a sync is what the board is true by; and
     before the asks, on at most EVICT_BUDGET_MS of what is left of the
     window (the clock looked at before every file), so the asks keep the
     rest. Nothing left, and it waits for tomorrow. It never throws. */
  const evictBudgetMs = Math.min(
    EVICT_BUDGET_MS,
    startedAt + maxDuration * 1000 - CRON_SETTLE_MARGIN_MS - Date.now()
  );
  const files: EvictResult =
    evictBudgetMs > 0
      ? await evictStaleSm8Files(Date.now(), { budgetMs: evictBudgetMs })
      : { evicted: 0, bytes: 0, starred: 0, failed: 0, capped: false, skipped: true };

  /* The asks, after every sync (CRON_SETTLE_MARGIN_MS). */
  let asksRead = 0;
  let asksMade = 0;
  let asksDeferred = 0;
  for (const orgId of orgs) {
    const budgetMs = startedAt + maxDuration * 1000 - CRON_SETTLE_MARGIN_MS - Date.now();
    if (budgetMs <= 0) {
      asksDeferred += 1;
      continue;
    }
    try {
      const settled = await settleMentionAsks(orgId, { budgetMs });
      asksRead += settled.reads;
      asksMade += settled.tasks;
    } catch {
      asksDeferred += 1;
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
    ...(hooks ? { hooks } : {}),
    ...(drains ? { drains } : {}),
    asks: { read: asksRead, tasks: asksMade, deferred: asksDeferred },
    files: {
      evicted: files.evicted,
      mb: Math.round(files.bytes / 104857.6) / 10,
      starred: files.starred,
      failed: files.failed,
      capped: files.capped,
      skipped: files.skipped,
    },
  });
}
