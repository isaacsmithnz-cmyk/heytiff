/**
 * @jest-environment node
 */

/* The drain (two-way phase 4, PR D).

   The real door (sm8-http), the real reader (sm8-read) and the real
   renewal (sm8-renew) run against a fake ServiceM8 that answers a record
   read by `$filter=uuid eq '…'`, and a fake database holding the queue,
   sm8_webhooks, the sync lease's row and the mirror. The lease helpers are
   a small fake of sm8-sync's (tested for real in sm8-lease.test), keyed on
   the same token and end. Time is a hand-cranked clock: a read, a sleep and
   a renewal each move it. Every id is made up. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const events: string[] = [];
let throwOn: string | null = null;
let clock = 0;
const iso = (ms: number) => new Date(ms).toISOString();

function cmp(x: unknown, v: unknown): number {
  const a = typeof x === "string" ? Date.parse(x) : NaN;
  const b = typeof v === "string" ? Date.parse(v) : NaN;
  if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
  return String(x) < String(v) ? -1 : String(x) > String(v) ? 1 : 0;
}

type Filter = (row: Row) => boolean;

function one(col: string, op: string, v: unknown): Filter {
  return (row) => {
    const x = row[col];
    if (op === "eq") return x === v;
    if (op === "is") return v === null ? x === null || x === undefined : x === v;
    if (op === "not.is") return v === null ? x !== null && x !== undefined : x !== v;
    if (op === "in") return (v as unknown[]).includes(x);
    if (x === null || x === undefined) return false;
    if (op === "lt") return cmp(x, v) < 0;
    return false;
  };
}

/** PostgREST's or(): `a.is.null,a.lt.X` and `and(a.eq.X,b.lt.Y),…`. */
function orOf(expr: string): Filter {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const term = (t: string): Filter => {
    if (t.startsWith("and(")) {
      const inner = t.slice(4, -1);
      const fs = inner.split(",").map(term);
      return (row) => fs.every((f) => f(row));
    }
    const [col, op, ...rest] = t.split(".");
    const val = rest.join(".");
    return one(col, op, val === "null" ? null : val);
  };
  const fs = parts.map(term);
  return (row) => fs.some((f) => f(row));
}

class Query {
  private op: "select" | "update" | "upsert" | "delete" = "select";
  private patch: Row = {};
  private filters: Filter[] = [];
  private single = false;
  private limitTo: number | null = null;
  private orderBy: string | null = null;
  constructor(private table: string) {}
  select() {
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push(one(c, "eq", v));
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push(one(c, "is", v));
    return this;
  }
  not(c: string, op: string, v: unknown) {
    this.filters.push(one(c, `not.${op}`, v));
    return this;
  }
  in(c: string, v: unknown[]) {
    this.filters.push(one(c, "in", v));
    return this;
  }
  lt(c: string, v: unknown) {
    this.filters.push(one(c, "lt", v));
    return this;
  }
  or(expr: string) {
    this.filters.push(orOf(expr));
    return this;
  }
  order(c: string) {
    this.orderBy = c;
    return this;
  }
  limit(n: number) {
    this.limitTo = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.patch = p;
    return this;
  }
  upsert(p: Row) {
    this.op = "upsert";
    this.patch = p;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  then<T>(res: (v: { data: unknown; error: { message: string } | null }) => T, rej?: (e: unknown) => T) {
    return Promise.resolve()
      .then(() => this.run())
      .then(res, rej);
  }
  private run(): { data: unknown; error: { message: string } | null } {
    if (throwOn === `${this.op}:${this.table}`) throw new Error(`${this.table} down`);
    if (errorOn !== null && `${this.op}:${this.table}:${Object.keys(this.patch).sort().join(",")}` === errorOn) {
      return { data: null, error: { message: `${this.table} refused` } };
    }
    if (this.op === "select") onSelect(this.table);
    const rows = (db[this.table] ??= []);
    const hit = () => rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op !== "select") events.push(`db:${this.op}:${this.table}`);
    if (this.op === "select") {
      let out = hit().map((r) => ({ ...r }));
      if (this.orderBy) out.sort((a, b) => cmp(a[this.orderBy!], b[this.orderBy!]));
      if (this.limitTo !== null) out = out.slice(0, this.limitTo);
      return { data: this.single ? (out[0] ?? null) : out, error: null };
    }
    if (this.op === "update") {
      const h = hit();
      for (const r of h) Object.assign(r, this.patch);
      onUpdate(this.table, this.patch);
      return { data: h.map((r) => ({ ...r })), error: null };
    }
    if (this.op === "upsert") {
      const found = rows.find((r) => r.org_id === this.patch.org_id && r.uuid === this.patch.uuid);
      if (found) Object.assign(found, this.patch);
      else rows.push({ ...this.patch });
      return { data: null, error: null };
    }
    const gone = hit();
    db[this.table] = rows.filter((r) => !gone.includes(r));
    return { data: gone, error: null };
  }
}

/** Something that happens as an update lands (a ping during a release). */
let onUpdate: (table: string, patch: Row) => void = () => {};
/** Something that happens as a table is read. */
let onSelect: (table: string) => void = () => {};
/** A write the database refuses, as `op:table:the patch's keys`. */
let errorOn: string | null = null;
let hookBudget = 3_000;

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => new Query(table),
    rpc: async (name: string, args: { p_org: string; p_budget: number }) => {
      events.push(`rpc:${name}`);
      const w = (db.sm8_webhooks ?? []).find((r) => r.org_id === args.p_org);
      if (!w) return { data: false, error: null };
      const used = (w.calls_today as number) ?? 0;
      if (used >= Math.min(args.p_budget, hookBudget)) return { data: false, error: null };
      w.calls_today = used + 1;
      return { data: true, error: null };
    },
  },
}));

/** The meter's answer to a turn: ok, or refused for the day. */
let meterRefuses = false;
jest.mock("../sm8-meter", () => ({
  ...jest.requireActual("../sm8-meter"),
  takeSm8Call: async () => (meterRefuses ? { ok: false, why: "day", waitMs: 60_000 } : { ok: true }),
  noteSm8Throttle: async () => {},
}));

/* ── the sync lease, as sm8-sync holds it: by token and end ── */

let tokens = 0;
const runSm8Sync = jest.fn();
const runSm8SyncWhenFree = jest.fn();
jest.mock("../sm8-sync", () => {
  const runRow = (org: string) => {
    const rows = (db.sm8_sync_runs ??= []);
    let r = rows.find((x) => x.org_id === org);
    if (!r) rows.push((r = { org_id: org, lease_until: null, lease_token: null, lease_by: null, wanted_at: null }));
    return r;
  };
  return {
    runSm8Sync: (...a: unknown[]) => runSm8Sync(...a),
    runSm8SyncWhenFree: (...a: unknown[]) => runSm8SyncWhenFree(...a),
    claimSm8Lease: async (org: string, by: string, now: number, _patch: unknown, ms: number) => {
      events.push(`lease:claim:${ms}`);
      const r = runRow(org);
      if (r.lease_until && Date.parse(r.lease_until as string) > now) return { ok: false, why: "busy" };
      const token = `tok-${++tokens}`;
      Object.assign(r, { lease_until: iso(now + ms), lease_token: token, lease_by: by });
      return { ok: true, lease: { orgId: org, until: r.lease_until, token, by }, calls_today: 0, calls_day: null };
    },
    extendSm8Lease: async (lease: { orgId: string; until: string; token: string }, now: number, ms: number) => {
      events.push(`lease:extend:${ms}`);
      const r = runRow(lease.orgId);
      if (r.lease_token !== lease.token || r.lease_until !== lease.until) return { ok: false, why: "lost" };
      r.lease_until = iso(now + ms);
      return { ok: true, lease: { ...lease, until: r.lease_until } };
    },
    releaseSm8Lease: async (lease: { orgId: string; until: string; token: string }) => {
      events.push("lease:release");
      const r = runRow(lease.orgId);
      if (r.lease_token === lease.token && r.lease_until === lease.until) r.lease_until = null;
    },
  };
});

const ACCOUNT = "acct-5b0e";
const ACCESS = { accessToken: "tok-a", tenantId: ACCOUNT, grant: "g-1", meter: ACCOUNT };
let accessResult: unknown = { ok: true, access: ACCESS };
let accounts: unknown = { ok: true, connected: { tenantId: ACCOUNT, tenantName: "Acme" }, mirrored: { uuid: ACCOUNT, name: "Acme" } };
const renewSm8Access = jest.fn(async () => ({ ok: true, access: { ...ACCESS, accessToken: "tok-b" } }));
const markSm8NeedsReauth = jest.fn(async () => true);
jest.mock("../sm8-store", () => ({
  sm8AccessResult: async () => accessResult,
  readSm8Accounts: async () => accounts,
  renewSm8Access: (...a: unknown[]) => renewSm8Access(...(a as [])),
  markSm8NeedsReauth: (...a: unknown[]) => markSm8NeedsReauth(...(a as [])),
}));
jest.mock("../sm8", () => ({ fetchSm8Vendor: jest.fn(), sm8Config: () => null }));

const settleMentionAsks = jest.fn(async (_org: string, _o: { budgetMs: number }) => ({ reads: 0, tasks: 0 }));
jest.mock("@/lib/dashboard/mention-settle", () => ({
  settleMentionAsks: (...a: unknown[]) => settleMentionAsks(...(a as [string, { budgetMs: number }])),
}));

import {
  drainReadStep,
  drainSm8Hooks,
  isReady,
  nextReadyAt,
  planDrainRound,
  syncWants,
  type QueueRow,
} from "../sm8-hook-drain";
import { HOOK_LEASE_MS, READ_NEED_MS } from "../sm8-hook-plan";

/* ── the fake ServiceM8 ── */

const requests: { method: string; path: string; filter: string | null; at: number; token: string }[] = [];
/** How long each read takes, in turn (then 0). */
let readTakes: number[] = [];
/** What ServiceM8 answers for a read, by endpoint and uuid. */
let serve: (endpoint: string, uuid: string, token: string) => Response = (endpoint, uuid) =>
  new Response(JSON.stringify([record(endpoint, uuid)]), { status: 200 });
/** Something that happens while a read is out (a ping, a reconnect). */
let during: (uuid: string) => void = () => {};

function record(endpoint: string, uuid: string): Row {
  const base = { uuid, edit_date: "2026-09-28 10:00:00", active: 1 };
  if (endpoint === "note.json") return { ...base, related_object: "job", related_object_uuid: "0b6f1c3e-1d4e-4a8b-9c1d-2e3f4a5b6c7d", note: "W2" };
  return { ...base, generated_job_id: "288", job_description: "W3" };
}

const fakeFetch = jest.fn(async (url: string, init: RequestInit) => {
  const u = new URL(url);
  const filter = u.searchParams.get("$filter");
  const token = String((init.headers as Record<string, string>)?.Authorization ?? (init.headers as Record<string, string>)?.authorization ?? "");
  requests.push({ method: init.method ?? "GET", path: u.pathname, filter, at: clock, token });
  events.push(`fetch:${u.pathname}`);
  clock += readTakes.shift() ?? 0;
  const uuid = /uuid eq '([^']+)'/.exec(filter ?? "")?.[1] ?? "";
  during(uuid);
  return serve(u.pathname.split("/").pop()!, uuid, token);
});

/* ── helpers ── */

const ORG = "org-2c7a";
const U = (n: number) => `${n.toString(16).padStart(8, "0")}-1a2b-4c3d-8e4f-5a6b7c8d9e0f`;
const T0 = Date.parse("2026-09-28T10:00:00Z");

function queue(object: string, uuid: string, ageMs = 30_000, extra: Row = {}): Row {
  return {
    org_id: ORG,
    object,
    uuid,
    first_seen_at: iso(clock - ageMs),
    last_seen_at: iso(clock - ageMs),
    pings: 1,
    attempts: 0,
    handed_at: null,
    ...extra,
  };
}

const deadline = () => clock + 280_000;
const drain = (o: Partial<Parameters<typeof drainSm8Hooks>[1]> = {}) =>
  drainSm8Hooks(ORG, {
    deadline: deadline(),
    maxMs: 120_000,
    wait: false,
    clock: () => clock,
    sleep: async (ms) => {
      events.push(`sleep:${ms}`);
      clock += ms;
    },
    ...o,
  });

const env = { ...process.env };
const realFetch = global.fetch;
beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  events.length = 0;
  requests.length = 0;
  throwOn = null;
  clock = T0;
  tokens = 0;
  readTakes = [];
  hookBudget = 3_000;
  onUpdate = () => {};
  onSelect = () => {};
  errorOn = null;
  meterRefuses = false;
  during = () => {};
  serve = (endpoint, uuid) => new Response(JSON.stringify([record(endpoint, uuid)]), { status: 200 });
  accessResult = { ok: true, access: ACCESS };
  accounts = { ok: true, connected: { tenantId: ACCOUNT, tenantName: "Acme" }, mirrored: { uuid: ACCOUNT, name: "Acme" } };
  runSm8Sync.mockClear();
  runSm8SyncWhenFree.mockClear();
  renewSm8Access.mockClear();
  markSm8NeedsReauth.mockClear();
  settleMentionAsks.mockClear();
  fakeFetch.mockClear();
  global.fetch = fakeFetch as unknown as typeof fetch;
  process.env.VERCEL_ENV = "production";
  process.env.SM8_WEBHOOKS = "1";
  db.sm8_webhooks = [{ org_id: ORG, account_uuid: ACCOUNT, objects: {}, draining_until: null, sync_wanted_at: null, calls_today: 0 }];
  db.integration_connections = [{ org_id: ORG, provider: "servicem8", tenant_id: ACCOUNT, status: "connected" }];
  db.sm8_sync_runs = [{ org_id: ORG, lease_until: null, lease_token: null, lease_by: null, wanted_at: null }];
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...env };
  jest.restoreAllMocks();
});
afterAll(() => {
  global.fetch = realFetch;
});

const pings = () => db.sm8_webhook_pings ?? [];
const run = () => db.sm8_sync_runs[0];
const hooks = () => db.sm8_webhooks[0];

/* ── the pure rules ── */

describe("the rules", () => {
  const row = (first: number, last: number): QueueRow => ({
    object: "jobs",
    uuid: U(1),
    pings: 1,
    attempts: 0,
    first_seen_at: iso(first),
    last_seen_at: iso(last),
  });

  it("a record is ready 8 s after its last ping, or a minute after its first, whichever is first", () => {
    expect(isReady(row(T0, T0), T0 + 7_999)).toBe(false);
    expect(isReady(row(T0, T0), T0 + 8_000)).toBe(true);
    // still pinging every few seconds: read once it has waited a minute
    expect(isReady(row(T0, T0 + 55_000), T0 + 59_999)).toBe(false);
    expect(isReady(row(T0, T0 + 55_000), T0 + 60_000)).toBe(true);
    expect(nextReadyAt([row(T0, T0 + 55_000)], T0 + 56_000)).toBe(T0 + 60_000);
    expect(nextReadyAt([row(T0, T0)], T0 + 8_000)).toBeNull();
  });

  it("more than 60 ready for one object are handed over; the rest read 40 a round, oldest first", () => {
    const many = Array.from({ length: 61 }, (_, i) => ({ ...row(T0 - 60_000 + i, T0 - 60_000 + i), uuid: U(i) }));
    const few = Array.from({ length: 50 }, (_, i) => ({
      ...row(T0 - 30_000 - i, T0 - 30_000 - i),
      object: "job_notes" as const,
      uuid: U(100 + i),
    }));
    const plan = planDrainRound([...many, ...few], T0);
    expect(plan.handOver).toEqual(["jobs"]);
    expect(plan.read).toHaveLength(40);
    expect(plan.read.every((r) => r.object === "job_notes")).toBe(true);
    expect(plan.read[0].uuid).toBe(U(149));
    // exactly 60 is still read, one at a time
    expect(planDrainRound(many.slice(0, 60), T0).handOver).toEqual([]);
  });

  it("a read goes only while 15 s are left on the lease; short of that it extends, while a whole lease fits the function", () => {
    const deadlineAt = T0 + 280_000;
    const end = T0 + 120_000;
    expect(READ_NEED_MS).toBe(15_000);
    expect(drainReadStep({ now: T0, leaseUntil: T0 + 15_000, deadline: deadlineAt, end })).toBe("go");
    expect(drainReadStep({ now: T0, leaseUntil: T0 + 14_999, deadline: deadlineAt, end })).toBe("extend");
    expect(drainReadStep({ now: T0, leaseUntil: T0 + 14_999, deadline: T0 + HOOK_LEASE_MS - 1, end })).toBe("stop");
    // the drain's own budget, or the function's, whichever is first
    expect(drainReadStep({ now: end - 14_999, leaseUntil: end + 60_000, deadline: deadlineAt, end })).toBe("stop");
    expect(drainReadStep({ now: T0, leaseUntil: T0 + 45_000, deadline: T0 + 14_999, end })).toBe("stop");
  });

  it("a sync's ask is fresh for a minute", () => {
    expect(syncWants(null, T0)).toBe(false);
    expect(syncWants(iso(T0 - 59_999), T0)).toBe(true);
    expect(syncWants(iso(T0 - 60_000), T0)).toBe(false);
    expect(syncWants(iso(T0 + 5_000), T0)).toBe(true);
  });
});

/* ── the drain ── */

describe("drainSm8Hooks", () => {
  it("reads each ready record once, writes it through the sync's shape, and empties the queue", async () => {
    db.sm8_webhook_pings = [queue("jobs", U(1)), queue("job_notes", U(2))];
    const out = await drain();
    expect(out).toMatchObject({ ran: true, read: 2, written: 2, stopped: null });
    expect(pings()).toEqual([]);
    expect(db.sm8_jobs).toEqual([
      expect.objectContaining({ org_id: ORG, uuid: U(1), job_description: "W3", synced_at: iso(T0) }),
    ]);
    expect(db.sm8_job_notes).toEqual([expect.objectContaining({ org_id: ORG, uuid: U(2) })]);
    expect(requests.map((r) => [r.path, r.filter])).toEqual([
      ["/api_1.0/job.json", `uuid eq '${U(1)}'`],
      ["/api_1.0/note.json", `uuid eq '${U(2)}'`],
    ]);
    // the lease given back by token, the flight given back, and when it ran
    expect(run().lease_until).toBeNull();
    expect(hooks().draining_until).toBeNull();
    expect(hooks().last_drain_at).toEqual(expect.any(String));
  });

  it("with the switch anything but on, reads and writes nothing", async () => {
    db.sm8_webhook_pings = [queue("jobs", U(1))];
    for (const [vercel, hook] of [["production", undefined], ["production", "gone"], ["preview", "1"]] as const) {
      process.env.VERCEL_ENV = vercel;
      if (hook === undefined) delete process.env.SM8_WEBHOOKS;
      else process.env.SM8_WEBHOOKS = hook;
      expect(await drain()).toMatchObject({ ran: false, stopped: "off" });
    }
    expect(events).toEqual([]);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  describe("the lease (M1)", () => {
    it("is taken only when 45 s of it end by the function's deadline", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1))];
      expect(await drain({ deadline: clock + HOOK_LEASE_MS - 1 })).toMatchObject({ read: 0, stopped: "budget" });
      expect(events.some((e) => e.startsWith("lease:claim"))).toBe(false);
      expect(await drain({ deadline: clock + HOOK_LEASE_MS })).toMatchObject({ read: 1, stopped: null });
      expect(events).toContain(`lease:claim:${HOOK_LEASE_MS}`);
    });

    it("is extended before a read with less than 15 s left", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1), 30_000), queue("jobs", U(2), 29_000)];
      readTakes = [31_000];
      const out = await drain();
      expect(out).toMatchObject({ read: 2, written: 2, stopped: null });
      expect(events.filter((e) => e.startsWith("lease:extend"))).toEqual([`lease:extend:${HOOK_LEASE_MS}`]);
    });

    it("and the drain stops when a whole new lease wouldn't fit the function", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1), 30_000), queue("jobs", U(2), 29_000)];
      readTakes = [31_000];
      const out = await drain({ deadline: clock + 75_000 });
      expect(out).toMatchObject({ read: 1, stopped: "budget" });
      expect(events.some((e) => e.startsWith("lease:extend"))).toBe(false);
      expect(pings().map((r) => r.uuid)).toEqual([U(2)]);
    });

    it("and when the extension finds the lease somebody else's", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1), 30_000), queue("jobs", U(2), 29_000)];
      readTakes = [31_000];
      during = () => {
        run().lease_until = iso(clock + 120_000);
        run().lease_token = "tok-sync";
      };
      const out = await drain();
      expect(out).toMatchObject({ read: 1, stopped: "lease" });
      // theirs, untouched by our release
      expect(run()).toMatchObject({ lease_token: "tok-sync", lease_until: expect.any(String) });
    });

    it("stands aside when a sync asked within the minute, and gives the lease back", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1))];
      run().wanted_at = iso(clock - 59_000);
      expect(await drain()).toMatchObject({ read: 0, stopped: "wanted" });
      expect(fakeFetch).not.toHaveBeenCalled();
      expect(run().lease_until).toBeNull();
      // an ask older than a minute is a sync that went away
      run().wanted_at = iso(clock - 61_000);
      expect(await drain()).toMatchObject({ read: 1, stopped: null });
    });

    it("stands aside within one read of a sync asking mid-drain", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1), 30_000), queue("jobs", U(2), 29_000), queue("jobs", U(3), 28_000)];
      during = (uuid) => {
        if (uuid === U(1)) run().wanted_at = iso(clock);
      };
      const out = await drain();
      expect(out).toMatchObject({ read: 1, written: 1, stopped: "wanted" });
      expect(run().lease_until).toBeNull();
      expect(pings().map((r) => r.uuid)).toEqual([U(2), U(3)]);
    });

    it("is given back by token even when a write throws", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1))];
      throwOn = "upsert:sm8_jobs";
      const out = await drain();
      expect(out).toMatchObject({ stopped: "threw" });
      expect(events).toContain("lease:release");
      expect(run().lease_until).toBeNull();
      expect(hooks().draining_until).toBeNull();
    });

    it("never starts a read that its own budget can't finish", async () => {
      db.sm8_webhook_pings = Array.from({ length: 30 }, (_, i) => queue("jobs", U(i), 30_000 - i));
      // the page-load backstop: 20 s, so at most 6 reads a second apart
      const out = await drain({ maxMs: 20_000 });
      expect(out.stopped).toBe("budget");
      expect(out.read).toBe(6);
      const last = requests[requests.length - 1].at;
      expect(last + READ_NEED_MS).toBeLessThanOrEqual(T0 + 20_000);
    });
  });

  it("paces its reads at one a second (S2)", async () => {
    db.sm8_webhook_pings = Array.from({ length: 4 }, (_, i) => queue("jobs", U(i), 30_000 - i));
    readTakes = [200, 1_500, 0, 0];
    await drain();
    const gaps = requests.slice(1).map((r, i) => r.at - requests[i].at);
    expect(gaps).toEqual([1_000, 1_500, 1_000]);
  });

  it("counts each call before it is made, and stops at the day's 3,000 (S10)", async () => {
    db.sm8_webhook_pings = [queue("jobs", U(1), 30_000), queue("jobs", U(2), 29_000)];
    hooks().calls_today = 2_999;
    const out = await drain();
    expect(out).toMatchObject({ read: 1, stopped: "day" });
    expect(hooks().calls_today).toBe(3_000);
    const firstFetch = events.indexOf("fetch:/api_1.0/job.json");
    expect(events.indexOf("rpc:sm8_take_hook_call")).toBeLessThan(firstFetch);
    expect(pings().map((r) => r.uuid)).toEqual([U(2)]);
  });

  it("a turn the meter refused reached nobody, and is given back to the day", async () => {
    db.sm8_webhook_pings = [queue("jobs", U(1), 30_000), queue("jobs", U(2), 29_000)];
    hooks().calls_today = 7;
    hooks().calls_day = iso(clock).slice(0, 10);
    meterRefuses = true;
    const out = await drain();
    expect(out).toMatchObject({ read: 0, stopped: "throttled" });
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(hooks().calls_today).toBe(7);
    expect(pings()).toHaveLength(2);
  });

  it("a renewal's second request is counted too", async () => {
    db.sm8_webhook_pings = [queue("jobs", U(1))];
    serve = (endpoint, uuid, token) =>
      token.includes("tok-a") ? new Response("no", { status: 401 }) : new Response(JSON.stringify([record(endpoint, uuid)]));
    const out = await drain();
    expect(out).toMatchObject({ read: 2, written: 1, stopped: null });
    expect(renewSm8Access).toHaveBeenCalledTimes(1);
    expect(hooks().calls_today).toBe(2);
  });

  describe("what it writes", () => {
    it("only the row whose uuid is the one asked for, in any case", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1), 30_000), queue("jobs", U(2), 29_000)];
      serve = (endpoint, uuid) =>
        new Response(
          JSON.stringify(uuid === U(1) ? [record(endpoint, U(9))] : [record(endpoint, U(9)), record(endpoint, uuid.toUpperCase())])
        );
      const out = await drain();
      expect(out).toMatchObject({ read: 2, written: 1 });
      expect((db.sm8_jobs ?? []).map((r) => r.uuid)).toEqual([U(2).toUpperCase()]);
      // the one ServiceM8 doesn't have: nothing written, and it leaves the queue
      expect(pings()).toEqual([]);
    });

    it("keeps a record pinged again during its read, to read it again", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1), 30_000)];
      let once = true;
      during = () => {
        if (!once) return;
        once = false;
        const r = pings()[0];
        r.pings = (r.pings as number) + 1;
        r.last_seen_at = iso(clock);
      };
      const out = await drain();
      expect(out).toMatchObject({ read: 1, written: 1 });
      expect(pings()).toEqual([expect.objectContaining({ uuid: U(1), pings: 2 })]);
    });

    it("counts records new to the mirror apart from those it had (U4)", async () => {
      db.sm8_jobs = [{ org_id: ORG, uuid: U(1), job_description: "old" }];
      hooks().objects = { jobs: { name: "job", active: true, new: 3, changed: 4 } };
      db.sm8_webhook_pings = [queue("jobs", U(1), 30_000), queue("jobs", U(2), 29_000), queue("job_notes", U(3), 28_000)];
      await drain();
      expect(hooks().objects).toEqual({
        jobs: { name: "job", active: true, new: 4, changed: 5 },
        job_notes: { new: 1, changed: 0 },
      });
    });

    it("writes nothing for an account that isn't the connection's, and drops its rows a day old", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1), 25 * 3_600_000), queue("jobs", U(2), 30_000)];
      accessResult = { ok: true, access: { ...ACCESS, tenantId: "acct-other" } };
      expect(await drain()).toMatchObject({ read: 0, dropped: 1, stopped: "account" });
      expect(pings().map((r) => r.uuid)).toEqual([U(2)]);
      // a connection that needs reconnecting: the same
      db.sm8_webhook_pings = [queue("jobs", U(1), 25 * 3_600_000), queue("jobs", U(2), 30_000)];
      accessResult = { ok: false, reason: "reauth" };
      expect(await drain()).toMatchObject({ read: 0, dropped: 1, stopped: "account" });
      // ServiceM8 unreachable is a wait: nothing dropped
      db.sm8_webhook_pings = [queue("jobs", U(1), 25 * 3_600_000)];
      accessResult = { ok: false, reason: "unreachable" };
      expect(await drain()).toMatchObject({ read: 0, dropped: 0, stopped: "unavailable" });
      expect(fakeFetch).not.toHaveBeenCalled();
    });

    it("writes nothing while the mirror holds another account's copy (a switch not yet synced)", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1), 25 * 3_600_000)];
      accounts = { ok: true, connected: { tenantId: ACCOUNT, tenantName: "Acme" }, mirrored: { uuid: "acct-old", name: "Old" } };
      expect(await drain()).toMatchObject({ read: 0, dropped: 0, stopped: "account" });
      expect(pings()).toHaveLength(1);
      expect(run().lease_until).toBeNull();
    });

    it("writes nothing when the connection moved to another account during the read", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1))];
      during = () => {
        db.integration_connections[0].tenant_id = "acct-other";
      };
      expect(await drain()).toMatchObject({ read: 1, written: 0, stopped: "account" });
      expect(db.sm8_jobs ?? []).toEqual([]);
      expect(pings()).toHaveLength(1);
    });
  });

  describe("what each answer does", () => {
    it("a 403 drops that object's waiting rows, says why, and the others go on", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1), 30_000), queue("jobs", U(2), 29_000), queue("job_notes", U(3), 28_000)];
      serve = (endpoint, uuid) =>
        endpoint === "job.json" ? new Response("scope", { status: 403 }) : new Response(JSON.stringify([record(endpoint, uuid)]));
      const out = await drain();
      expect(out).toMatchObject({ read: 2, written: 1, stopped: null });
      expect(pings()).toEqual([]);
      expect((hooks().objects as Record<string, { error?: string }>).jobs.error).toBe(
        "ServiceM8 refused reading Jobs: reconnect ServiceM8 to grant read_jobs."
      );
    });

    it.each([
      ["a 429", 429, "throttled"],
      ["a 402", 402, "billing"],
    ])("%s stops, and the rows wait", async (_name, status, stopped) => {
      db.sm8_webhook_pings = [queue("jobs", U(1), 30_000), queue("jobs", U(2), 29_000)];
      serve = () => new Response("no", { status });
      expect(await drain()).toMatchObject({ read: 1, stopped });
      expect(pings()).toHaveLength(2);
    });

    it("a 401 twice, a token apart, stops, and the rows wait", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1))];
      serve = () => new Response("no", { status: 401 });
      expect(await drain()).toMatchObject({ read: 2, stopped: "grant" });
      expect(markSm8NeedsReauth).toHaveBeenCalled();
      expect(pings()).toHaveLength(1);
    });

    it.each([400, 404, 410, 422])("a %i for one record drops that row, and the drain goes on", async (status) => {
      db.sm8_webhook_pings = [queue("jobs", U(1), 30_000), queue("jobs", U(2), 29_000)];
      serve = (endpoint, uuid) =>
        uuid === U(1) ? new Response("no", { status }) : new Response(JSON.stringify([record(endpoint, uuid)]));
      const out = await drain();
      expect(out).toMatchObject({ read: 2, written: 1, stopped: null });
      expect(pings()).toEqual([]);
    });

    it("a 408 is a timeout, not a refusal: an attempt, and a stop", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1), 30_000), queue("jobs", U(2), 29_000)];
      serve = () => new Response("slow", { status: 408 });
      expect(await drain()).toMatchObject({ read: 1, stopped: "unavailable" });
      expect(pings()).toEqual([expect.objectContaining({ uuid: U(1), attempts: 1 }), expect.objectContaining({ uuid: U(2) })]);
    });

    it("unavailable counts an attempt and stops; the fifth drops the row", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1))];
      serve = () => new Response("down", { status: 503 });
      expect(await drain()).toMatchObject({ read: 1, stopped: "unavailable" });
      expect(pings()).toEqual([expect.objectContaining({ attempts: 1 })]);
      pings()[0].attempts = 4;
      await drain();
      expect(pings()).toEqual([]);
    });
  });

  describe("a burst too big to read one at a time (M2)", () => {
    it("is handed to the next ordinary sync, and no sync is run", async () => {
      db.sm8_webhook_pings = [
        ...Array.from({ length: 61 }, (_, i) => queue("attachments", U(i), 30_000)),
        queue("jobs", U(500), 30_000),
      ];
      const out = await drain();
      expect(out).toMatchObject({ handed: 61, read: 1, written: 1 });
      expect(runSm8Sync).not.toHaveBeenCalled();
      expect(runSm8SyncWhenFree).not.toHaveBeenCalled();
      expect(requests.every((r) => r.path === "/api_1.0/job.json")).toBe(true);
      expect(hooks().sync_wanted_at).toBe(iso(T0));
      expect(pings().filter((r) => r.handed_at !== null)).toHaveLength(61);
    });

    it("its rows stay until a walk of the object completes after they were handed", async () => {
      const handedAt = iso(clock - 5 * 60_000);
      db.sm8_webhook_pings = [
        queue("attachments", U(1), 10 * 60_000, { handed_at: handedAt }),
        queue("jobs", U(2), 10 * 60_000, { handed_at: handedAt }),
      ];
      hooks().sync_wanted_at = handedAt;
      db.sm8_sync_state = [
        { org_id: ORG, object: "attachments", last_synced_at: iso(clock - 6 * 60_000) },
        { org_id: ORG, object: "jobs", last_synced_at: iso(clock - 60_000) },
      ];
      await drain();
      // the jobs walk finished after the hand-over; the attachments walk before it
      expect(pings().map((r) => r.uuid)).toEqual([U(1)]);
      expect(hooks().sync_wanted_at).toBe(handedAt);
      expect(fakeFetch).not.toHaveBeenCalled();
      // once that walk completes too, the last goes, and so does the ask
      db.sm8_sync_state[0].last_synced_at = iso(clock);
      await drain();
      expect(pings()).toEqual([]);
      expect(hooks().sync_wanted_at).toBeNull();
    });

    it("a handed row pinged again since is read on its own, never eaten by the walk it was handed to", async () => {
      const handedAt = iso(clock - 5 * 60_000);
      db.sm8_webhook_pings = [
        queue("jobs", U(1), 10 * 60_000, { handed_at: handedAt, last_seen_at: iso(clock - 30_000), pings: 2 }),
      ];
      hooks().sync_wanted_at = handedAt;
      // the walk finished after the hand-over, but before the second ping
      db.sm8_sync_state = [{ org_id: ORG, object: "jobs", last_synced_at: iso(clock - 60_000) }];
      const out = await drain();
      expect(out).toMatchObject({ read: 1, written: 1 });
      expect(requests.map((r) => r.filter)).toEqual([`uuid eq '${U(1)}'`]);
      expect(pings()).toEqual([]);
    });

    it("a ping that lands as the tidy runs keeps its row", async () => {
      const handedAt = iso(clock - 5 * 60_000);
      db.sm8_webhook_pings = [queue("jobs", U(1), 10 * 60_000, { handed_at: handedAt })];
      db.sm8_sync_state = [{ org_id: ORG, object: "jobs", last_synced_at: iso(clock - 60_000) }];
      onSelect = (table) => {
        if (table === "sm8_sync_state") pings()[0].last_seen_at = iso(clock - 1);
      };
      await drain();
      expect(pings()).toEqual([expect.objectContaining({ uuid: U(1), handed_at: handedAt })]);
      // the next flight puts it back in the queue, and reads it
      onSelect = () => {};
      clock += 60_000;
      expect(await drain()).toMatchObject({ read: 1, written: 1 });
      expect(pings()).toEqual([]);
    });

    it("handed rows are tidied even when the ask for a sync never landed", async () => {
      const handedAt = iso(clock - 5 * 60_000);
      db.sm8_webhook_pings = [queue("jobs", U(1), 10 * 60_000, { handed_at: handedAt })];
      hooks().sync_wanted_at = null;
      db.sm8_sync_state = [{ org_id: ORG, object: "jobs", last_synced_at: iso(clock - 60_000) }];
      await drain();
      expect(pings()).toEqual([]);
    });

    it("a hand-over whose ask the database refused stops, and its rows are still tidied later", async () => {
      db.sm8_webhook_pings = Array.from({ length: 61 }, (_, i) => queue("attachments", U(i), 30_000));
      errorOn = "update:sm8_webhooks:sync_wanted_at";
      const out = await drain();
      expect(out).toMatchObject({ handed: 61, read: 0, stopped: "db" });
      expect(runSm8Sync).not.toHaveBeenCalled();
      errorOn = null;
      db.sm8_sync_state = [{ org_id: ORG, object: "attachments", last_synced_at: iso(clock + 1_000) }];
      clock += 2_000;
      await drain();
      expect(pings()).toEqual([]);
    });
  });

  describe("the single flight (S1)", () => {
    it("a second invocation leaves at once", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1))];
      hooks().draining_until = iso(clock + 30_000);
      expect(await drain()).toMatchObject({ ran: false, stopped: "flying", read: 0 });
      expect(events.filter((e) => !e.startsWith("db:update:sm8_webhooks"))).toEqual([]);
      // a flight whose holder died is taken
      hooks().draining_until = iso(clock - 1);
      expect(await drain()).toMatchObject({ ran: true, read: 1 });
    });

    it("the holder gives it back, then looks again: a record queued at its last moment is read", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1))];
      let queued = false;
      onUpdate = (table, patch) => {
        if (table === "sm8_webhooks" && patch.draining_until === null && !queued) {
          queued = true;
          // arrived while the holder was finishing: its own invocation found the flight held
          db.sm8_webhook_pings.push(queue("jobs", U(2), 61_000));
        }
      };
      const out = await drain();
      expect(out).toMatchObject({ read: 2, written: 2, stopped: null });
      expect(pings()).toEqual([]);
    });
  });

  describe("quiet", () => {
    it("a backstop reads only rows already quiet, and rows waiting over a minute, and never sleeps (S3)", async () => {
      db.sm8_webhook_pings = [
        queue("jobs", U(1), 3_000),
        queue("jobs", U(2), 9_000),
        queue("jobs", U(3), 61_000, { last_seen_at: iso(clock - 1_000) }),
      ];
      const out = await drain({ maxMs: 20_000, wait: false });
      expect(requests.map((r) => r.filter)).toEqual([`uuid eq '${U(3)}'`, `uuid eq '${U(2)}'`]);
      expect(out.read).toBe(2);
      expect(pings().map((r) => r.uuid)).toEqual([U(1)]);
      expect(events.filter((e) => e.startsWith("sleep:") && e !== "sleep:1000")).toEqual([]);
    });

    it("the route's drain waits, at most 8 s, for its own rows to go quiet", async () => {
      db.sm8_webhook_pings = [queue("jobs", U(1), 3_000)];
      const out = await drain({ wait: true });
      expect(events).toContain("sleep:5000");
      expect(out).toMatchObject({ read: 1, written: 1 });
    });
  });

  it("a notes write settles the asks, within the drain's budget (S4)", async () => {
    db.sm8_webhook_pings = [queue("job_notes", U(1))];
    await drain({ maxMs: 120_000 });
    expect(settleMentionAsks).toHaveBeenCalledWith(ORG, { budgetMs: 20_000 });
    settleMentionAsks.mockClear();
    db.sm8_webhook_pings = [queue("job_notes", U(2))];
    // a read that took 10 s of a 25 s budget leaves the settle 15 s
    readTakes = [10_000];
    await drain({ maxMs: 25_000 });
    expect(settleMentionAsks).toHaveBeenCalledWith(ORG, { budgetMs: 15_000 });
    // no note written, no settle
    settleMentionAsks.mockClear();
    db.sm8_webhook_pings = [queue("jobs", U(3))];
    await drain();
    expect(settleMentionAsks).not.toHaveBeenCalled();
  });
});

/* ── the echo: read-only against ServiceM8 ── */

describe("read-only against ServiceM8", () => {
  it("only ever GETs, through the one door's REST base", async () => {
    db.sm8_webhook_pings = [queue("jobs", U(1), 30_000), queue("job_activities", U(2), 29_000), queue("companies", U(3), 28_000)];
    await drain();
    expect(requests.length).toBe(3);
    for (const r of requests) {
      expect(r.method).toBe("GET");
      expect(r.path.startsWith("/api_1.0/")).toBe(true);
    }
  });

  it("names no other method, no other door and no sync, anywhere in its source", () => {
    const src = readFileSync(join(__dirname, "..", "sm8-hook-drain.ts"), "utf8")
      // its header may say what it never does
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/\b(POST|PUT|PATCH|DELETE)\b/);
    expect(src).not.toMatch(/\bmethod\s*:/);
    expect(src).not.toMatch(/\bsm8Request\b|api\s*:\s*["']hooks["']/);
    expect(src).not.toMatch(/\brunSm8Sync\w*\b/);
    expect(src).toMatch(/fetchSm8Page\(sm8CallOf\(a, "hook"\)/);
  });
});
