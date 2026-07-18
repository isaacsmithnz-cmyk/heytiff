/**
 * HVAC Charge-Out Rate Calculator — Calculation Engine
 * ────────────────────────────────────────────────────────────────────────
 * Pure logic, no UI. Takes the calculator's data and returns every output.
 *
 * This is the single source of truth for all numbers. The UI never
 * calculates anything itself — it only displays what this returns.
 *
 * All money values are annual dollars unless suffixed _hr (per hour) or
 * _wk (per week). All rates are EX-GST.
 *
 * Produces two charge-out rates: Install and Service.
 * Admin is overhead — it never produces a rate; it flows into the
 * business costs pool.
 */

// ─── Types ──────────────────────────────────────────────────────────────

export type EmploymentType = "Full Time" | "Part Time" | "Casual" | "Subcontractor";

export interface StaffMember {
  id: number | string;
  name: string;
  role?: string;
  hourly_wage: number;
  employment_type?: EmploymentType | string;
  contracted_hours_per_week?: number;
  install_pct?: number;
  service_pct?: number;
  admin_pct?: number;
  super_override?: number | null;
  workers_comp_override?: number | null;
  payroll_complete?: boolean;
}

export interface TimesheetEntry {
  week_ending_date?: string;
  standard_hours?: number;
  overtime_1_hours?: number;
  overtime_2_hours?: number;
  job_type?: "Install" | "Service" | "Non-Billable" | string;
}

export interface VehicleCosts {
  replacement_value?: number;
  resale_value?: number;
  cycle_years?: number;
  fuel_per_week?: number;
  insurance?: number;
  rego?: number;
  servicing?: number;
  tolls?: number;
  fitout?: number;
}

export interface VehicleRecord {
  vehicle_id: string;
  vehicle_name?: string;
  rego_number?: string;
  assigned_driver_id?: number | string | null;
  allocation?: "Install" | "Service" | string;
  costs?: VehicleCosts;
  simpleTotal?: number | null;
}

export interface BusinessCost {
  name: string;
  amount: number;
  allocated_to: "shared" | "install" | "service" | string;
}

export interface RiskSettings {
  warranty: number;
  defect: number;
  callback: number;
  diagnostic: number;
}

export interface ProfitSettings {
  margin: number;
  costIncrease: number;
}

export interface Multipliers {
  afterHours: number;
  emergency: number;
}

export interface CalcSettings {
  state?: string;
  super_pct?: number;
  workers_comp_pct?: number;
  payroll_tax_enabled?: boolean;
  payroll_tax_threshold?: number;
  payroll_tax_rate?: number;
  payroll_tax_fy?: string;
  working_weeks?: number;
  working_hours?: number;
  annual_cost_increase_pct?: number;
  review_reminder_months?: number;
}

export interface SimpleLabourData {
  months: number[];
  install_pct?: number;
  service_pct?: number;
  admin_pct?: number;
  staff_count?: number;
  billable_pct?: number;
}

export interface SimpleBusinessData {
  months: number[];
}

export interface SimpleVehicleData {
  months: number[];
}

export interface EngineData {
  staff?: StaffMember[];
  timesheets?: Record<string | number, TimesheetEntry[]>;
  vehicles?: VehicleRecord[];
  businessCosts?: BusinessCost[];
  risk?: RiskSettings;
  profit?: ProfitSettings;
  multipliers?: Multipliers;
  settings?: CalcSettings;
  simpleLabourData?: SimpleLabourData | null;
  simpleBusinessData?: SimpleBusinessData | null;
  simpleVehicleData?: SimpleVehicleData | null;
}

export interface Confidence {
  label: string;
  level: "low" | "building" | "reliable" | "high";
}

export interface StaffCostBreakdown {
  id: number | string;
  name: string;
  annualCost: number;
  base: number;
  burden: number;
  leaveLoading: number;
  weeksSubmitted: number;
  burdenPct: number;
  taxableWages: number;
}

export interface VehicleBreakdown {
  id: string;
  annual: number;
  iPct: number;
  sPct: number;
  aPct: number;
}

export interface CalcResult {
  // headline rates (null = show "—")
  recInst: number | null;
  recSvc: number | null;
  beInst: number | null;
  beSvc: number | null;
  afterHrs: number | null;
  emergency: number | null;
  projInst: number | null;
  projSvc: number | null;
  profInst: number;
  profSvc: number;
  daily: number;
  // cost structure
  instLab: number;
  svcLab: number;
  adminLab: number;
  instVehicle: number;
  svcVehicle: number;
  adminVehicle: number;
  totalInst: number;
  totalSvc: number;
  pool: number;
  sharedCosts: number;
  directInst: number;
  directSvc: number;
  enteredBiz: number;
  payrollTax: number;
  totalWages: number;
  // utilisation
  instUtil: number;
  svcUtil: number;
  effInst: number;
  effSvc: number;
  totalAnnualPaid: number;
  utilFromDefault: boolean;
  // confidence
  weeksSubmitted: number;
  confidence: Confidence;
  // breakdowns for display
  staffBreakdown: StaffCostBreakdown[];
  vehicleBreakdown: VehicleBreakdown[];
  hasStaff: boolean;
}

export type HealthType = "neutral" | "warning" | "danger" | "success";

export interface HealthStatusResult {
  status: string;
  type: HealthType;
}

export type StepCompletion =
  | "complete"
  | "in_progress"
  | "not_started"
  | "defaults"
  | "customised";

export type StepMode = "simple" | "detailed" | null;

export interface StepStatusEntry {
  completion: StepCompletion;
  mode: StepMode;
}

export interface StepStatusMap {
  staff: StepStatusEntry;
  business: StepStatusEntry;
  vehicles: StepStatusEntry;
  risk: StepStatusEntry;
  profit: StepStatusEntry;
}

export interface CurrentRates {
  install: number | null;
  service: number | null;
}

// ─── Australian payroll tax (2026–27) ──────────────────────────────────
// Maintenance note: verify and update these at the start of each FY
// (payrolltax.gov.au). Rates are the base tier — QLD >$6.5M, TAS >$2M and
// ACT large-employer surcharges are beyond this tool's audience.
export const PAYROLL_TAX: Record<string, { threshold: number; rate: number; fy: string }> = {
  NSW: { threshold: 1_200_000, rate: 5.45, fy: "2026–27" },
  VIC: { threshold: 1_000_000, rate: 4.85, fy: "2026–27" },
  QLD: { threshold: 1_300_000, rate: 4.75, fy: "2026–27" },
  SA:  { threshold: 1_500_000, rate: 4.95, fy: "2026–27" },
  WA:  { threshold: 1_000_000, rate: 5.50, fy: "2026–27" },
  TAS: { threshold: 1_250_000, rate: 4.00, fy: "2026–27" },
  ACT: { threshold: 2_000_000, rate: 6.85, fy: "2026–27" },
  NT:  { threshold: 2_500_000, rate: 5.50, fy: "2026–27" },
};

export const LEAVE_LOADING_PCT = 17.5; // award rate, fixed
export const ANNUAL_LEAVE_WEEKS = 4;
/** Weeks a tech is actually on the tools: 52 − 4 annual leave − ~2 public
    holidays (11 gazetted days ≈ 2.2 weeks). Personal/sick leave is NOT netted
    off — crews that take it in full should set 44. Single source of truth:
    state.ts, demo-data.ts, eofy.tsx and the settings stepper all read this, so
    the engine fallback can never silently disagree with the UI again. */
export const DEFAULT_WORKING_WEEKS = 46;
export const SANITY_CEILING_HR = 1000; // any rate above this = data error
export const MIN_WEEKS_FOR_CONFIDENCE = 4;
export const MIN_WEEKS_FOR_TAX_WARNING = 8;

// ─── Helpers ────────────────────────────────────────────────────────────
const sum = <T,>(arr: T[], fn?: (x: T) => number): number =>
  arr.reduce((a, x) => a + (fn ? fn(x) : (x as unknown as number)), 0);
const safeDiv = (a: number, b: number): number => (b > 0 ? a / b : 0);

export function confidenceLabel(weeks: number): Confidence {
  if (weeks < 4) return { label: "Estimated — limited data", level: "low" };
  if (weeks < 12) return { label: "Building accuracy", level: "building" };
  if (weeks < 24) return { label: "Reliable", level: "reliable" };
  return { label: "Highly accurate", level: "high" };
}

interface StaffCost {
  annualCost: number;
  base: number;
  burden: number;
  leaveLoading: number;
  weeksSubmitted: number;
  burdenPct: number;
  taxableWages: number;
}

/**
 * Per-staff true annual labour cost from timesheet buckets.
 * Falls back to contracted-hours estimate when timesheet data is thin.
 */
function staffAnnualCost(
  staff: StaffMember,
  weeksData: TimesheetEntry[],
  settings: CalcSettings,
): StaffCost {
  const wage = staff.hourly_wage || 0;
  const contracted = staff.contracted_hours_per_week || 38;
  const weeks = settings.working_weeks || DEFAULT_WORKING_WEEKS;

  // Employment type drives paid weeks and entitlements:
  //   Full/Part Time  → paid 52 weeks/yr (annual leave, sick leave and public
  //                     holidays are PAID time) + leave loading
  //   Casual          → paid only for weeks worked (working_weeks); no leave
  //                     loading (casual loading is built into their hourly wage)
  //   Subcontractor   → invoices for work done; no burden, no loading
  const isSubbie    = staff.employment_type === "Subcontractor";
  const isCasual    = staff.employment_type === "Casual";
  const isPermanent = !isSubbie && !isCasual; // Full Time, Part Time, or unspecified

  const paidWeeks = isPermanent ? 52 : weeks;

  // Burden — subcontractors attract none
  const superPct = isSubbie ? 0 : (staff.super_override ?? settings.super_pct ?? 12);
  const wcPct    = isSubbie ? 0 : (staff.workers_comp_override ?? settings.workers_comp_pct ?? 2);
  const burdenPct = superPct + wcPct; // payroll tax handled globally, not here

  // True cost from timesheets if we have enough; else estimate.
  // Timesheet entries are at DAILY level (or split by job type), so there
  // can be many entries per week. Group by week_ending_date so we average
  // by actual weeks, not entry count.
  let projectedAnnual: number;
  let weeksSubmitted = 0;

  if (weeksData && weeksData.length > 0) {
    const byWeek: Record<string, number> = {};
    weeksData.forEach(e => {
      const key = e.week_ending_date || "_";
      const cost =
        (e.standard_hours   || 0) * wage * 1.0 +
        (e.overtime_1_hours || 0) * wage * 1.5 +
        (e.overtime_2_hours || 0) * wage * 2.0;
      byWeek[key] = (byWeek[key] || 0) + cost;
    });
    const weekCosts = Object.values(byWeek);
    weeksSubmitted = weekCosts.length;
    const avgWeekly = safeDiv(sum(weekCosts), weeksSubmitted);
    // Permanents: paid every week of the year including leave weeks at their
    // normal weekly cost. Casuals/subbies: paid only for working weeks.
    projectedAnnual = avgWeekly * paidWeeks;
  } else {
    // No timesheet data — estimate from contracted hours at base rate
    projectedAnnual = wage * contracted * paidWeeks;
  }

  const withBurden = projectedAnnual * (1 + burdenPct / 100);

  // Leave loading — permanents only. Casuals receive casual loading in their
  // wage instead of leave entitlements; subbies invoice.
  const leaveLoading = isPermanent
    ? (contracted * wage * ANNUAL_LEAVE_WEEKS) * (LEAVE_LOADING_PCT / 100)
    : 0;

  // Payroll-taxable wages. In every AU jurisdiction taxable wages include
  // gross wages PLUS employer super contributions and leave loading —
  // workers-comp premiums are NOT wages and stay out. Subcontractor
  // invoices are not wages at all, so subbies contribute nothing here.
  const superAmount = projectedAnnual * superPct / 100;
  const taxableWages = isSubbie ? 0 : projectedAnnual + superAmount + leaveLoading;

  return {
    annualCost: withBurden + leaveLoading,
    base: projectedAnnual,
    burden: withBurden - projectedAnnual,
    leaveLoading,
    weeksSubmitted,
    burdenPct,
    taxableWages,
  };
}

/**
 * Main engine — see EngineData for the input shape.
 */
export function calculate(data: EngineData): CalcResult {
  const {
    staff = [],
    timesheets = {},
    vehicles = [],
    businessCosts = [],
    risk = { warranty: 3, defect: 2, callback: 4, diagnostic: 3 },
    profit = { margin: 20, costIncrease: 3 },
    multipliers = { afterHours: 1.5, emergency: 2.0 },
    settings = {},
  } = data;

  const weeks = settings.working_weeks || DEFAULT_WORKING_WEEKS;
  const hoursPerDay = settings.working_hours || 8;

  // Declared here so both simple-mode and normal paths can set/read them
  let utilFromDefault = false;
  let totalWages = 0;
  let instLab = 0, svcLab = 0, adminLab = 0;
  let minWeeks = Infinity;

  // ── Simple labour mode override ────────────────────────────────────────
  // When simpleLabourData is provided, bypass timesheet-based calculation.
  // The owner has entered last 3 months of payroll directly.
  if (data.simpleLabourData) {
    const sl = data.simpleLabourData;
    const validMonths = (sl.months || []).filter(m => m > 0);
    if (validMonths.length > 0) {
      const avgMonthly    = validMonths.reduce((a, b) => a + b, 0) / validMonths.length;
      const projAnnual    = avgMonthly * 12;
      totalWages          = projAnnual;
      const burdenPct     = (settings.super_pct ?? 12) + (settings.workers_comp_pct ?? 2);
      const withBurden    = projAnnual * (1 + burdenPct / 100);
      // projAnnual is 52 weeks of pay (avgMonthly × 12), so the true weekly wage
      // bill is projAnnual / 52 — not projAnnual / working_weeks. Dividing by
      // working_weeks overstated the loading by 52/weeks (8.3% at 48) and made
      // it drift with a setting that has nothing to do with what leave costs.
      // Detailed mode uses contracted × wage, which is likewise weeks-independent.
      const leaveLoading  = (projAnnual / 52) * ANNUAL_LEAVE_WEEKS * (LEAVE_LOADING_PCT / 100);
      const totalAnnual   = withBurden + leaveLoading;
      const iPct = sl.install_pct ?? 60;
      const sPct = sl.service_pct ?? 30;
      const aPct = sl.admin_pct   ?? 10;
      instLab  = totalAnnual * iPct / 100;
      svcLab   = totalAnnual * sPct / 100;
      adminLab = totalAnnual * aPct / 100;
      minWeeks = 0; // simple mode → default utilisation will apply
      // Payroll tax — simple mode treats the whole wage bill as employee
      // wages (no subcontractor concept here), so taxable wages are
      // gross pay + super + leave loading, same as the detailed path.
      const superAmount2 = projAnnual * (settings.super_pct ?? 12) / 100;
      const taxableWages2 = projAnnual + superAmount2 + leaveLoading;
      totalWages = taxableWages2;
      let payrollTax2 = 0;
      if (settings.payroll_tax_enabled && settings.payroll_tax_threshold) {
        const excess2 = Math.max(0, taxableWages2 - settings.payroll_tax_threshold);
        payrollTax2 = excess2 * (settings.payroll_tax_rate || 0) / 100;
        instLab  += payrollTax2 * iPct / 100;
        svcLab   += payrollTax2 * sPct / 100;
        adminLab += payrollTax2 * aPct / 100;
      }
      const bd: StaffCostBreakdown[] = [{
        id: "simple", name: "All staff (simple mode)",
        annualCost: totalAnnual, base: projAnnual,
        burden: withBurden - projAnnual, leaveLoading,
        weeksSubmitted: 0, burdenPct, taxableWages: taxableWages2,
      }];
      // Skip normal staff loop — jump straight to Step 2
      const staffCount = sl.staff_count || Math.max(1, Math.round(avgMonthly / 4500));
      const totalAnnualPaid2 = staffCount * 38 * weeks;
      // Effective hours = allocation × billable %. The owner can set billability
      // in Simple mode (sl.billable_pct); defaults to the 75% industry estimate.
      const billPct = (sl.billable_pct != null ? sl.billable_pct : 75) / 100;
      const instUtil2 = (iPct / 100) * billPct;
      const svcUtil2  = (sPct / 100) * billPct;
      utilFromDefault = true;
      const effInst2 = totalAnnualPaid2 * instUtil2;
      const effSvc2  = totalAnnualPaid2 * svcUtil2;
      // Vehicles — use simpleVehicleData if provided, otherwise per-vehicle loop
      let instVehicle2 = 0, svcVehicle2 = 0, adminVehicle2 = 0;
      const vehicleBreakdown2: VehicleBreakdown[] = [];
      if (data.simpleVehicleData) {
        const svMo = (data.simpleVehicleData.months || []).filter(m => m > 0);
        if (svMo.length > 0) {
          const fleetAnn = (svMo.reduce((a, b) => a + b, 0) / svMo.length) * 12;
          if (vehicles.length > 0) {
            let iSum = 0, sSum = 0, aSum = 0;
            vehicles.forEach(v => {
              const drv = staff.find(s => s.id === v.assigned_driver_id);
              iSum += drv ? (drv.install_pct || 0) : v.allocation === "Install" ? 100 : 0;
              sSum += drv ? (drv.service_pct || 0) : v.allocation === "Service" ? 100 : 0;
              aSum += drv ? (drv.admin_pct || 0) : 0;
            });
            const tot = (iSum + sSum + aSum) || 100;
            instVehicle2 = fleetAnn * iSum / tot; svcVehicle2 = fleetAnn * sSum / tot; adminVehicle2 = fleetAnn * aSum / tot;
          } else {
            instVehicle2 = fleetAnn; // no fleet records → all to install
          }
          vehicleBreakdown2.push({ id: "fleet-simple", annual: fleetAnn, iPct: 100, sPct: 0, aPct: 0 });
        }
      } else {
        vehicles.forEach(v => {
          const ann = v.simpleTotal != null ? v.simpleTotal :
            ((v.costs?.replacement_value || 0) - (v.costs?.resale_value || 0)) / (v.costs?.cycle_years || 5)
            + (v.costs?.fuel_per_week || 0) * 52 + (v.costs?.insurance || 0) + (v.costs?.rego || 0)
            + (v.costs?.servicing || 0) + (v.costs?.tolls || 0) + (v.costs?.fitout || 0) / (v.costs?.cycle_years || 5);
          const drv = staff.find(s => s.id === v.assigned_driver_id);
          const iP = drv ? drv.install_pct || 0 : v.allocation === "Install" ? 100 : 0;
          const sP = drv ? drv.service_pct || 0 : v.allocation === "Service" ? 100 : 0;
          const aP = drv ? drv.admin_pct || 0 : 0;
          instVehicle2 += ann * iP / 100; svcVehicle2 += ann * sP / 100; adminVehicle2 += ann * aP / 100;
          vehicleBreakdown2.push({ id: v.vehicle_id, annual: ann, iPct: iP, sPct: sP, aPct: aP });
        });
      }
      // enteredBiz2: use simpleBusinessData if provided, else sum businessCosts array
      const sbm2 = data.simpleBusinessData ? (data.simpleBusinessData.months || []).filter(m => m > 0) : [];
      const enteredBiz2 = sbm2.length > 0
        ? (sbm2.reduce((a, b) => a + b, 0) / sbm2.length) * 12
        : (businessCosts || []).reduce((a, c) => a + c.amount, 0);
      const pool2 = adminLab + adminVehicle2 + enteredBiz2;
      const labRatio2 = safeDiv(instLab, instLab + svcLab);
      const totalInst2 = instLab + instVehicle2 + pool2 * labRatio2;
      const totalSvc2  = svcLab + svcVehicle2 + pool2 * (1 - labRatio2);
      const iRM = 1 + (risk.warranty + risk.defect) / 100;
      const sRM = 1 + (risk.callback + risk.diagnostic) / 100;
      const beI2 = safeDiv(totalInst2 * iRM, effInst2);
      const beS2 = safeDiv(totalSvc2 * sRM, effSvc2);
      const m2 = profit.margin / 100;
      const rI2 = m2 < 1 ? safeDiv(beI2, 1 - m2) : 0;
      const rS2 = m2 < 1 ? safeDiv(beS2, 1 - m2) : 0;
      const aH2 = rS2 * (multipliers.afterHours || 1.5);
      const em2 = rS2 * (multipliers.emergency || 2.0);
      const inc2 = (profit.costIncrease ?? 3) / 100;
      const iHShare = safeDiv(effInst2, effInst2 + effSvc2);
      const blended2 = rI2 * iHShare + rS2 * (1 - iHShare);
      const guard2 = (r: number, e: number) => (!r || r === 0 || r > SANITY_CEILING_HR || e <= 0) ? null : r;
      return {
        recInst: guard2(rI2, effInst2), recSvc: guard2(rS2, effSvc2),
        beInst: guard2(beI2, effInst2), beSvc: guard2(beS2, effSvc2),
        afterHrs: guard2(aH2, effSvc2), emergency: guard2(em2, effSvc2),
        projInst: guard2(rI2 * (1 + inc2), effInst2), projSvc: guard2(rS2 * (1 + inc2), effSvc2),
        profInst: rI2 - beI2, profSvc: rS2 - beS2,
        daily: blended2 * (settings.working_hours || 8),
        instLab, svcLab, adminLab, instVehicle: instVehicle2,
        svcVehicle: svcVehicle2, adminVehicle: adminVehicle2,
        totalInst: totalInst2, totalSvc: totalSvc2,
        pool: pool2, sharedCosts: enteredBiz2, directInst: 0, directSvc: 0,
        enteredBiz: enteredBiz2, payrollTax: payrollTax2, totalWages,
        instUtil: instUtil2 * 100, svcUtil: svcUtil2 * 100,
        effInst: effInst2, effSvc: effSvc2, totalAnnualPaid: totalAnnualPaid2,
        utilFromDefault: true,
        weeksSubmitted: 0, confidence: confidenceLabel(0),
        staffBreakdown: bd, vehicleBreakdown: vehicleBreakdown2,
        hasStaff: totalAnnual > 0,
      };
    }
  }

  // ── Step 1: annual labour cost per staff, split by allocation ──────────
  // Normal path — reset shared variables
  instLab = 0; svcLab = 0; adminLab = 0;
  minWeeks = Infinity;
  const staffBreakdown: StaffCostBreakdown[] = [];
  utilFromDefault = false;
  totalWages = 0;

  staff.forEach(s => {
    const ts = timesheets[s.id] || [];
    const c = staffAnnualCost(s, ts, settings);
    totalWages += c.taxableWages; // payroll-taxable wages: base + super + leave loading (employees only)
    minWeeks = Math.min(minWeeks, c.weeksSubmitted);

    instLab  += c.annualCost * (s.install_pct || 0) / 100;
    svcLab   += c.annualCost * (s.service_pct || 0) / 100;
    adminLab += c.annualCost * (s.admin_pct   || 0) / 100;

    staffBreakdown.push({ id: s.id, name: s.name, ...c });
  });
  if (!isFinite(minWeeks)) minWeeks = 0;

  // ── Payroll tax (applies to wages above threshold, if enabled) ─────────
  let payrollTax = 0;
  if (settings.payroll_tax_enabled && settings.payroll_tax_threshold) {
    const excess = Math.max(0, totalWages - settings.payroll_tax_threshold);
    payrollTax = excess * (settings.payroll_tax_rate || 0) / 100;
    // distribute proportionally into labour pools by wage share
    if (totalWages > 0) {
      const instShareW = safeDiv(instLab, instLab + svcLab + adminLab);
      const svcShareW  = safeDiv(svcLab,  instLab + svcLab + adminLab);
      const admShareW  = safeDiv(adminLab, instLab + svcLab + adminLab);
      instLab  += payrollTax * instShareW;
      svcLab   += payrollTax * svcShareW;
      adminLab += payrollTax * admShareW;
    }
  }

  // ── Step 2: utilisation from timesheets ────────────────────────────────
  let paidHrs = 0, instBillable = 0, svcBillable = 0;
  staff.forEach(s => {
    const ts = timesheets[s.id] || [];
    ts.forEach(w => {
      const wkHrs = (w.standard_hours || 0) + (w.overtime_1_hours || 0) + (w.overtime_2_hours || 0);
      paidHrs += wkHrs;
      if (w.job_type === "Install") instBillable += wkHrs;
      if (w.job_type === "Service") svcBillable += wkHrs;
    });
  });

  let instUtil: number, svcUtil: number;
  if (minWeeks >= MIN_WEEKS_FOR_CONFIDENCE && paidHrs > 0) {
    instUtil = safeDiv(instBillable, paidHrs);
    svcUtil  = safeDiv(svcBillable, paidHrs);
  } else {
    // Fallback: no timesheet data yet.
    // Weight default billability (75%) by each type's allocation share —
    // applying 75% independently to both install AND service against
    // totalAnnualPaid would claim 150% of all hours as billable, inflating
    // effInst/effSvc and collapsing the recommended rates. This mirrors the
    // simple mode calculation: instUtil = install_pct × 75%.
    utilFromDefault = true;
    const totalContractedHrs = sum(staff, s => (s.contracted_hours_per_week || 38));
    if (totalContractedHrs > 0) {
      const instAllocPct = sum(staff, s => (s.install_pct || 0) * (s.contracted_hours_per_week || 38)) / totalContractedHrs;
      const svcAllocPct  = sum(staff, s => (s.service_pct  || 0) * (s.contracted_hours_per_week || 38)) / totalContractedHrs;
      const DEF_UTIL = 0.75;
      instUtil = (instAllocPct / 100) * DEF_UTIL;
      svcUtil  = (svcAllocPct  / 100) * DEF_UTIL;
    } else {
      instUtil = 0.45;  // 60% install × 75% — safe fallback
      svcUtil  = 0.225; // 30% service × 75%
    }
  }

  // ── Step 3: effective annual billable hours ────────────────────────────
  const totalAnnualPaid = sum(staff, s => (s.contracted_hours_per_week || 38) * weeks);
  const effInst = totalAnnualPaid * instUtil;
  const effSvc  = totalAnnualPaid * svcUtil;

  // ── Step 4: vehicle costs by driver allocation ─────────────────────────
  let instVehicle = 0, svcVehicle = 0, adminVehicle = 0;
  const vehicleBreakdown: VehicleBreakdown[] = [];

  if (data.simpleVehicleData) {
    // Simple fleet mode — one total for all vehicles combined.
    // Split across install/service using the fleet's aggregate driver allocations.
    const sv = data.simpleVehicleData;
    const validMo = (sv.months || []).filter(m => m > 0);
    if (validMo.length > 0) {
      const fleetAnnual = (validMo.reduce((a, b) => a + b, 0) / validMo.length) * 12;
      if (vehicles.length > 0) {
        // Derive install/service/admin split from all drivers' allocations combined
        let iSum = 0, sSum = 0, aSum = 0;
        vehicles.forEach(v => {
          const drv = staff.find(s => s.id === v.assigned_driver_id);
          iSum += drv ? (drv.install_pct || 0) : v.allocation === "Install" ? 100 : 0;
          sSum += drv ? (drv.service_pct || 0) : v.allocation === "Service" ? 100 : 0;
          aSum += drv ? (drv.admin_pct || 0) : 0;
        });
        const tot = (iSum + sSum + aSum) || 100;
        instVehicle  = fleetAnnual * iSum / tot;
        svcVehicle   = fleetAnnual * sSum / tot;
        adminVehicle = fleetAnnual * aSum / tot;
      } else {
        // No Fleet records — put full total against install as a safe default
        instVehicle = fleetAnnual;
      }
      vehicleBreakdown.push({ id: "fleet-simple", annual: fleetAnnual, iPct: 100, sPct: 0, aPct: 0 });
    }
  } else {
    // Detailed mode — per-vehicle cost calculation
    vehicles.forEach(v => {
      const c = v.costs || {};
      const annual = v.simpleTotal != null
        ? v.simpleTotal
        : ((c.replacement_value || 0) - (c.resale_value || 0)) / (c.cycle_years || 5)
          + (c.fuel_per_week || 0) * 52
          + (c.insurance || 0) + (c.rego || 0) + (c.servicing || 0) + (c.tolls || 0)
          + (c.fitout || 0) / (c.cycle_years || 5);
      const driver = staff.find(s => s.id === v.assigned_driver_id);
      let iPct = 0, sPct = 0, aPct = 0;
      if (driver) { iPct = driver.install_pct || 0; sPct = driver.service_pct || 0; aPct = driver.admin_pct || 0; }
      else if (v.allocation === "Install") iPct = 100;
      else if (v.allocation === "Service") sPct = 100;
      instVehicle  += annual * iPct / 100;
      svcVehicle   += annual * sPct / 100;
      adminVehicle += annual * aPct / 100;
      vehicleBreakdown.push({ id: v.vehicle_id, annual, iPct, sPct, aPct });
    });
  }

  // ── Step 5: business costs pool + division split ───────────────────────
  let directInst = 0, directSvc = 0, sharedCosts = 0;
  businessCosts.forEach(c => {
    if (c.allocated_to === "install") directInst += c.amount;
    else if (c.allocated_to === "service") directSvc += c.amount;
    else sharedCosts += c.amount;
  });

  // Simple business mode: override entered costs with monthly average × 12
  let enteredBiz: number;
  if (data.simpleBusinessData) {
    const sbMonths = (data.simpleBusinessData.months || []).filter(m => m > 0);
    enteredBiz = sbMonths.length
      ? (sbMonths.reduce((a, b) => a + b, 0) / sbMonths.length) * 12
      : directInst + directSvc + sharedCosts;
  } else {
    enteredBiz = directInst + directSvc + sharedCosts;
  }

  // Pool uses enteredBiz when simpleBusinessData is active (all simple overhead is "shared").
  // In normal mode uses sharedCosts only (directInst/directSvc bypass the pool).
  const effectiveShared = data.simpleBusinessData ? enteredBiz : sharedCosts;
  const pool = adminLab + adminVehicle + effectiveShared;
  const labourRatio = safeDiv(instLab, instLab + svcLab);
  const instPoolShare = pool * labourRatio;
  const svcPoolShare  = pool * (1 - labourRatio);

  const totalInst = instLab + instVehicle + directInst + instPoolShare;
  const totalSvc  = svcLab  + svcVehicle  + directSvc  + svcPoolShare;

  // ── Step 6: HVAC risk ──────────────────────────────────────────────────
  const instRiskM = 1 + (risk.warranty + risk.defect) / 100;
  const svcRiskM  = 1 + (risk.callback + risk.diagnostic) / 100;
  const instWithRisk = totalInst * instRiskM;
  const svcWithRisk  = totalSvc  * svcRiskM;

  // ── Step 7: break-even ──────────────────────────────────────────────────
  const beInst = safeDiv(instWithRisk, effInst);
  const beSvc  = safeDiv(svcWithRisk,  effSvc);

  // ── Step 8: recommended rates ───────────────────────────────────────────
  const m = profit.margin / 100;
  const recInst = m < 1 ? safeDiv(beInst, 1 - m) : 0;
  const recSvc  = m < 1 ? safeDiv(beSvc,  1 - m) : 0;
  const afterHrs  = recSvc * (multipliers.afterHours || 1.5);
  const emergency = recSvc * (multipliers.emergency  || 2.0);
  const profInst  = recInst - beInst;
  const profSvc   = recSvc - beSvc;

  // blended daily target by billable-hour share
  const instHrShare = safeDiv(effInst, effInst + effSvc);
  const svcHrShare  = 1 - instHrShare;
  const blended = recInst * instHrShare + recSvc * svcHrShare;
  const daily = blended * hoursPerDay;

  // ── Step 9: next-year projection ────────────────────────────────────────
  const inc = (profit.costIncrease ?? 3) / 100;
  const projInst = recInst * (1 + inc);
  const projSvc  = recSvc  * (1 + inc);

  // ── Guards ──────────────────────────────────────────────────────────────
  const hasStaff = staff.length > 0 && (instLab + svcLab) > 0;
  const guard = (rate: number, eff: number): number | null => {
    if (!hasStaff) return null;       // → UI shows "—" + prompt
    if (eff <= 0) return null;        // no billable hours
    if (rate > SANITY_CEILING_HR) return null; // data error
    return rate;
  };

  return {
    // headline rates (null = show "—")
    recInst: guard(recInst, effInst),
    recSvc:  guard(recSvc, effSvc),
    beInst:  guard(beInst, effInst),
    beSvc:   guard(beSvc, effSvc),
    afterHrs: guard(afterHrs, effSvc),
    emergency: guard(emergency, effSvc),
    projInst: guard(projInst, effInst),
    projSvc:  guard(projSvc, effSvc),
    profInst, profSvc, daily,

    // cost structure
    instLab, svcLab, adminLab,
    instVehicle, svcVehicle, adminVehicle,
    totalInst, totalSvc,
    pool, sharedCosts, directInst, directSvc,
    enteredBiz,
    payrollTax, totalWages,

    // utilisation
    instUtil: instUtil * 100,
    svcUtil:  svcUtil * 100,
    effInst, effSvc, totalAnnualPaid, utilFromDefault,

    // confidence
    weeksSubmitted: minWeeks,
    confidence: confidenceLabel(minWeeks),

    // breakdowns for display
    staffBreakdown, vehicleBreakdown,

    hasStaff,
  };
}

/**
 * Health status — considers BOTH rate adequacy AND utilisation.
 * currentRates: { install, service } — what they currently charge.
 */
export function healthStatus(
  calc: CalcResult | null,
  currentRates: Partial<CurrentRates> = {},
): HealthStatusResult {
  if (!calc || !calc.hasStaff || calc.recInst == null) {
    return { status: "Setup Incomplete", type: "neutral" };
  }

  const ci = currentRates?.install;
  const cs = currentRates?.service;

  // No current rates set yet
  if (ci == null && cs == null) {
    return { status: "Set Your Rates", type: "warning" };
  }

  // Health is about rate adequacy only. Utilisation is already factored into
  // the recommended rate — penalising it again here double-counts the risk.
  // A business charging above the recommended rate cannot be "High Risk"
  // just because their utilisation is low; the higher rate already compensates.

  // High Risk: rates are far below break-even (actively losing money)
  const farBelowBE =
    (ci != null && calc.beInst != null && calc.beInst !== 0 && ci < calc.beInst * 0.85) ||
    (cs != null && calc.beSvc  != null && calc.beSvc  !== 0 && cs < calc.beSvc  * 0.85);
  if (farBelowBE) return { status: "High Risk", type: "danger" };

  // Underpriced: below break-even at all
  const belowBE =
    (ci != null && calc.beInst != null && calc.beInst !== 0 && ci < calc.beInst) ||
    (cs != null && calc.beSvc  != null && calc.beSvc  !== 0 && cs < calc.beSvc);
  if (belowBE) return { status: "Underpriced", type: "warning" };

  // Healthy: at or above recommended on both rates (within 5% tolerance)
  const atTarget =
    (ci == null || (calc.recInst != null && ci >= calc.recInst * 0.95)) &&
    (cs == null || (calc.recSvc  != null && cs >= calc.recSvc  * 0.95));
  if (atTarget) return { status: "Healthy", type: "success" };

  // Needs Review: above break-even but below recommended
  return { status: "Needs Review", type: "warning" };
}

export interface StepStatusSimpleData {
  simpleLabourData?: SimpleLabourData | null;
  simpleBusinessData?: SimpleBusinessData | null;
  fleetSimpleMonths?: number[];
}

/**
 * Step completion status — live re-evaluation, never a stored flag.
 * Returns { completion, mode } per step.
 */
export function stepStatus(
  data: EngineData,
  calc: CalcResult | null,
  simpleData: StepStatusSimpleData = {},
): StepStatusMap {
  const { staff = [], vehicles = [], businessCosts = [] } = data;
  const {
    simpleLabourData   = null,
    simpleBusinessData = null,
    fleetSimpleMonths  = [],
  } = simpleData;

  // ── Staff ─────────────────────────────────────────────────────────────
  const staffHasSimple = (simpleLabourData?.months || []).some(m => m > 0);
  const staffMode: StepMode = staffHasSimple ? "simple" : "detailed";
  let staffCompletion: StepCompletion;
  if (staffHasSimple && simpleLabourData) {
    const validMo = (simpleLabourData.months || []).filter(m => m > 0);
    const allocOk = ((simpleLabourData.install_pct || 0) +
                     (simpleLabourData.service_pct || 0) +
                     (simpleLabourData.admin_pct || 0)) === 100;
    if (validMo.length === 0)               staffCompletion = "not_started";
    else if (validMo.length > 0 && allocOk) staffCompletion = "complete";
    else                                    staffCompletion = "in_progress";
  } else {
    if (calc && calc.hasStaff && (calc.instLab + calc.svcLab) > 0)
                                            staffCompletion = "complete";
    else if (staff.length > 0)              staffCompletion = "in_progress";
    else                                    staffCompletion = "not_started";
  }

  // ── Business costs ────────────────────────────────────────────────────
  const bizHasSimple = (simpleBusinessData?.months || []).some(m => m > 0);
  const bizMode: StepMode = bizHasSimple ? "simple" : "detailed";
  let bizCompletion: StepCompletion;
  if (bizMode === "simple") {
    bizCompletion = bizHasSimple ? "complete" : "not_started";
  } else {
    const enteredTotal = sum(businessCosts, c => c.amount);
    bizCompletion = (enteredTotal > 0 || (calc && calc.enteredBiz > 0) || (calc && calc.adminLab > 0))
      ? "complete" : "not_started";
  }

  // ── Vehicles ──────────────────────────────────────────────────────────
  const vehHasSimple = (fleetSimpleMonths || []).some(m => m > 0);
  const vehMode: StepMode = vehHasSimple ? "simple" : "detailed";
  let vehCompletion: StepCompletion;
  if (vehicles.length === 0) {
    vehCompletion = "complete";
  } else if (vehMode === "simple") {
    vehCompletion = vehHasSimple ? "complete" : "not_started";
  } else {
    const allCosted  = vehicles.every(v =>
      (v.simpleTotal ?? 0) > 0 || (v.costs != null && (v.costs.fuel_per_week ?? 0) > 0));
    const someCosted = vehicles.some(v =>
      (v.simpleTotal ?? 0) > 0 || (v.costs != null && (v.costs.fuel_per_week ?? 0) > 0));
    const engineHas  = calc != null &&
      ((calc.instVehicle || 0) + (calc.svcVehicle || 0) + (calc.adminVehicle || 0)) > 0;
    if (allCosted || engineHas) vehCompletion = "complete";
    else if (someCosted)        vehCompletion = "in_progress";
    else                        vehCompletion = "not_started";
  }

  // ── HVAC Risk ─────────────────────────────────────────────────────────
  const rDef: RiskSettings = { warranty: 3, defect: 2, callback: 4, diagnostic: 3 };
  const rD = data.risk || rDef;
  const riskCompletion: StepCompletion = (Object.keys(rDef) as (keyof RiskSettings)[])
    .some(k => rD[k] !== rDef[k]) ? "customised" : "defaults";

  // ── Profit Target ─────────────────────────────────────────────────────
  const pD = data.profit || ({} as Partial<ProfitSettings>);
  const mD = data.multipliers || ({} as Partial<Multipliers>);
  const profCompletion: StepCompletion = (
    (pD.margin       != null && pD.margin       !== 20)  ||
    (mD.afterHours   != null && mD.afterHours   !== 1.5) ||
    (mD.emergency    != null && mD.emergency    !== 2.0) ||
    (pD.costIncrease != null && pD.costIncrease !== 3)
  ) ? "customised" : "defaults";

  return {
    staff:    { completion: staffCompletion, mode: staffMode },
    business: { completion: bizCompletion,   mode: bizMode   },
    vehicles: { completion: vehCompletion,   mode: vehMode   },
    risk:     { completion: riskCompletion,  mode: null      },
    profit:   { completion: profCompletion,  mode: null      },
  };
}
