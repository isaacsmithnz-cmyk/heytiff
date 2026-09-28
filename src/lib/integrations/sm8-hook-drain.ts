/* The drain (two-way phase 4, PR D) — server only.

   A ping from ServiceM8 is a doorbell: it names a record, never its values
   (sm8-hook-plan's header). The route queues it (sm8_webhook_pings, one row
   per record, repeat pings merged); this reads each queued record ITSELF,
   through the one door, and writes what ServiceM8 answered into the same
   mirror table the sync writes, through the sync's own shape. Nothing here
   runs unless sm8-hooks-switch says `on`, and every caller loads this
   module only after asking too.

   READ-ONLY AGAINST SERVICEM8. The drain only ever GETs: fetchSm8Page, on
   the `hook` lane, through sm8Request's REST base (which refuses anything
   off /api_1.0/) and the meter. It never sends a POST, a PUT or a DELETE —
   and a DELETE on a record ServiceM8 has removed RESTORES it (#847). A
   removal arrives as a ping like any other change, and is read back as the
   record with active = 0. A test scans this file for any method but GET.

   THE MIRROR'S SECOND WRITER. It writes only what ServiceM8 returned, the
   row whose uuid is the one asked for, shaped by SM8_OBJECTS[i].shape and
   upserted on (org_id, uuid), under the keep-newer trigger
   (sm8_calls_echo_freshness.sql) — so an older read never lands over a
   newer copy. And under the sync lease, by token, after the same
   which-account checks the sync makes.

   FOUR RULES BOUND IT:
   - SINGLE FLIGHT PER WORKSPACE (sm8_webhooks.draining_until, claimed
     conditionally for DRAIN_FLIGHT_MS and extended as it goes). An
     invocation that finds it held leaves at once. The holder RELEASES,
     THEN LOOKS AGAIN: a row queued while it was finishing is seen either by
     that second look or by its own invocation, which finds the flight free.
   - EVERY BUDGET FROM THE FUNCTION'S OWN DEADLINE. `deadline` is the
     caller's start + its maxDuration − FUNCTION_MARGIN_MS
     (functionDeadline); the drain also stops at its own `maxMs`. A read
     starts only while its worst case (READ_NEED_MS: the read's timeout,
     the meter's longest wait, the write) still ends inside both.
   - THE SYNC LEASE, BY TOKEN. Claimed as `hook` for HOOK_LEASE_MS, only
     while that ends by the deadline. Before each read, READ_NEED_MS must be
     left on it, or it is extended by token — again only while the new end
     is inside the deadline — or the drain stops. Given back by token, in
     `finally`, and last_* is never touched: this isn't a sync.
   - IT STANDS ASIDE. A sync that meets the drain's lease asks for it
     (sm8_sync_runs.wanted_at, sm8-sync's wantSm8Lease); the drain looks
     before every read, and gives the lease back within one read.

   PINGS NEVER START A SYNC. More than HAND_OVER_AT ready for one object is
   a bulk edit, not worth a read a second: those rows are marked handed_at
   for the NEXT ORDINARY sync (a page load or the night), sync_wanted_at is
   set, and no sync is run here. A handed row stays until a completed walk
   of its object — sm8_sync_state.last_synced_at, which only a finished
   walk sets — is later than its handed_at.

   PACED AND COUNTED. At most one read a second (HOOK_READ_GAP_MS), and
   each is counted BEFORE it is made (sm8_take_hook_call, HOOK_DAILY_BUDGET
   a workspace a UTC day): a refusal stops the drain, and its rows wait. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { settleMentionAsks } from "@/lib/dashboard/mention-settle";
import { sm8CallOf } from "./sm8-http";
import { fetchSm8Page, type Sm8Page } from "./sm8-read";
import { withSm8Renewal } from "./sm8-renew";
import { readSm8Accounts, sm8AccessResult, type Sm8Access } from "./sm8-store";
import { claimSm8Lease, extendSm8Lease, releaseSm8Lease, type Sm8Lease } from "./sm8-sync";
import { sm8WebhooksState } from "./sm8-hooks-switch";
import {
  DRAIN_FLIGHT_MS,
  DRAIN_ROUND,
  HAND_OVER_AT,
  HOOK_DAILY_BUDGET,
  HOOK_LEASE_MS,
  HOOK_MAX_ATTEMPTS,
  HOOK_OBJECT_NAMES,
  HOOK_READ_GAP_MS,
  HOOK_READ_TIMEOUT_MS,
  MISMATCH_DROP_MS,
  QUIET_MS,
  READ_NEED_MS,
  STALE_ROW_MS,
  WANTED_FRESH_MS,
  fitsLease,
  hookSpecOf,
  isHookObject,
  readFits,
  readHookObjects,
  type HookObjectName,
} from "./sm8-hook-plan";

const WEBHOOKS = "sm8_webhooks";
const PINGS = "sm8_webhook_pings";

/** The most queued rows read at once: past it, the next round reads on. */
const QUEUE_READ_MAX = 1_000;
/** The asks a notes write brings in are settled in at most this long. */
const NOTES_SETTLE_MS = 20_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const iso = (ms: number) => new Date(ms).toISOString();
const msOf = (v: unknown): number | null => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ── the rules, pure ── */

/** One waiting record: which, how many pings (the snapshot a delete must
    still match), how many unavailable reads, and when it was pinged. */
export type QueueRow = {
  object: HookObjectName;
  uuid: string;
  pings: number;
  attempts: number;
  first_seen_at: string;
  last_seen_at: string;
};

/** Ready to read: QUIET_MS with no new ping, or waiting STALE_ROW_MS
    whatever it does — so a record that keeps pinging still gets read. */
export function isReady(row: Pick<QueueRow, "first_seen_at" | "last_seen_at">, now: number): boolean {
  const last = msOf(row.last_seen_at);
  const first = msOf(row.first_seen_at);
  return (last !== null && last + QUIET_MS <= now) || (first !== null && first + STALE_ROW_MS <= now);
}

/** When the first row not yet ready will be. Null when there is none. */
export function nextReadyAt(rows: readonly QueueRow[], now: number): number | null {
  let soonest: number | null = null;
  for (const r of rows) {
    if (isReady(r, now)) continue;
    const at = Math.min((msOf(r.last_seen_at) ?? Infinity) + QUIET_MS, (msOf(r.first_seen_at) ?? Infinity) + STALE_ROW_MS);
    if (Number.isFinite(at) && (soonest === null || at < soonest)) soonest = at;
  }
  return soonest;
}

/** One round: the objects with more than HAND_OVER_AT ready (handed to the
    next ordinary sync, never read here), and up to DRAIN_ROUND ready rows
    of the rest, the longest-waiting first. */
export function planDrainRound(rows: readonly QueueRow[], now: number): { handOver: HookObjectName[]; read: QueueRow[] } {
  const ready = rows.filter((r) => isHookObject(r.object) && UUID_RE.test(r.uuid) && isReady(r, now));
  const per = new Map<HookObjectName, number>();
  for (const r of ready) per.set(r.object, (per.get(r.object) ?? 0) + 1);
  const handOver = HOOK_OBJECT_NAMES.filter((o) => (per.get(o) ?? 0) > HAND_OVER_AT);
  const read = ready
    .filter((r) => !handOver.includes(r.object))
    .sort((a, b) => (msOf(a.first_seen_at) ?? 0) - (msOf(b.first_seen_at) ?? 0))
    .slice(0, DRAIN_ROUND);
  return { handOver, read };
}

/** Before a read:
    - `stop`: its worst case no longer ends by the drain's end (its own
      budget, or the function's deadline, whichever is first);
    - `go`: it fits the lease as it stands;
    - `extend`: it doesn't, but a whole new lease still ends by the
      function's deadline — extend by token first;
    - `stop` otherwise. */
export function drainReadStep(input: { now: number; leaseUntil: number; deadline: number; end: number }): "go" | "extend" | "stop" {
  const { now, leaseUntil, deadline, end } = input;
  if (!fitsLease(now, READ_NEED_MS, Math.min(end, deadline))) return "stop";
  if (readFits(leaseUntil, now)) return "go";
  return fitsLease(now, HOOK_LEASE_MS, deadline) ? "extend" : "stop";
}

/** A sync asked for the lease within WANTED_FRESH_MS (or, by a clock ahead
    of ours, in the future): the drain stands aside. */
export function syncWants(wantedAt: string | null | undefined, now: number): boolean {
  const at = msOf(wantedAt ?? null);
  return at !== null && now - at < WANTED_FRESH_MS;
}

/* ── the result ── */

export type Sm8DrainResult = {
  /** It held the flight at least once. */
  ran: boolean;
  /** Records read from ServiceM8 (each counted before it was asked). */
  read: number;
  /** Mirror rows written. */
  written: number;
  /** Rows handed to the next ordinary sync. */
  handed: number;
  /** Rows dropped: an account that is no longer the connection's. */
  dropped: number;
  /** Why it stopped short, when it did: `off`, `flying` (another drain
      has the flight), `budget`, `busy` (a sync holds the lease), `lease`,
      `wanted` (it stood aside), `day` (3,000 today), `throttled`, `grant`,
      `billing`, `unavailable`, `account`, `db` or `threw`. Null: the queue
      had nothing more ready. */
  stopped: string | null;
};

type Counts = Partial<Record<HookObjectName, { new: number; changed: number; error?: string }>>;

type Ctx = {
  orgId: string;
  deadline: number;
  end: number;
  wait: boolean;
  clock: () => number;
  sleep: (ms: number) => Promise<void>;
  out: Sm8DrainResult;
  counts: Counts;
  wroteNotes: boolean;
  /** When the last read started: the next waits HOOK_READ_GAP_MS. */
  lastReadAt: number | null;
  /** The flight's end, as this drain last wrote it. */
  flightUntil: string;
};

/** Drain this workspace's queue: read each ready record once, paced, under
    the lease, and write it into the mirror. `deadline`: the caller's
    function's end (functionDeadline). `maxMs`: the drain's own budget.
    `wait`: sleep (at most QUIET_MS) for rows that aren't quiet yet — the
    route's drain, never a backstop's. Never throws. */
export async function drainSm8Hooks(
  orgId: string,
  opts: { deadline: number; maxMs: number; wait: boolean; clock?: () => number; sleep?: (ms: number) => Promise<void> }
): Promise<Sm8DrainResult> {
  const out: Sm8DrainResult = { ran: false, read: 0, written: 0, handed: 0, dropped: 0, stopped: null };
  if (sm8WebhooksState() !== "on") {
    out.stopped = "off";
    return out;
  }
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const ctx: Ctx = {
    orgId,
    deadline: opts.deadline,
    end: Math.min(opts.deadline, started + opts.maxMs),
    wait: opts.wait,
    clock,
    sleep: opts.sleep ?? realSleep,
    out,
    counts: {},
    wroteNotes: false,
    lastReadAt: null,
    flightUntil: "",
  };
  try {
    for (let pass = 0; ; pass++) {
      const flight = await claimFlight(ctx);
      if (flight === "error") {
        out.stopped = "db";
        break;
      }
      if (flight === null) {
        if (pass === 0) out.stopped = "flying";
        break;
      }
      out.ran = true;
      let stop: string | null = "threw";
      try {
        stop = await underFlight(ctx, flight, pass === 0 && ctx.wait);
      } finally {
        await releaseFlight(ctx);
      }
      if (stop !== null) {
        out.stopped = stop;
        break;
      }
      /* RELEASE, THEN LOOK AGAIN: a row queued as the flight ended found it
         held, and left; this look is what reads it */
      if (!fitsLease(clock(), READ_NEED_MS, ctx.end)) break;
      const again = await readQueue(orgId);
      if (again === null || planDrainRound(again, clock()).read.length === 0) break;
    }
    if (ctx.wroteNotes) {
      /* a note may ask somebody something: the asks it brings in are made
         tasks now, in what is left, rather than on the next sync */
      const budgetMs = Math.min(NOTES_SETTLE_MS, ctx.end - clock());
      if (budgetMs > 0) await settleMentionAsks(orgId, { budgetMs });
    }
  } catch (err) {
    console.error(`[sm8] live updates for org ${orgId}: the drain threw: ${err instanceof Error ? err.message : String(err)}`);
    out.stopped = "threw";
  }
  return out;
}

/* ── the single flight ── */

type Flight = { account: string | null; syncWantedAt: string | null };

async function claimFlight(ctx: Ctx): Promise<Flight | null | "error"> {
  const now = ctx.clock();
  const until = iso(now + DRAIN_FLIGHT_MS);
  const { data, error } = await supabaseAdmin
    .from(WEBHOOKS)
    .update({ draining_until: until })
    .eq("org_id", ctx.orgId)
    .or(`draining_until.is.null,draining_until.lt.${iso(now)}`)
    .select("account_uuid, sync_wanted_at");
  if (error) {
    console.error(`[sm8] live updates for org ${ctx.orgId}: couldn't claim the drain: ${error.message}`);
    return "error";
  }
  const row = ((data ?? []) as { account_uuid: string | null; sync_wanted_at: string | null }[])[0];
  if (!row) return null;
  ctx.flightUntil = until;
  return { account: row.account_uuid ?? null, syncWantedAt: row.sync_wanted_at ?? null };
}

/** Keep the flight while there is less than half of it left. False: it
    isn't this drain's any more. */
async function holdFlight(ctx: Ctx): Promise<boolean> {
  const now = ctx.clock();
  if ((msOf(ctx.flightUntil) ?? 0) - now >= DRAIN_FLIGHT_MS / 2) return true;
  const until = iso(now + DRAIN_FLIGHT_MS);
  const { data, error } = await supabaseAdmin
    .from(WEBHOOKS)
    .update({ draining_until: until })
    .eq("org_id", ctx.orgId)
    .eq("draining_until", ctx.flightUntil)
    .select("org_id");
  if (error || (data ?? []).length === 0) return false;
  ctx.flightUntil = until;
  return true;
}

/** The counters, then the flight given back — only while it is still the
    one this drain wrote — with when the drain last ran. */
async function releaseFlight(ctx: Ctx): Promise<void> {
  try {
    await flushCounts(ctx);
    await supabaseAdmin
      .from(WEBHOOKS)
      .update({ draining_until: null, last_drain_at: iso(ctx.clock()) })
      .eq("org_id", ctx.orgId)
      .eq("draining_until", ctx.flightUntil);
  } catch (err) {
    console.error(`[sm8] live updates for org ${ctx.orgId}: couldn't give the drain back: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** New against changed records, per object (U4: whether a creation pings
    shows here), and a read refused, into sm8_webhooks.objects — read again
    just before writing, so the reconcile's findings are kept. */
async function flushCounts(ctx: Ctx): Promise<void> {
  const objects = Object.keys(ctx.counts) as HookObjectName[];
  if (objects.length === 0) return;
  const { data, error } = await supabaseAdmin.from(WEBHOOKS).select("objects").eq("org_id", ctx.orgId).maybeSingle();
  if (error) return;
  const stored = readHookObjects((data as { objects?: unknown } | null)?.objects);
  for (const o of objects) {
    const c = ctx.counts[o]!;
    stored[o] = {
      ...stored[o],
      new: (stored[o]?.new ?? 0) + c.new,
      changed: (stored[o]?.changed ?? 0) + c.changed,
      ...(c.error ? { error: c.error } : {}),
    };
  }
  const saved = await supabaseAdmin.from(WEBHOOKS).update({ objects: stored }).eq("org_id", ctx.orgId);
  if (!saved.error) ctx.counts = {};
}

/* ── the queue ── */

async function readQueue(orgId: string): Promise<QueueRow[] | null> {
  const { data, error } = await supabaseAdmin
    .from(PINGS)
    .select("object, uuid, pings, attempts, first_seen_at, last_seen_at")
    .eq("org_id", orgId)
    .is("handed_at", null)
    .order("first_seen_at", { ascending: true })
    .limit(QUEUE_READ_MAX);
  if (error) {
    console.error(`[sm8] live updates for org ${orgId}: couldn't read the queue: ${error.message}`);
    return null;
  }
  return ((data ?? []) as QueueRow[]).filter((r) => isHookObject(r.object));
}

/** Handed rows a completed walk of their object has passed since. Only
    when the queue asked for a sync (sync_wanted_at), so a quiet workspace
    pays nothing; the ask is cleared once no handed row is left. */
async function tidyHanded(ctx: Ctx, askedAt: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("sm8_sync_state")
    .select("object, last_synced_at")
    .eq("org_id", ctx.orgId)
    .in("object", [...HOOK_OBJECT_NAMES]);
  if (error) return;
  const walked = ((data ?? []) as { object: string; last_synced_at: string | null }[])
    .filter((r) => isHookObject(r.object) && msOf(r.last_synced_at) !== null)
    .map((r) => `and(object.eq.${r.object},handed_at.lt.${iso(msOf(r.last_synced_at)!)})`);
  if (walked.length > 0) {
    const gone = await supabaseAdmin.from(PINGS).delete().eq("org_id", ctx.orgId).or(walked.join(",")).select("uuid");
    if (gone.error) return;
  }
  const left = await supabaseAdmin.from(PINGS).select("uuid").eq("org_id", ctx.orgId).not("handed_at", "is", null).limit(1);
  if (left.error || (left.data ?? []).length > 0) return;
  await supabaseAdmin.from(WEBHOOKS).update({ sync_wanted_at: null }).eq("org_id", ctx.orgId).eq("sync_wanted_at", askedAt);
}

/** Every waiting row of `object` handed to the next ordinary sync, and the
    sync asked for. NO SYNC IS RUN HERE: pings never start one. */
async function handOver(ctx: Ctx, object: HookObjectName): Promise<boolean> {
  const at = iso(ctx.clock());
  const { data, error } = await supabaseAdmin
    .from(PINGS)
    .update({ handed_at: at })
    .eq("org_id", ctx.orgId)
    .eq("object", object)
    .is("handed_at", null)
    .select("uuid");
  if (error) return false;
  ctx.out.handed += (data ?? []).length;
  await supabaseAdmin.from(WEBHOOKS).update({ sync_wanted_at: at }).eq("org_id", ctx.orgId);
  return true;
}

/** Deleted only while nobody has pinged it since it was read: a ping
    during the read keeps the row, and the record is read again. */
async function doneWith(ctx: Ctx, row: QueueRow): Promise<void> {
  await supabaseAdmin
    .from(PINGS)
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("object", row.object)
    .eq("uuid", row.uuid)
    .eq("pings", row.pings);
}

/* ── the account ── */

/** Whether the connection still holds `account` and is connected: asked
    just before every write. A read that fails is a stop, not a guess. */
async function stillHolds(orgId: string, account: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("integration_connections")
    .select("tenant_id, status")
    .eq("org_id", orgId)
    .eq("provider", "servicem8")
    .maybeSingle();
  if (error) return false;
  const row = data as { tenant_id: string | null; status: string | null } | null;
  return !!row && row.status === "connected" && row.tenant_id === account;
}

/** The account the queue's pings were for isn't the connection's any more,
    for good (another account, or no working connection): its rows are
    dropped once a day old. Nothing is read or written for them. */
async function dropMismatched(ctx: Ctx): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from(PINGS)
    .delete()
    .eq("org_id", ctx.orgId)
    .lt("first_seen_at", iso(ctx.clock() - MISMATCH_DROP_MS))
    .select("uuid");
  if (!error) ctx.out.dropped += (data ?? []).length;
}

/* ── under the flight ── */

type Read = Sm8Page | "spent" | "uncounted";

async function underFlight(ctx: Ctx, flight: Flight, mayWait: boolean): Promise<string | null> {
  const { orgId, clock } = ctx;
  if (flight.syncWantedAt !== null) await tidyHanded(ctx, flight.syncWantedAt);

  let lease: Sm8Lease | null = null;
  let access: Sm8Access | null = null;
  let account: string | null = null;
  let slept = 0;
  try {
    while (true) {
      const rows = await readQueue(orgId);
      if (rows === null) return "db";
      const plan = planDrainRound(rows, clock());

      if (plan.read.length === 0 && plan.handOver.length === 0) {
        /* the route's drain waits a moment for its own rows to go quiet */
        const next = mayWait ? nextReadyAt(rows, clock()) : null;
        if (next === null) return null;
        const nap = Math.max(0, Math.min(next - clock(), QUIET_MS - slept));
        if (nap <= 0 || !fitsLease(clock() + nap, READ_NEED_MS, ctx.end)) return null;
        await ctx.sleep(nap);
        slept += nap;
        if (!(await holdFlight(ctx))) return "flying";
        continue;
      }

      for (const object of plan.handOver) {
        if (!(await handOver(ctx, object))) return "db";
      }
      if (plan.read.length === 0) continue;

      /* WHICH ACCOUNT, then the lease, then the mirror's own account under
         it (a change of account clears the mirror under the lease) */
      if (lease === null) {
        const got = await sm8AccessResult(orgId, clock());
        if (!got.ok) {
          if (got.reason === "unreachable") return "unavailable";
          await dropMismatched(ctx);
          return "account";
        }
        access = got.access;
        account = got.access.tenantId;
        if (account === null) return "account";
        if (flight.account !== account) {
          await dropMismatched(ctx);
          return "account";
        }

        if (!fitsLease(clock(), HOOK_LEASE_MS, ctx.deadline)) return "budget";
        const claimed = await claimSm8Lease(orgId, "hook", clock(), {}, HOOK_LEASE_MS);
        if (!claimed.ok) return claimed.why === "busy" ? "busy" : "db";
        lease = claimed.lease;
        /* a lease held the old way, without a token, is never shared */
        if (lease.token === null) return "lease";

        const accounts = await readSm8Accounts(orgId);
        if (!accounts.ok) return "db";
        if (accounts.connected?.tenantId !== account || accounts.mirrored?.uuid !== account) return "account";
      }

      const skip = new Set<HookObjectName>();
      for (const row of plan.read) {
        if (skip.has(row.object)) continue;
        const stop = await readOne(ctx, row, {
          lease: () => lease!,
          setLease: (l) => {
            lease = l;
          },
          access: () => access!,
          setAccess: (a) => {
            access = a;
          },
          account: account!,
          skip,
        });
        if (stop !== null) return stop;
      }
    }
  } finally {
    if (lease !== null) await releaseSm8Lease(lease);
  }
}

type Held = {
  lease: () => Sm8Lease;
  setLease: (l: Sm8Lease) => void;
  access: () => Sm8Access;
  setAccess: (a: Sm8Access) => void;
  account: string;
  skip: Set<HookObjectName>;
};

/** Wait out the gap since the last read started. */
async function pace(ctx: Ctx): Promise<void> {
  if (ctx.lastReadAt === null) return;
  const wait = ctx.lastReadAt + HOOK_READ_GAP_MS - ctx.clock();
  if (wait > 0) await ctx.sleep(wait);
}

/** One record: read, and act on what came back. Null to go on. */
async function readOne(ctx: Ctx, row: QueueRow, held: Held): Promise<string | null> {
  const { orgId, clock } = ctx;
  const spec = hookSpecOf(row.object);
  if (!UUID_RE.test(row.uuid)) {
    await doneWith(ctx, row);
    return null;
  }

  await pace(ctx);

  /* a sync asked: stand aside, within this one read */
  const run = await supabaseAdmin.from("sm8_sync_runs").select("wanted_at, lease_token").eq("org_id", orgId).maybeSingle();
  if (run.error) return "db";
  const runRow = run.data as { wanted_at: string | null; lease_token: string | null } | null;
  if (!runRow || runRow.lease_token !== held.lease().token) return "lease";
  if (syncWants(runRow.wanted_at, clock())) return "wanted";

  /* the lease must outlast the read, and the read the drain */
  const step = drainReadStep({ now: clock(), leaseUntil: Date.parse(held.lease().until), deadline: ctx.deadline, end: ctx.end });
  if (step === "stop") return "budget";
  if (step === "extend") {
    const ext = await extendSm8Lease(held.lease(), clock(), HOOK_LEASE_MS);
    if (!ext.ok) return "lease";
    held.setLease(ext.lease);
  }
  if (!(await holdFlight(ctx))) return "flying";

  /* COUNTED BEFORE IT IS MADE, each request — a renewal's second one too */
  const call = async (a: Sm8Access): Promise<Read> => {
    await pace(ctx);
    const took = await supabaseAdmin.rpc("sm8_take_hook_call", { p_org: orgId, p_budget: HOOK_DAILY_BUDGET });
    if (took.error) return "uncounted";
    if (took.data !== true) return "spent";
    ctx.lastReadAt = clock();
    ctx.out.read += 1;
    return fetchSm8Page(sm8CallOf(a, "hook"), spec.endpoint, {
      cursor: "-1",
      filter: `uuid eq '${row.uuid}'`,
      timeoutMs: HOOK_READ_TIMEOUT_MS,
    });
  };
  const got = await withSm8Renewal(
    orgId,
    held.access(),
    call,
    (r) => typeof r === "object" && !r.ok && r.failure === "unauthorized",
    {
      /* a second request only while it too fits, the gap included */
      retry: () =>
        fitsLease(clock() + HOOK_READ_GAP_MS, READ_NEED_MS, Math.min(ctx.end, ctx.deadline, Date.parse(held.lease().until))),
    }
  );
  held.setAccess(got.access);
  if (got.verdict === "dead" || got.verdict === "gone") return "grant";
  if (got.verdict === "unreachable") return "unavailable";
  if (got.verdict === "late") return "budget";
  const page = got.result;
  if (page === "spent") return "day";
  if (page === "uncounted") return "db";

  if (!page.ok) {
    switch (page.failure) {
      case "forbidden": {
        /* this object can't be read under the grant: its waiting rows go,
           and the reconcile's record of it says why */
        await supabaseAdmin.from(PINGS).delete().eq("org_id", orgId).eq("object", row.object).is("handed_at", null);
        const c = (ctx.counts[row.object] ??= { new: 0, changed: 0 });
        c.error = `ServiceM8 refused reading ${spec.label}: reconnect ServiceM8 to grant ${spec.scope}.`;
        held.skip.add(row.object);
        return null;
      }
      case "unavailable": {
        const attempts = row.attempts + 1;
        const q = supabaseAdmin.from(PINGS);
        if (attempts >= HOOK_MAX_ATTEMPTS) {
          await q.delete().eq("org_id", orgId).eq("object", row.object).eq("uuid", row.uuid);
        } else {
          await q.update({ attempts }).eq("org_id", orgId).eq("object", row.object).eq("uuid", row.uuid);
        }
        return "unavailable";
      }
      case "throttled":
      case "rate_limited":
        return "throttled";
      case "payment_required":
        return "billing";
      default:
        return "grant";
    }
  }

  /* ONLY the row whose uuid is the one asked for */
  const raw = page.rows.find((r) => typeof r.uuid === "string" && r.uuid.toLowerCase() === row.uuid);
  const shaped = raw ? spec.shape(raw) : null;
  if (!shaped) {
    await doneWith(ctx, row);
    return null;
  }

  /* the connection still holds the account, just before the write */
  if (!(await stillHolds(orgId, held.account))) return "account";

  const had = await supabaseAdmin
    .from(spec.table)
    .select("uuid")
    .eq("org_id", orgId)
    .eq("uuid", shaped.uuid as string)
    .maybeSingle();
  if (had.error) return "db";
  const { error } = await supabaseAdmin
    .from(spec.table)
    .upsert({ ...shaped, org_id: orgId, synced_at: iso(clock()) }, { onConflict: "org_id,uuid" });
  if (error) {
    console.error(`[sm8] live updates for org ${orgId}: couldn't store a ${row.object} record: ${error.message}`);
    return "db";
  }
  ctx.out.written += 1;
  const c = (ctx.counts[row.object] ??= { new: 0, changed: 0 });
  if (had.data) c.changed += 1;
  else c.new += 1;
  if (row.object === "job_notes") ctx.wroteNotes = true;
  await doneWith(ctx, row);
  return null;
}
