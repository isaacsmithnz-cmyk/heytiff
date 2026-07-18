/**
 * Rate Calculator — UI state shape, defaults, hydration and engine glue.
 * The engine (engine.ts) is the single source of truth for all numbers;
 * this module only assembles its input and interprets step readiness.
 */

import {
  calculate,
  DEFAULT_WORKING_WEEKS,
  healthStatus,
  stepStatus,
  type CalcResult,
  type CalcSettings,
  type BusinessCost,
  type EngineData,
  type HealthStatusResult,
  type Multipliers,
  type ProfitSettings,
  type RiskSettings,
  type SimpleBusinessData,
  type SimpleLabourData,
  type SimpleVehicleData,
  type StaffMember,
  type StepStatusMap,
  type TimesheetEntry,
  type VehicleRecord,
} from "./engine";

// ─── State shape ────────────────────────────────────────────────────────

export interface CurrentRatesState {
  install: number | null;
  service: number | null;
}

export interface ReviewState {
  lastReviewed: string | null; // ISO timestamp of the last "apply rates"
  message?: string | null;     // optional server-provided nudge copy
}

export interface EofyData {
  revenue: number | null;
  cost_of_sales: number | null;
  operating_profit: number | null;
  staff_costs: number | null;
  vehicle_costs: number | null;
  business_overheads: number | null;
  last_install_rate: number | null;
  last_service_rate: number | null;
}

export type EntryMode = "Simple" | "Detailed";

export interface ModeState {
  staff: EntryMode;
  business: EntryMode;
  vehicles: EntryMode;
}

export interface RateCalcState {
  businessName: string;
  staff: StaffMember[];
  timesheets: Record<string | number, TimesheetEntry[]>;
  vehicles: VehicleRecord[];
  businessCosts: BusinessCost[];
  currentRates: CurrentRatesState;
  reviewState: ReviewState;
  settings: CalcSettings;
  eofy: EofyData;
  risk: RiskSettings;
  profit: ProfitSettings;
  multipliers: Multipliers;
  simpleLabour: SimpleLabourData;
  simpleBusiness: SimpleBusinessData;
  simpleVehicle: SimpleVehicleData;
  mode: ModeState;
  /** Set when the user explicitly confirms they run no vehicles — the Vehicles
      step no longer auto-completes on an empty fleet, so this records the
      deliberate "no fleet" choice that lets the step count as done. */
  noVehicles: boolean;
  /** Risk & Profit ship with valid defaults, but the steps only count as
      complete once the user has explicitly accepted them (clicking Continue
      on the step, or customising a value). */
  riskAccepted: boolean;
  profitAccepted: boolean;
}

// ─── Defaults (real orgs — independent of the demo dataset) ─────────────

export const DEFAULT_SETTINGS: CalcSettings = {
  state: "NSW",
  super_pct: 12,
  workers_comp_pct: 2.0,
  payroll_tax_enabled: false,
  payroll_tax_threshold: 1_200_000,
  payroll_tax_rate: 5.45,
  payroll_tax_fy: "2026-27",
  working_weeks: DEFAULT_WORKING_WEEKS,
  working_hours: 8,
  annual_cost_increase_pct: 3,
  review_reminder_months: 6,
};

// Engine-canonical defaults (stepStatus reads risk as "customised" the
// moment any of these differ — the demo's callback:5 is deliberately custom).
export const DEFAULT_RISK: RiskSettings = { warranty: 3, defect: 2, callback: 4, diagnostic: 3 };
export const DEFAULT_PROFIT: ProfitSettings = { margin: 20, costIncrease: 3 };
export const DEFAULT_MULTIPLIERS: Multipliers = { afterHours: 1.5, emergency: 2.0 };

const EMPTY_EOFY: EofyData = {
  revenue: null, cost_of_sales: null, operating_profit: null,
  staff_costs: null, vehicle_costs: null, business_overheads: null,
  last_install_rate: null, last_service_rate: null,
};

export function emptyState(): RateCalcState {
  return {
    businessName: "",
    staff: [],
    timesheets: {},
    vehicles: [],
    businessCosts: [],
    currentRates: { install: null, service: null },
    reviewState: { lastReviewed: null },
    settings: { ...DEFAULT_SETTINGS },
    eofy: { ...EMPTY_EOFY },
    risk: { ...DEFAULT_RISK },
    profit: { ...DEFAULT_PROFIT },
    multipliers: { ...DEFAULT_MULTIPLIERS },
    simpleLabour: { months: [0, 0, 0], install_pct: 60, service_pct: 30, admin_pct: 10, staff_count: 1, billable_pct: 75 },
    simpleBusiness: { months: [0, 0, 0] },
    simpleVehicle: { months: [0, 0, 0] },
    mode: { staff: "Simple", business: "Simple", vehicles: "Simple" },
    noVehicles: false,
    riskAccepted: false,
    profitAccepted: false,
  };
}

/**
 * Merge a persisted (or unknown/legacy) row into a full state. Tolerates
 * missing fields, drops the legacy stored `reviewState.daysSince` (now
 * derived at render from lastReviewed), and never throws on bad input.
 */
export function hydrateState(raw: unknown): RateCalcState {
  const base = emptyState();
  if (raw == null || typeof raw !== "object") return base;
  const D = raw as Partial<RateCalcState> & { reviewState?: ReviewState & { daysSince?: unknown } };
  return {
    businessName: typeof D.businessName === "string" ? D.businessName : base.businessName,
    staff: Array.isArray(D.staff) ? D.staff.map(x => ({ ...x })) : base.staff,
    timesheets: D.timesheets && typeof D.timesheets === "object" ? D.timesheets : base.timesheets,
    vehicles: Array.isArray(D.vehicles) ? D.vehicles.map(v => ({ ...v, costs: { ...v.costs } })) : base.vehicles,
    businessCosts: Array.isArray(D.businessCosts) ? D.businessCosts.map(c => ({ ...c })) : base.businessCosts,
    currentRates: { ...base.currentRates, ...(D.currentRates ?? {}) },
    reviewState: {
      lastReviewed: D.reviewState?.lastReviewed ?? null,
      message: D.reviewState?.message ?? null,
    },
    settings: { ...base.settings, ...(D.settings ?? {}) },
    eofy: { ...base.eofy, ...(D.eofy ?? {}) },
    risk: { ...base.risk, ...(D.risk ?? {}) },
    profit: { ...base.profit, ...(D.profit ?? {}) },
    multipliers: { ...base.multipliers, ...(D.multipliers ?? {}) },
    simpleLabour: { ...base.simpleLabour, ...(D.simpleLabour ?? {}) },
    simpleBusiness: { ...base.simpleBusiness, ...(D.simpleBusiness ?? {}) },
    simpleVehicle: { ...base.simpleVehicle, ...(D.simpleVehicle ?? {}) },
    mode: { ...base.mode, ...(D.mode ?? {}) },
    noVehicles: D.noVehicles === true,
    riskAccepted: D.riskAccepted === true,
    profitAccepted: D.profitAccepted === true,
  };
}

/** Whether the fleet has real running-cost input (either mode). */
export function fleetCosted(s: RateCalcState): boolean {
  return s.mode.vehicles === "Simple"
    ? (s.simpleVehicle.months || []).some(m => m > 0)
    : s.vehicles.some(v => (v.simpleTotal ?? 0) > 0 || (v.costs?.fuel_per_week ?? 0) > 0);
}

/** Most timesheet history any one staff member has, in distinct weeks.
    Gates the Staff step's Detailed mode (~3 months = 12 weeks minimum). */
export function timesheetWeeks(s: RateCalcState): number {
  let max = 0;
  for (const p of s.staff) {
    const entries = s.timesheets[p.id] || [];
    const weeks = new Set<string>();
    for (const e of entries) weeks.add(e.week_ending_date || "_");
    if (weeks.size > max) max = weeks.size;
  }
  return max;
}

/** Whole days since the last rate review; null when never reviewed. */
export function daysSinceReviewed(lastReviewed: string | null | undefined, now = Date.now()): number | null {
  if (!lastReviewed) return null;
  const t = Date.parse(lastReviewed);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** A step counts as "done" when it's complete, customised, or running on
    explicitly-accepted defaults. */
export const DONE_COMPLETIONS = ["complete", "customised", "defaults"];

export function allStepsDone(steps: StepStatusMap): boolean {
  return [steps.staff, steps.business, steps.vehicles, steps.risk, steps.profit]
    .every(st => DONE_COMPLETIONS.includes(st.completion));
}

// ─── Engine glue ────────────────────────────────────────────────────────

export function buildEngineData(s: RateCalcState): EngineData {
  return {
    staff: s.staff,
    timesheets: s.timesheets,
    vehicles: s.vehicles,
    businessCosts: s.businessCosts,
    risk: s.risk,
    profit: s.profit,
    multipliers: s.multipliers,
    settings: s.settings,
    ...(s.mode.staff === "Simple" ? { simpleLabourData: s.simpleLabour } : {}),
    ...(s.mode.business === "Simple" ? { simpleBusinessData: s.simpleBusiness } : {}),
    ...(s.mode.vehicles === "Simple" ? { simpleVehicleData: s.simpleVehicle } : {}),
  };
}

export interface EngineRun {
  calc: CalcResult;
  health: HealthStatusResult;
  steps: StepStatusMap;
  uplift: number | null;
  ready: boolean;
  missing: string[];
}

export function runEngine(s: RateCalcState): EngineRun {
  const data = buildEngineData(s);
  const calc = calculate(data);
  const health = healthStatus(calc, s.currentRates);
  const steps = stepStatus(data, calc, {
    simpleLabourData: s.mode.staff === "Simple" ? s.simpleLabour : null,
    simpleBusinessData: s.mode.business === "Simple" ? s.simpleBusiness : null,
    fleetSimpleMonths: s.mode.vehicles === "Simple" ? (s.simpleVehicle.months || []) : [],
  });
  // Guard a stepStatus false-positive: the engine marks Business "complete"
  // whenever the overhead pool is non-empty — which admin labour alone can
  // cause. Only count it complete once the user actually entered overheads.
  const bizTouched = s.mode.business === "Simple"
    ? (s.simpleBusiness.months || []).some(m => m > 0)
    : (s.businessCosts || []).some(c => (c.amount || 0) > 0);
  if (!bizTouched && steps.business.completion === "complete") {
    steps.business = { ...steps.business, completion: "not_started" };
  }

  // Vehicles no longer auto-complete on an empty fleet. The engine marks the
  // step "complete" whenever there are no vehicle records; downgrade that to
  // "not_started" until the user either enters running costs or explicitly
  // confirms they run no vehicles (s.noVehicles).
  const hasFleet = fleetCosted(s);
  if (!hasFleet && !s.noVehicles && steps.vehicles.completion === "complete") {
    steps.vehicles = { ...steps.vehicles, completion: "not_started" };
  } else if (!hasFleet && s.noVehicles) {
    steps.vehicles = { ...steps.vehicles, completion: "complete" };
  }

  // Risk & Profit defaults are valid but must be explicitly accepted before
  // the step counts as done ("customised" passes through — editing a value
  // is acceptance in itself).
  if (steps.risk.completion === "defaults" && !s.riskAccepted) {
    steps.risk = { ...steps.risk, completion: "not_started" };
  }
  if (steps.profit.completion === "defaults" && !s.profitAccepted) {
    steps.profit = { ...steps.profit, completion: "not_started" };
  }

  // Readiness gate — no rate without genuine labour input.
  const missing: string[] = [];
  if (s.mode.staff === "Simple") {
    const months = (s.simpleLabour.months || []).filter(m => m > 0);
    const alloc = (s.simpleLabour.install_pct || 0) + (s.simpleLabour.service_pct || 0) + (s.simpleLabour.admin_pct || 0);
    if (months.length < 1) missing.push("at least one month of wages");
    if (alloc !== 100) missing.push("a work split that totals 100%");
  } else {
    if (!(calc.hasStaff && (calc.instLab + calc.svcLab) > 0)) missing.push("staff wages and allocations");
  }
  const ready = missing.length === 0 && calc.recInst != null;

  // Display-only: annual uplift if re-priced to recommended.
  let uplift: number | null = null;
  if (ready && calc.recInst != null && calc.recSvc != null &&
      s.currentRates.install != null && s.currentRates.service != null) {
    uplift = Math.max(0,
      (calc.recInst - s.currentRates.install) * calc.effInst +
      (calc.recSvc - s.currentRates.service) * calc.effSvc);
  }
  return { calc, health, steps, uplift, ready, missing };
}
