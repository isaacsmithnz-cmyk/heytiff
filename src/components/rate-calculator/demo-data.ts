/**
 * Live Demo Data — Blue Sky Air Conditioning, Sydney NSW
 * ────────────────────────────────────────────────────────────────────────
 * Frozen constants for the calculator's example mode. The component renders
 * with this data substituted for real state.
 *
 * This data is CLIENT-SIDE ONLY and is discarded immediately on exit.
 * Nothing is persisted. It never touches the database.
 *
 * Rates are deliberately higher than most operators currently charge.
 * The goal: "Am I really that far below where I should be?" reaction.
 *
 * Maintenance: update payroll_tax_fy (and the seeded NSW threshold/rate)
 * each financial year alongside PAYROLL_TAX in engine.ts.
 */

import type {
  BusinessCost,
  CalcSettings,
  Multipliers,
  ProfitSettings,
  RiskSettings,
  StaffMember,
  TimesheetEntry,
  VehicleRecord,
} from "./engine";
import type { RateCalcState } from "./state";

// ── Helpers ──────────────────────────────────────────────────────────────
function buildWeeks(n = 18): string[] {
  const weeks: string[] = [];
  for (let i = 0; i < n; i++) weeks.push(`2026-BS-W${String(i + 1).padStart(2, "0")}`);
  return weeks;
}

// Generate weekly timesheet entries for one staff member.
// billableHrs/wk split across jobType; remainder is Non-Billable.
// Some weeks include overtime to make data realistic.
function tsWeeks(weeks: string[], billHrs: number, jobType: string, extraOT = 0): TimesheetEntry[] {
  return weeks.flatMap((w, i) => {
    const hasOT = extraOT > 0 && i % 3 === 0; // every 3rd week has OT
    const ot1 = hasOT ? Math.min(extraOT, 2) : 0;
    const ot2 = hasOT && extraOT > 2 ? extraOT - 2 : 0;
    const nonBill = Math.max(0, 38 - billHrs - ot1 - ot2);
    const entries: TimesheetEntry[] = [
      { week_ending_date: w, standard_hours: billHrs, overtime_1_hours: ot1, overtime_2_hours: ot2, job_type: jobType },
    ];
    if (nonBill > 0) entries.push({ week_ending_date: w, standard_hours: nonBill, overtime_1_hours: 0, overtime_2_hours: 0, job_type: "Non-Billable" });
    return entries;
  });
}

function tsAdmin(weeks: string[]): TimesheetEntry[] {
  return weeks.map(w => ({ week_ending_date: w, standard_hours: 38, overtime_1_hours: 0, overtime_2_hours: 0, job_type: "Non-Billable" }));
}

function tsMixed(weeks: string[], installHrs: number, serviceHrs: number): TimesheetEntry[] {
  const nonBill = Math.max(0, 38 - installHrs - serviceHrs);
  return weeks.flatMap(w => {
    const entries: TimesheetEntry[] = [];
    if (installHrs > 0) entries.push({ week_ending_date: w, standard_hours: installHrs, overtime_1_hours: 0, overtime_2_hours: 0, job_type: "Install" });
    if (serviceHrs > 0) entries.push({ week_ending_date: w, standard_hours: serviceHrs, overtime_1_hours: 0, overtime_2_hours: 0, job_type: "Service" });
    if (nonBill > 0) entries.push({ week_ending_date: w, standard_hours: nonBill, overtime_1_hours: 0, overtime_2_hours: 0, job_type: "Non-Billable" });
    return entries;
  });
}

const WEEKS = buildWeeks(18); // 18 weeks → "Reliable" confidence

// ── Staff ─────────────────────────────────────────────────────────────────
const STAFF: StaffMember[] = [
  {
    id: 10, name: "Mark", role: "Director / Working Tech",
    hourly_wage: 58, employment_type: "Full Time", contracted_hours_per_week: 38,
    install_pct: 40, service_pct: 20, admin_pct: 40, payroll_complete: true,
  },
  {
    id: 11, name: "Jake", role: "Senior Install Technician",
    hourly_wage: 45, employment_type: "Full Time", contracted_hours_per_week: 38,
    install_pct: 100, service_pct: 0, admin_pct: 0, payroll_complete: true,
  },
  {
    id: 12, name: "Sarah", role: "Senior Service Technician",
    hourly_wage: 42, employment_type: "Full Time", contracted_hours_per_week: 38,
    install_pct: 0, service_pct: 100, admin_pct: 0, payroll_complete: true,
  },
  {
    id: 13, name: "Tom", role: "Install Technician (2nd yr)",
    hourly_wage: 32, employment_type: "Full Time", contracted_hours_per_week: 38,
    install_pct: 100, service_pct: 0, admin_pct: 0, payroll_complete: true,
  },
  {
    id: 14, name: "Lisa", role: "Office Manager",
    hourly_wage: 35, employment_type: "Full Time", contracted_hours_per_week: 38,
    install_pct: 0, service_pct: 0, admin_pct: 100, payroll_complete: true,
  },
];

// ── Timesheets ─────────────────────────────────────────────────────────────
// Mark: install 15 hrs + service 8 hrs; Jake: 28 hrs install with OT every
// 3rd week; Sarah: 30 hrs service with light OT; Tom: 26 hrs install;
// Lisa: 100% non-billable.
const TIMESHEETS: Record<string | number, TimesheetEntry[]> = {
  10: tsMixed(WEEKS, 15, 8),
  11: tsWeeks(WEEKS, 28, "Install", 2),
  12: tsWeeks(WEEKS, 30, "Service", 1.5),
  13: tsWeeks(WEEKS, 26, "Install", 0),
  14: tsAdmin(WEEKS),
};

// ── Vehicles ──────────────────────────────────────────────────────────────
const VEHICLES: VehicleRecord[] = [
  {
    vehicle_id: "v10", vehicle_name: "Ford Transit", rego_number: "BSA001",
    assigned_driver_id: 11, // Jake → install 100%
    allocation: "Install",
    costs: { replacement_value: 48000, resale_value: 16000, cycle_years: 5, fuel_per_week: 165, insurance: 2200, rego: 950, servicing: 1600, tolls: 600, fitout: 6000 },
  },
  {
    vehicle_id: "v11", vehicle_name: "Toyota HiAce", rego_number: "BSA002",
    assigned_driver_id: 12, // Sarah → service 100%
    allocation: "Service",
    costs: { replacement_value: 44000, resale_value: 14000, cycle_years: 5, fuel_per_week: 140, insurance: 2100, rego: 920, servicing: 1500, tolls: 500, fitout: 4500 },
  },
];

// ── Business Costs ────────────────────────────────────────────────────────
const BUSINESS_COSTS: BusinessCost[] = [
  { name: "Public liability", amount: 5500, allocated_to: "shared" },
  { name: "Software & subscriptions", amount: 3800, allocated_to: "shared" },
  { name: "Phones & internet", amount: 3200, allocated_to: "shared" },
  { name: "Accounting fees", amount: 6500, allocated_to: "shared" },
  { name: "Marketing & website", amount: 7200, allocated_to: "shared" },
  { name: "Rent & utilities", amount: 18400, allocated_to: "shared" },
  { name: "Training & PPE", amount: 4100, allocated_to: "shared" },
];

// ── Settings ──────────────────────────────────────────────────────────────
const SETTINGS: CalcSettings = {
  state: "NSW",
  super_pct: 12,
  workers_comp_pct: 2.0,
  payroll_tax_enabled: false,
  payroll_tax_threshold: 1_200_000,
  payroll_tax_rate: 5.45,
  payroll_tax_fy: "2026-27",
  working_weeks: 48,
  working_days: 5,
  working_hours: 8,
  annual_cost_increase_pct: 3,
  review_reminder_months: 6,
};

// ── EOFY ──────────────────────────────────────────────────────────────────
// Last year Blue Sky charged $118/$105 — below where the calculator now says
// they should be. The better-off number creates the "am I that far below?"
// realisation when the owner compares to their own business.
const EOFY = {
  revenue:            850_000,
  cost_of_sales:      138_000,
  staff_costs:        412_000,
  vehicle_costs:       42_000,
  business_overheads:  90_000,
  operating_profit:   102_000,  // 19.8% margin — close to target
  last_install_rate:      118,
  last_service_rate:      105,
};

// ── Current rates / review state ──────────────────────────────────────────
const CURRENT_RATES = { install: 118, service: 105 };
const REVIEW_STATE = { lastReviewed: "2026-04-10" };

// ── Risk + profit settings ────────────────────────────────────────────────
export const DEMO_RISK: RiskSettings = { warranty: 3, defect: 2, callback: 5, diagnostic: 3 };
export const DEMO_PROFIT: ProfitSettings = { margin: 20, costIncrease: 3 };
export const DEMO_MULTIPLIERS: Multipliers = { afterHours: 1.5, emergency: 2.0 };

// ── Full demo data object ─────────────────────────────────────────────────
export const DEMO_DATA = Object.freeze({
  // Identity
  businessName: "Blue Sky Air Conditioning",
  location:     "Sydney, NSW",

  // Data feeds (same shape as real state)
  staff:         STAFF,
  timesheets:    TIMESHEETS,
  vehicles:      VEHICLES,
  businessCosts: BUSINESS_COSTS,
  currentRates:  CURRENT_RATES,
  reviewState:   REVIEW_STATE,
  settings:      SETTINGS,
  eofy:          EOFY,
  risk:          DEMO_RISK,
  profit:        DEMO_PROFIT,
  multipliers:   DEMO_MULTIPLIERS,
});

/**
 * Full calculator state seeded with the Blue Sky example. Deep-cloned every
 * call — DEMO_DATA is frozen, and editors must never mutate shared refs.
 */
export function buildDemoState(): RateCalcState {
  // JSON round-trip: exact for this dataset (plain data, no dates/undefined),
  // and available in every runtime the app targets (jsdom lacks structuredClone).
  const d = JSON.parse(JSON.stringify(DEMO_DATA)) as typeof DEMO_DATA;
  return {
    businessName: d.businessName,
    staff: d.staff,
    timesheets: d.timesheets,
    vehicles: d.vehicles,
    businessCosts: d.businessCosts,
    currentRates: { ...d.currentRates },
    reviewState: { ...d.reviewState },
    settings: { ...d.settings },
    eofy: { ...d.eofy },
    risk: { ...d.risk },
    profit: { ...d.profit },
    multipliers: { ...d.multipliers },
    simpleLabour: { months: [38200, 35900, 37400], install_pct: 60, service_pct: 30, admin_pct: 10, staff_count: 5, billable_pct: 75 },
    simpleBusiness: { months: [4060, 3950, 4170] },
    simpleVehicle: { months: [3400, 3300, 3500] },
    mode: { staff: "Simple", business: "Simple", vehicles: "Simple" },
  };
}
