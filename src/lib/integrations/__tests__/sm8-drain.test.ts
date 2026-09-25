/**
 * @jest-environment node
 */

/* Every press drains: one sender for the whole workspace, behind the answer,
   after any run of the press's own that is still going, and only while it
   fits in the press's function. */

const scheduled: (() => Promise<unknown>)[] = [];
jest.mock("next/server", () => ({ after: (fn: () => Promise<unknown>) => scheduled.push(fn) }));

let writing = true;
const runSm8Writes = jest.fn(async () => ({ done: 0, sent: 0, trial: 0, failed: 0, again: 0, lost: 0, stopped: null }));
jest.mock("../sm8-writes", () => ({
  runSm8Writes: (...a: unknown[]) => runSm8Writes(...(a as [])),
  sm8WritesEnabled: () => writing,
}));

import { DONE_PRESS_BUDGET_MS, drainSm8WritesAfterResponse, NOTE_PRESS_BUDGET_MS, settlePressedWrites } from "../sm8-drain";

let clock = Date.parse("2026-09-25T00:00:00Z");

beforeEach(() => {
  scheduled.length = 0;
  writing = true;
  runSm8Writes.mockClear();
  clock = Date.parse("2026-09-25T00:00:00Z");
  jest.spyOn(Date, "now").mockImplementation(() => clock);
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("drainSm8WritesAfterResponse", () => {
  it("schedules one sender for everything due in the workspace — no ids", async () => {
    drainSm8WritesAfterResponse("org-1");
    expect(runSm8Writes).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect(runSm8Writes).toHaveBeenCalledTimes(1);
    expect(runSm8Writes).toHaveBeenCalledWith("org-1", "send", { budgetMs: 90_000 });
  });

  const RAN = { stopped: null };

  it("waits for a run of the press's own that is still going, then drains", async () => {
    let finish: (r: { stopped: string | null }) => void = () => {};
    const still = new Promise<{ stopped: string | null }>((resolve) => (finish = resolve));
    drainSm8WritesAfterResponse("org-1", { behind: still });
    const draining = scheduled[0]();
    await Promise.resolve();
    expect(runSm8Writes).not.toHaveBeenCalled();
    finish(RAN);
    await draining;
    expect(runSm8Writes).toHaveBeenCalledTimes(1);
  });

  it("doesn't drain behind a run that stopped for the account's reasons — ServiceM8 unreachable holds nothing back", async () => {
    /* an unreachable ServiceM8 leaves the queue's other files due at once:
       a drain now would upload the next one into the same outage */
    drainSm8WritesAfterResponse("org-1", {
      behind: Promise.resolve({ stopped: "ServiceM8 couldn't be reached. Trying again shortly." }),
    });
    await scheduled[0]();
    expect(runSm8Writes).not.toHaveBeenCalled();
  });

  it("drains after a run that failed, too", async () => {
    drainSm8WritesAfterResponse("org-1", { behind: Promise.reject(new Error("boom")) });
    await scheduled[0]();
    expect(runSm8Writes).toHaveBeenCalledTimes(1);
  });

  it("gives the drain only what the press's function has left, counted from the press", async () => {
    const startedAt = clock;
    drainSm8WritesAfterResponse("org-1", { startedAt });
    clock += 150_000; // 300 s less a lease (120 s) and a margin (15 s) leaves 15 s
    await scheduled[0]();
    expect(runSm8Writes).toHaveBeenCalledWith("org-1", "send", { budgetMs: 15_000 });
  });

  it("drains nothing once the function has no time for a send", async () => {
    drainSm8WritesAfterResponse("org-1", { startedAt: clock });
    clock += 170_000;
    await scheduled[0]();
    expect(runSm8Writes).not.toHaveBeenCalled();
  });

  it("schedules nothing on a deployment that doesn't write", () => {
    writing = false;
    drainSm8WritesAfterResponse("org-1");
    expect(scheduled).toHaveLength(0);
  });

  it("never lets a failed drain escape", async () => {
    runSm8Writes.mockRejectedValueOnce(new Error("boom"));
    drainSm8WritesAfterResponse("org-1");
    await expect(scheduled[0]()).resolves.toBeUndefined();
  });
});

/* A NOTE PRESS (two-way phase 2): its own rows in the foreground for a few
   seconds, then the drain — the pattern Send to ServiceM8 already follows. */
describe("settlePressedWrites", () => {
  it("sends the press's own rows within its budget, then drains the rest", async () => {
    await settlePressedWrites("org-1", ["w1"], { startedAt: clock, budgetMs: NOTE_PRESS_BUDGET_MS });
    expect(runSm8Writes).toHaveBeenCalledWith("org-1", "send", { ids: ["w1"], budgetMs: 8_000 });
    expect(scheduled).toHaveLength(1);
    expect(DONE_PRESS_BUDGET_MS).toBe(3_000);
  });

  it("doesn't drain after a run that stopped for the account's reasons", async () => {
    runSm8Writes.mockResolvedValueOnce({ done: 1, sent: 0, trial: 0, failed: 0, again: 0, lost: 0, stopped: "ServiceM8 couldn't be reached." } as never);
    await settlePressedWrites("org-1", ["w1"], { startedAt: clock, budgetMs: NOTE_PRESS_BUDGET_MS });
    expect(scheduled).toHaveLength(0);
  });

  it("with nothing of its own queued, only drains", async () => {
    await settlePressedWrites("org-1", [], { startedAt: clock, budgetMs: NOTE_PRESS_BUDGET_MS });
    expect(runSm8Writes).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
  });
});
