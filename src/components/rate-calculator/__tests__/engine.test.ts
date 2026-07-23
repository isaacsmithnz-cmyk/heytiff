/**
 * Engine tests.
 *
 * The "engine baseline" blocks pin the TypeScript port to ground-truth
 * outputs captured by running the original handoff engine (plain JS) over
 * the same inputs. They pass EXPLICIT settings so they stay valid as the
 * demo defaults / FY tax table move each year.
 */
import { calculate, classifyEmployment, healthStatus, stepStatus, type EngineData } from "../engine";
import { BASELINE_DATA, BASELINE_RISK, BASELINE_PROFIT, BASELINE_MULTIPLIERS } from "./fixtures/baseline-org";

// Settings frozen to the values the ground-truth run used — independent of
// BASELINE_DATA.settings, which tracks the current FY.
const BASELINE_SETTINGS = {
  state: "NSW",
  super_pct: 11.5,
  workers_comp_pct: 2.0,
  payroll_tax_enabled: false,
  payroll_tax_threshold: 1_200_000,
  payroll_tax_rate: 5.45,
  working_weeks: 48,
  working_hours: 8,
};

const detailedData: EngineData = {
  staff: BASELINE_DATA.staff,
  timesheets: BASELINE_DATA.timesheets,
  vehicles: BASELINE_DATA.vehicles,
  businessCosts: BASELINE_DATA.businessCosts,
  risk: BASELINE_RISK,
  profit: BASELINE_PROFIT,
  multipliers: BASELINE_MULTIPLIERS,
  settings: BASELINE_SETTINGS,
};

const simpleData: EngineData = {
  ...detailedData,
  simpleLabourData: { months: [38200, 35900, 37400], install_pct: 60, service_pct: 30, admin_pct: 10, staff_count: 5, billable_pct: 75 },
  simpleBusinessData: { months: [4060, 3950, 4170] },
  simpleVehicleData: { months: [3400, 3300, 3500] },
};

function expectClose(actual: Record<string, unknown>, expected: Record<string, number | boolean | null>) {
  for (const [k, v] of Object.entries(expected)) {
    if (typeof v === "number") {
      expect(actual[k]).toBeCloseTo(v, 5);
    } else {
      expect(actual[k]).toBe(v);
    }
  }
}

describe("calculate — engine baseline (detailed mode)", () => {
  const calc = calculate(detailedData);

  it("reproduces the ground-truth outputs of the original engine", () => {
    expectClose(calc as unknown as Record<string, unknown>, {
      recInst: 144.253838,
      recSvc: 149.397098,
      beInst: 115.403071,
      beSvc: 119.517678,
      afterHrs: 224.095647,
      emergency: 298.794195,
      projInst: 148.581453,
      projSvc: 153.879011,
      profInst: 28.850768,
      profSvc: 29.87942,
      daily: 1168.675919,
      instLab: 228275.172,
      svcLab: 122257.406,
      adminLab: 132076.752,
      instVehicle: 21530,
      svcVehicle: 19200,
      adminVehicle: 0,
      totalInst: 367531.302883,
      totalSvc: 204508.027117,
      pool: 180776.752,
      sharedCosts: 48700,
      directInst: 0,
      directSvc: 0,
      enteredBiz: 48700,
      payrollTax: 0,
      instUtil: 36.666667,
      svcUtil: 20.263158,
      effInst: 3344,
      effSvc: 1848,
      totalAnnualPaid: 9120,
      utilFromDefault: false,
      weeksSubmitted: 18,
      hasStaff: true,
    });
  });

  it("computes per-staff breakdown (Mark)", () => {
    expectClose(calc.staffBreakdown[0] as unknown as Record<string, unknown>, {
      annualCost: 131622.88,
      base: 114608,
      burden: 15472.08,
      leaveLoading: 1542.8,
      weeksSubmitted: 18,
      burdenPct: 13.5,
    });
  });

  it("computes vehicle breakdown from driver allocations", () => {
    expect(calc.vehicleBreakdown).toEqual([
      { id: "v10", annual: 21530, iPct: 100, sPct: 0, aPct: 0 },
      { id: "v11", annual: 19200, iPct: 0, sPct: 100, aPct: 0 },
    ]);
  });

  it("grades 18 weeks of timesheets as Reliable", () => {
    expect(calc.confidence).toEqual({ label: "Reliable", level: "reliable" });
  });

  it("flags the baseline org's current rates as Underpriced", () => {
    expect(healthStatus(calc, BASELINE_DATA.currentRates)).toEqual({ status: "Underpriced", type: "warning" });
  });

  it("reports step completion", () => {
    expect(stepStatus(detailedData, calc, {})).toEqual({
      staff: { completion: "complete", mode: "detailed" },
      business: { completion: "complete", mode: "detailed" },
      vehicles: { completion: "complete", mode: "detailed" },
      risk: { completion: "customised", mode: null },
      profit: { completion: "defaults", mode: null },
    });
  });
});

describe("calculate — engine baseline (simple mode)", () => {
  const calc = calculate(simpleData);

  it("reproduces the ground-truth outputs of the original engine", () => {
    expectClose(calc as unknown as Record<string, unknown>, {
      recInst: 126.118936,
      recSvc: 136.432861,
      beInst: 100.895149,
      beSvc: 109.146289,
      afterHrs: 204.649291,
      emergency: 272.865722,
      projInst: 129.902505,
      projSvc: 140.525847,
      profInst: 25.223787,
      profSvc: 27.286572,
      daily: 1036.455291,
      instLab: 307328.307692,
      svcLab: 153664.153846,
      adminLab: 51221.384615,
      instVehicle: 20400,
      svcVehicle: 20400,
      adminVehicle: 0,
      totalInst: 394355.897436,
      totalSvc: 207377.948718,
      pool: 99941.384615,
      sharedCosts: 48720,
      directInst: 0,
      directSvc: 0,
      enteredBiz: 48720,
      payrollTax: 0,
      instUtil: 45,
      svcUtil: 22.5,
      effInst: 4104,
      effSvc: 2052,
      totalAnnualPaid: 9120,
      utilFromDefault: true,
      weeksSubmitted: 0,
      hasStaff: true,
    });
  });

  it("reports simple-mode step completion", () => {
    expect(stepStatus(simpleData, calc, {
      simpleLabourData: simpleData.simpleLabourData,
      simpleBusinessData: simpleData.simpleBusinessData,
      fleetSimpleMonths: simpleData.simpleVehicleData!.months,
    })).toEqual({
      staff: { completion: "complete", mode: "simple" },
      business: { completion: "complete", mode: "simple" },
      vehicles: { completion: "complete", mode: "simple" },
      risk: { completion: "customised", mode: null },
      profit: { completion: "defaults", mode: null },
    });
  });
});

// ─── Payroll-tax wage base ──────────────────────────────────────────────
// AU taxable wages = gross pay + employer super + leave loading, employees
// only. Explicit settings keep these valid across FY table refreshes.

const TAX_SETTINGS = {
  super_pct: 12,
  workers_comp_pct: 2,
  payroll_tax_enabled: true,
  payroll_tax_threshold: 1_200_000,
  payroll_tax_rate: 5.45,
  working_weeks: 48,
  working_hours: 8,
};

// Ten identical full-timers: base 10 × 58×38×52 = 1,146,080 (under the
// threshold on its own); super 12% = 137,529.60 and leave loading 15,428
// push taxable to 1,299,037.60. Ten heads keep per-hour rates realistic —
// a single employee with the same wage bill would trip the sanity ceiling.
const roster10 = Array.from({ length: 10 }, (_, i) => ({
  id: `e${i + 1}`, name: `Emp ${i + 1}`, hourly_wage: 58, employment_type: "Full Time",
  contracted_hours_per_week: 38, install_pct: 60, service_pct: 30, admin_pct: 10,
}));

describe("payroll tax — taxable wage base (detailed mode)", () => {
  it("includes super + leave loading: crosses the threshold on burden alone", () => {
    const calc = calculate({ staff: roster10, settings: TAX_SETTINGS });
    expect(calc.totalWages).toBeCloseTo(1_299_037.6, 4);
    // excess 99,037.60 × 5.45%
    expect(calc.payrollTax).toBeCloseTo(5_397.5492, 4);
  });

  it("without super the same wages stay under the threshold", () => {
    const calc = calculate({
      staff: roster10,
      settings: { ...TAX_SETTINGS, super_pct: 0 },
    });
    // base 1,146,080 + leave loading 15,428 = 1,161,508 < 1.2M
    expect(calc.totalWages).toBeCloseTo(1_161_508, 4);
    expect(calc.payrollTax).toBe(0);
  });

  it("excludes subcontractor invoices from the wage base entirely", () => {
    const subbie = {
      id: "s1", name: "Sub", hourly_wage: 1000, employment_type: "Subcontractor",
      contracted_hours_per_week: 40, install_pct: 100, service_pct: 0, admin_pct: 0,
    };
    const alone = calculate({ staff: [subbie], settings: TAX_SETTINGS });
    expect(alone.totalWages).toBe(0);
    expect(alone.payrollTax).toBe(0);

    // A big subbie alongside an employee changes nothing about the tax
    const mixed = calculate({ staff: [...roster10, subbie], settings: TAX_SETTINGS });
    expect(mixed.totalWages).toBeCloseTo(1_299_037.6, 4);
    expect(mixed.payrollTax).toBeCloseTo(5_397.5492, 4);
    expect(mixed.staffBreakdown.find(b => b.id === "s1")!.taxableWages).toBe(0);
  });

  it("distributes the tax into labour pools without loss, raising break-evens", () => {
    const withTax = calculate({ staff: roster10, settings: TAX_SETTINGS });
    const noTax = calculate({ staff: roster10, settings: { ...TAX_SETTINGS, payroll_tax_enabled: false } });
    const poolsWith = withTax.instLab + withTax.svcLab + withTax.adminLab;
    const poolsWithout = noTax.instLab + noTax.svcLab + noTax.adminLab;
    expect(poolsWith - poolsWithout).toBeCloseTo(withTax.payrollTax, 6);
    expect(withTax.beInst!).toBeGreaterThan(noTax.beInst!);
    expect(withTax.beSvc!).toBeGreaterThan(noTax.beSvc!);
  });

  it("casuals contribute base + super (no leave loading)", () => {
    const casual = {
      id: "c1", name: "Cas", hourly_wage: 50, employment_type: "Casual",
      contracted_hours_per_week: 38, install_pct: 100, service_pct: 0, admin_pct: 0,
    };
    const calc = calculate({ staff: [casual], settings: TAX_SETTINGS });
    // base 50×38×48 = 91,200 paid weeks only; × 1.12 for super
    expect(calc.totalWages).toBeCloseTo(91_200 * 1.12, 6);
  });
});

describe("employment classification — the roster vocabulary", () => {
  it("maps the roster labels to their pay class, tolerant of spelling", () => {
    // permanent
    for (const v of ["Full-time", "Full Time", "part-time", "Part Time", "Apprentice", "", undefined])
      expect(classifyEmployment(v)).toBe("permanent");
    // subbie — the one whose misclassification changes the tax base
    for (const v of ["Subcontractor", "Sub-contractor", "sub contractor", "contractor"])
      expect(classifyEmployment(v)).toBe("subbie");
    expect(classifyEmployment("Casual")).toBe("casual");
  });

  it("classifies an APPRENTICE as permanent — super + leave, not special", () => {
    const appr = {
      id: "a1", name: "Appr", hourly_wage: 30, employment_type: "Apprentice",
      contracted_hours_per_week: 38, install_pct: 100, service_pct: 0, admin_pct: 0,
    };
    const perm = { ...appr, id: "p1", employment_type: "Full-time" };
    // an apprentice is priced exactly like any other permanent
    expect(calculate({ staff: [appr], settings: TAX_SETTINGS }).totalWages)
      .toBeCloseTo(calculate({ staff: [perm], settings: TAX_SETTINGS }).totalWages, 6);
    // and unlike a subbie, they DO carry super into the wage base
    expect(calculate({ staff: [appr], settings: TAX_SETTINGS }).totalWages).toBeGreaterThan(0);
  });

  it("prices the roster's hyphenated vocab identically to the old spaced labels", () => {
    // the parity guarantee: feeding staff_profiles.employment_type straight in
    // produces the same numbers the space-separated fixtures always did
    const hyphen = { id: "x", name: "X", hourly_wage: 60, employment_type: "Full-time",
      contracted_hours_per_week: 38, install_pct: 100, service_pct: 0, admin_pct: 0 };
    const spaced = { ...hyphen, employment_type: "Full Time" };
    expect(calculate({ staff: [hyphen], settings: TAX_SETTINGS }).totalWages)
      .toBe(calculate({ staff: [spaced], settings: TAX_SETTINGS }).totalWages);

    const subHyphen = { ...hyphen, id: "s", employment_type: "Sub-contractor" };
    const subPlain = { ...hyphen, id: "s", employment_type: "Subcontractor" };
    // both are subbies → zero wage base
    expect(calculate({ staff: [subHyphen], settings: TAX_SETTINGS }).totalWages).toBe(0);
    expect(calculate({ staff: [subPlain], settings: TAX_SETTINGS }).totalWages).toBe(0);
  });
});

describe("payroll tax — simple labour mode", () => {
  const simpleTax = (months: number[], enabled = true) => calculate({
    simpleLabourData: { months, install_pct: 60, service_pct: 30, admin_pct: 10, staff_count: 8, billable_pct: 75 },
    settings: { ...TAX_SETTINGS, payroll_tax_enabled: enabled },
  });

  it("applies payroll tax when the wage bill crosses the threshold", () => {
    const calc = simpleTax([110_000, 110_000, 110_000]);
    // projAnnual 1.32M + super 158,400 + leave loading 17,769.23 = 1,496,169.23
    expect(calc.totalWages).toBeCloseTo(1_496_169.2307692308, 4);
    // excess 296,169.23 × 5.45%
    expect(calc.payrollTax).toBeCloseTo(16_141.2230769231, 4);
  });

  it("conserves the tax into the labour pools and raises break-even", () => {
    const withTax = simpleTax([110_000, 110_000, 110_000]);
    const noTax = simpleTax([110_000, 110_000, 110_000], false);
    const diff = (withTax.instLab + withTax.svcLab + withTax.adminLab)
      - (noTax.instLab + noTax.svcLab + noTax.adminLab);
    expect(diff).toBeCloseTo(withTax.payrollTax, 6);
    expect(withTax.beInst!).toBeGreaterThan(noTax.beInst!);
  });

  it("is zero below the threshold and when disabled", () => {
    expect(simpleTax([50_000, 50_000, 50_000]).payrollTax).toBe(0);
    expect(simpleTax([110_000, 110_000, 110_000], false).payrollTax).toBe(0);
  });
});

// ─── Simple-mode leave loading ──────────────────────────────────────────
// Regression: this used to divide the monthly wage bill by weeks/12, so the
// loading scaled by 52/weeks — 8.3% high at 48, and drifting with a setting
// that has nothing to do with what leave costs. Lowering working_weeks would
// cut billable hours AND inflate this cost, compounding in the same direction.
describe("simple-mode leave loading", () => {
  const ll = (working_weeks: number) => calculate({
    simpleLabourData: { months: [110_000, 110_000, 110_000], install_pct: 60, service_pct: 30, admin_pct: 10, staff_count: 8, billable_pct: 75 },
    settings: { ...TAX_SETTINGS, working_weeks, payroll_tax_enabled: false },
  }).staffBreakdown[0].leaveLoading;

  it("does not move with working_weeks", () => {
    expect(ll(44)).toBeCloseTo(ll(48), 8);
    expect(ll(52)).toBeCloseTo(ll(48), 8);
  });

  it("derives the weekly wage from the 52 weeks actually paid", () => {
    expect(ll(48)).toBeCloseTo(1_320_000 / 52 * 4 * 0.175, 6); // 17,769.230769
  });

  it("matches detailed mode on the same 52-week wage bill", () => {
    const annualWage = 58 * 38 * 52; // 114,608 — one full-timer
    const detailed = calculate({ staff: [roster10[0]], settings: { ...TAX_SETTINGS, payroll_tax_enabled: false } });
    const simple = calculate({
      simpleLabourData: { months: [annualWage / 12, annualWage / 12, annualWage / 12], install_pct: 60, service_pct: 30, admin_pct: 10, staff_count: 1, billable_pct: 75 },
      settings: { ...TAX_SETTINGS, payroll_tax_enabled: false },
    });
    expect(simple.staffBreakdown[0].leaveLoading).toBeCloseTo(detailed.staffBreakdown[0].leaveLoading, 6);
  });
});

describe("super guarantee default", () => {
  it("defaults burden to 12% super + 2% workers comp when settings are silent", () => {
    const calc = calculate({ staff: [{ ...roster10[0], hourly_wage: 45 }], settings: {} });
    expect(calc.staffBreakdown[0].burdenPct).toBe(14);
  });
});

describe("calculate — guards and empties", () => {
  it("returns null rates with no staff", () => {
    const calc = calculate({ settings: BASELINE_SETTINGS });
    expect(calc.hasStaff).toBe(false);
    expect(calc.recInst).toBeNull();
    expect(calc.recSvc).toBeNull();
    expect(calc.beInst).toBeNull();
  });

  it("health is Setup Incomplete with no staff", () => {
    const calc = calculate({ settings: BASELINE_SETTINGS });
    expect(healthStatus(calc, {})).toEqual({ status: "Setup Incomplete", type: "neutral" });
  });

  it("health prompts for current rates when none set", () => {
    const calc = calculate(detailedData);
    expect(healthStatus(calc, { install: null, service: null })).toEqual({ status: "Set Your Rates", type: "warning" });
  });

  it("health is High Risk far below break-even and Healthy at recommended", () => {
    const calc = calculate(detailedData);
    expect(healthStatus(calc, { install: 90, service: 90 }).status).toBe("High Risk");
    expect(healthStatus(calc, { install: 150, service: 155 }).status).toBe("Healthy");
  });
});
