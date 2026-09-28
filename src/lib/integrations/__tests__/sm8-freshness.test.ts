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
/** Whether the sync ran (false: another held the lease), and how long it took. */
let syncRan = true;
let syncTakes = 0;
const runSm8Sync = jest.fn(async () => {
  order.push("sync");
  clock += syncTakes;
  return { ran: syncRan, note: "", pagesUsed: 0, rowsPulled: 0, complete: true };
});
/* H18: the asks the sync brought in, each made one task. */
const settleMentionAsks = jest.fn(async (_org: string, _opts: { budgetMs: number }) => {
  order.push("asks");
  return { reads: 0, tasks: 0, moved: 0, done: 0, failed: 0, skipped: null };
});
jest.mock("@/lib/dashboard/mention-settle", () => ({
  settleMentionAsks: (...a: unknown[]) => settleMentionAsks(...(a as [string, { budgetMs: number }])),
}));
const runSm8Writes = jest.fn(async () => {
  order.push("writes");
  clock += writesTake;
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

/* Live updates (two-way phase 4): the subscribing module is loaded only
   with SM8_WEBHOOKS on, so its factory running is itself the proof. */
let hooksLoaded = false;
let writesTake = 0;
const ensureSm8WebhooksIfOwed = jest.fn(async (_org: string, _opts: { budgetMs: number }) => {
  order.push("ensure");
  return null;
});
jest.mock("../sm8-hooks", () => {
  hooksLoaded = true;
  return { ensureSm8WebhooksIfOwed: (...a: unknown[]) => ensureSm8WebhooksIfOwed(...(a as [string, { budgetMs: number }])) };
});

/* Live updates' page-load backstop (two-way phase 4, PR D): the drain is
   loaded only with SM8_WEBHOOKS on, the same way. */
let drainLoaded = false;
let drainTakes = 0;
const drainSm8Hooks = jest.fn(async (_org: string, _opts: { deadline: number; maxMs: number; wait: boolean }) => {
  order.push("drain");
  clock += drainTakes;
  return { ran: true, read: 0, written: 0, handed: 0, dropped: 0, stopped: null };
});
jest.mock("../sm8-hook-drain", () => {
  drainLoaded = true;
  return {
    drainSm8Hooks: (...a: unknown[]) => drainSm8Hooks(...(a as [string, { deadline: number; maxMs: number; wait: boolean }])),
  };
});

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
  syncRan = true;
  syncTakes = 0;
  writesTake = 0;
  drainTakes = 0;
  drainSm8Hooks.mockClear();
  ensureSm8WebhooksIfOwed.mockClear();
  runSm8Sync.mockClear();
  runSm8Writes.mockClear();
  settleMentionAsks.mockClear();
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

  it("sends what is due before it syncs a stale mirror, and reads the asks it brought in last", async () => {
    freshenSm8AfterResponse("org-1");
    await behind();
    expect(order).toEqual(["writes", "sync", "asks"]);
    expect(runSm8Writes).toHaveBeenCalledWith("org-1", "kick", { budgetMs: 90_000 });
    // the page's function: the platform's 300 s, less the 20 s margin
    expect(runSm8Sync).toHaveBeenCalledWith("org-1", "kick", clock, {
      deadline: Date.parse("2026-09-25T00:00:00Z") + 280_000,
    });
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
    expect(order).toEqual(["sync", "asks"]);
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

  /* Two-way phase 4, PR B: a kick that meets a DRAIN holding the lease asks
     for it and tries again, 2 s apart — never starting a try once a whole
     lease no longer fits the page's function, and only while the mirror is
     still stale. Any other holder: busy at once, as before. */
  describe("when the lease is held", () => {
    const { SM8_SYNC_BUSY } = jest.requireActual("../sm8-lease") as { SM8_SYNC_BUSY: string };
    const busy = { ran: false, note: SM8_SYNC_BUSY, pagesUsed: 0, rowsPulled: 0, complete: false, heldByHook: true };
    const busySync = { ...busy, heldByHook: false };
    beforeEach(() => jest.useFakeTimers({ doNotFake: ["Date"] }));
    afterEach(() => jest.useRealTimers());

    it("tries again, and syncs once it is given back", async () => {
      runSm8Sync.mockResolvedValueOnce(busy as never);
      freshenSm8AfterResponse("org-1");
      const pending = scheduled[0]();
      await jest.advanceTimersByTimeAsync(2_000);
      await pending;
      expect(runSm8Sync).toHaveBeenCalledTimes(2);
      expect(order).toEqual(["writes", "sync", "asks"]);
    });

    it("starts no try past the last moment a lease still fits the function", async () => {
      runSm8Sync.mockResolvedValueOnce(busy as never);
      freshenSm8AfterResponse("org-1");
      // 164 s in: this try fits, the next (2 s on) would not
      clock += 164_000;
      const pending = scheduled[0]();
      await jest.advanceTimersByTimeAsync(20_000);
      await pending;
      expect(runSm8Sync).toHaveBeenCalledTimes(1);
      expect(settleMentionAsks).not.toHaveBeenCalled();
    });

    it("gives up at once when another sync holds it, as the kick always has", async () => {
      runSm8Sync.mockResolvedValueOnce(busySync as never);
      freshenSm8AfterResponse("org-1");
      const pending = scheduled[0]();
      await jest.advanceTimersByTimeAsync(20_000);
      await pending;
      expect(runSm8Sync).toHaveBeenCalledTimes(1);
      expect(settleMentionAsks).not.toHaveBeenCalled();
    });

    it("stops waiting when the mirror went fresh meanwhile: no second sync", async () => {
      runSm8Sync.mockImplementationOnce(async () => {
        stale = false; // the drain stood aside and another run synced
        return busy as never;
      });
      freshenSm8AfterResponse("org-1");
      const pending = scheduled[0]();
      await jest.advanceTimersByTimeAsync(20_000);
      await pending;
      expect(runSm8Sync).toHaveBeenCalledTimes(1);
      expect(settleMentionAsks).not.toHaveBeenCalled();
    });
  });

  it("never lets a failure escape the after()", async () => {
    runSm8Writes.mockRejectedValueOnce(new Error("boom"));
    freshenSm8AfterResponse("org-1");
    await expect(scheduled[0]()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

/* H18: each ServiceM8 ask of a person the new Home is on becomes one task,
   settled in the same after() right behind the sync, so the conversation
   and its task arrive on the same next load. */
describe("the asks after the sync", () => {
  it("are read after a sync that ran, with what is left of the function less the writes' margin", async () => {
    syncTakes = 20_000;
    freshenSm8AfterResponse("org-1");
    await behind();
    // 300 s, less 15 s of margin, less the 20 s the sync took
    expect(settleMentionAsks).toHaveBeenCalledWith("org-1", { budgetMs: 265_000 });
  });

  it("are not read when no sync ran: a fresh mirror brought nothing, and a busy one is another run's", async () => {
    stale = false;
    freshenSm8AfterResponse("org-1");
    await behind();
    syncRan = false;
    stale = true;
    scheduled.length = 0;
    freshenSm8AfterResponse("org-1");
    await behind();
    expect(settleMentionAsks).not.toHaveBeenCalled();
  });

  it("are not read once the function has no time left", async () => {
    syncTakes = 290_000;
    freshenSm8AfterResponse("org-1");
    await behind();
    expect(runSm8Sync).toHaveBeenCalled();
    expect(settleMentionAsks).not.toHaveBeenCalled();
  });

  it("never let a failure of theirs escape the after()", async () => {
    settleMentionAsks.mockRejectedValueOnce(new Error("boom"));
    freshenSm8AfterResponse("org-1");
    await expect(scheduled[0]()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("live updates owed (two-way phase 4)", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  /* first: the module registry keeps a module once any test loads it */
  it("off or gone, the subscribing isn't even loaded", async () => {
    for (const hooks of [undefined, "gone", "0"]) {
      process.env.VERCEL_ENV = "production";
      if (hooks === undefined) delete process.env.SM8_WEBHOOKS;
      else process.env.SM8_WEBHOOKS = hooks;
      scheduled.length = 0;
      freshenSm8AfterResponse("org-1");
      await behind();
    }
    expect(hooksLoaded).toBe(false);
    expect(ensureSm8WebhooksIfOwed).not.toHaveBeenCalled();
    expect(drainLoaded).toBe(false);
    expect(drainSm8Hooks).not.toHaveBeenCalled();
  });

  it("with the switch on, an owed reconcile runs after the writes and before the sync, in 30 s less 2 for its last writes", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.SM8_WEBHOOKS = "1";
    freshenSm8AfterResponse("org-1");
    await behind();
    expect(order).toEqual(["writes", "drain", "ensure", "sync", "asks"]);
    expect(ensureSm8WebhooksIfOwed).toHaveBeenCalledWith("org-1", { budgetMs: 28_000 });
  });

  it("never when it would put the sync past its start", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.SM8_WEBHOOKS = "1";
    // the sync must start by 300 - 120 - 15 = 165 s; 140 s + 30 s is past it
    // (the backstop's 20 s still fit)
    writesTake = 140_000;
    freshenSm8AfterResponse("org-1");
    await behind();
    expect(order).toEqual(["writes", "drain", "sync", "asks"]);
  });

  /* PR D: the backstop drain, after the writes and before the reconcile
     and the sync: 20 s, never sleeping, bound by the page's function */
  it("with the switch on, the queue is drained for 20 s after the writes, without waiting for quiet", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.SM8_WEBHOOKS = "1";
    freshenSm8AfterResponse("org-1");
    await behind();
    expect(drainSm8Hooks).toHaveBeenCalledWith("org-1", {
      deadline: Date.parse("2026-09-25T00:00:00Z") + 280_000,
      maxMs: 20_000,
      wait: false,
    });
    expect(order.indexOf("drain")).toBe(order.indexOf("writes") + 1);
  });

  it("never drains when 20 s would put the sync past its start", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.SM8_WEBHOOKS = "1";
    writesTake = 145_000; // 145 + 20 = 165: the last moment
    freshenSm8AfterResponse("org-1");
    await behind();
    expect(order).toEqual(["writes", "drain", "sync", "asks"]);
    order.length = 0;
    scheduled.length = 0;
    clock = Date.parse("2026-09-25T00:00:00Z");
    writesTake = 145_001;
    freshenSm8AfterResponse("org-1");
    await behind();
    expect(order).toEqual(["writes", "sync", "asks"]);
  });

  it("a drain's time comes off the reconcile's, never the sync's", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.SM8_WEBHOOKS = "1";
    writesTake = 120_000;
    drainTakes = 20_000; // 140 s in: 30 s more is past 165
    freshenSm8AfterResponse("org-1");
    await behind();
    expect(order).toEqual(["writes", "drain", "sync", "asks"]);
  });

  it("nor for a workspace that isn't connected", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.SM8_WEBHOOKS = "1";
    status = "needs_reauth";
    freshenSm8AfterResponse("org-1");
    await behind();
    expect(ensureSm8WebhooksIfOwed).not.toHaveBeenCalled();
    expect(drainSm8Hooks).not.toHaveBeenCalled();
  });
});
