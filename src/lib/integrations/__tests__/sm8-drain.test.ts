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

import { drainSm8WritesAfterResponse } from "../sm8-drain";

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

  it("waits for a run of the press's own that is still going, then drains", async () => {
    let finish: () => void = () => {};
    const still = new Promise<void>((resolve) => (finish = resolve));
    drainSm8WritesAfterResponse("org-1", { behind: still });
    const draining = scheduled[0]();
    await Promise.resolve();
    expect(runSm8Writes).not.toHaveBeenCalled();
    finish();
    await draining;
    expect(runSm8Writes).toHaveBeenCalledTimes(1);
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
