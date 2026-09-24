/**
 * @jest-environment node
 *
 * The nightly sweep. Only a call that passes CRON_SECRET does anything, and
 * a refused one writes nothing — not even the trace. Writes go first, on one
 * budget for the whole night, so the syncs after them still fit the window;
 * a write run's budget only stops it CLAIMING, and a send claimed at the
 * last moment can hold its row for a whole lease. Vercel's own scheduled
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
  orgsWithDueSm8Writes: jest.fn(async () => ["a", "b", "c", "d"]),
  runSm8Writes: jest.fn(async (org: string, _trigger: string, opts: { budgetMs?: number }) => {
    events.push(`writes:${org}`);
    budgets.push(opts.budgetMs);
    clock += takes.shift() ?? 0;
    return { done: 1, sent: 1, trial: 0, failed: 0, again: 0, lost: 0, stopped: null };
  }),
}));

import { GET, maxDuration } from "../sm8-sync/route";
import { WRITE_LEASE_MS } from "@/lib/integrations/sm8-write-plan";

const { recordSm8CronVisit, runSm8Sync } = jest.requireMock("@/lib/integrations/sm8-sync") as {
  recordSm8CronVisit: jest.Mock;
  runSm8Sync: jest.Mock;
};
const { runSm8Writes } = jest.requireMock("@/lib/integrations/sm8-writes") as { runSm8Writes: jest.Mock };

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
    expect(events.filter((e) => !e.startsWith("writes:"))).toEqual(["visit:s1", "sync:s1", "visit:s2", "sync:s2"]);
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
  it("gives each workspace 30 s of claiming while the night's minute has room", async () => {
    takes = [1_000, 1_000, 1_000, 1_000];
    const body = await (await GET(byScheduler())).json();
    expect(budgets).toEqual([30_000, 30_000, 30_000, 30_000]);
    expect(body.writes).toMatchObject({ orgs: 4, sent: 4, deferred: 0 });
  });

  it("shares one minute across every workspace, and claims nothing past it", async () => {
    // the first takes its whole 30 s, the second 25 of its 30
    takes = [30_000, 25_000, 5_000];
    const body = await (await GET(byScheduler())).json();
    expect(budgets).toEqual([30_000, 30_000, 5_000]);
    expect(body.writes).toMatchObject({ orgs: 4, sent: 3, deferred: 1 });
  });

  it("a send claimed at the end of the writes' minute still ends before any sync could be cut off", () => {
    // claims stop 60 s in; one held a whole lease ends by 180 s, inside the 300 s function
    expect(60_000 + WRITE_LEASE_MS).toBeLessThan(maxDuration * 1000);
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
