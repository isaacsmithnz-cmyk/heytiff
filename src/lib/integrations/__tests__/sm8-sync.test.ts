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
/* for sweepableSm8Orgs: the connected workspaces, and what each one's last
   finished run looks like */
let connRows: Row[] = [];
let runRows: Row[] = [];

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
        sub.is = () => sub;
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
        sub.in = () => sub;
        sub.limit = () => sub;
        sub.maybeSingle = async () => ({ data: runsRow });
        sub.then = (res: (v: { data: Row[] }) => unknown) => {
          const data =
            table === "sm8_sync_state"
              ? stateRows
              : table === "integration_connections"
                ? connRows
                : table === "sm8_sync_runs"
                  ? runRows
                  : [];
          return Promise.resolve({ data }).then(res);
        };
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
/* The token paths are stubbed, but the naming repair is the REAL one: it
   touches no tokens, and a spy here would only prove the sync calls something
   — the point of the test below is that the connection row actually gets
   written. */
jest.mock("../sm8-store", () => ({
  sm8Access: (...a: unknown[]) => sm8Access(...(a as [])),
  markSm8NeedsReauth: (...a: unknown[]) => markSm8NeedsReauth(...(a as [])),
  nameSm8ConnectionIfNameless: jest.requireActual("../sm8-store").nameSm8ConnectionIfNameless,
}));

const fetchSm8Vendor = jest.fn();
jest.mock("../sm8", () => ({
  fetchSm8Vendor: (...a: unknown[]) => fetchSm8Vendor(...(a as [])),
}));

const fetchSm8Page = jest.fn();
jest.mock("../sm8-read", () => ({
  fetchSm8Page: (...a: unknown[]) => fetchSm8Page(...(a as [])),
}));

import { kickSm8SyncIfStale, runSm8Sync, sweepableSm8Orgs } from "../sm8-sync";
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
  connRows = [];
  runRows = [];
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

describe("the vendor read repairs a nameless connect", () => {
  /* A connect whose vendor read failed (a 402-blocked account, say) is stored
     deliberately nameless. saveSm8Connection's comment promises the next sync
     names it — before this, only the sm8_vendor mirror was written and the
     connection row stayed NULL forever. */
  const connectionWrite = () => updates.find((u) => u.table === "integration_connections");

  it("a successful vendor read names the connection row, not just the mirror", async () => {
    await runSm8Sync("org-1", "manual", NOW);

    expect(upserts.find((u) => u.table === "sm8_vendor")).toBeDefined();
    expect(connectionWrite()!.patch).toMatchObject({
      tenant_id: "v-1",
      tenant_name: "Acme Air",
    });
  });

  it("a vendor read that failed leaves the connection row alone", async () => {
    // nothing was learned, so there is nothing to write — and a bad read must
    // never blank a name the row already has
    fetchSm8Vendor.mockResolvedValue({ ok: false, unauthorized: false });
    await runSm8Sync("org-1", "manual", NOW);
    expect(connectionWrite()).toBeUndefined();
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

  /* 2026-07-30, the first live connection: an expired ServiceM8 trial answers
     402 to every endpoint, and with no branch for it the board said "couldn't
     be reached" — a network fault — while the sync retried a state only the
     account holder can clear. */
  it("a 402 ends the run on the account read, before spending a page call", async () => {
    fetchSm8Vendor.mockResolvedValue({ ok: false, unauthorized: false, paymentRequired: true });

    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toMatch(/trial has ended or an invoice is outstanding/);
    // the nine objects would each be told the same thing
    expect(fetchSm8Page).not.toHaveBeenCalled();
    expect(lastRunsUpdate().patch).toMatchObject({ last_ok: false, calls_today: 1 });
  });

  it("a 402 never marks the grant needs_reauth — reconnecting can't pay a bill", async () => {
    fetchSm8Vendor.mockResolvedValue({ ok: false, unauthorized: false, paymentRequired: true });
    await runSm8Sync("org-1", "manual", NOW);
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
  });

  it("a 402 mid-walk stops the run too, on that object's own error", async () => {
    fetchSm8Page.mockImplementation(async (_tok: string, endpoint: string) =>
      endpoint === "staff.json" ? { ok: false, failure: "payment_required" } : emptyPage
    );

    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.complete).toBe(false);
    expect(stateUpsertFor("staff")!.last_error).toMatch(/Choose a plan in ServiceM8/);
    expect(fetchSm8Page).toHaveBeenCalledTimes(1);
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
  });
});

describe("sweepableSm8Orgs — the nightly cap must rotate, not cut off", () => {
  it("puts the longest-waiting workspace first", async () => {
    connRows = [{ org_id: "a" }, { org_id: "b" }, { org_id: "c" }];
    runRows = [
      { org_id: "a", last_finished_at: "2026-07-28T03:00:00.000Z" },
      { org_id: "b", last_finished_at: "2026-07-26T03:00:00.000Z" },
      { org_id: "c", last_finished_at: "2026-07-27T03:00:00.000Z" },
    ];
    expect(await sweepableSm8Orgs(10)).toEqual(["b", "c", "a"]);
  });

  it("a workspace that has NEVER synced goes first — it has waited longest", async () => {
    // the exact org an unordered .limit() is most likely to strand: it has no
    // sm8_sync_runs row at all, so selecting FROM that table would hide it
    connRows = [{ org_id: "synced" }, { org_id: "never" }];
    runRows = [{ org_id: "synced", last_finished_at: "2026-07-28T03:00:00.000Z" }];
    expect(await sweepableSm8Orgs(10)).toEqual(["never", "synced"]);
  });

  it("treats a null last_finished_at as never swept", async () => {
    connRows = [{ org_id: "a" }, { org_id: "b" }];
    runRows = [
      { org_id: "a", last_finished_at: "2026-07-28T03:00:00.000Z" },
      { org_id: "b", last_finished_at: null }, // claimed a lease, never finished
    ];
    expect(await sweepableSm8Orgs(10)).toEqual(["b", "a"]);
  });

  it("the cap takes the neediest, and tomorrow's run reaches the rest", async () => {
    connRows = ["a", "b", "c", "d"].map((org_id) => ({ org_id }));
    runRows = [
      { org_id: "a", last_finished_at: "2026-07-28T03:00:00.000Z" },
      { org_id: "b", last_finished_at: "2026-07-25T03:00:00.000Z" },
      { org_id: "c", last_finished_at: "2026-07-26T03:00:00.000Z" },
      { org_id: "d", last_finished_at: "2026-07-27T03:00:00.000Z" },
    ];
    const tonight = await sweepableSm8Orgs(2);
    expect(tonight).toEqual(["b", "c"]);

    // once tonight's two have run, the other two are the longest-waiting
    runRows = [
      { org_id: "a", last_finished_at: "2026-07-28T03:00:00.000Z" },
      { org_id: "b", last_finished_at: "2026-07-29T03:00:00.000Z" },
      { org_id: "c", last_finished_at: "2026-07-29T03:00:00.000Z" },
      { org_id: "d", last_finished_at: "2026-07-27T03:00:00.000Z" },
    ];
    expect(await sweepableSm8Orgs(2)).toEqual(["d", "a"]);
  });

  it("is deterministic when timestamps tie", async () => {
    connRows = [{ org_id: "b" }, { org_id: "a" }];
    runRows = [
      { org_id: "a", last_finished_at: "2026-07-28T03:00:00.000Z" },
      { org_id: "b", last_finished_at: "2026-07-28T03:00:00.000Z" },
    ];
    expect(await sweepableSm8Orgs(10)).toEqual(["a", "b"]);
  });

  it("no connected workspaces spends no second query", async () => {
    connRows = [];
    expect(await sweepableSm8Orgs(10)).toEqual([]);
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
