/**
 * @jest-environment node
 */

/* The account's call counter: the numbers that keep HeyTiff under
   ServiceM8's limits, and what the caller does with the database's answer.
   The SQL that carries the numbers out is exercised for real by
   docs/migrations/sm8_calls_echo_freshness.test.sql, in a rolled-back
   transaction; here it is a fake, and what is pinned is what goes in and
   what comes out. */

const rpc = jest.fn();
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { noteSm8Throttle, sm8LimitOf, SM8_METER, takeSm8Call } from "../sm8-meter";
import { DAILY_CALL_BUDGET } from "../sm8-sync-plan";
import {
  WRITE_LEASE_MARGIN_MS,
  WRITE_LEASE_MS,
  WRITE_READ_TIMEOUT_MS,
  WRITE_SEND_BY_MS,
  WRITE_TIMEOUT_MS,
} from "../sm8-write-plan";

beforeEach(() => {
  rpc.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("the numbers", () => {
  it("never let more than 150 calls through in any minute — ServiceM8 allows 180", () => {
    expect(SM8_METER.burst + SM8_METER.perSecond * 60).toBeLessThanOrEqual(150);
  });

  it("leave the most room behind for the sync, then reads, and none for a person's send", () => {
    const { floor, burst } = SM8_METER;
    expect(floor.write).toBe(0);
    expect(floor.sync).toBeGreaterThan(floor.read);
    expect(floor.read).toBeGreaterThan(floor.write);
    for (const f of Object.values(floor)) expect(f).toBeLessThan(burst);
  });

  it("stop the sync first each day, then reads, then writes, all under ServiceM8's 20,000", () => {
    const { dayCap } = SM8_METER;
    expect(dayCap.sync).toBeLessThan(dayCap.read);
    expect(dayCap.read).toBeLessThan(dayCap.write);
    expect(dayCap.write).toBeLessThanOrEqual(18_000);
    // the sync's own per-workspace budget still binds first
    expect(DAILY_CALL_BUDGET).toBeLessThanOrEqual(dayCap.sync);
  });

  it("never sleep under a write's claim: an upload started at the last moment, and its read-back, still end inside the lease with the whole margin", () => {
    /* the upload and a read-back after a 409 each take a turn on lane
       `write` after WRITE_SEND_BY_MS; a sleep before either would come out
       of the margin, which is for the database and the clocks */
    expect(SM8_METER.maxWaitMs.write).toBe(0);
    expect(
      WRITE_SEND_BY_MS + 2 * SM8_METER.maxWaitMs.write + WRITE_TIMEOUT_MS + WRITE_READ_TIMEOUT_MS + WRITE_LEASE_MARGIN_MS
    ).toBeLessThanOrEqual(WRITE_LEASE_MS);
  });

  it("wait a minute after a per-minute 429, and an hour after a daily one", () => {
    expect(SM8_METER.cooldownMs).toEqual({ minute: 60_000, day: 3_600_000 });
  });
});

describe("taking a turn", () => {
  it("passes the lane's floor and daily cap to the counter", async () => {
    rpc.mockResolvedValue({ data: [{ ok: true, wait_ms: 0, why: null }], error: null });
    expect(await takeSm8Call("v-1", "sync")).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("sm8_take_call", {
      p_meter: "v-1",
      p_n: 1,
      p_burst: 20,
      p_per_second: 2,
      p_floor: 10,
      p_day_cap: 12_000,
    });
    await takeSm8Call("v-1", "write");
    expect(rpc).toHaveBeenLastCalledWith("sm8_take_call", expect.objectContaining({ p_floor: 0, p_day_cap: 18_000 }));
    await takeSm8Call("v-1", "read");
    expect(rpc).toHaveBeenLastCalledWith("sm8_take_call", expect.objectContaining({ p_floor: 4, p_day_cap: 16_000 }));
  });

  it("hands a refusal back with its wait and its reason", async () => {
    rpc.mockResolvedValue({ data: [{ ok: false, wait_ms: 1_250, why: "minute" }], error: null });
    expect(await takeSm8Call("v-1", "read")).toEqual({ ok: false, waitMs: 1_250, why: "minute" });
    rpc.mockResolvedValue({ data: [{ ok: false, wait_ms: 3_000_000, why: "cooldown_day" }], error: null });
    expect(await takeSm8Call("v-1", "write")).toEqual({ ok: false, waitMs: 3_000_000, why: "cooldown_day" });
  });

  it("hands back a daily refusal with the wait left to UTC midnight", async () => {
    rpc.mockResolvedValue({ data: [{ ok: false, wait_ms: 20 * 3_600_000, why: "day" }], error: null });
    expect(await takeSm8Call("v-1", "sync")).toEqual({ ok: false, waitMs: 20 * 3_600_000, why: "day" });
  });

  it("reads a single row as well as the array a RETURNS TABLE comes back as", async () => {
    rpc.mockResolvedValue({ data: { ok: false, wait_ms: 500, why: "minute" }, error: null });
    expect(await takeSm8Call("v-1", "sync")).toEqual({ ok: false, waitMs: 500, why: "minute" });
  });
});

describe("a counter that can't be asked", () => {
  it("lets the call through, and says so once per worker", async () => {
    await jest.isolateModulesAsync(async () => {
      const { takeSm8Call: take } = await import("../sm8-meter");
      rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "no function" } });
      expect(await take("v-1", "sync")).toEqual({ ok: true });
      rpc.mockRejectedValue(new Error("fetch failed"));
      expect(await take("v-1", "write")).toEqual({ ok: true });
      rpc.mockResolvedValue({ data: [], error: null });
      expect(await take("v-1", "read")).toEqual({ ok: true });
      expect(console.error).toHaveBeenCalledTimes(1);
      expect((console.error as jest.Mock).mock.calls[0][0]).toContain("call meter unavailable (PGRST202)");
    });
  });
});

/* The SQL is exercised by a script, not by these tests. A counter that
   answered — but wrongly — would hold every call to ServiceM8 without an
   error to show for it, so an answer it can't have meant is let through,
   like a counter that can't be asked, and said once in the log. */
describe("a counter that answers what it can't mean", () => {
  it("lets the call through when a wait is longer than its reason allows", async () => {
    await jest.isolateModulesAsync(async () => {
      const { takeSm8Call: take } = await import("../sm8-meter");
      // the bucket refills 2 a second: no per-minute wait is an hour
      rpc.mockResolvedValue({ data: [{ ok: false, wait_ms: 3_600_000, why: "minute" }], error: null });
      expect(await take("v-1", "sync")).toEqual({ ok: true });
      // a cooldown is a minute, or an hour for the day
      rpc.mockResolvedValue({ data: [{ ok: false, wait_ms: 600_000, why: "cooldown_minute" }], error: null });
      expect(await take("v-1", "read")).toEqual({ ok: true });
      rpc.mockResolvedValue({ data: [{ ok: false, wait_ms: 5 * 3_600_000, why: "cooldown_day" }], error: null });
      expect(await take("v-1", "write")).toEqual({ ok: true });
      // the day's cap waits until UTC midnight, never longer than a day
      rpc.mockResolvedValue({ data: [{ ok: false, wait_ms: 30 * 3_600_000, why: "day" }], error: null });
      expect(await take("v-1", "sync")).toEqual({ ok: true });
      // a reason it never gives
      rpc.mockResolvedValue({ data: [{ ok: false, wait_ms: 500, why: null }], error: null });
      expect(await take("v-1", "sync")).toEqual({ ok: true });
      expect(console.error).toHaveBeenCalledTimes(1);
      expect((console.error as jest.Mock).mock.calls[0][0]).toContain("call meter answered what it can't mean");
    });
  });

  it("still refuses the longest wait each reason can honestly carry", async () => {
    // the sync's floor is 10: from an empty bucket, 11 tokens at 2 a second
    rpc.mockResolvedValue({ data: [{ ok: false, wait_ms: 5_500, why: "minute" }], error: null });
    expect(await takeSm8Call("v-1", "sync")).toEqual({ ok: false, waitMs: 5_500, why: "minute" });
    rpc.mockResolvedValue({ data: [{ ok: false, wait_ms: 60_000, why: "cooldown_minute" }], error: null });
    expect(await takeSm8Call("v-1", "read")).toEqual({ ok: false, waitMs: 60_000, why: "cooldown_minute" });
    rpc.mockResolvedValue({ data: [{ ok: false, wait_ms: 3_600_000, why: "cooldown_day" }], error: null });
    expect(await takeSm8Call("v-1", "write")).toEqual({ ok: false, waitMs: 3_600_000, why: "cooldown_day" });
    rpc.mockResolvedValue({ data: [{ ok: false, wait_ms: 86_400_000, why: "day" }], error: null });
    expect(await takeSm8Call("v-1", "sync")).toEqual({ ok: false, waitMs: 86_400_000, why: "day" });
  });
});

describe("a 429, shared", () => {
  it("starts an hour's cooldown for the daily limit and a minute's for the other", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await noteSm8Throttle("v-1", "day");
    expect(rpc).toHaveBeenCalledWith("sm8_note_throttle", { p_meter: "v-1", p_kind: "day", p_cooldown_ms: 3_600_000 });
    await noteSm8Throttle("v-1", "minute");
    expect(rpc).toHaveBeenLastCalledWith("sm8_note_throttle", { p_meter: "v-1", p_kind: "minute", p_cooldown_ms: 60_000 });
  });

  it("never throws when the counter can't be written", async () => {
    rpc.mockRejectedValue(new Error("fetch failed"));
    await expect(noteSm8Throttle("v-1", "day")).resolves.toBeUndefined();
  });

  it("tells the daily limit from the minute's by ServiceM8's words, in plain text or JSON", () => {
    expect(sm8LimitOf("Number of allowed API requests per day exceeded")).toBe("day");
    expect(sm8LimitOf('{"errorCode":429,"message":"Number of allowed API requests per day exceeded"}')).toBe("day");
    expect(sm8LimitOf("Number of allowed API requests per minute exceeded")).toBe("minute");
    expect(sm8LimitOf("")).toBe("minute");
  });
});
