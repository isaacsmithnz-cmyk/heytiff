/* The ServiceM8 sync engine — pulls each object's changes into the sm8_*
   mirrors, resumably, under a lease. drift-sweep.ts's bigger sibling: the
   decisions live in sm8-sync-plan.ts (pure, tested cold), this file is the
   plumbing that carries them out.

   THE RULES THE SHAPE ENFORCES:
   - ONE RUN PER ORG AT A TIME, across instances. Cron, Sync-now and the
     page-load kick all land on different serverless workers, so the mutex is
     a conditional write on sm8_sync_runs.lease_until — no row claimed means
     someone else is mid-run, and the answer is "already running", not a
     second walker double-spending the rate limit.
   - CURSORS ADVANCE ONLY ON COMPLETED WALKS. A run that stops mid-object —
     page budget, 429, upstream wobble — leaves that object's cursor alone
     and re-pulls from the same floor next kick. Repeat reads are the cost;
     idempotent upserts make them harmless.
   - EVERY RUN IS BOUNDED TWICE: PAGE_BUDGET caps one invocation (a 20k-job
     backfill lands across several kicks, visibly in sm8_sync_state), and
     DAILY_CALL_BUDGET caps the day (our worst bug must not eat a customer's
     real ServiceM8 quota).
   - FAILURES ARE PER-OBJECT WHERE THEY CAN BE. A 403 records "reconnect to
     grant X" on that object and the walk moves on; only a dead grant (401)
     or a back-off signal (429/unreachable) ends the whole run.

   NO SESSION HERE — the caller establishes the right to ask (owner action,
   CRON_SECRET, or a page loader that already gated the org) and hands in a
   bare orgId. */

import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { fetchSm8Vendor } from "./sm8";
import { markSm8NeedsReauth, sm8Access } from "./sm8-store";
import { fetchSm8Page } from "./sm8-read";
import {
  chunk,
  DAILY_CALL_BUDGET,
  filterFor,
  maxEditDate,
  PAGE_BUDGET,
  SM8_BILLING,
  SM8_OBJECTS,
  type MirrorRow,
} from "./sm8-sync-plan";

export type Sm8SyncTrigger = "connect" | "manual" | "kick" | "cron";

export type Sm8SyncOutcome = {
  /** False when the lease was held elsewhere or the grant is unusable. */
  ran: boolean;
  /** One sentence for the caller's log or the screen's last-run line. */
  note: string;
  pagesUsed: number;
  rowsPulled: number;
  /** Every object finished its walk — nothing is waiting on the next kick. */
  complete: boolean;
};

const LEASE_MS = 120_000;

type StateRow = {
  object: string;
  cursor: string | null;
  backfill_done: boolean | null;
  rows_pulled: number | null;
};

export async function runSm8Sync(
  orgId: string,
  trigger: Sm8SyncTrigger,
  now: number = Date.now()
): Promise<Sm8SyncOutcome> {
  const iso = new Date(now).toISOString();
  const today = iso.slice(0, 10);

  /* Claim the lease. The upsert guarantees a row exists without touching a
     live one (ignoreDuplicates); the conditional update is the actual mutex —
     it matches only an unleased or expired-lease row, and matching nothing
     means somebody else is running. Same conditional-write idiom as the
     refresh rotation guard. */
  await supabaseAdmin
    .from("sm8_sync_runs")
    .upsert({ org_id: orgId }, { onConflict: "org_id", ignoreDuplicates: true });

  const { data: claimed } = await supabaseAdmin
    .from("sm8_sync_runs")
    .update({
      lease_until: new Date(now + LEASE_MS).toISOString(),
      last_trigger: trigger,
      last_started_at: iso,
    })
    .eq("org_id", orgId)
    .or(`lease_until.is.null,lease_until.lt.${iso}`)
    .select("calls_today, calls_day");

  const lease = (claimed ?? [])[0] as { calls_today: number | null; calls_day: string | null } | undefined;
  if (!lease) {
    return { ran: false, note: "A sync is already running.", pagesUsed: 0, rowsPulled: 0, complete: false };
  }

  const callsBase = lease.calls_day === today ? lease.calls_today ?? 0 : 0;
  let calls = 0;

  const release = async (ok: boolean, note: string) => {
    await supabaseAdmin
      .from("sm8_sync_runs")
      .update({
        lease_until: null,
        last_finished_at: new Date().toISOString(),
        last_ok: ok,
        last_note: note,
        calls_today: callsBase + calls,
        calls_day: today,
      })
      .eq("org_id", orgId);
  };

  if (callsBase >= DAILY_CALL_BUDGET) {
    const note = "Today's sync budget is spent — resuming tomorrow.";
    await release(false, note);
    return { ran: false, note, pagesUsed: 0, rowsPulled: 0, complete: false };
  }

  const access = await sm8Access(orgId, now);
  if (!access) {
    const note = "ServiceM8 isn't connected, or needs reconnecting.";
    await release(false, note);
    return { ran: false, note, pagesUsed: 0, rowsPulled: 0, complete: false };
  }

  /* The account row first: cheap, and timezone_name is what every due-date
     bucket downstream reads. A plain failure here is not fatal — the mirrors
     are still worth refreshing — but a 401 is the same dead grant it is
     anywhere else. */
  const vendorResult = await fetchSm8Vendor(access.accessToken);
  calls += 1;
  if (!vendorResult.ok && vendorResult.unauthorized) {
    await markSm8NeedsReauth(orgId, "ServiceM8 no longer accepts this connection. Reconnect ServiceM8.");
    const note = "The connection needs reconnecting.";
    await release(false, note);
    return { ran: true, note, pagesUsed: 0, rowsPulled: 0, complete: false };
  }
  /* A billing block answers every endpoint the same way, and this call already
     proved it — walking the nine objects would spend nine calls to be told so
     nine more times. The grant is untouched: it isn't what's wrong. */
  if (!vendorResult.ok && vendorResult.paymentRequired) {
    await release(false, SM8_BILLING);
    return { ran: true, note: SM8_BILLING, pagesUsed: 0, rowsPulled: 0, complete: false };
  }
  if (vendorResult.ok) {
    const v = vendorResult.vendor;
    await supabaseAdmin.from("sm8_vendor").upsert(
      {
        org_id: orgId,
        uuid: v.uuid,
        name: v.name,
        email: v.email,
        timezone_name: v.timezoneName,
        currency: v.currency,
        synced_at: iso,
      },
      { onConflict: "org_id" }
    );
  }

  const { data: stateRows } = await supabaseAdmin
    .from("sm8_sync_state")
    .select("object, cursor, backfill_done, rows_pulled")
    .eq("org_id", orgId);
  const state = new Map<string, StateRow>(
    ((stateRows ?? []) as StateRow[]).map((r) => [r.object, r])
  );

  let pagesLeft = PAGE_BUDGET;
  let rowsPulled = 0;
  let objectsCompleted = 0;
  let stopNote: string | null = null; // set = the whole run ends after this object

  for (const spec of SM8_OBJECTS) {
    if (stopNote) break;
    if (pagesLeft <= 0) {
      stopNote = "Page budget spent — resuming next sync.";
      break;
    }

    const prior = state.get(spec.object);
    const filter = filterFor(spec, prior?.cursor ?? null, now);

    let walkCursor = "-1";
    let batchMax = prior?.cursor ?? null;
    let pulled = 0;
    let objectError: string | null = null;
    let completed = false;

    while (true) {
      if (callsBase + calls >= DAILY_CALL_BUDGET) {
        objectError = "Today's sync budget is spent — resuming tomorrow.";
        stopNote = objectError;
        break;
      }

      const page = await fetchSm8Page(access.accessToken, spec.endpoint, {
        cursor: walkCursor,
        filter,
      });
      calls += 1;

      if (!page.ok) {
        if (page.failure === "unauthorized") {
          await markSm8NeedsReauth(orgId, "ServiceM8 no longer accepts this connection. Reconnect ServiceM8.");
          objectError = "The connection needs reconnecting.";
          stopNote = objectError;
        } else if (page.failure === "forbidden") {
          // Scope drift is per-object news, not a dead run: record which
          // grant would fix it and keep walking the others.
          objectError = `Reconnect ServiceM8 to grant ${spec.scope}.`;
        } else if (page.failure === "payment_required") {
          /* Every object shares the account, so every one of them would answer
             402 as well: spending the calls to learn it nine more times helps
             nobody, and the fix isn't ours to make. Ends the run WITHOUT
             touching the grant — reconnecting cannot settle an invoice. */
          objectError = SM8_BILLING;
          stopNote = objectError;
        } else if (page.failure === "rate_limited") {
          objectError = "ServiceM8's rate limit was hit — resuming next sync.";
          stopNote = objectError;
        } else {
          // Unreachable: the other objects share the same upstream, so
          // spending eight more calls to learn it eight more times helps
          // nobody. End the run; the next kick retries everything.
          objectError = "ServiceM8 couldn't be reached — resuming next sync.";
          stopNote = objectError;
        }
        break;
      }

      const shaped: MirrorRow[] = [];
      for (const raw of page.rows) {
        const s = spec.shape(raw);
        if (s) shaped.push({ ...s, org_id: orgId, synced_at: iso });
      }

      let storeFailed = false;
      for (const part of chunk(shaped)) {
        const { error } = await supabaseAdmin
          .from(spec.table)
          .upsert(part, { onConflict: "org_id,uuid" });
        if (error) {
          objectError = "A page couldn't be stored — resuming next sync.";
          storeFailed = true;
          break;
        }
      }
      if (storeFailed) break;

      batchMax = maxEditDate(shaped, batchMax);
      pulled += shaped.length;
      pagesLeft -= 1;

      if (!page.nextCursor) {
        completed = true;
        break;
      }
      if (pagesLeft <= 0) break; // paused mid-walk; cursor stays put
      walkCursor = page.nextCursor;
    }

    rowsPulled += pulled;
    if (completed) objectsCompleted += 1;

    await supabaseAdmin.from("sm8_sync_state").upsert(
      completed
        ? {
            org_id: orgId,
            object: spec.object,
            cursor: batchMax,
            backfill_done: true,
            last_synced_at: new Date().toISOString(),
            last_error: null,
            rows_pulled: (prior?.rows_pulled ?? 0) + pulled,
          }
        : {
            org_id: orgId,
            object: spec.object,
            // unchanged on purpose: only a finished walk may move the floor
            cursor: prior?.cursor ?? null,
            backfill_done: prior?.backfill_done ?? false,
            last_error: objectError ?? "Paused mid-walk — resuming next sync.",
            rows_pulled: (prior?.rows_pulled ?? 0) + pulled,
          },
      { onConflict: "org_id,object" }
    );
  }

  const complete = objectsCompleted === SM8_OBJECTS.length && !stopNote;
  const note = complete
    ? `Synced ${rowsPulled} change${rowsPulled === 1 ? "" : "s"} across ${SM8_OBJECTS.length} objects.`
    : stopNote ?? "Paused — resuming next sync.";

  await release(complete || stopNote === null, note);
  return { ran: true, note, pagesUsed: PAGE_BUDGET - pagesLeft, rowsPulled, complete };
}

/* ── what the screen shows ── */

export type Sm8ObjectStatus = {
  object: string;
  label: string;
  rowsPulled: number;
  backfillDone: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type Sm8SyncStatusView = {
  objects: Sm8ObjectStatus[];
  lastRun: {
    startedAt: string | null;
    finishedAt: string | null;
    ok: boolean | null;
    note: string | null;
    running: boolean;
  } | null;
};

export async function listSm8SyncStatus(orgId: string): Promise<Sm8SyncStatusView> {
  const [{ data: stateRows }, { data: runRows }] = await Promise.all([
    supabaseAdmin
      .from("sm8_sync_state")
      .select("object, cursor, backfill_done, rows_pulled, last_synced_at, last_error")
      .eq("org_id", orgId),
    supabaseAdmin
      .from("sm8_sync_runs")
      .select("lease_until, last_started_at, last_finished_at, last_ok, last_note")
      .eq("org_id", orgId)
      .maybeSingle(),
  ]);

  const byObject = new Map(
    ((stateRows ?? []) as (StateRow & { last_synced_at: string | null; last_error: string | null })[]).map(
      (r) => [r.object, r]
    )
  );

  const run = runRows as
    | { lease_until: string | null; last_started_at: string | null; last_finished_at: string | null; last_ok: boolean | null; last_note: string | null }
    | null;

  return {
    objects: SM8_OBJECTS.map((spec) => {
      const s = byObject.get(spec.object);
      return {
        object: spec.object,
        label: spec.label,
        rowsPulled: s?.rows_pulled ?? 0,
        backfillDone: s?.backfill_done ?? false,
        lastSyncedAt: s?.last_synced_at ?? null,
        lastError: s?.last_error ?? null,
      };
    }),
    lastRun: run
      ? {
          startedAt: run.last_started_at,
          finishedAt: run.last_finished_at,
          ok: run.last_ok,
          note: run.last_note,
          running: !!run.lease_until && Date.parse(run.lease_until) > Date.now(),
        }
      : null,
  };
}

/* ── who the nightly backstop sweeps ── */

/** How many connected workspaces one query considers before ordering them.
    Far above any real customer count; it exists so this can never become an
    unbounded read. */
const CANDIDATE_CAP = 500;

/** Connected workspaces, LEAST-RECENTLY-SWEPT FIRST, capped.

    WHY THE ORDER IS THE POINT: the cron's cap bounds one run, and the run is
    DAILY (Vercel's Hobby tier refuses anything more frequent). An unordered
    `.limit(n)` therefore hands back the same arbitrary n workspaces every
    night, and workspace n+1 never gets a backstop at all. Oldest-first turns
    the cap into a ROTATION: a workspace can wait its turn, but it cannot be
    skipped forever.

    WHY THIS ISN'T ONE QUERY, unlike Xero's sweepableOrgs: Xero's cursor
    (`drift_checked_at`) lives on integration_connections, so it can order in
    the database. Ours lives in sm8_sync_runs, and a workspace that has NEVER
    synced has no row there — exactly the workspace that most needs picking.
    Selecting from sm8_sync_runs would hide it, so the connections are the
    spine and the run times are merged on.

    Never-swept sorts first by construction: a missing timestamp becomes "",
    which precedes every ISO string. Ties break on org id so a run is
    deterministic rather than dependent on row order. */
export async function sweepableSm8Orgs(limit: number): Promise<string[]> {
  const { data: conns } = await supabaseAdmin
    .from("integration_connections")
    .select("org_id")
    .eq("provider", "servicem8")
    .eq("status", "connected")
    .limit(CANDIDATE_CAP);

  const orgIds = ((conns ?? []) as { org_id: string }[]).map((r) => r.org_id);
  if (orgIds.length === 0) return [];

  const { data: runs } = await supabaseAdmin
    .from("sm8_sync_runs")
    .select("org_id, last_finished_at")
    .in("org_id", orgIds);

  const finishedAt = new Map(
    ((runs ?? []) as { org_id: string; last_finished_at: string | null }[]).map((r) => [
      r.org_id,
      r.last_finished_at ?? "",
    ])
  );

  return [...orgIds]
    .sort((a, b) => {
      const av = finishedAt.get(a) ?? "";
      const bv = finishedAt.get(b) ?? "";
      if (av !== bv) return av < bv ? -1 : 1;
      return a < b ? -1 : a > b ? 1 : 0;
    })
    .slice(0, limit);
}

/* ── the page-load kick — the PRIMARY freshness path ── */

const STALE_AFTER_MS = 10 * 60_000;

/** Schedule a sync slice after the current response if the mirrors look
    stale. `after()` is what makes fire-and-forget real on Vercel — a floating
    promise is frozen the instant the response returns; this one rides the
    invocation's waitUntil. Callers are Server Components and route handlers
    that already gated the org, and the callback deliberately closes over
    nothing but the orgId. */
export async function kickSm8SyncIfStale(orgId: string, now: number = Date.now()): Promise<void> {
  const { data } = await supabaseAdmin
    .from("sm8_sync_runs")
    .select("lease_until, last_finished_at")
    .eq("org_id", orgId)
    .maybeSingle();

  const run = data as { lease_until: string | null; last_finished_at: string | null } | null;
  const running = !!run?.lease_until && Date.parse(run.lease_until) > now;
  const fresh =
    !!run?.last_finished_at && now - Date.parse(run.last_finished_at) < STALE_AFTER_MS;
  if (running || fresh) return;

  after(() => runSm8Sync(orgId, "kick").catch(() => {}));
}
