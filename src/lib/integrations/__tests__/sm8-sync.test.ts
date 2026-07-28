/* The engine's hard cases: the lease is a real mutex, budgets actually stop
   the walk, cursors move only on completed walks, and each failure kind ends
   exactly as much of the run as it should — one object for a missing scope,
   everything for a rate limit or a dead grant. */

type Row = Record<string, unknown>;

const upserts: { table: string; payload: unknown }[] = [];
const updates: { table: string; patch: Row }[] = [];

let claimResult: Row[] = [{ calls_today: 0, calls_day: null }];
let stateRows: Row[] = [];
let runsRow: Row | null = null;

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.upsert = (payload: unknown) => {
        upserts.push({ table, payload });
        return Promise.resolve({ error: null });
      };
      chain.update = (patch: Row) => {
        const sub: Record<string, unknown> = {};
        sub.eq = () => sub;
        sub.or = () => sub;
        sub.select = () => {
          updates.push({ table, patch });
          return Promise.resolve({ data: table === "sm8_sync_runs" ? claimResult : [] });
        };
        sub.then = (res: (v: { error: null }) => unknown) => {
          updates.push({ table, patch });
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
      };
      chain.select = () => {
        const sub: Record<string, unknown> = {};
        sub.eq = () => sub;
        sub.maybeSingle = async () => ({ data: runsRow });
        sub.then = (res: (v: { data: Row[] }) => unknown) =>
          Promise.resolve({ data: table === "sm8_sync_state" ? stateRows : [] }).then(res);
        return sub;
      };
      chain.delete = () => {
        const sub: Record<string, unknown> = {};
        sub.eq = () => sub;
        sub.then = (res: (v: { error: null }) => unknown) =>
          Promise.resolve({ error: null }).then(res);
        return sub;
      };
      return chain;
    },
  },
}));

const afterFn = jest.fn((cb: () => unknown) => void cb);
jest.mock("next/server", () => ({ after: (cb: () => unknown) => afterFn(cb) }));

const sm8Access = jest.fn();
const markSm8NeedsReauth = jest.fn();
jest.mock("../sm8-store", () => ({
  sm8Access: (...a: unknown[]) => sm8Access(...(a as [])),
  markSm8NeedsReauth: (...a: unknown[]) => markSm8NeedsReauth(...(a as [])),
}));

const fetchSm8Vendor = jest.fn();
jest.mock("../sm8", () => ({
  fetchSm8Vendor: (...a: unknown[]) => fetchSm8Vendor(...(a as [])),
}));

const fetchSm8Page = jest.fn();
jest.mock("../sm8-read", () => ({
  fetchSm8Page: (...a: unknown[]) => fetchSm8Page(...(a as [])),
}));

import { kickSm8SyncIfStale, runSm8Sync } from "../sm8-sync";
import { PAGE_BUDGET, SM8_OBJECTS } from "../sm8-sync-plan";

const NOW = Date.parse("2026-07-28T01:00:00Z");
const TODAY = "2026-07-28";

const emptyPage = { ok: true as const, rows: [], nextCursor: null };

beforeEach(() => {
  upserts.length = 0;
  updates.length = 0;
  claimResult = [{ calls_today: 0, calls_day: null }];
  stateRows = [];
  runsRow = null;
  afterFn.mockClear();
  sm8Access.mockReset().mockResolvedValue({ accessToken: "tok" });
  markSm8NeedsReauth.mockReset();
  fetchSm8Vendor.mockReset().mockResolvedValue({
    ok: true,
    vendor: { uuid: "v-1", name: "Acme Air", email: null, timezoneName: "Australia/Brisbane", currency: "AUD" },
  });
  fetchSm8Page.mockReset().mockResolvedValue(emptyPage);
});

const lastRunsUpdate = () => updates.filter((u) => u.table === "sm8_sync_runs").pop()!;
const stateUpsertFor = (object: string) =>
  upserts
    .filter((u) => u.table === "sm8_sync_state")
    .map((u) => u.payload as Row)
    .find((p) => p.object === object);

describe("the lease is a real mutex", () => {
  it("an unclaimed lease means someone else is running — not a second walker", async () => {
    claimResult = [];
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out).toMatchObject({ ran: false, note: "A sync is already running." });
    expect(sm8Access).not.toHaveBeenCalled();
    expect(fetchSm8Page).not.toHaveBeenCalled();
  });

  it("an unusable grant releases the lease with the reason", async () => {
    sm8Access.mockResolvedValue(null);
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.ran).toBe(false);
    const release = lastRunsUpdate();
    expect(release.patch).toMatchObject({ lease_until: null, last_ok: false });
    expect(String(release.patch.last_note)).toContain("connected");
  });
});

describe("budgets", () => {
  it("a spent daily budget refuses before spending a single call", async () => {
    claimResult = [{ calls_today: 2000, calls_day: TODAY }];
    const out = await runSm8Sync("org-1", "cron", NOW);
    expect(out.ran).toBe(false);
    expect(out.note).toContain("budget");
    expect(fetchSm8Vendor).not.toHaveBeenCalled();
  });

  it("yesterday's spend doesn't count against today", async () => {
    claimResult = [{ calls_today: 2000, calls_day: "2026-07-27" }];
    const out = await runSm8Sync("org-1", "cron", NOW);
    expect(out.ran).toBe(true);
    expect(fetchSm8Vendor).toHaveBeenCalled();
  });

  it("the page budget pauses mid-walk WITHOUT advancing the cursor", async () => {
    // The first object never runs out of pages; the budget is what stops it.
    fetchSm8Page.mockImplementation(async () => ({
      ok: true,
      rows: [{ uuid: "u-x", edit_date: "2026-07-28 09:00:00", active: 1 }],
      nextCursor: "more",
    }));

    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out).toMatchObject({ ran: true, complete: false, pagesUsed: PAGE_BUDGET });
    expect(out.note).toContain("Page budget");
    expect(fetchSm8Page).toHaveBeenCalledTimes(PAGE_BUDGET);

    const staff = stateUpsertFor("staff")!;
    // rows were stored (idempotent), but the floor didn't move
    expect(staff.cursor).toBeNull();
    expect(staff.backfill_done).toBe(false);
    expect(staff.rows_pulled).toBe(PAGE_BUDGET);
  });
});

describe("a clean walk", () => {
  it("mirrors the rows, advances cursors, and counts the calls", async () => {
    fetchSm8Page.mockImplementation(async (_tok: string, endpoint: string) =>
      endpoint === "job.json"
        ? {
            ok: true,
            rows: [
              {
                uuid: "j-1",
                generated_job_id: "1042",
                status: "Work Order",
                edit_date: "2026-07-28 09:00:00",
                active: 1,
                total_invoice_amount: "999.00",
              },
            ],
            nextCursor: null,
          }
        : emptyPage
    );

    const out = await runSm8Sync("org-1", "connect", NOW);
    expect(out).toMatchObject({ ran: true, complete: true, rowsPulled: 1 });

    const vendor = upserts.find((u) => u.table === "sm8_vendor")!.payload as Row;
    expect(vendor).toMatchObject({ org_id: "org-1", timezone_name: "Australia/Brisbane" });

    const jobRows = upserts.find((u) => u.table === "sm8_jobs")!.payload as Row[];
    expect(jobRows[0]).toMatchObject({ org_id: "org-1", uuid: "j-1", generated_job_id: "1042" });
    expect(jobRows[0]).not.toHaveProperty("total_invoice_amount");

    const jobs = stateUpsertFor("jobs")!;
    expect(jobs).toMatchObject({
      cursor: "2026-07-28 09:00:00",
      backfill_done: true,
      last_error: null,
      rows_pulled: 1,
    });

    const release = lastRunsUpdate();
    // one vendor call + one page per object
    expect(release.patch).toMatchObject({
      lease_until: null,
      last_ok: true,
      calls_today: 1 + SM8_OBJECTS.length,
      calls_day: TODAY,
    });
  });
});

describe("failure kinds end exactly as much as they should", () => {
  it("a 403 names the grant on that object and keeps walking the rest", async () => {
    fetchSm8Page.mockImplementation(async (_tok: string, endpoint: string) =>
      endpoint === "staff.json" ? { ok: false, failure: "forbidden" } : emptyPage
    );

    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.complete).toBe(false);
    expect(stateUpsertFor("staff")!.last_error).toBe("Reconnect ServiceM8 to grant read_staff.");
    // the walk went on: every other object was still fetched
    expect(fetchSm8Page).toHaveBeenCalledTimes(SM8_OBJECTS.length);
    expect(stateUpsertFor("jobs")!.backfill_done).toBe(true);
  });

  it("a 429 ends the whole run — serverless can't sleep it off", async () => {
    fetchSm8Page.mockImplementation(async (_tok: string, endpoint: string) =>
      endpoint === "staff.json" ? { ok: false, failure: "rate_limited" } : emptyPage
    );

    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toContain("rate limit");
    expect(fetchSm8Page).toHaveBeenCalledTimes(1);
    expect(lastRunsUpdate().patch).toMatchObject({ last_ok: false });
  });

  it("a dead grant marks needs_reauth and stops immediately", async () => {
    fetchSm8Page.mockResolvedValue({ ok: false, failure: "unauthorized" });

    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(markSm8NeedsReauth).toHaveBeenCalledTimes(1);
    expect(out.note).toContain("reconnecting");
    expect(fetchSm8Page).toHaveBeenCalledTimes(1);
  });
});

describe("the page-load kick", () => {
  it("fires only when the mirrors are stale and nothing is running", async () => {
    runsRow = { lease_until: null, last_finished_at: new Date(NOW - 60 * 60_000).toISOString() };
    await kickSm8SyncIfStale("org-1", NOW);
    expect(afterFn).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when fresh or already running", async () => {
    runsRow = { lease_until: null, last_finished_at: new Date(NOW - 2 * 60_000).toISOString() };
    await kickSm8SyncIfStale("org-1", NOW);
    expect(afterFn).not.toHaveBeenCalled();

    runsRow = {
      lease_until: new Date(NOW + 60_000).toISOString(),
      last_finished_at: new Date(NOW - 60 * 60_000).toISOString(),
    };
    await kickSm8SyncIfStale("org-1", NOW);
    expect(afterFn).not.toHaveBeenCalled();
  });
});
