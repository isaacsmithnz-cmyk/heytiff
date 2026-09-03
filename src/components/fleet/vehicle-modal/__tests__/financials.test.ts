import type { Vehicle, VehicleFinance, VehicleLog, VehiclePolicy } from "../../logic";
import {
  addMonths,
  costToRun,
  currentFinance,
  financeEndsOn,
  financePosition,
  financeRows,
  previousFinance,
  purchaseRows,
  repaymentLabel,
  valueNotes,
} from "../derive";

/* The Financials screen's reasoning, with no DOM. What these pin is the rule
   the screen states out loud: nothing here is a forecast. The position on the
   schedule is arithmetic on the agreement's own terms, the cost to run is what
   was logged and what the policies in force cost, and a figure nobody
   recorded is a blank, never $0. */

const TODAY = "2026-09-03";

const agreement: VehicleFinance = {
  id: "f1",
  lender: "Macquarie Leasing",
  agreementNo: "402193",
  kind: "chattel_mortgage",
  startsOn: "2022-09-01",
  termMonths: 60,
  repayment: 742,
  frequency: "monthly",
  ratePct: 7.45,
  balloon: 12000,
  amountFinanced: 38500,
  documentId: null,
  source: "scan",
};

const van: Vehicle = {
  id: "v1",
  name: "WORK TRITON",
  make: "Mitsubishi",
  model: "Triton",
  year: 2022,
  plate: "YLI59V",
  plateState: "NSW",
  status: "active",
  odometer: 108375,
  regoDays: 391,
  insuranceDays: 20,
  ctpDays: 391,
  serviceIntervalKm: 10000,
  lastServiceOdo: 100000,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true,
  assignedTo: null,
  value: 27000,
  purchasePrice: 41990,
  purchaseDateDays: 597,
  lastServiceDays: 41,
  purchaseSupplier: "Sydney City Mitsubishi",
  purchaseInvoiceNo: "TI-88213",
  purchaseExGst: 36354.55,
  purchaseGst: 3635.45,
  purchaseOnRoad: 2000,
  purchaseDeposit: 4000,
  purchaseOdometer: 12,
};

describe("addMonths / financeEndsOn", () => {
  it("clamps to the month's last day rather than rolling into the next", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
  });

  it("ends the schedule at start plus term", () => {
    expect(financeEndsOn(agreement)).toBe("2027-09-01");
  });
});

describe("financePosition", () => {
  it("counts the repayments fallen due — 48 of 60 four years in", () => {
    const pos = financePosition(agreement, "2026-09-03");
    expect(pos).toMatchObject({
      total: 60,
      made: 48,
      remaining: 12,
      payout: 12 * 742 + 12000,
      started: true,
      ended: false,
    });
    expect(pos.progress).toBeCloseTo(0.8);
  });

  it("does not count a month until its day has come", () => {
    expect(financePosition(agreement, "2026-08-31").made).toBe(47);
    expect(financePosition(agreement, "2026-09-01").made).toBe(48);
  });

  it("caps at the schedule and reports the end", () => {
    expect(financePosition(agreement, "2028-01-01")).toMatchObject({ made: 60, remaining: 0, payout: 12000, ended: true });
  });

  it("has no payout when the agreement didn't state a repayment", () => {
    expect(financePosition({ ...agreement, repayment: null }, TODAY).payout).toBeNull();
  });

  it("counts fortnights and weeks by days", () => {
    // 1 Jun → 3 Sep is 94 days: six fortnights, thirteen weeks
    const fortnightly = { ...agreement, frequency: "fortnightly" as const, termMonths: 12, startsOn: "2026-06-01" };
    expect(financePosition(fortnightly, TODAY)).toMatchObject({ total: 26, made: 6 });
    const weekly = { ...fortnightly, frequency: "weekly" as const };
    expect(financePosition(weekly, TODAY)).toMatchObject({ total: 52, made: 13 });
  });

  it("has nothing fallen due before the agreement starts", () => {
    expect(financePosition({ ...agreement, startsOn: "2027-01-01" }, TODAY)).toMatchObject({ made: 0, started: false });
  });
});

describe("currentFinance / previousFinance", () => {
  it("is the newest schedule, not the newest row", () => {
    const refinanced = { ...agreement, id: "f0", startsOn: "2019-01-01", createdAt: "2026-01-01" };
    expect(currentFinance([refinanced, agreement])?.id).toBe("f1");
    expect(previousFinance([refinanced, agreement]).map((f) => f.id)).toEqual(["f0"]);
    expect(currentFinance([])).toBeNull();
  });
});

describe("financeRows / repaymentLabel", () => {
  it("says what the lender wrote and Not recorded for the rest", () => {
    const rows = financeRows({ ...agreement, agreementNo: null, balloon: null });
    const by = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(by.REPAYMENT.value).toBe("$742 / month");
    expect(by.ENDS.value).toBe("1 Sep 2027");
    expect(by.RATE.value).toBe("7.45% p.a.");
    expect(by["AGREEMENT NO."]).toMatchObject({ value: "Not recorded", faint: true });
    expect(by.BALLOON).toMatchObject({ value: "Not recorded", faint: true });
  });

  it("labels the repayment by its frequency", () => {
    expect(repaymentLabel({ ...agreement, frequency: "weekly", repayment: 171.2 })).toBe("$171 / week");
    expect(repaymentLabel({ ...agreement, repayment: null })).toBeNull();
  });
});

describe("purchaseRows", () => {
  it("reads PAID when nothing is financed, and DEPOSIT + BALANCE when something is", () => {
    const outright = Object.fromEntries(purchaseRows({ ...van, purchaseDeposit: null }, TODAY, null).map((r) => [r.label, r]));
    expect(outright.PAID.value).toBe("$41,990");
    expect(outright["BALANCE FINANCED"]).toBeUndefined();
    expect(outright.FUNDING).toMatchObject({ value: "No finance recorded", faint: true });

    const financed = Object.fromEntries(purchaseRows(van, TODAY, agreement).map((r) => [r.label, r]));
    expect(financed["DEPOSIT PAID"].value).toBe("$4,000");
    expect(financed["BALANCE FINANCED"].value).toBe("$38,500");
    expect(financed.FUNDING.value).toBe("Deposit + finance");
    expect(financed["ODOMETER AT PURCHASE"].value).toBe("12 km");
  });

  it("never prints $0 for a line the invoice didn't have", () => {
    const rows = Object.fromEntries(purchaseRows({ ...van, purchaseGst: null, purchaseDateDays: 0 }, TODAY, null).map((r) => [r.label, r]));
    expect(rows.GST).toMatchObject({ value: "Not recorded", faint: true });
    expect(rows.DATE).toMatchObject({ value: "Not recorded", faint: true });
  });
});

describe("valueNotes", () => {
  it("says where the estimate came from and whether the odometer has left it behind", () => {
    const val = { point: 27000, low: 24500, high: 29500, note: "2022 Triton GLX+ utes at similar km", atOdo: 105000 };
    expect(valueNotes(val, van, true)).toEqual([
      "2022 Triton GLX+ utes at similar km",
      "Valued at 105,000 km",
      "Odometer has moved 3,375 km since — value again for a current figure",
    ]);
    expect(valueNotes(undefined, van, false)).toEqual([]);
  });
});

describe("costToRun", () => {
  const log = (over: Partial<VehicleLog>): VehicleLog => ({
    id: "l",
    vehicleId: "v1",
    staffId: null,
    kind: "fuel",
    when: "",
    ago: 10,
    ...over,
  });
  const policy = (kind: VehiclePolicy["kind"], premium: number | null, termMonths?: number): VehiclePolicy => ({
    id: kind,
    kind,
    provider: "X",
    premium,
    startsOn: null,
    expiresOn: "2027-06-30",
    documentId: null,
    termMonths,
  });

  it("adds up what was logged in the window and annualises the policies in force", () => {
    const c = costToRun(
      van,
      [
        log({ cost: 100, odo: 100000, ago: 300 }),
        log({ cost: 120, odo: 104000, ago: 5 }),
        log({ cost: 999, ago: 400 }), // outside the window
        log({ kind: "service", cost: 480, odo: 102000, ago: 100 }),
      ],
      [policy("insurance", 1842.6), policy("rego", 504, 6), policy("ctp", null)],
      [agreement],
      TODAY,
    );
    const by = Object.fromEntries(c.items.map((i) => [i.key, i.value]));
    expect(by.fuel).toBe(220);
    expect(by.service).toBe(480);
    expect(by.insurance).toBe(1842.6);
    expect(by.rego).toBe(1008); // a six-month notice, twice a year
    expect(by.ctp).toBeNull(); // a slip with no premium read is a blank, not $0
    expect(by.finance).toBe(742 * 12);
    expect(c.known).toBe(5);
    expect(c.total).toBeCloseTo(220 + 480 + 1842.6 + 1008 + 8904);
    expect(c.kmDriven).toBe(4000);
    expect(c.perKm).toBeCloseTo(c.total / 4000);
    expect(c.sinceIso).toBe("2025-09-03");
  });

  it("has no fuel line for a trailer and no finance line once the schedule has ended", () => {
    const c = costToRun({ ...van, motorised: false }, [], [], [{ ...agreement, startsOn: "2019-01-01", termMonths: 12 }], TODAY);
    expect(c.items.map((i) => i.key)).toEqual(["insurance", "rego", "ctp", "service"]);
    expect(c.known).toBe(0);
    expect(c.perKm).toBeNull();
  });

  it("needs two odometer readings at least 100 km apart before it quotes a per-km figure", () => {
    const c = costToRun(van, [log({ cost: 100, odo: 100000 }), log({ cost: 100, odo: 100050 })], [], [], TODAY);
    expect(c.total).toBe(200);
    expect(c.kmDriven).toBe(50);
    expect(c.perKm).toBeNull();
  });
});
