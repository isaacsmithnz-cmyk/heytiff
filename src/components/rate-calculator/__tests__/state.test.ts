import { daysSinceReviewed, emptyState, hydrateState, runEngine } from "../state";
import { buildDemoState } from "../demo-data";

describe("emptyState", () => {
  it("is not ready and reports what is missing", () => {
    const run = runEngine(emptyState());
    expect(run.ready).toBe(false);
    expect(run.missing).toContain("at least one month of wages");
    expect(run.health).toEqual({ status: "Setup Incomplete", type: "neutral" });
  });

  it("does not mark Business complete on admin labour alone", () => {
    const s = emptyState();
    s.simpleLabour = { ...s.simpleLabour, months: [10000, 10000, 10000] };
    const run = runEngine(s);
    expect(run.steps.business.completion).toBe("not_started");
  });
});

describe("demo state", () => {
  it("is ready and lands Underpriced against demo current rates", () => {
    const run = runEngine(buildDemoState());
    expect(run.ready).toBe(true);
    expect(run.missing).toEqual([]);
    expect(run.health.status).toBe("Underpriced");
    expect(run.uplift).toBeGreaterThan(0);
  });

  it("is deep-cloned — mutating one build never affects the next", () => {
    const a = buildDemoState();
    a.staff[0].hourly_wage = 999;
    a.timesheets[10].push({ week_ending_date: "X", standard_hours: 1 });
    const b = buildDemoState();
    expect(b.staff[0].hourly_wage).not.toBe(999);
    expect(b.timesheets[10].some(t => t.week_ending_date === "X")).toBe(false);
  });
});

describe("vehicles no longer auto-complete on an empty fleet", () => {
  it("empty state leaves Vehicles not_started", () => {
    expect(runEngine(emptyState()).steps.vehicles.completion).toBe("not_started");
  });
  it("confirming No vehicles marks it complete", () => {
    const run = runEngine({ ...emptyState(), noVehicles: true });
    expect(run.steps.vehicles.completion).toBe("complete");
  });
  it("entering fleet running costs marks it complete", () => {
    const s = emptyState();
    s.simpleVehicle = { months: [1200, 1100, 1300] };
    expect(runEngine(s).steps.vehicles.completion).toBe("complete");
  });
  it("demo (a costed fleet) stays complete", () => {
    expect(runEngine(buildDemoState()).steps.vehicles.completion).toBe("complete");
  });
});

describe("hydrateState", () => {
  it("returns defaults for null / garbage input", () => {
    expect(hydrateState(null)).toEqual(emptyState());
    expect(hydrateState("nope")).toEqual(emptyState());
    expect(hydrateState(42)).toEqual(emptyState());
  });

  it("merges partial rows over defaults", () => {
    const s = hydrateState({ businessName: "Acme Air", currentRates: { install: 120 } });
    expect(s.businessName).toBe("Acme Air");
    expect(s.currentRates).toEqual({ install: 120, service: null });
    expect(s.mode).toEqual({ staff: "Simple", business: "Simple", vehicles: "Simple" });
    expect(s.settings.working_weeks).toBe(48);
  });

  it("drops the legacy stored daysSince and keeps lastReviewed", () => {
    const s = hydrateState({ reviewState: { lastReviewed: "2026-04-10", daysSince: 55 } });
    expect(s.reviewState).toEqual({ lastReviewed: "2026-04-10", message: null });
    expect("daysSince" in s.reviewState).toBe(false);
  });

  it("round-trips a full demo state through JSON", () => {
    const demo = buildDemoState();
    const s = hydrateState(JSON.parse(JSON.stringify(demo)));
    expect(runEngine(s).calc.recInst).toBeCloseTo(runEngine(demo).calc.recInst!, 8);
  });
});

describe("daysSinceReviewed", () => {
  const now = Date.parse("2026-07-16T00:00:00Z");
  it("derives whole days", () => {
    expect(daysSinceReviewed("2026-07-01T00:00:00Z", now)).toBe(15);
    expect(daysSinceReviewed("2026-07-16T00:00:00Z", now)).toBe(0);
  });
  it("clamps future timestamps to 0", () => {
    expect(daysSinceReviewed("2026-08-01T00:00:00Z", now)).toBe(0);
  });
  it("returns null for missing or invalid input", () => {
    expect(daysSinceReviewed(null, now)).toBeNull();
    expect(daysSinceReviewed(undefined, now)).toBeNull();
    expect(daysSinceReviewed("not-a-date", now)).toBeNull();
  });
});
