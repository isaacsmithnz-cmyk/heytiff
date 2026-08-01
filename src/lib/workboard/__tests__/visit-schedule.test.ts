/* The visit maths, held still. The two ways this module could quietly ruin
   the radar: month-end drift (Jan 31 → Feb 28 → Mar 28, the iterate-from-
   previous bug the clamp-from-anchor rule exists to kill) and a prune rule
   loose enough to delete a visit somebody touched. */

import {
  addMonthsClamped,
  bucketFor,
  dueDatesFor,
  isPristineFuture,
  isReadinessKey,
  migrateLegacyReadiness,
  READINESS_KEYS,
  readinessCount,
  readReadiness,
} from "../visit-schedule";

describe("addMonthsClamped", () => {
  it("clamps to the target month's length, from the ANCHOR every time", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    // the drift test: +2 from the anchor is March THE 31ST, not March 28 —
    // which is exactly what iterating from February would have produced
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29"); // leap
    expect(addMonthsClamped("2026-11-30", 3)).toBe("2027-02-28"); // year roll + clamp
    expect(addMonthsClamped("2026-07-15", 12)).toBe("2027-07-15");
    expect(addMonthsClamped("2026-07-15", -1)).toBe("2026-06-15");
  });
});

describe("dueDatesFor", () => {
  it("covers the horizon on the cadence, plus exactly the most recent missed visit", () => {
    const due = dueDatesFor({
      anchorISO: "2026-01-15",
      intervalMonths: 3,
      fromISO: "2026-07-28",
    });
    // one interval of lookback holds exactly ONE past occurrence — the visit
    // this agreement already owes…
    expect(due).toContain("2026-07-15");
    // …then forward through the horizon
    expect(due).toContain("2026-10-15");
    expect(due).toContain("2027-07-15");
    // and NOT the deep past: an old anchor must not generate history
    expect(due).not.toContain("2026-04-15");
    expect(due).not.toContain("2026-01-15");
    expect(due).not.toContain("2027-10-15"); // beyond the horizon
  });

  it("caps at the contract end", () => {
    const due = dueDatesFor({
      anchorISO: "2026-01-01",
      intervalMonths: 3,
      fromISO: "2026-07-28",
      contractEndISO: "2026-12-31",
    });
    expect(due[due.length - 1]).toBe("2026-10-01");
  });

  it("a brand-new agreement's first visit is the anchor itself", () => {
    const due = dueDatesFor({
      anchorISO: "2026-08-01",
      intervalMonths: 6,
      fromISO: "2026-07-28",
    });
    expect(due[0]).toBe("2026-08-01");
  });

  it("refuses a nonsense interval instead of spinning", () => {
    expect(dueDatesFor({ anchorISO: "2026-01-01", intervalMonths: 0, fromISO: "2026-07-28" })).toEqual([]);
  });
});

describe("isPristineFuture — the only thing regeneration may delete", () => {
  const clean = {
    status: "upcoming",
    remoteId: null,
    jobNumber: null,
    readiness: {},
    notes: null,
    dueDate: "2026-09-15",
  };
  const today = "2026-07-28";

  it("a pure generated future row is prunable", () => {
    expect(isPristineFuture(clean, today)).toBe(true);
  });

  it("anything a human touched survives", () => {
    expect(isPristineFuture({ ...clean, status: "booked" }, today)).toBe(false);
    expect(isPristineFuture({ ...clean, jobNumber: "1042" }, today)).toBe(false);
    expect(isPristineFuture({ ...clean, remoteId: "j-1" }, today)).toBe(false);
    expect(isPristineFuture({ ...clean, notes: "gate code 4471" }, today)).toBe(false);
    expect(isPristineFuture({ ...clean, readiness: { access_confirmed: true } }, today)).toBe(false);
  });

  it("the new touch signals count as touches: placement, a tech, a packed item", () => {
    expect(isPristineFuture({ ...clean, bookedDate: "2026-09-15" }, today)).toBe(false);
    expect(isPristineFuture({ ...clean, techCount: 1 }, today)).toBe(false);
    expect(isPristineFuture({ ...clean, packedCount: 1 }, today)).toBe(false);
  });

  it("a LEGACY tick still counts as a touch — old confirmations are not clutter", () => {
    expect(isPristineFuture({ ...clean, readiness: { parts_ready: true } }, today)).toBe(false);
    expect(isPristineFuture({ ...clean, readiness: { customer_notified: true } }, today)).toBe(false);
    expect(isPristineFuture({ ...clean, readiness: { time_confirmed: true } }, today)).toBe(false);
    // …but a junk value under a legacy key is not a tick
    expect(isPristineFuture({ ...clean, readiness: { parts_ready: "yes" } }, today)).toBe(true);
  });

  it("the past is history, not clutter — never pruned", () => {
    expect(isPristineFuture({ ...clean, dueDate: "2026-07-01" }, today)).toBe(false);
    expect(isPristineFuture({ ...clean, dueDate: today }, today)).toBe(false);
  });
});

describe("buckets", () => {
  const today = "2026-07-28";

  it("overdue / due soon (≤14d) / upcoming, by date alone", () => {
    expect(bucketFor("2026-07-27", today)).toBe("overdue");
    expect(bucketFor("2026-07-28", today)).toBe("due_soon"); // today is not overdue yet
    expect(bucketFor("2026-08-11", today)).toBe("due_soon"); // day 14
    expect(bucketFor("2026-08-12", today)).toBe("upcoming"); // day 15
  });
});

describe("readiness — the two stored gates (D1)", () => {
  it("reads by whitelist — junk keys and junk values are ignored", () => {
    const r = readReadiness({
      access_confirmed: true,
      equipment_ready: "yes", // not boolean true → not ready
      __proto__: { equipment_ready: true },
      free_lunch: true,
    });
    expect(r.access_confirmed).toBe(true);
    expect(r.equipment_ready).toBe(false);
    expect(Object.keys(r).sort()).toEqual([...READINESS_KEYS].sort());
  });

  it("legacy keys are invisible to the new read — the migration is the bridge", () => {
    const r = readReadiness({ parts_ready: true, customer_notified: true, time_confirmed: true });
    expect(r.equipment_ready).toBe(false);
    expect(r.access_confirmed).toBe(false);
  });

  it("counts ready out of the fixed two", () => {
    expect(readinessCount({ access_confirmed: true })).toEqual({ ready: 1, total: 2 });
    expect(readinessCount(null)).toEqual({ ready: 0, total: 2 });
  });

  it("isReadinessKey is the whitelist, not a shape — retired keys are out", () => {
    expect(isReadinessKey("access_confirmed")).toBe(true);
    expect(isReadinessKey("equipment_ready")).toBe(true);
    expect(isReadinessKey("parts_ready")).toBe(false);
    expect(isReadinessKey("time_confirmed")).toBe(false);
    expect(isReadinessKey("customer_notified")).toBe(false);
    expect(isReadinessKey("vibes_confirmed")).toBe(false);
  });
});

describe("migrateLegacyReadiness — the D1 mapping, mirrored from the SQL", () => {
  it("parts becomes equipment; access OR customer-told becomes access", () => {
    expect(migrateLegacyReadiness({ parts_ready: true })).toEqual({
      equipment_ready: true,
      access_confirmed: false,
    });
    expect(migrateLegacyReadiness({ customer_notified: true })).toEqual({
      equipment_ready: false,
      access_confirmed: true,
    });
    expect(migrateLegacyReadiness({ access_confirmed: true })).toEqual({
      equipment_ready: false,
      access_confirmed: true,
    });
  });

  it("OR, not AND — half-done work is not un-confirmed", () => {
    expect(
      migrateLegacyReadiness({ access_confirmed: true, customer_notified: false })
    ).toEqual({ equipment_ready: false, access_confirmed: true });
  });

  it("time_confirmed maps to NOTHING — placement carries it now", () => {
    expect(migrateLegacyReadiness({ time_confirmed: true })).toEqual({
      equipment_ready: false,
      access_confirmed: false,
    });
  });

  it("already-migrated keys pass through; junk values never count", () => {
    expect(migrateLegacyReadiness({ equipment_ready: true })).toEqual({
      equipment_ready: true,
      access_confirmed: false,
    });
    expect(migrateLegacyReadiness({ parts_ready: "yes", customer_notified: 1 })).toEqual({
      equipment_ready: false,
      access_confirmed: false,
    });
    expect(migrateLegacyReadiness(null)).toEqual({
      equipment_ready: false,
      access_confirmed: false,
    });
  });
});
