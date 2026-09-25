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
     page budget, 429, upstream wobble — leaves that object's edit_date floor
     alone, because a half-read walk must not move the floor past rows it
     never saw.
   - BUT THE PAGE IT STOPPED ON IS REMEMBERED. `walk_cursor` holds ServiceM8's
     pagination cursor and `walk_filter` freezes the query that minted it, so
     the next run continues rather than starting over. Without this an object
     bigger than PAGE_BUDGET × 1000 rows can never finish: it re-reads the
     same first pages every run, forever. sm8_attachments hit that wall on the
     live account (24,999 rows mirrored, 49,992 "pulled") and is why the two
     columns exist.
   - THE WALK STARTS WHERE THE HUNGER IS. Each run walks walkOrderFor's
     rotation: the first object whose backfill isn't done goes first and
     inherits the WHOLE page budget, so a backfill bigger than one run can't
     starve the list's tail out of ever being reached.
   - EVERY RUN IS BOUNDED TWICE: PAGE_BUDGET caps one invocation (a 20k-job
     backfill lands across several kicks, visibly in sm8_sync_state), and
     DAILY_CALL_BUDGET caps the day (our worst bug must not eat a customer's
     real ServiceM8 quota).
   - FAILURES ARE PER-OBJECT WHERE THEY CAN BE. A 403 records "reconnect to
     grant X" on that object and the walk moves on; only a dead grant (401)
     or a back-off signal (429/unreachable) ends the whole run.
   - A 401 IS RENEWED BEFORE IT IS BELIEVED. The hourly token can run out
     mid-walk; one renewal and one more try (sm8-renew.ts) tell that apart
     from a grant that is really dead, and only the second refusal flags it.
   - ONE ACCOUNT PER MIRROR. The run checks that the account it reads is the
     one the mirror holds; a different one clears the old copy first
     (switchSm8Account), and a connection moved to another account mid-walk
     stops the run before it writes the old account into the new mirror.
   - THE SYNC STEPS BACK FIRST. Every request is counted against the
     account's limit (sm8-http, lane `sync`), and the sync's lane leaves the
     most room behind: when the counter has no turn for it, the run pauses
     (SM8_PAUSE_SHARED_LIMIT) and a person's send goes instead.
   - A FINISHED WALK'S CURSOR SITS BEFORE THE WALK BEGAN (nextCursor), so an
     edit made on a page already read, or in April's repeated hour, is read
     by the next walk rather than skipped. (Read, not always kept: a record
     edited in both passes of the repeated hour keeps its first-pass copy
     until its next edit, because the mirror keeps the newer stamp and the
     second pass's reads as older — see sm8-sync-plan's cursor note.)

   NO SESSION HERE — the caller establishes the right to ask (owner action,
   CRON_SECRET, or a page loader that already gated the org) and hands in a
   bare orgId. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { fetchSm8Vendor } from "./sm8";
import { sm8CallOf } from "./sm8-http";
import {
  markSm8NeedsReauth,
  nameSm8ConnectionIfNameless,
  readSm8Accounts,
  sm8AccessResult,
  switchSm8Account,
  type Sm8SwitchResult,
} from "./sm8-store";
import type { Sm8Vendor } from "./sm8";
import { withSm8Renewal } from "./sm8-renew";
import { fetchSm8Page } from "./sm8-read";
import {
  chunk,
  DAILY_CALL_BUDGET,
  filterFor,
  maxEditDate,
  nextCursor,
  PAGE_BUDGET,
  SM8_ACCOUNT_MOVED,
  SM8_ACCOUNT_SWITCHED,
  SM8_ACCOUNT_UNCLEARED,
  SM8_ACCOUNT_UNREAD,
  SM8_BILLING,
  SM8_ELSEWHERE,
  SM8_OBJECTS,
  SM8_PAUSE_DAILY_BUDGET,
  SM8_PAUSE_MIDWALK,
  SM8_PAUSE_PAGE_BUDGET,
  SM8_PAUSE_RATE_LIMIT,
  SM8_PAUSE_SHARED_LIMIT,
  SM8_STATE_UNREAD,
  SM8_UNREACHABLE,
  sm8ObjectPhase,
  walkOrderFor,
  type MirrorRow,
  type Sm8ObjectPhase,
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

const NOT_CONNECTED = "ServiceM8 isn't connected, or needs reconnecting.";
const DEAD = "The connection needs reconnecting.";
/** The lease is held elsewhere: another run is walking. */
export const SM8_SYNC_BUSY = "A sync is already running.";

/** Claim the one lease over this workspace's mirror. The upsert guarantees a
    row exists without touching a live one (ignoreDuplicates); the
    conditional update is the actual mutex — it matches only an unleased or
    expired-lease row, and matching nothing means somebody else holds it.
    Same conditional-write idiom as the refresh rotation guard. Null: busy. */
async function claimSm8Lease(
  orgId: string,
  now: number,
  patch: Record<string, unknown> = {}
): Promise<{ calls_today: number | null; calls_day: string | null } | null> {
  const iso = new Date(now).toISOString();
  await supabaseAdmin
    .from("sm8_sync_runs")
    .upsert({ org_id: orgId }, { onConflict: "org_id", ignoreDuplicates: true });

  const { data: claimed } = await supabaseAdmin
    .from("sm8_sync_runs")
    .update({ lease_until: new Date(now + LEASE_MS).toISOString(), ...patch })
    .eq("org_id", orgId)
    .or(`lease_until.is.null,lease_until.lt.${iso}`)
    .select("calls_today, calls_day");
  return ((claimed ?? [])[0] as { calls_today: number | null; calls_day: string | null } | undefined) ?? null;
}

/** Whether the connection still holds the account this run is reading.
    Asked before every write into the mirror: a reconnect to a different
    account while a run is walking must not let the old account's rows land
    in the new account's copy. A read that fails is no evidence either way,
    and the write it guards goes ahead. */
async function stillReading(orgId: string, uuid: string): Promise<"same" | "moved" | "gone"> {
  const { data, error } = await supabaseAdmin
    .from("integration_connections")
    .select("tenant_id")
    .eq("org_id", orgId)
    .eq("provider", "servicem8")
    .maybeSingle();
  if (error) return "same";
  const row = data as { tenant_id: string | null } | null;
  if (!row) return "gone";
  return row.tenant_id === uuid ? "same" : "moved";
}

/** The zone the last vendor read named, for a read that came back without
    one. Null when there is none, or it can't be read. */
async function storedTimezone(orgId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("sm8_vendor")
    .select("timezone_name")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return null;
  const tz = (data as { timezone_name: string | null } | null)?.timezone_name;
  return typeof tz === "string" && tz.trim() ? tz.trim() : null;
}

type StateRow = {
  object: string;
  cursor: string | null;
  backfill_done: boolean | null;
  rows_pulled: number | null;
  /** Where a paused walk resumes, and the query that cursor belongs to. */
  walk_cursor: string | null;
  walk_filter: string | null;
  /** When the walk in progress began — what its finished cursor is floored
      at (nextCursor). Absent on a database without the column, and null for
      a walk paused before it existed: both finish on the old rule. */
  walk_started_at?: string | null;
};

type DbError = { code?: string; message?: string } | null;
const missingColumn = (e: DbError) => e?.code === "PGRST204" || e?.code === "42703";

const STATE_COLUMNS = "object, cursor, backfill_done, rows_pulled, walk_cursor, walk_filter";

/** Every object's state for one workspace. A READ THAT FAILS IS NOT AN EMPTY
    STATE: read as "nothing synced yet", it would start every object's
    backfill again — 24 months of history. A database without walk_started_at
    yet is asked again without it; any other failure is null, and the run
    stops. */
async function readSyncState(orgId: string): Promise<StateRow[] | null> {
  const withStart = await supabaseAdmin
    .from("sm8_sync_state")
    .select(`${STATE_COLUMNS}, walk_started_at`)
    .eq("org_id", orgId);
  if (!withStart.error) return (withStart.data ?? []) as StateRow[];
  /* ONLY a missing column is asked again: after any other failure a plain
     read that happened to answer would lose the start of a walk in progress
     — its finished cursor back on the old rule, or the start saved as null
     for good. The run stops instead, and the next one reads it whole. */
  if (!missingColumn(withStart.error)) {
    console.error(`[sm8] couldn't read where the last sync stopped for org ${orgId}:`, withStart.error);
    return null;
  }
  const plain = await supabaseAdmin.from("sm8_sync_state").select(STATE_COLUMNS).eq("org_id", orgId);
  if (!plain.error) return (plain.data ?? []) as StateRow[];
  console.error(`[sm8] couldn't read where the last sync stopped for org ${orgId}:`, plain.error);
  return null;
}

/** Save one object's state. A database without walk_started_at yet saves the
    rest; anything else that fails is logged — the next run re-reads from the
    older cursor, which costs calls, never rows. */
async function saveSyncState(orgId: string, row: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from("sm8_sync_state").upsert(row, { onConflict: "org_id,object" });
  if (!error) return;
  if (missingColumn(error) && "walk_started_at" in row) {
    const { walk_started_at: _dropped, ...rest } = row;
    void _dropped;
    const again = await supabaseAdmin.from("sm8_sync_state").upsert(rest, { onConflict: "org_id,object" });
    if (!again.error) return;
    console.error(`[sm8] couldn't save the sync state of ${String(row.object)} for org ${orgId}:`, again.error);
    return;
  }
  console.error(`[sm8] couldn't save the sync state of ${String(row.object)} for org ${orgId}:`, error);
}

export async function runSm8Sync(
  orgId: string,
  trigger: Sm8SyncTrigger,
  now: number = Date.now()
): Promise<Sm8SyncOutcome> {
  const iso = new Date(now).toISOString();
  const today = iso.slice(0, 10);

  const lease = await claimSm8Lease(orgId, now, { last_trigger: trigger, last_started_at: iso });
  if (!lease) {
    return { ran: false, note: SM8_SYNC_BUSY, pagesUsed: 0, rowsPulled: 0, complete: false };
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
    const note = SM8_PAUSE_DAILY_BUDGET;
    await release(false, note);
    return { ran: false, note, pagesUsed: 0, rowsPulled: 0, complete: false };
  }

  const got = await sm8AccessResult(orgId, now);
  if (!got.ok) {
    /* A refresh that couldn't reach ServiceM8 is a wait, not a broken
       connection, and says so. */
    const note = got.reason === "unreachable" ? SM8_UNREACHABLE : NOT_CONNECTED;
    await release(false, note);
    return { ran: false, note, pagesUsed: 0, rowsPulled: 0, complete: false };
  }
  let access = got.access;

  const ended = async (note: string) => {
    await release(false, note);
    return { ran: true, note, pagesUsed: 0, rowsPulled: 0, complete: false };
  };

  /* The account row first: cheap, timezone_name is what every due-date
     bucket downstream reads, and its uuid is how the run knows WHICH account
     it is about to write into the mirror. So a failed read ends the run: the
     objects share its host, and without the uuid nothing below can tell a
     changed account from the same one. */
  const vendorRead = await withSm8Renewal(
    orgId,
    access,
    (a) => fetchSm8Vendor(sm8CallOf(a, "sync")),
    (r) => !r.ok && r.unauthorized
  );
  const vendorResult = vendorRead.result;
  // a turn the counter refused reached nobody, and costs the day nothing
  calls += vendorRead.tries - (!vendorResult.ok && vendorResult.called === false ? 1 : 0);
  access = vendorRead.access;
  // the grant was flagged by the renewal, for this grant only
  if (vendorRead.verdict === "dead") return ended(DEAD);
  if (vendorRead.verdict === "unreachable") return ended(SM8_UNREACHABLE);
  if (vendorRead.verdict === "gone") return ended(NOT_CONNECTED);
  /* The account's limit has no room for the sync — before a single page is
     asked for, so a person's send finds the room instead. */
  if (!vendorResult.ok && vendorResult.throttled) return ended(SM8_PAUSE_SHARED_LIMIT);
  /* A billing block answers every endpoint the same way, and this call already
     proved it — walking the nine objects would spend nine calls to be told so
     nine more times. The grant is untouched: it isn't what's wrong. */
  if (!vendorResult.ok && vendorResult.paymentRequired) return ended(SM8_BILLING);
  if (!vendorResult.ok) return ended(SM8_UNREACHABLE);

  const v = vendorResult.vendor;

  /* WHICH ACCOUNT. Two questions, asked of two records, and they are not
     the same question:

     - Is this token still the connection's? The connection's tenant_id is
       always written from a vendor read with its own grant, so one that
       names another account than this token reads means the owner
       reconnected while this run was starting. This run writes nothing; the
       next one, under the new grant, reads the new account. (Extra
       protection for a stale run, not the reason for the order below.)
     - Is the copy here the account this token reads? That is sm8_vendor's
       to say, not the connection's, and the switch below compares against
       it even when tenant_id already matches. The connection moves first
       (the callback saves the new account before anything is cleared);
       sm8_vendor names the old account until its copy is gone, including
       across a disconnect. Comparing tenant_id alone would find the two
       agreeing, write the new account into sm8_vendor, and lose the only
       marker that the old copy — or a clear that didn't finish — is still
       here to clear. Nothing is cleared on a missing value either way.

     A failed read of either record ends the run before anything is named,
     cleared or written: an error is not an absent row. */
  const before = await readSm8Accounts(orgId);
  if (!before.ok) return ended(SM8_ACCOUNT_UNREAD);
  if (!before.connected) return ended(NOT_CONNECTED);
  if (before.connected.tenantId && before.connected.tenantId !== v.uuid) return ended(SM8_ACCOUNT_MOVED);

  /* A grant whose connect-time vendor read failed was stored nameless on
     purpose (saveSm8Connection). This read is the one that can fix it, so
     it does — the mirror is the queryable home for the account, but the
     connection row is what the screens' status line reads, and what any
     later tenant_name reader would find empty forever. No-ops on a row that
     already has a name. An account another workspace already holds can't be
     named here: one account, one workspace. */
  if (!before.connected.tenantId) {
    const named = await nameSm8ConnectionIfNameless(orgId, v, now);
    if (named === "elsewhere") {
      await markSm8NeedsReauth(orgId, SM8_ELSEWHERE, access);
      return ended(SM8_ELSEWHERE);
    }
    if (named === "unchanged" && (await stillReading(orgId, v.uuid)) !== "same") {
      return ended(SM8_ACCOUNT_MOVED);
    }
  }

  /* The mirror's own row names the account its copy was read from. A
     different account behind the connection now means that copy is another
     business's: it is cleared, sending goes off, and this run reads the new
     account from the start. Never on a missing value — no mirror row, no
     switch. This run holds the lease, so no walker under the old grant can
     be writing while the clear runs. */
  let switched = false;
  if (before.mirrored && before.mirrored.uuid !== v.uuid) {
    const sw = await switchSm8Account(orgId, { to: v, from: before.mirrored, now });
    if (!sw.ok) {
      if (sw.reason === "elsewhere") {
        await markSm8NeedsReauth(orgId, SM8_ELSEWHERE, access);
        return ended(SM8_ELSEWHERE);
      }
      return ended(sw.reason === "moved" ? SM8_ACCOUNT_MOVED : SM8_ACCOUNT_UNCLEARED);
    }
    // an unfinished clear keeps the old sm8_vendor row, so the next sync repeats it
    if (!sw.cleared) return ended(SM8_ACCOUNT_UNCLEARED);
    switched = true;
  }

  /* The mirror's row is written only while the connection still holds this
     account: a reconnect that landed since would otherwise find the old
     account named here, and clear a copy it had only just started. */
  const holdingNow = await stillReading(orgId, v.uuid);
  if (holdingNow !== "same") return ended(holdingNow === "moved" ? SM8_ACCOUNT_MOVED : NOT_CONNECTED);

  /* THE ACCOUNT'S ZONE, which its edit stamps are written in: from this
     read, or the last one that named it. Unknown, a finished walk's cursor
     keeps the old rule (nextCursor). */
  const tz = v.timezoneName ?? (await storedTimezone(orgId));

  await supabaseAdmin.from("sm8_vendor").upsert(
    {
      org_id: orgId,
      uuid: v.uuid,
      name: v.name,
      email: v.email,
      timezone_name: tz,
      currency: v.currency,
      synced_at: iso,
    },
    { onConflict: "org_id" }
  );

  const stateRows = await readSyncState(orgId);
  if (stateRows === null) return ended(SM8_STATE_UNREAD);
  const state = new Map<string, StateRow>(stateRows.map((r) => [r.object, r]));

  const backfillDone = new Set(
    [...state.values()].filter((r) => r.backfill_done === true).map((r) => r.object)
  );

  let pagesLeft = PAGE_BUDGET;
  let rowsPulled = 0;
  let objectsCompleted = 0;
  let stopNote: string | null = null; // set = the whole run ends after this object
  /* set = the connection no longer holds the account this run is reading;
     nothing more of it is written, not even this object's state row */
  let accountLost = false;

  for (const spec of walkOrderFor(backfillDone)) {
    if (stopNote) break;
    if (pagesLeft <= 0) {
      stopNote = SM8_PAUSE_PAGE_BUDGET;
      break;
    }

    const prior = state.get(spec.object);

    /* A RESUMED WALK KEEPS ITS OWN QUERY. `walk_cursor` present means a
       previous run stopped part-way, and `walk_filter` is the filter that
       cursor was minted against — recomputing it here would slide a backfill
       floor forward by however long ago that run was, leaving the cursor
       pointing into a result set that no longer exists. A stored null filter
       is a real value (an object with no floor), which is why the cursor, not
       the filter, is what says a walk is in progress. */
    const resuming = prior?.walk_cursor != null;
    const filter = resuming ? prior!.walk_filter : filterFor(spec, prior?.cursor ?? null, now);

    /* When this walk began: a resumed walk keeps its own start, a new one
       starts now — a moment before its first page, the safe side. */
    const walkStartedAt: string | null = resuming ? prior?.walk_started_at ?? null : iso;

    let walkCursor = prior?.walk_cursor ?? "-1";
    /* Where the NEXT run should pick up; null once the walk finishes. Every
       break below sets it before leaving, so a pause never forgets its place. */
    let resumeCursor: string | null = null;
    let batchMax = prior?.cursor ?? null;
    let pulled = 0;
    let objectError: string | null = null;
    let completed = false;

    while (true) {
      if (callsBase + calls >= DAILY_CALL_BUDGET) {
        objectError = SM8_PAUSE_DAILY_BUDGET;
        stopNote = objectError;
        resumeCursor = walkCursor; // this page was never asked for
        break;
      }

      const read = await withSm8Renewal(
        orgId,
        access,
        (a) => fetchSm8Page(sm8CallOf(a, "sync"), spec.endpoint, { cursor: walkCursor, filter }),
        (p) => !p.ok && p.failure === "unauthorized"
      );
      const page = read.result;
      // a turn the counter refused reached nobody, and costs the day nothing
      calls += read.tries - (!page.ok && page.called === false ? 1 : 0);
      access = read.access;

      if (read.verdict === "unreachable" || read.verdict === "gone") {
        // no token to go on with: the page was never read, so it is the one to retry
        objectError = read.verdict === "unreachable" ? SM8_UNREACHABLE : NOT_CONNECTED;
        stopNote = objectError;
        resumeCursor = walkCursor;
        break;
      }

      if (!page.ok) {
        if (page.failure === "unauthorized") {
          // refused twice, a token apart: the renewal has flagged this grant
          objectError = DEAD;
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
          objectError = SM8_PAUSE_RATE_LIMIT;
          stopNote = objectError;
        } else if (page.failure === "throttled") {
          /* the account's counter had no room for the sync: it steps back,
             and the page it didn't read is the one to start from */
          objectError = SM8_PAUSE_SHARED_LIMIT;
          stopNote = objectError;
        } else {
          // Unreachable: the other objects share the same upstream, so
          // spending eight more calls to learn it eight more times helps
          // nobody. End the run; the next kick retries everything.
          objectError = SM8_UNREACHABLE;
          stopNote = objectError;
        }
        /* The page that failed is the page to retry. Harmless on the paths
           that need a human first (401/403): the walk is not advancing
           either way, and the cursor is cleared by the restart a fixed grant
           brings. */
        resumeCursor = walkCursor;
        break;
      }

      const shaped: MirrorRow[] = [];
      for (const raw of page.rows) {
        const s = spec.shape(raw);
        if (s) shaped.push({ ...s, org_id: orgId, synced_at: iso });
      }

      /* The connection may have moved to another account since the run
         began. Nothing of the old one lands after that — not these rows, and
         not the state row below. */
      const holding = await stillReading(orgId, v.uuid);
      if (holding !== "same") {
        stopNote = holding === "moved" ? SM8_ACCOUNT_MOVED : NOT_CONNECTED;
        accountLost = true;
        break;
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
      if (storeFailed) {
        resumeCursor = walkCursor; // re-read the page whose rows didn't land
        break;
      }

      batchMax = maxEditDate(shaped, batchMax);
      pulled += shaped.length;
      pagesLeft -= 1;

      if (!page.nextCursor) {
        completed = true;
        break;
      }
      if (pagesLeft <= 0) {
        /* Out of budget with pages still to read. The floor stays put — this
           walk hasn't finished — but the NEXT page is remembered, which is
           what lets an object bigger than one run's budget ever finish. */
        resumeCursor = page.nextCursor;
        break;
      }
      walkCursor = page.nextCursor;
    }

    rowsPulled += pulled;
    if (completed) objectsCompleted += 1;

    if (!accountLost) {
      const holding = await stillReading(orgId, v.uuid);
      if (holding !== "same") {
        stopNote = holding === "moved" ? SM8_ACCOUNT_MOVED : NOT_CONNECTED;
        accountLost = true;
      }
    }
    if (accountLost) break;

    await saveSyncState(
      orgId,
      completed
        ? {
            org_id: orgId,
            object: spec.object,
            /* the lower of the highest stamp read and the walk's start less
               the overlap, in the account's clock — see nextCursor */
            cursor: nextCursor({
              seenMax: batchMax,
              walkStartedAtMs: walkStartedAt ? Date.parse(walkStartedAt) : null,
              tz,
            }),
            backfill_done: true,
            last_synced_at: new Date().toISOString(),
            last_error: null,
            rows_pulled: (prior?.rows_pulled ?? 0) + pulled,
            // The walk is over; the next one starts fresh from the new floor.
            walk_cursor: null,
            walk_filter: null,
            walk_started_at: null,
          }
        : {
            org_id: orgId,
            object: spec.object,
            // unchanged on purpose: only a finished walk may move the floor
            cursor: prior?.cursor ?? null,
            backfill_done: prior?.backfill_done ?? false,
            last_error: objectError ?? SM8_PAUSE_MIDWALK,
            rows_pulled: (prior?.rows_pulled ?? 0) + pulled,
            /* Where to pick up, and the query it belongs to — stored together
               or not at all, because a cursor without its filter is a page
               number into an unknown book. */
            walk_cursor: resumeCursor,
            walk_filter: resumeCursor === null ? null : filter,
            walk_started_at: resumeCursor === null ? null : walkStartedAt,
          }
    );
  }

  const complete = objectsCompleted === SM8_OBJECTS.length && !stopNote;
  const note = complete
    ? switched
      ? SM8_ACCOUNT_SWITCHED
      : `Synced ${rowsPulled} change${rowsPulled === 1 ? "" : "s"} across ${SM8_OBJECTS.length} objects.`
    : stopNote ?? "Paused — resuming next sync.";

  await release(complete || stopNote === null, note);
  return { ran: true, note, pagesUsed: PAGE_BUDGET - pagesLeft, rowsPulled, complete };
}

/* ── the callback's half of a change of account ── */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Clear the old account's copy under the sync lease, so no walker is
    writing into the mirror while it goes. `busy`: a run holds the lease.
    One under the old grant stops at its next check (the connection has
    moved); one under the new grant finds the old copy itself and clears it
    under its own lease. Either way nothing was cleared here, so sm8_vendor
    still names the old account, and the run that holds or follows the lease
    finishes the switch.

    The lease is released unconditionally: the callback that calls this can
    run for a minute at most (its maxDuration), well inside LEASE_MS, so the
    lease can't have passed to anyone else while it held it. last_* are left
    alone — this is not a sync, and the page-load kick reads them. */
export async function switchSm8AccountUnderLease(
  orgId: string,
  input: { to: Sm8Vendor; from: { uuid: string | null; name: string | null }; now?: number }
): Promise<Sm8SwitchResult | { ok: false; reason: "busy" }> {
  const now = input.now ?? Date.now();
  if (!(await claimSm8Lease(orgId, now))) return { ok: false, reason: "busy" };
  try {
    return await switchSm8Account(orgId, { ...input, now });
  } finally {
    await supabaseAdmin.from("sm8_sync_runs").update({ lease_until: null }).eq("org_id", orgId);
  }
}

/** A sync that waits a moment for a run already walking to end — the
    callback's first sync. A run under the old grant stops at its next check
    once the connection has moved, typically within a page; giving up at
    once would leave the old account's copy on the board until the next kick,
    ten minutes on. Bounded: past `tries`, the busy answer is the answer. */
export async function runSm8SyncWhenFree(
  orgId: string,
  trigger: Sm8SyncTrigger,
  opts: { tries?: number; waitMs?: number } = {}
): Promise<Sm8SyncOutcome> {
  const tries = opts.tries ?? 6;
  const waitMs = opts.waitMs ?? 2_000;
  for (let i = 1; ; i++) {
    const out = await runSm8Sync(orgId, trigger);
    if (out.ran || out.note !== SM8_SYNC_BUSY || i >= tries) return out;
    await sleep(waitMs);
  }
}

/* ── what the screen shows ── */

export type Sm8ObjectStatus = {
  object: string;
  label: string;
  rowsPulled: number;
  backfillDone: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  phase: Sm8ObjectPhase;
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
  /** When Vercel's scheduler last called the overnight sync for this
      workspace; null when it never has, and absent when that couldn't be
      read (the screen then says nothing about it). */
  lastCron?: string | null;
};

export async function listSm8SyncStatus(orgId: string): Promise<Sm8SyncStatusView> {
  const [{ data: stateRows }, { data: runRows }, lastCron] = await Promise.all([
    supabaseAdmin
      .from("sm8_sync_state")
      .select("object, cursor, backfill_done, rows_pulled, last_synced_at, last_error")
      .eq("org_id", orgId),
    supabaseAdmin
      .from("sm8_sync_runs")
      .select("lease_until, last_started_at, last_finished_at, last_ok, last_note")
      .eq("org_id", orgId)
      .maybeSingle(),
    readSm8LastCron(orgId),
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
      const rowsPulled = s?.rows_pulled ?? 0;
      const backfillDone = s?.backfill_done ?? false;
      const lastError = s?.last_error ?? null;
      return {
        object: spec.object,
        label: spec.label,
        rowsPulled,
        backfillDone,
        lastSyncedAt: s?.last_synced_at ?? null,
        lastError,
        phase: sm8ObjectPhase({ backfillDone, rowsPulled, lastError }),
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
    ...(lastCron === undefined ? {} : { lastCron }),
  };
}

/* ── the overnight trace ──

   Kept apart from last_trigger, which the next page-load kick overwrites
   within minutes of the morning: last_cron_at is written only by Vercel's
   scheduled call, once it has passed CRON_SECRET, and only read here. It is
   how the owner's screen can say the overnight sync ran — or that it never
   has, which is what an unset CRON_SECRET looks like. */

/** The scheduler called the overnight sync for this workspace. Recorded
    before the workspace's sync runs, so a night where another sync held the
    lease still counts. Never throws; a database without the column yet
    records nothing. */
export async function recordSm8CronVisit(orgId: string, now: number = Date.now()): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("sm8_sync_runs")
      .upsert({ org_id: orgId, last_cron_at: new Date(now).toISOString() }, { onConflict: "org_id" });
    if (error && !missingColumn(error)) {
      console.error(`[sm8] couldn't record the overnight sync for org ${orgId}:`, error);
    }
  } catch {
    // the trace is a courtesy; the sync is the point
  }
}

/** When the overnight sync last came: the time, null when it never has, and
    undefined when it can't be read (a database without the column yet). */
export async function readSm8LastCron(orgId: string): Promise<string | null | undefined> {
  const { data, error } = await supabaseAdmin
    .from("sm8_sync_runs")
    .select("last_cron_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return undefined;
  const at = (data as { last_cron_at?: string | null } | null)?.last_cron_at;
  return typeof at === "string" && at ? at : null;
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

/* ── is the mirror due a top-up? ── */

/** How long a finished sync keeps the mirror fresh. */
export const STALE_AFTER_MS = 10 * 60_000;

/** Whether the mirror is due a sync slice: nothing running, and nothing
    finished in the last ten minutes. The page-load path asks it after the
    response (sm8-freshness), so no page waits on it. */
export async function sm8SyncIsStale(orgId: string, now: number = Date.now()): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("sm8_sync_runs")
    .select("lease_until, last_finished_at")
    .eq("org_id", orgId)
    .maybeSingle();

  const run = data as { lease_until: string | null; last_finished_at: string | null } | null;
  const running = !!run?.lease_until && Date.parse(run.lease_until) > now;
  const fresh =
    !!run?.last_finished_at && now - Date.parse(run.last_finished_at) < STALE_AFTER_MS;
  return !running && !fresh;
}
