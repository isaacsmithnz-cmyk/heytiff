/**
 * @jest-environment node
 */

/* The sync lease, held by token (two-way phase 4, PR B).

   Against the in-memory database (fixtures/sm8-fake-db), which applies the
   conditional writes for real: a release or an extension that doesn't match
   the row matches nothing. What is pinned:
   - a holder that outlived its lease can't give back or extend the next
     holder's — not even between that holder's claim and its stamp;
   - the sync checks a whole page still fits before each one, extends by
     token only while a whole new lease ends inside its function, and
     otherwise pauses; a sync whose extension matches nothing writes nothing
     more;
   - a sync that meets the lease held asks for it (wanted_at), tries again,
     and clears the ask when it gets it;
   - the owner's "running" is a sync's lease only;
   - a database without the new columns holds the lease exactly as before,
     and says so once. */

import { makeFakeDb } from "./fixtures/sm8-fake-db";

type Row = Record<string, unknown>;

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => fake.from(t),
    rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a),
  },
}));

const ORG = "org-lease-5c1d";
const ACCOUNT = "acct-9e27";

const sm8AccessResult = jest.fn();
const switchSm8Account = jest.fn();
jest.mock("../sm8-store", () => ({
  sm8AccessResult: (...a: unknown[]) => sm8AccessResult(...a),
  renewSm8Access: jest.fn(),
  markSm8NeedsReauth: jest.fn(),
  nameSm8ConnectionIfNameless: jest.fn(),
  readSm8Accounts: async () => ({
    ok: true,
    connected: { tenantId: ACCOUNT, tenantName: "Harbour Air" },
    mirrored: { uuid: ACCOUNT, name: "Harbour Air" },
  }),
  switchSm8Account: (...a: unknown[]) => switchSm8Account(...a),
}));

const fetchSm8Vendor = jest.fn();
jest.mock("../sm8", () => ({ fetchSm8Vendor: (...a: unknown[]) => fetchSm8Vendor(...a) }));

const fetchSm8Page = jest.fn();
jest.mock("../sm8-read", () => ({ fetchSm8Page: (...a: unknown[]) => fetchSm8Page(...a) }));

import {
  claimSm8Lease,
  extendSm8Lease,
  listSm8SyncStatus,
  releaseSm8Lease,
  runSm8Sync,
  runSm8SyncWhenFree,
  sm8SyncIsStale,
  switchSm8AccountUnderLease,
} from "../sm8-sync";
import {
  SM8_LEASE_LOST,
  SM8_SYNC_BUSY,
  SYNC_LEASE_MS,
  SYNC_METER_WAIT_MS,
  SYNC_PAGE_NEED_MS,
  syncPageStep,
  whenSm8LeaseFree,
} from "../sm8-lease";
import { SM8_METER } from "../sm8-meter";
import { SM8_PAUSE_MIDWALK } from "../sm8-sync-plan";

const T0 = Date.parse("2026-09-28T02:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const staff = (n: number): Row => ({
  uuid: `5e1f0000-0000-4000-8000-00000000000${n}`,
  first: `Tech ${n}`,
  active: 1,
  edit_date: "2026-09-27 10:00:00",
});
const emptyPage = { ok: true as const, rows: [], nextCursor: null };

const runRow = () => (fake.db.sm8_sync_runs ?? []).find((r) => r.org_id === ORG) as Row;
const staffRows = () => fake.db.sm8_staff ?? [];
const stateRows = () => fake.db.sm8_sync_state ?? [];

beforeEach(() => {
  fake.reset();
  fake.db.integration_connections = [{ org_id: ORG, provider: "servicem8", status: "connected", tenant_id: ACCOUNT }];
  sm8AccessResult.mockReset().mockResolvedValue({
    ok: true,
    access: { accessToken: "tok", tenantId: ACCOUNT, grant: "g1", meter: ACCOUNT },
  });
  switchSm8Account.mockReset().mockResolvedValue({ ok: true, cancelled: 0, cleared: true });
  fetchSm8Vendor.mockReset().mockResolvedValue({
    ok: true,
    vendor: { uuid: ACCOUNT, name: "Harbour Air", email: null, timezoneName: "Australia/Sydney", currency: "AUD" },
  });
  fetchSm8Page.mockReset().mockResolvedValue(emptyPage);
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("the rules, cold", () => {
  it("a page needs two reads at the sync's patience, a renewal and its writes", () => {
    expect(SYNC_METER_WAIT_MS).toBe(SM8_METER.maxWaitMs.sync);
    expect(SYNC_PAGE_NEED_MS).toBe(51_000);
  });

  it("goes while a whole page fits, extends while a whole lease fits, and otherwise stops", () => {
    const deadline = T0 + 280_000;
    expect(syncPageStep({ now: T0, leaseUntil: T0 + SYNC_PAGE_NEED_MS, deadline })).toBe("go");
    expect(syncPageStep({ now: T0, leaseUntil: T0 + SYNC_PAGE_NEED_MS - 1, deadline })).toBe("extend");
    // a whole new lease no longer ends by the deadline
    expect(syncPageStep({ now: T0, leaseUntil: T0 + 1_000, deadline: T0 + SYNC_LEASE_MS - 1 })).toBe("stop");
    expect(syncPageStep({ now: T0, leaseUntil: T0 + 1_000, deadline: T0 + SYNC_LEASE_MS })).toBe("extend");
    // the function ends before a page could, whatever the lease says
    expect(syncPageStep({ now: T0, leaseUntil: T0 + 100_000, deadline: T0 + SYNC_PAGE_NEED_MS - 1 })).toBe("stop");
  });

  it("tries again while busy, and never starts a try past its start-by", async () => {
    const busy = { ran: false, note: SM8_SYNC_BUSY };
    const run = jest.fn(async () => busy);
    await whenSm8LeaseFree(run, { tries: 3, waitMs: 0 });
    expect(run).toHaveBeenCalledTimes(3);

    run.mockClear();
    await whenSm8LeaseFree(run, { tries: 10, waitMs: 5, startBy: Date.now() });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("a lease is given back and extended by token only", () => {
  it("a holder that outlived its lease can't give back or extend the next holder's", async () => {
    const a = (await claimSm8Lease(ORG, "sync", T0))!;
    // a's lease runs out; a drain claims the next one
    const b = (await claimSm8Lease(ORG, "hook", T0 + SYNC_LEASE_MS + 1_000, {}, 45_000))!;
    expect(b).not.toBeNull();

    await releaseSm8Lease(a.lease, { last_note: "the late one" });
    expect(runRow()).toMatchObject({ lease_until: b.lease.until, lease_token: b.lease.token, lease_by: "hook" });
    expect(runRow().last_note).toBeUndefined();
    expect(await extendSm8Lease(a.lease, T0 + SYNC_LEASE_MS + 2_000)).toEqual({ ok: false, why: "lost" });
    expect(runRow().lease_until).toBe(b.lease.until);

    // the holder itself gives it back
    await releaseSm8Lease(b.lease);
    expect(runRow().lease_until).toBeNull();
  });

  it("...not even between the next holder's claim and its stamp, while the row still carries the old token", async () => {
    const a = (await claimSm8Lease(ORG, "sync", T0))!;
    // the next claim has written its end, and not yet its token
    const theirs = iso(T0 + 2 * SYNC_LEASE_MS);
    runRow().lease_until = theirs;

    await releaseSm8Lease(a.lease);
    expect(runRow().lease_until).toBe(theirs);
    expect(await extendSm8Lease(a.lease, T0 + SYNC_LEASE_MS + 5_000)).toEqual({ ok: false, why: "lost" });
    expect(runRow().lease_until).toBe(theirs);
  });

  it("a claim whose row moved on before its stamp stamps nothing, and is busy", async () => {
    const theirs = iso(T0 + 3 * SYNC_LEASE_MS);
    let moved = false;
    fake.before.sm8_sync_runs = (s) => {
      // between this claim's write and its stamp, the row takes another end
      if (!moved && s.op === "update" && s.patch && "lease_token" in s.patch) {
        moved = true;
        runRow().lease_until = theirs;
      }
    };
    expect(await claimSm8Lease(ORG, "sync", T0)).toBeNull();
    expect(moved).toBe(true);
    expect(runRow().lease_token).toBeUndefined();
    expect(runRow().lease_until).toBe(theirs);
  });

  it("a claim names its holder, and a claim while the lease is live is busy", async () => {
    const a = (await claimSm8Lease(ORG, "switch", T0))!;
    expect(runRow()).toMatchObject({ lease_by: "switch", lease_token: a.lease.token, lease_until: iso(T0 + SYNC_LEASE_MS) });
    expect(await claimSm8Lease(ORG, "sync", T0 + 1_000)).toBeNull();
  });

  it("the account switch holds the lease as `switch` and gives it back by token", async () => {
    let during: Row | null = null;
    switchSm8Account.mockImplementation(async () => {
      during = { ...runRow() };
      return { ok: true, cancelled: 0, cleared: true };
    });
    const r = await switchSm8AccountUnderLease(ORG, {
      to: { uuid: ACCOUNT, name: "Harbour Air", email: null, timezoneName: "Australia/Sydney", currency: "AUD" },
      from: { uuid: "acct-0001", name: "Old Co" },
      now: T0,
    });
    expect(r).toEqual({ ok: true, cancelled: 0, cleared: true });
    expect(during).toMatchObject({ lease_by: "switch", lease_until: iso(T0 + SYNC_LEASE_MS) });
    expect(typeof during!.lease_token).toBe("string");
    expect(runRow().lease_until).toBeNull();
  });
});

describe("the sync outlasts no lease", () => {
  /** A staff walk two pages long; `between` runs after the first is read. */
  const twoPages = (between: () => void) => {
    let n = 0;
    fetchSm8Page.mockImplementation(async (_call: unknown, endpoint: string) => {
      if (endpoint !== "staff.json") return emptyPage;
      n += 1;
      if (n === 1) {
        between();
        return { ok: true, rows: [staff(1)], nextCursor: "page-2" };
      }
      return { ok: true, rows: [staff(2)], nextCursor: null };
    });
  };
  const staffReads = () => fetchSm8Page.mock.calls.filter((c) => c[1] === "staff.json").length;
  const extensions = () =>
    fake.log.filter((s) => s.table === "sm8_sync_runs" && s.op === "update" && s.filters.some((f) => f.startsWith("lease_token=")) && s.patch && Object.keys(s.patch).join() === "lease_until");

  it("extends by token when less than a page's need is left, while a whole lease still ends inside its function", async () => {
    let t = T0;
    twoPages(() => {
      t = T0 + 80_000; // 40 s of the lease left: short of a page's need
    });
    const out = await runSm8Sync(ORG, "cron", T0, { deadline: T0 + 280_000, clock: () => t });
    expect(out.ran).toBe(true);
    expect(staffReads()).toBe(2);
    expect(staffRows().map((r) => r.uuid)).toEqual([staff(1).uuid, staff(2).uuid]);
    expect(extensions()).toHaveLength(1);
    expect(extensions()[0].patch).toEqual({ lease_until: iso(T0 + 80_000 + SYNC_LEASE_MS) });
    expect(runRow().lease_until).toBeNull();
  });

  it("doesn't extend past its function: it pauses where it is, and the next sync reads the page it didn't", async () => {
    let t = T0;
    twoPages(() => {
      t = T0 + 80_000;
    });
    // a whole new lease from 80 s would end at 200 s, past this function's 150
    const out = await runSm8Sync(ORG, "cron", T0, { deadline: T0 + 150_000, clock: () => t });
    expect(out).toMatchObject({ ran: true, complete: false, note: SM8_PAUSE_MIDWALK });
    expect(staffReads()).toBe(1);
    expect(extensions()).toHaveLength(0);
    expect(stateRows().find((r) => r.object === "staff")).toMatchObject({ walk_cursor: "page-2" });
    expect(runRow()).toMatchObject({ lease_until: null, last_note: SM8_PAUSE_MIDWALK });
  });

  it("with no deadline it lives inside the one lease it claimed, and stops before that lease runs out", async () => {
    let t = T0;
    twoPages(() => {
      t = T0 + 70_000; // 50 s left, a second short of a page
    });
    const out = await runSm8Sync(ORG, "kick", T0, { clock: () => t });
    expect(out).toMatchObject({ ran: true, complete: false, note: SM8_PAUSE_MIDWALK });
    expect(staffReads()).toBe(1);
    expect(extensions()).toHaveLength(0);
    expect(runRow().lease_until).toBeNull();
  });

  it("a sync whose lease is lost mid-walk stops before its next page, and writes nothing more — not even its release", async () => {
    let t = T0;
    const theirs = "c0ffee00-0000-4000-8000-00000000beef";
    twoPages(() => {
      t = T0 + 80_000;
      // meanwhile the lease went to somebody else
      Object.assign(runRow(), { lease_token: theirs, lease_by: "hook", lease_until: iso(T0 + 125_000) });
    });
    const out = await runSm8Sync(ORG, "cron", T0, { deadline: T0 + 280_000, clock: () => t });
    expect(out).toMatchObject({ ran: true, complete: false, note: SM8_LEASE_LOST });
    expect(staffReads()).toBe(1);
    expect(staffRows().map((r) => r.uuid)).toEqual([staff(1).uuid]);
    expect(stateRows()).toEqual([]);
    expect(runRow()).toMatchObject({ lease_token: theirs, lease_by: "hook", lease_until: iso(T0 + 125_000) });
    expect(runRow().last_finished_at).toBeUndefined();
  });
});

describe("a sync that meets the lease held asks for it", () => {
  it("sets wanted_at, tries again once the holder gives it back, and clears the ask with its claim", async () => {
    fake.db.sm8_sync_runs = [
      { org_id: ORG, lease_until: iso(Date.now() + 40_000), lease_token: "d1a1d1a1-0000-4000-8000-000000000001", lease_by: "hook" },
    ];
    let asked: Row | null = null;
    fake.before.sm8_sync_runs = (s) => {
      if (s.op === "update" && s.patch?.wanted_at) {
        asked = { ...s.patch };
        // the drain sees the ask and stands aside
        runRow().lease_until = null;
      }
    };
    const out = await runSm8SyncWhenFree(ORG, "manual", { tries: 3, waitMs: 0 });
    expect(asked).toMatchObject({ wanted_by: "manual" });
    expect(out.ran).toBe(true);
    expect(runRow()).toMatchObject({ wanted_at: null, wanted_by: null, lease_until: null });
  });

  it("gives up after its tries with the busy answer, and the ask stands for the drain to see", async () => {
    fake.db.sm8_sync_runs = [
      { org_id: ORG, lease_until: iso(Date.now() + 40_000), lease_token: "d1a1d1a1-0000-4000-8000-000000000002", lease_by: "hook" },
    ];
    const out = await runSm8SyncWhenFree(ORG, "cron", { tries: 2, waitMs: 0 });
    expect(out).toMatchObject({ ran: false, note: SM8_SYNC_BUSY });
    expect(runRow()).toMatchObject({ wanted_by: "cron", lease_by: "hook" });
    expect(typeof runRow().wanted_at).toBe("string");
  });
});

describe("what the screen and the kick read", () => {
  const live = () => iso(Date.now() + 60_000);
  const old = iso(Date.now() - 60 * 60_000);

  it("the owner's `running` is a sync's lease only — never a drain's", async () => {
    fake.db.sm8_sync_runs = [{ org_id: ORG, lease_until: live(), lease_by: "hook", last_finished_at: old }];
    expect((await listSm8SyncStatus(ORG)).lastRun?.running).toBe(false);
    runRow().lease_by = "sync";
    expect((await listSm8SyncStatus(ORG)).lastRun?.running).toBe(true);
    // claimed the old way: a sync, as it always was
    runRow().lease_by = null;
    expect((await listSm8SyncStatus(ORG)).lastRun?.running).toBe(true);
  });

  it("a drain's lease doesn't put off the kick; any other still does", async () => {
    fake.db.sm8_sync_runs = [{ org_id: ORG, lease_until: live(), lease_by: "hook", last_finished_at: old }];
    expect(await sm8SyncIsStale(ORG)).toBe(true);
    runRow().lease_by = "sync";
    expect(await sm8SyncIsStale(ORG)).toBe(false);
    runRow().lease_by = "switch";
    expect(await sm8SyncIsStale(ORG)).toBe(false);
  });
});

describe("a database without the new columns", () => {
  beforeEach(() => {
    for (const c of ["lease_token", "lease_by", "wanted_at", "wanted_by"]) fake.missing.add(c);
  });

  it("holds the lease as before — no token, no extension, an unconditional release — and says so once", async () => {
    let t = T0;
    let n = 0;
    fetchSm8Page.mockImplementation(async (_call: unknown, endpoint: string) => {
      if (endpoint !== "staff.json") return emptyPage;
      n += 1;
      if (n === 1) {
        t = T0 + 80_000; // would be an extension, with a token
        return { ok: true, rows: [staff(1)], nextCursor: "page-2" };
      }
      return { ok: true, rows: [staff(2)], nextCursor: null };
    });
    const out = await runSm8Sync(ORG, "cron", T0, { deadline: T0 + 280_000, clock: () => t });
    expect(out).toMatchObject({ ran: true, complete: true });
    expect(staffRows()).toHaveLength(2);
    expect(runRow()).toMatchObject({ lease_until: null, last_ok: true });
    const leaseWrites = fake.log.filter((s) => s.table === "sm8_sync_runs" && s.op === "update");
    expect(leaseWrites.some((s) => s.filters.some((f) => f.startsWith("lease_token=")))).toBe(false);

    // a second run: still held the old way, and nothing more in the log
    await runSm8Sync(ORG, "kick", T0 + 200_000);
    expect(runRow().lease_until).toBeNull();
    expect((console.warn as jest.Mock).mock.calls.filter((c) => String(c[0]).includes("lease_token"))).toHaveLength(1);
  });

  it("a busy sync still answers busy, and the screen reads `running` from the lease alone", async () => {
    fake.db.sm8_sync_runs = [{ org_id: ORG, lease_until: iso(Date.now() + 60_000), last_finished_at: null }];
    expect(await runSm8Sync(ORG, "manual")).toMatchObject({ ran: false, note: SM8_SYNC_BUSY });
    expect((await listSm8SyncStatus(ORG)).lastRun?.running).toBe(true);
    expect(await sm8SyncIsStale(ORG)).toBe(false);
  });
});
