import { allStepsDone, daysSinceReviewed, emptyState, hydrateState, runEngine, timesheetWeeks } from "../state";
import { buildDemoState } from "../demo-data";
import { calculate, DEFAULT_WORKING_WEEKS } from "../engine";

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
    expect(s.settings.working_weeks).toBe(DEFAULT_WORKING_WEEKS);
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

describe("risk & profit require explicit acceptance", () => {
  it("defaults alone leave both steps not_started", () => {
    const run = runEngine(emptyState());
    expect(run.steps.risk.completion).toBe("not_started");
    expect(run.steps.profit.completion).toBe("not_started");
  });
  it("accepting flips them to defaults", () => {
    const run = runEngine({ ...emptyState(), riskAccepted: true, profitAccepted: true });
    expect(run.steps.risk.completion).toBe("defaults");
    expect(run.steps.profit.completion).toBe("defaults");
  });
  it("customising a value is acceptance in itself", () => {
    const s = emptyState();
    s.risk = { ...s.risk, warranty: 5 };
    s.profit = { ...s.profit, margin: 25 };
    const run = runEngine(s);
    expect(run.steps.risk.completion).toBe("customised");
    expect(run.steps.profit.completion).toBe("customised");
  });
  it("demo state passes allStepsDone; empty state does not", () => {
    expect(allStepsDone(runEngine(buildDemoState()).steps)).toBe(true);
    expect(allStepsDone(runEngine(emptyState()).steps)).toBe(false);
  });
  it("hydrate defaults the flags to false", () => {
    const s = hydrateState({ businessName: "Acme" });
    expect(s.riskAccepted).toBe(false);
    expect(s.profitAccepted).toBe(false);
  });
});

describe("timesheetWeeks", () => {
  it("is 0 with no staff or timesheets", () => {
    expect(timesheetWeeks(emptyState())).toBe(0);
  });
  it("counts distinct weeks for the demo roster (18)", () => {
    expect(timesheetWeeks(buildDemoState())).toBe(18);
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

// ─── Working-weeks default ──────────────────────────────────────────────
// The UI shipped 48 while the engine fell back to 44, so the two disagreed
// silently for anyone whose settings didn't carry the key. One constant now
// feeds both; this pins that they can't drift apart again.
describe("working weeks default", () => {
  it("is 46 — 52 less annual leave less public holidays", () => {
    expect(DEFAULT_WORKING_WEEKS).toBe(46);
    expect(emptyState().settings.working_weeks).toBe(DEFAULT_WORKING_WEEKS);
  });

  it("the engine's own fallback matches the shipped default", () => {
    // A casual exercises the paidWeeks path; totalAnnualPaid exercises the
    // billable-hours divisor — one fixture covers both engine fallbacks.
    const staff = [{
      id: "c1", name: "Cas", hourly_wage: 50, employment_type: "Casual",
      contracted_hours_per_week: 38, install_pct: 100, service_pct: 0, admin_pct: 0,
    }];
    const fallback = calculate({ staff, settings: {} });
    const explicit = calculate({ staff, settings: { working_weeks: DEFAULT_WORKING_WEEKS } });
    expect(fallback.totalAnnualPaid).toBe(explicit.totalAnnualPaid);
    expect(fallback.staffBreakdown[0].base).toBe(explicit.staffBreakdown[0].base);
  });
});
