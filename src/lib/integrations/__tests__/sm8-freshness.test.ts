/**
 * @jest-environment node
 */

/* Looking counts as looking: opening Home, the Workboard or the ServiceM8
   screen sends what is waiting and syncs a stale mirror — all after the
   response. What is pinned: the page itself reads nothing, a workspace that
   isn't connected is left alone, writes go before the sync, and each only
   starts while it still fits in the function. */

const reads: string[] = [];
let status: string | null = "connected";
let readFails = false;
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => {
        reads.push(table);
        if (readFails) return { data: null, error: { code: "08006" } };
        return { data: status === null ? null : { status }, error: null };
      };
      return q;
    },
  },
}));

const scheduled: (() => Promise<unknown>)[] = [];
jest.mock("next/server", () => ({ after: (fn: () => Promise<unknown>) => scheduled.push(fn) }));

const order: string[] = [];
let stale = true;
let due = true;
let writing = true;
const runSm8Sync = jest.fn(async () => {
  order.push("sync");
  return { ran: true, note: "", pagesUsed: 0, rowsPulled: 0, complete: true };
});
const runSm8Writes = jest.fn(async () => {
  order.push("writes");
  return { done: 0, sent: 0, trial: 0, failed: 0, again: 0, lost: 0, stopped: null };
});
jest.mock("../sm8-sync", () => ({
  runSm8Sync: (...a: unknown[]) => runSm8Sync(...(a as [])),
  sm8SyncIsStale: async () => stale,
}));
jest.mock("../sm8-writes", () => ({
  runSm8Writes: (...a: unknown[]) => runSm8Writes(...(a as [])),
  sm8WritesDue: async () => due,
  sm8WritesEnabled: () => writing,
}));

import { freshenSm8AfterResponse } from "../sm8-freshness";

let clock = Date.parse("2026-09-25T00:00:00Z");

beforeEach(() => {
  reads.length = 0;
  scheduled.length = 0;
  order.length = 0;
  status = "connected";
  readFails = false;
  stale = true;
  due = true;
  writing = true;
  runSm8Sync.mockClear();
  runSm8Writes.mockClear();
  clock = Date.parse("2026-09-25T00:00:00Z");
  jest.spyOn(Date, "now").mockImplementation(() => clock);
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const behind = async () => {
  expect(scheduled).toHaveLength(1);
  await scheduled[0]();
};

describe("freshenSm8AfterResponse", () => {
  it("reads nothing before the response — the page only registers one after()", () => {
    const returned: unknown = freshenSm8AfterResponse("org-1");
    expect(returned).toBeUndefined();
    expect(reads).toHaveLength(0);
    expect(scheduled).toHaveLength(1);
    expect(runSm8Writes).not.toHaveBeenCalled();
    expect(runSm8Sync).not.toHaveBeenCalled();
  });

  it("sends what is due before it syncs a stale mirror", async () => {
    freshenSm8AfterResponse("org-1");
    await behind();
    expect(order).toEqual(["writes", "sync"]);
    expect(runSm8Writes).toHaveBeenCalledWith("org-1", "kick", { budgetMs: 90_000 });
    expect(runSm8Sync).toHaveBeenCalledWith("org-1", "kick");
  });

  it("does neither when the mirror is fresh and nothing is due", async () => {
    stale = false;
    due = false;
    freshenSm8AfterResponse("org-1");
    await behind();
    expect(order).toEqual([]);
  });

  it("does nothing for a workspace that isn't connected, or whose connection can't be read", async () => {
    for (const s of ["needs_reauth", null]) {
      status = s;
      scheduled.length = 0;
      freshenSm8AfterResponse("org-1");
      await behind();
    }
    readFails = true;
    scheduled.length = 0;
    freshenSm8AfterResponse("org-1");
    await behind();
    expect(order).toEqual([]);
  });

  it("sends nothing on a deployment that doesn't write, and still syncs", async () => {
    writing = false;
    freshenSm8AfterResponse("org-1");
    await behind();
    expect(order).toEqual(["sync"]);
  });

  it("claims only while a send still fits in the page's function", async () => {
    freshenSm8AfterResponse("org-1");
    // the after() began late: 150 s into a 300 s function, a lease and a margin leave 15 s
    clock += 150_000;
    await behind();
    expect(runSm8Writes).toHaveBeenCalledWith("org-1", "kick", { budgetMs: 15_000 });
  });

  it("starts no sync that can't finish inside the function", async () => {
    freshenSm8AfterResponse("org-1");
    clock += 170_000;
    await behind();
    expect(runSm8Writes).not.toHaveBeenCalled();
    expect(runSm8Sync).not.toHaveBeenCalled();
  });

  it("never lets a failure escape the after()", async () => {
    runSm8Writes.mockRejectedValueOnce(new Error("boom"));
    freshenSm8AfterResponse("org-1");
    await expect(scheduled[0]()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
