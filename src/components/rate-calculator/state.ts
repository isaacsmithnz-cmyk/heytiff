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
import { annualFactor } from "@/lib/integrations/xero-pl";

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

export type CostsSource = "manual" | "xero";

/** A pull from a connected Xero organisation's profit & loss, frozen. */
export interface XeroCostSnapshot {
  /** ISO timestamp of the pull — the screen shows it, because a figure from
      three months ago should not look like today's. */
  fetchedAt: string;
  period: { from: string; to: string; label: string };
  tenantName: string;
  /** The overhead lines. `allocated_to` is editable here — how a cost splits
      between install and service is a judgement about the business, not
      something a chart of accounts knows. */
  lines: BusinessCost[];
  /** Lines deliberately left out (wages, super, vehicles — the calculator has
      those already) with the reason, so the double-count guard is visible and
      reversible rather than a silent filter. */
  excluded: { name: string; amount: number; reason: string }[];
  /** Kept lines worth a second look — depreciation that may already be in the
      Vehicles step, subcontract labour that is job cost rather than overhead.
      Flagged rather than dropped: they're real money either way. */
  notes: { name: string; amount: number; note: string }[];
  /** Which P&L sections were read — the mapper showing its working. */
  sections: string[];
  /** Active operating-expense accounts the report never mentioned, because they
      had no transactions in the window. Named so a wrong verdict on an account
      can be caught BEFORE the quarter it finally has a balance — which is how
      `Income Tax Expense` stayed invisible through a whole audit. */
  dormant: { name: string; code: string | null; verdict: string }[];
  /** Months of the window with actual activity, or null when it couldn't be
      established. Below 12 the window is a PART year, and reading its total as
      an annual figure under-states overheads — see `annualise`. */
  monthsCovered: number | null;
  /** Whether a part-year window is scaled up to a year. Stored rather than
      derived so the user's answer to "is this five months typical?" survives a
      reload — but never applied silently; the panel shows both figures. */
  annualise: boolean;
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
  /** Where business costs come from. "manual" is the Simple/Detailed entry
      this calculator has always had; "xero" reads them off a connected
      organisation's profit & loss.

      The two are kept SEPARATE rather than one overwriting the other, so
      switching either way is non-destructive: `businessCosts` stays exactly as
      the user left it while Xero is the source, and is still there when they
      switch back. */
  costsSource: CostsSource;
  /** Where the FLEET's running cost comes from. Separate from `costsSource`
      because the two steps are answered separately and one can be on Xero
      while the other is typed in — but they read the SAME snapshot, so
      switching this never costs another call.

      The invariant both sides depend on: a vehicle line is in the fleet total
      or in the overhead pool, never both and never neither. It holds by
      construction rather than by arithmetic — `snapshotVehicleTotal` sums the
      lines Xero's mapper held OUT of the pool, so the moment someone presses
      Include on the Business panel the line leaves that set and the fleet
      total drops by exactly what overheads gained. */
  vehicleSource: CostsSource;
  /** The last figures pulled from Xero, kept as a snapshot rather than a live
      read. Two reasons: the engine must keep producing rates when Xero is
      unreachable or disconnected, and a rate the business has quoted from
      shouldn't change under them because someone recoded an account. */
  xeroCosts: XeroCostSnapshot | null;
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

/** Overhead categories most HVAC businesses carry. The Detailed business table
    seeds from these (at $0) so it opens as a checklist to price rather than a
    blank slate, and offers any the user removed as one-tap chips. Order and
    names match the demo dataset so both speak the same vocabulary. */
export const SUGGESTED_BUSINESS_COSTS: readonly string[] = [
  "Public liability",
  "Software & subscriptions",
  "Phones & internet",
  "Accounting fees",
  "Marketing & website",
  "Rent & utilities",
  "Training & PPE",
];

export function suggestedBusinessCosts(): BusinessCost[] {
  return SUGGESTED_BUSINESS_COSTS.map(name => ({ name, amount: 0, allocated_to: "shared" }));
}

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
    costsSource: "manual",
    vehicleSource: "manual",
    xeroCosts: null,
    noVehicles: false,
    riskAccepted: false,
    profitAccepted: false,
  };
}

/** Cost lines a stored snapshot claims, defensively — it round-trips through
    jsonb, and a row written by an older shape must degrade to "no snapshot"
    rather than reaching the engine as junk. */
function hydrateSnapshot(raw: unknown): XeroCostSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<XeroCostSnapshot>;
  if (!Array.isArray(s.lines)) return null;
  const lines = s.lines
    .filter((l): l is BusinessCost => !!l && typeof l === "object" && typeof l.name === "string")
    .map(l => ({
      name: l.name,
      amount: typeof l.amount === "number" && Number.isFinite(l.amount) ? l.amount : 0,
      allocated_to: l.allocated_to || "shared",
    }));
  const p = s.period;
  const months = s.monthsCovered;
  return {
    fetchedAt: typeof s.fetchedAt === "string" ? s.fetchedAt : "",
    period: {
      from: typeof p?.from === "string" ? p.from : "",
      to: typeof p?.to === "string" ? p.to : "",
      label: typeof p?.label === "string" ? p.label : "",
    },
    tenantName: typeof s.tenantName === "string" ? s.tenantName : "",
    lines,
    excluded: Array.isArray(s.excluded) ? s.excluded.filter(e => !!e && typeof e === "object") : [],
    notes: Array.isArray(s.notes) ? s.notes.filter(n => !!n && typeof n === "object") : [],
    sections: Array.isArray(s.sections) ? s.sections.filter(x => typeof x === "string") : [],
    dormant: Array.isArray(s.dormant) ? s.dormant.filter(d => !!d && typeof d === "object") : [],
    /* A row written before coverage existed says nothing about how many months
       it covers, and "null" is exactly that — unknown, so nothing is scaled. */
    monthsCovered: typeof months === "number" && Number.isFinite(months) ? months : null,
    annualise: s.annualise !== false,
  };
}

/** The cost-source pair, resolved together because they constrain each other.

    A stored `"xero"` with no readable snapshot is normalised back to
    `"manual"` — otherwise the engine would run on an empty cost pool and
    quietly produce a rate with no overheads in it, which looks like a working
    answer and isn't. */
function hydrateCostsSource(
  D: Partial<RateCalcState>
): Pick<RateCalcState, "costsSource" | "xeroCosts" | "vehicleSource"> {
  const xeroCosts = hydrateSnapshot(D.xeroCosts);
  const wanted = D.costsSource === "xero" ? "xero" : "manual";
  /* Same normalisation for the fleet, and for the same reason: "xero" with
     nothing to read would price the fleet at zero and look like a finished
     step. Note it survives a snapshot whose vehicle lines are all included
     back into overheads — that is a legitimate state worth showing (fleet
     nil, everything in the pool), not a broken one. */
  const vWanted = D.vehicleSource === "xero" ? "xero" : "manual";
  return {
    costsSource: wanted === "xero" && xeroCosts ? "xero" : "manual",
    vehicleSource: vWanted === "xero" && xeroCosts ? "xero" : "manual",
    xeroCosts,
  };
}

/* ── snapshot arithmetic the screens share ── */

/** Whether Step 2 shows the manual/Xero source switch.

    The audit's trap: the switch used to render only while CONNECTED, but the
    Xero panel renders whenever the SOURCE is "xero" — so a disconnect left
    the calculator pricing from a frozen snapshot with the way back to manual
    hidden. The switch must show whenever there is a choice to make: a grant
    to switch onto, or a snapshot to walk away from. */
export function sourceSwitchVisible(connected: boolean, source: CostsSource): boolean {
  return connected || source === "xero";
}

/** What a snapshot's raw figures are multiplied by to reach a year.

    1 unless the window is a KNOWN part-year and the user has left scaling on.
    One implementation, because the pool the engine prices from, the total on
    the panel, the Simple seed and the EOFY seed must never disagree. */
export function snapshotFactor(snap: XeroCostSnapshot | null): number {
  if (!snap || !snap.annualise) return 1;
  return annualFactor(snap.monthsCovered);
}

/** The snapshot's included overheads, as a year. */
export function snapshotTotal(snap: XeroCostSnapshot | null): number {
  const f = snapshotFactor(snap);
  return (snap?.lines ?? []).reduce((a, l) => a + l.amount, 0) * f;
}

/** What the P&L says the fleet cost, as a year — the lines held out of the
    pool because the Vehicles step is meant to have them.

    Exported so the Vehicles step can offer them as a seed instead of the money
    simply vanishing between two steps that each assume the other has it. */
export function snapshotVehicleTotal(snap: XeroCostSnapshot | null): number {
  const f = snapshotFactor(snap);
  return (snap?.excluded ?? [])
    .filter(e => e.reason === "vehicle")
    .reduce((a, e) => a + e.amount, 0) * f;
}

/** Whole months since the snapshot was pulled; null when it can't say. */
export function snapshotAgeMonths(fetchedAt: string | undefined, now: number): number | null {
  if (!fetchedAt) return null;
  const at = Date.parse(fetchedAt);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((now - at) / 2_592_000_000)); // 30-day months
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
    /* All THREE keys must be named here: hydrateState is a whitelist merge,
       and a key it doesn't mention is dropped on the next save round-trip. */
    ...hydrateCostsSource(D),
    noVehicles: D.noVehicles === true,
    riskAccepted: D.riskAccepted === true,
    profitAccepted: D.profitAccepted === true,
  };
}

/** The fleet's annual running cost when Xero is its source, else null.

    Xero as the source bypasses the Simple/Detailed fork the same way it does
    for business costs — those are two ways of TYPING a fleet cost in, and this
    is a third source. The typed figures are left untouched underneath, so
    switching back is non-destructive. */
export function activeFleetAnnual(s: RateCalcState): number | null {
  if (s.vehicleSource !== "xero" || !s.xeroCosts) return null;
  const annual = snapshotVehicleTotal(s.xeroCosts);
  return annual > 0 ? annual : null;
}

/** The patch for putting business costs on Xero — which drags the fleet along
    unless the fleet has been costed by hand.

    THE STATE WORTH DESIGNING AGAINST is business-on-Xero with vehicles-on-
    manual, because both failure modes live there at once: the P&L's vehicle
    lines have left the overhead pool with nothing claiming them, and the
    per-vehicle editor is inviting insurance and depreciation that business
    costs already carry. Xero for both, and neither can happen.

    It defers to real work: a fleet somebody has already costed is left alone
    and warned about instead. Silently overriding entered figures to close a
    trap would be its own trap. */
export function costsToXeroPatch(s: RateCalcState): Partial<RateCalcState> {
  const takeFleetToo = !fleetCosted(s) && snapshotVehicleTotal(s.xeroCosts) > 0;
  return takeFleetToo
    ? { costsSource: "xero", vehicleSource: "xero" }
    : { costsSource: "xero" };
}

/** Business costs on Xero while the fleet is typed in — the one combination
    where a dollar can be doubled and another dropped in the same breath. */
export function fleetSourceMixed(s: RateCalcState): boolean {
  return s.costsSource === "xero" && !!s.xeroCosts && s.vehicleSource !== "xero";
}

/** Whether the fleet has real running-cost input, by whichever route.

    Drives the Vehicles step's completion, so Xero has to count: pulling real
    figures is as much a finished step as typing them in. Without this a
    Xero-sourced fleet would read "not started" forever and the rail would
    never say the calculator was ready. */
export function fleetCosted(s: RateCalcState): boolean {
  if (activeFleetAnnual(s) !== null) return true;
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

/** Which cost lines the engine actually runs on.

    Xero as the source bypasses the Simple/Detailed fork entirely — those are
    two ways of TYPING costs in, and this is a third source altogether. The
    manual list is left untouched underneath, which is what makes switching
    back non-destructive. */
export function activeBusinessCosts(s: RateCalcState): BusinessCost[] {
  if (!(s.costsSource === "xero" && s.xeroCosts)) return s.businessCosts;
  /* The engine wants a year. Scaling happens HERE rather than being baked into
     the stored line, so the panel can keep showing what Xero actually said
     beside what the rate is priced on — a figure the user can't reconcile
     against their own P&L is a figure they won't trust. */
  const f = snapshotFactor(s.xeroCosts);
  const lines = s.xeroCosts.lines;
  return f === 1 ? lines : lines.map(l => ({ ...l, amount: l.amount * f }));
}

/* Per-vehicle fields a Xero P&L has ALREADY paid for through business costs.

   `insurance` is the org's `Insurance` account; the replacement/resale pair is
   its `Depreciation`. Neither has the word "vehicle" in it, so neither leaves
   the overhead pool — which is correct, and which means typing the ute's share
   in here again charges it twice.

   `cycle_years` is deliberately NOT in this list: it still divides fit-out,
   which nothing else covers. `fuel_per_week`, `rego`, `servicing` and `tolls`
   are not either — those DID leave the pool as vehicle lines, so the per-vehicle
   editor is the only place they exist. */
export const XERO_COVERED_VEHICLE_FIELDS = ["insurance", "replacement_value", "resale_value"] as const;

/** The fleet as the ENGINE should see it.

    A greyed-out input fixes nothing on its own: a figure typed before Xero was
    connected is still sitting in state and would still be summed. The double
    count has to be closed on the way INTO the engine, and non-destructively —
    the typed values stay exactly where the user left them, so turning Xero off
    hands them straight back. */
export function activeVehicles(s: RateCalcState): VehicleRecord[] {
  if (!(s.costsSource === "xero" && s.xeroCosts)) return s.vehicles;
  return s.vehicles.map(v => {
    const costs = { ...v.costs };
    for (const k of XERO_COVERED_VEHICLE_FIELDS) costs[k] = 0;
    return { ...v, costs };
  });
}

export function buildEngineData(s: RateCalcState): EngineData {
  const onXero = s.costsSource === "xero" && !!s.xeroCosts;
  const fleetAnnual = activeFleetAnnual(s);
  return {
    staff: s.staff,
    timesheets: s.timesheets,
    vehicles: activeVehicles(s),
    businessCosts: activeBusinessCosts(s),
    risk: s.risk,
    profit: s.profit,
    multipliers: s.multipliers,
    settings: s.settings,
    ...(s.mode.staff === "Simple" ? { simpleLabourData: s.simpleLabour } : {}),
    /* Never both: simpleBusinessData makes the engine use a 3-month average
       instead of the itemised list, which would throw away the Xero figures it
       was just handed. */
    ...(!onXero && s.mode.business === "Simple" ? { simpleBusinessData: s.simpleBusiness } : {}),
    /* The fleet, in precedence order. Xero wins over both typed modes and does
       so in EITHER mode — a P&L reports one fleet number, so there is nothing
       for the per-vehicle editor to do with it, and letting Detailed silently
       out-rank it would leave someone on Xero looking at a fleet cost the rate
       wasn't using. `annual` carries it as a year rather than a month average,
       because a Xero window isn't three months. */
    ...(fleetAnnual !== null
      ? { simpleVehicleData: { months: [], annual: fleetAnnual } }
      : s.mode.vehicles === "Simple"
        ? { simpleVehicleData: s.simpleVehicle }
        : {}),
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
  // Whichever pool is ACTIVE is what counts as entered — pulling real figures
  // from Xero is as much a completed step as typing them in.
  const bizTouched = s.costsSource === "xero" && s.xeroCosts
    ? s.xeroCosts.lines.some(c => (c.amount || 0) > 0)
    : s.mode.business === "Simple"
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
