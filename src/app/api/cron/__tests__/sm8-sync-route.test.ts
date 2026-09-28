/**
 * @jest-environment node
 *
 * The nightly sweep. Only a call that passes CRON_SECRET does anything, and
 * a refused one writes nothing — not even the trace. Writes go first, on one
 * budget for the whole night, so the syncs after them still fit the window;
 * a write run's budget only stops it CLAIMING, and a send claimed at the
 * last moment can hold its row for a whole lease — so claiming stops a
 * lease before the first sync must start. Vercel's own scheduled
 * call is recorded against each workspace it syncs, before the sync, so the
 * owner's screen can say the overnight run came; a call made by hand is not.
 */

let authorised = true;
jest.mock("@/lib/integrations/cron-auth", () => ({ authorised: () => authorised }));

const events: string[] = [];
let clock = 0;
/** How long each sync takes, in turn. */
let syncTakes: number[] = [];
let syncAnswer: { ran: boolean } = { ran: true };
jest.mock("@/lib/integrations/sm8-sync", () => ({
  sweepableSm8Orgs: jest.fn(async () => ["s1", "s2"]),
  recordSm8CronVisit: jest.fn(async (org: string) => void events.push(`visit:${org}`)),
  runSm8Sync: jest.fn(async (org: string) => {
    events.push(`sync:${org}`);
    clock += syncTakes.shift() ?? 0;
    return { ...syncAnswer, note: "", pagesUsed: 1, rowsPulled: 0, complete: true };
  }),
}));

const budgets: (number | undefined)[] = [];
/** How long each workspace's write run takes, in turn. */
let takes: number[] = [];
jest.mock("@/lib/integrations/sm8-writes", () => ({
  /* a note's words leaving the queue (two-way phase 2) */
  clearSm8NoteText: jest.fn(async () => 2),
  clearDisconnectedSm8NoteText: jest.fn(async () => 1),
  orgsWithDueSm8Writes: jest.fn(async () => ["a", "b", "c", "d"]),
  runSm8Writes: jest.fn(async (org: string, _trigger: string, opts: { budgetMs?: number }) => {
    events.push(`writes:${org}`);
    budgets.push(opts.budgetMs);
    clock += takes.shift() ?? 0;
    return { done: 1, sent: 1, trial: 0, failed: 0, again: 0, lost: 0, stopped: null };
  }),
}));

/* The asks (H18): each workspace's settle, after every sync. */
const settled: { org: string; budgetMs: number }[] = [];
let settleTakes: number[] = [];
jest.mock("@/lib/dashboard/mention-settle", () => ({
  settleMentionAsks: jest.fn(async (org: string, opts: { budgetMs: number }) => {
    events.push(`asks:${org}`);
    settled.push({ org, budgetMs: opts.budgetMs });
    clock += settleTakes.shift() ?? 0;
    return { reads: 2, tasks: 1, moved: 0, done: 0, failed: 0, skipped: null };
  }),
}));

/* The file cache's 30-day cap (lib/integrations/sm8-file-cache, tested there). */
const evictBudgets: (number | undefined)[] = [];
jest.mock("@/lib/integrations/sm8-file-cache", () => ({
  EVICT_BUDGET_MS: 20_000,
  evictStaleSm8Files: jest.fn(async (_now: number, opts: { budgetMs?: number } = {}) => {
    events.push("evict");
    evictBudgets.push(opts.budgetMs);
    return { evicted: 3, bytes: 3 * 1_048_576, starred: 1, failed: 0, capped: false, skipped: false };
  }),
}));

/* Live updates' nightly reconcile (two-way phase 4): loaded only with
   SM8_WEBHOOKS on, so its factory running is itself the proof. */
let hooksLoaded = false;
const ensured: { org: string; budgetMs: number }[] = [];
let ensureTakes: number[] = [];
jest.mock("@/lib/integrations/sm8-hooks", () => {
  hooksLoaded = true;
  return {
    ensureSm8Webhooks: jest.fn(async (org: string, opts: { budgetMs: number }) => {
      events.push(`ensure:${org}`);
      ensured.push({ org, budgetMs: opts.budgetMs });
      clock += ensureTakes.shift() ?? 0;
      return { ran: true, rotated: false, posted: 0, deleted: 0, subscribed: true, stopped: null };
    }),
    dropExpiredSm8Hooks: jest.fn(async () => {
      events.push("expire");
      return 1;
    }),
  };
});

import { GET, maxDuration } from "../sm8-sync/route";
import { WRITE_LEASE_MS } from "@/lib/integrations/sm8-write-plan";

const { recordSm8CronVisit, runSm8Sync } = jest.requireMock("@/lib/integrations/sm8-sync") as {
  recordSm8CronVisit: jest.Mock;
  runSm8Sync: jest.Mock;
};
const { runSm8Writes } = jest.requireMock("@/lib/integrations/sm8-writes") as { runSm8Writes: jest.Mock };
const { settleMentionAsks } = jest.requireMock("@/lib/dashboard/mention-settle") as { settleMentionAsks: jest.Mock };

beforeEach(() => {
  authorised = true;
  clock = Date.parse("2026-09-25T20:00:00Z");
  budgets.length = 0;
  events.length = 0;
  takes = [];
  syncTakes = [];
  syncAnswer = { ran: true };
  recordSm8CronVisit.mockClear();
  runSm8Sync.mockClear();
  runSm8Writes.mockClear();
  settleMentionAsks.mockClear();
  settled.length = 0;
  settleTakes = [];
  evictBudgets.length = 0;
  jest.spyOn(Date, "now").mockImplementation(() => clock);
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

/** Vercel's scheduler marks its calls with x-vercel-cron-schedule. */
const byScheduler = () =>
  new Request("https://app.test/api/cron/sm8-sync", {
    headers: { authorization: "Bearer s", "x-vercel-cron-schedule": "0 20 * * *" },
  });
const byHand = () => new Request("https://app.test/api/cron/sm8-sync", { headers: { authorization: "Bearer s" } });

describe("a call that doesn't pass CRON_SECRET", () => {
  it("does nothing and records nothing — and says so in the log when it was Vercel's", async () => {
    authorised = false;
    const res = await GET(byScheduler());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authorised." });
    expect(events).toEqual([]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect((console.warn as jest.Mock).mock.calls[0][0]).toMatch(/CRON_SECRET is unset or different/);
  });

  it("from anyone else, refuses without a word in the log", async () => {
    authorised = false;
    expect((await GET(byHand())).status).toBe(401);
    expect(console.warn).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

describe("the night's order", () => {
  it("sends what is waiting before any workspace syncs", async () => {
    await GET(byScheduler());
    const firstSync = events.findIndex((e) => e.startsWith("sync:"));
    const lastWrite = events.map((e) => e.startsWith("writes:")).lastIndexOf(true);
    expect(lastWrite).toBeLessThan(firstSync);
  });

  it("records Vercel's visit against each workspace before its sync", async () => {
    await GET(byScheduler());
    expect(events.filter((e) => /^(visit|sync):/.test(e))).toEqual(["visit:s1", "sync:s1", "visit:s2", "sync:s2"]);
  });

  it("counts the visit even when another sync held the lease", async () => {
    syncAnswer = { ran: false };
    const body = await (await GET(byScheduler())).json();
    expect(body.busy).toBe(2);
    expect(recordSm8CronVisit).toHaveBeenCalledTimes(2);
  });

  it("a call made by hand runs, and records nothing", async () => {
    await GET(byHand());
    expect(runSm8Sync).toHaveBeenCalledTimes(2);
    expect(recordSm8CronVisit).not.toHaveBeenCalled();
  });
});

describe("the writes' one budget", () => {
  it("gives each workspace 30 s of claiming while the night's budget has room", async () => {
    takes = [1_000, 1_000, 1_000, 1_000];
    const body = await (await GET(byScheduler())).json();
    expect(budgets).toEqual([30_000, 30_000, 30_000, 30_000]);
    expect(body.writes).toMatchObject({ orgs: 4, sent: 4, deferred: 0 });
  });

  it("shares 45 s across every workspace, and claims nothing past it", async () => {
    // the first takes 20 of its 30 s, the second 20 of its 25, the third has 5 left
    takes = [20_000, 20_000, 5_000];
    const body = await (await GET(byScheduler())).json();
    expect(budgets).toEqual([30_000, 25_000, 5_000]);
    expect(body.writes).toMatchObject({ orgs: 4, sent: 3, deferred: 1 });
  });

  it("a send claimed at the last moment, held for a whole lease, still lets the first sync start and record the visit", async () => {
    // the first workspace's writes take 44 s; the second is given the last
    // second, claims in it, and its send holds its row for the whole lease
    takes = [44_000, WRITE_LEASE_MS];
    const body = await (await GET(byScheduler())).json();
    expect(budgets).toEqual([30_000, 1_000]);
    expect(events.filter((e) => /^(visit|sync):/.test(e))).toEqual(["visit:s1", "sync:s1", "visit:s2", "sync:s2"]);
    expect(body).toMatchObject({ ran: 2, deferred: 0 });
    // ...and it all ends inside the function
    expect(clock - Date.parse("2026-09-25T20:00:00Z")).toBeLessThan(maxDuration * 1000);
  });
});

describe("the syncs fit the window", () => {
  it("starts no sync that couldn't finish its lease before the function ends, and says how many waited", async () => {
    // the writes ran long; the first sync starts at 150 s and takes 20 s
    takes = [150_000];
    syncTakes = [20_000];
    const body = await (await GET(byScheduler())).json();
    expect(events.filter((e) => e.startsWith("sync:"))).toEqual(["sync:s1"]);
    expect(body).toMatchObject({ ran: 1, deferred: 1 });
    // a workspace that waited records no visit: it wasn't synced
    expect(recordSm8CronVisit).toHaveBeenCalledTimes(1);
  });
});

/* A NOTE'S WORDS LEAVE THE QUEUE nightly (two-way phase 2) — only on a
   deployment that sends notes. Production sends files only, and there the
   night is exactly as it was. */
describe("note words", () => {
  const { clearSm8NoteText, clearDisconnectedSm8NoteText } = jest.requireMock("@/lib/integrations/sm8-writes") as {
    clearSm8NoteText: jest.Mock;
    clearDisconnectedSm8NoteText: jest.Mock;
  };
  afterEach(() => {
    delete process.env.SM8_WRITES;
  });

  it("(F) with SM8_WRITES=1: no clear runs, and the answer is word for word as before", async () => {
    process.env.SM8_WRITES = "1";
    clearSm8NoteText.mockClear();
    clearDisconnectedSm8NoteText.mockClear();
    const body = await (await GET(byScheduler())).json();
    expect(clearSm8NoteText).not.toHaveBeenCalled();
    expect(clearDisconnectedSm8NoteText).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty("notesCleared");
  });

  it("with notes allowed: the 30-day clear across workspaces, and every disconnected workspace's", async () => {
    process.env.SM8_WRITES = "attachment,note";
    clearSm8NoteText.mockClear();
    const body = await (await GET(byScheduler())).json();
    expect(clearSm8NoteText).toHaveBeenCalledWith({ olderThanDays: 30 }, expect.any(Number));
    expect(clearDisconnectedSm8NoteText).toHaveBeenCalled();
    expect(body.notesCleared).toBe(3);
  });
});

/* H18: a ServiceM8 ask of a person the new Home is on becomes one task. A
   sync is what brings an ask in, so the asks are read after every sync, in
   what is left of the night, and one workspace's reading never puts off
   another's sync. */
describe("the asks", () => {
  it("are read after every workspace has synced, each with what is left of the window", async () => {
    settleTakes = [10_000, 0];
    const body = await (await GET(byScheduler())).json();
    const lastSync = events.map((e) => e.startsWith("sync:")).lastIndexOf(true);
    expect(events.findIndex((e) => e.startsWith("asks:"))).toBeGreaterThan(lastSync);
    expect(settled.map((s) => s.org)).toEqual(["s1", "s2"]);
    // nothing else took time: 300 s less the 15 s margin, then 10 s fewer for the second
    expect(settled.map((s) => s.budgetMs)).toEqual([285_000, 275_000]);
    expect(body.asks).toEqual({ read: 4, tasks: 2, deferred: 0 });
  });

  it("are left for another night when the window is spent, and says how many waited", async () => {
    // the writes and the first sync used the whole window, margin and all
    takes = [44_000];
    syncTakes = [241_000];
    const body = await (await GET(byScheduler())).json();
    expect(settleMentionAsks).not.toHaveBeenCalled();
    expect(body.asks).toEqual({ read: 0, tasks: 0, deferred: 2 });
  });

  it("one workspace's failure doesn't stop the next one's", async () => {
    settleMentionAsks.mockRejectedValueOnce(new Error("boom"));
    const body = await (await GET(byScheduler())).json();
    expect(settleMentionAsks).toHaveBeenCalledTimes(2);
    expect(body.asks).toEqual({ read: 2, tasks: 1, deferred: 1 });
  });

  it("reads none on a call that doesn't pass CRON_SECRET", async () => {
    authorised = false;
    await GET(byScheduler());
    expect(settleMentionAsks).not.toHaveBeenCalled();
  });
});

describe("the file cache's 30-day cap", () => {
  it("runs once a night, after every sync and before the asks, and says what it took", async () => {
    const body = await (await GET(byScheduler())).json();
    expect(events.filter((e) => e === "evict")).toHaveLength(1);
    expect(events.indexOf("evict")).toBeGreaterThan(events.map((e) => e.startsWith("sync:")).lastIndexOf(true));
    expect(events.indexOf("evict")).toBeLessThan(events.findIndex((e) => e.startsWith("asks:")));
    expect(body.files).toEqual({ evicted: 3, mb: 3, starred: 1, failed: 0, capped: false, skipped: false });
  });

  it("takes at most its own budget, and never the asks' margin", async () => {
    await GET(byScheduler());
    expect(evictBudgets).toEqual([20_000]);

    /* the syncs left 25 s: the eviction may have 10 of them, the asks' 15 s margin kept */
    events.length = 0;
    evictBudgets.length = 0;
    clock = Date.parse("2026-09-25T20:00:00Z");
    syncTakes = [275_000];
    await GET(byScheduler());
    expect(evictBudgets).toEqual([10_000]);
  });

  it("waits for tomorrow when the syncs spent the window", async () => {
    syncTakes = [290_000];
    const body = await (await GET(byScheduler())).json();
    expect(events).not.toContain("evict");
    expect(body.files).toMatchObject({ evicted: 0, skipped: true });
  });

  it("evicts nothing on a call that doesn't pass CRON_SECRET", async () => {
    authorised = false;
    await GET(byScheduler());
    expect(events).not.toContain("evict");
  });
});

/* Two-way phase 4, PR B: a workspace whose lease is held no longer misses
   its night. Its sync asks for the lease and is tried again (12 × 2 s,
   never past the start-by); only what is still busy after that is busy. */
describe("a workspace whose lease is held", () => {
  const { SM8_SYNC_BUSY } = jest.requireActual("@/lib/integrations/sm8-lease") as { SM8_SYNC_BUSY: string };
  const busy = { ran: false, note: SM8_SYNC_BUSY, pagesUsed: 0, rowsPulled: 0, complete: false };

  beforeEach(() => jest.useFakeTimers({ doNotFake: ["Date"] }));
  afterEach(() => jest.useRealTimers());

  it("is tried again, and syncs once the lease is given back", async () => {
    runSm8Sync.mockResolvedValueOnce(busy);
    const pending = GET(byScheduler());
    await jest.advanceTimersByTimeAsync(2_000);
    const body = await (await pending).json();
    expect(runSm8Sync).toHaveBeenCalledTimes(3);
    expect(body).toMatchObject({ ran: 2, busy: 0 });
  });

  it("is busy only after its last try, and each sync may run until the function's own deadline", async () => {
    for (let i = 0; i < 24; i++) runSm8Sync.mockResolvedValueOnce(busy);
    const pending = GET(byScheduler());
    await jest.advanceTimersByTimeAsync(2 * 11 * 2_000);
    const body = await (await pending).json();
    expect(runSm8Sync).toHaveBeenCalledTimes(24);
    expect(body).toMatchObject({ ran: 0, busy: 2 });
    // 300 s less the 20 s margin, from the request's start
    expect(runSm8Sync.mock.calls[0][3]).toEqual({ deadline: Date.parse("2026-09-25T20:00:00Z") + 280_000 });
  });
});

describe("live updates' nightly reconcile (two-way phase 4)", () => {
  const env = { ...process.env };
  beforeEach(() => {
    ensured.length = 0;
    ensureTakes = [];
  });
  afterEach(() => {
    process.env = { ...env };
  });
  const on = () => {
    process.env.VERCEL_ENV = "production";
    process.env.SM8_WEBHOOKS = "1";
  };
  /** The first sync's start-by: 300 s less a sync lease (120 s) and the margin (15 s). */
  const START_BY = 165_000;

  /* first: the module registry keeps a module once any test loads it */
  it("off or gone: the night is as it was, nothing loaded, nothing added to the answer", async () => {
    for (const hooks of [undefined, "gone"]) {
      process.env.VERCEL_ENV = "production";
      if (hooks === undefined) delete process.env.SM8_WEBHOOKS;
      else process.env.SM8_WEBHOOKS = hooks;
      const body = await (await GET(byScheduler())).json();
      expect(body).not.toHaveProperty("hooks");
    }
    expect(hooksLoaded).toBe(false);
    expect(events.some((e) => e.startsWith("ensure"))).toBe(false);
  });

  it("on: one reconcile per swept workspace after the writes and before any sync, then the expired hooks go", async () => {
    on();
    const body = await (await GET(byScheduler())).json();
    const firstSync = events.findIndex((e) => e.startsWith("sync:"));
    const lastWrite = events.map((e) => e.startsWith("writes:")).lastIndexOf(true);
    expect(events.slice(lastWrite + 1, firstSync)).toEqual(["ensure:s1", "ensure:s2", "expire", "visit:s1"]);
    expect(body.hooks).toEqual({ ensured: 2, subscribed: 2, deferred: 0, failed: 0, expired: 1 });
  });

  it("on: the whole step has 30 s between its workspaces", async () => {
    on();
    ensureTakes = [12_000];
    await GET(byScheduler());
    expect(ensured).toEqual([
      { org: "s1", budgetMs: 30_000 },
      { org: "s2", budgetMs: 18_000 },
    ]);
  });

  it("on: never starts a workspace past the first sync's start-by less 30 s", async () => {
    on();
    const started = clock;
    // the writes run until exactly the last moment a reconcile may start
    takes = [START_BY - 30_000];
    ensureTakes = [1];
    const body = await (await GET(byScheduler())).json();
    expect(ensured).toEqual([{ org: "s1", budgetMs: 30_000 }]);
    expect(body.hooks).toMatchObject({ ensured: 1, deferred: 1 });
    // and past it, none
    ensured.length = 0;
    clock = started;
    takes = [START_BY - 30_000 + 1];
    const later = await (await GET(byScheduler())).json();
    expect(ensured).toEqual([]);
    expect(later.hooks).toMatchObject({ ensured: 0, deferred: 2 });
    // the syncs themselves are untouched by it
    expect(events.filter((e) => e.startsWith("sync:")).length).toBeGreaterThan(0);
  });
});
