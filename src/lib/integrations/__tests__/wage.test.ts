import {
  isAdoptable,
  isPlausibleHourly,
  MAX_HOURLY,
  resolveXeroPay,
  wageDrift,
  type EarningsRate,
  type OrdinaryLine,
} from "../wage";
import { shapeEarningsRates, shapeOrdinaryLine } from "../xero-shape";

/* `hourly_wage` is the column every charge-out rate in the Rate Calculator
   derives from, so the cases that matter here are the ones where this module
   must REFUSE to produce a number: a salary, a multiplier, a missing rate. A
   wrong figure adopted from here would propagate into what the business
   charges its customers. */

const line = (o: Partial<OrdinaryLine> = {}): OrdinaryLine => ({
  earningsRateID: "er-1",
  calculationType: "ENTEREARNINGSRATE",
  ratePerUnit: 58,
  annualSalary: null,
  numberOfUnitsPerWeek: null,
  ...o,
});

const rate = (o: Partial<EarningsRate> = {}): EarningsRate => ({
  earningsRateID: "er-1",
  name: "Ordinary Hours",
  rateType: "RATEPERUNIT",
  ratePerUnit: 61.5,
  ...o,
});

describe("resolveXeroPay", () => {
  it("reads a rate typed on the employee's own template", () => {
    expect(resolveXeroPay(line(), [])).toEqual({ kind: "hourly", rate: 58, source: "template" });
  });

  /* The rate lives on the ORGANISATION, not the person — one lookup for
     everyone rather than a number that isn't on the employee at all. */
  it("resolves a rate inherited from the organisation's earnings rate", () => {
    const inherited = line({ calculationType: "USEEARNINGSRATE", ratePerUnit: null });
    expect(resolveXeroPay(inherited, [rate()])).toEqual({
      kind: "hourly",
      rate: 61.5,
      source: "earnings-rate",
    });
  });

  /* THE DIVISOR IS 52, NOT working_weeks. A salary pays every week of the
     year — Xero cuts each pay as annual ÷ 52 — so the hourly rate behind it is
     fully determined, and the Rate Calculator's 46 billable weeks is a pricing
     concept with no business here. (User correction, 2026-07-27.) */
  it("converts a salary the way payroll does: ÷ 52, ÷ weekly hours", () => {
    const salaried = line({
      calculationType: "ANNUALSALARY",
      ratePerUnit: null,
      annualSalary: 95_000,
      numberOfUnitsPerWeek: 38,
    });
    expect(resolveXeroPay(salaried, [])).toEqual({
      kind: "hourly",
      rate: 48.08, // 95000 / 52 / 38, to the cent
      source: "salary",
      annual: 95_000,
      hoursPerWeek: 38,
    });
  });

  it("leaves a salary unconverted only when Xero states no weekly hours", () => {
    const noHours = line({
      calculationType: "ANNUALSALARY",
      ratePerUnit: null,
      annualSalary: 95_000,
      numberOfUnitsPerWeek: null,
    });
    // no denominator — there is no honest hourly figure to offer
    expect(resolveXeroPay(noHours, [])).toEqual({
      kind: "salary",
      annual: 95_000,
      hoursPerWeek: null,
    });
  });

  it("refuses a rate type that isn't hourly", () => {
    const inherited = line({ calculationType: "USEEARNINGSRATE", ratePerUnit: null });
    const multiplier = rate({ rateType: "MULTIPLE", name: "Overtime x1.5" });
    const out = resolveXeroPay(inherited, [multiplier]);
    expect(out.kind).toBe("not-hourly");
    expect(out.kind === "not-hourly" && out.note).toContain("Overtime x1.5");
  });

  it("says so when the inherited rate can't be found at all", () => {
    const inherited = line({ calculationType: "USEEARNINGSRATE", ratePerUnit: null });
    expect(resolveXeroPay(inherited, []).kind).toBe("not-hourly");
  });

  it("says so when a template line carries no rate", () => {
    expect(resolveXeroPay(line({ ratePerUnit: null }), []).kind).toBe("not-hourly");
  });

  it("falls back to a bare rate when Xero gives no calculation type", () => {
    expect(resolveXeroPay(line({ calculationType: null }), [])).toEqual({
      kind: "hourly",
      rate: 58,
      source: "template",
    });
  });

  it("is unknown with no line at all", () => {
    expect(resolveXeroPay(null, [])).toEqual({ kind: "unknown" });
    expect(resolveXeroPay(line({ calculationType: null, ratePerUnit: null }), [])).toEqual({
      kind: "unknown",
    });
  });

  it("treats zero and negative rates as no rate", () => {
    expect(resolveXeroPay(line({ ratePerUnit: 0 }), []).kind).toBe("not-hourly");
    expect(resolveXeroPay(line({ ratePerUnit: -5 }), []).kind).toBe("not-hourly");
  });
});

describe("wageDrift", () => {
  const hourly = (rate: number) => ({ kind: "hourly" as const, rate, source: "template" as const });

  it("says nothing is wrong when both agree", () => {
    expect(wageDrift(58, hourly(58))).toEqual({ kind: "match", rate: 58 });
  });

  /* Two rates a fraction of a cent apart are the same rate rounded differently
     somewhere, not a disagreement worth prompting about. */
  it("tolerates sub-cent rounding", () => {
    expect(wageDrift(58.001, hourly(58)).kind).toBe("match");
  });

  it("reports a real difference, with the delta signed", () => {
    expect(wageDrift(58, hourly(61.5))).toEqual({
      kind: "differs",
      here: 58,
      xero: 61.5,
      delta: 3.5,
    });
    expect(wageDrift(61.5, hourly(58))).toMatchObject({ delta: -3.5 });
  });

  it("treats no wage here as new information rather than a match", () => {
    expect(wageDrift(null, hourly(58))).toEqual({ kind: "differs", here: null, xero: 58, delta: 58 });
    expect(wageDrift(0, hourly(58))).toMatchObject({ kind: "differs", here: null });
  });

  it("compares a salary-derived rate like any other, carrying its working", () => {
    const drift = wageDrift(58, {
      kind: "hourly",
      rate: 48.08,
      source: "salary",
      annual: 95_000,
      hoursPerWeek: 38,
    });
    expect(drift).toEqual({
      kind: "differs",
      here: 58,
      xero: 48.08,
      delta: -9.92,
      basis: { annual: 95_000, hoursPerWeek: 38 },
    });
    expect(isAdoptable(drift)).toBe(true);
  });

  it("passes a no-hours salary through with no number to adopt", () => {
    const drift = wageDrift(58, { kind: "salary", annual: 95_000, hoursPerWeek: null });
    expect(drift).toMatchObject({ kind: "salary", annual: 95_000, here: 58 });
    expect(isAdoptable(drift)).toBe(false);
  });

  it("carries the reason through when there's nothing comparable", () => {
    expect(wageDrift(58, { kind: "not-hourly", note: "Not an hourly rate." })).toEqual({
      kind: "none",
      note: "Not an hourly rate.",
    });
    expect(wageDrift(58, { kind: "unknown" })).toEqual({ kind: "none", note: null });
  });

  it("only ever offers an adopt on an hourly-vs-hourly difference", () => {
    expect(isAdoptable(wageDrift(58, hourly(61.5)))).toBe(true);
    expect(isAdoptable(wageDrift(58, hourly(58)))).toBe(false);
    expect(isAdoptable(wageDrift(58, { kind: "unknown" }))).toBe(false);
  });
});

describe("isPlausibleHourly", () => {
  /* A guard against a cents/dollars confusion in a pay template writing an
     absurd figure into the column charge-out rates derive from. */
  it("accepts a real trade wage and refuses nonsense", () => {
    expect(isPlausibleHourly(58)).toBe(true);
    expect(isPlausibleHourly(MAX_HOURLY)).toBe(true);
    expect(isPlausibleHourly(MAX_HOURLY + 1)).toBe(false);
    expect(isPlausibleHourly(0)).toBe(false);
    expect(isPlausibleHourly(-5)).toBe(false);
    expect(isPlausibleHourly(Number.NaN)).toBe(false);
  });
});

describe("shapeOrdinaryLine", () => {
  const employee = {
    ordinaryEarningsRateID: "er-ord",
    payTemplate: {
      earningsLines: [
        { earningsRateID: "er-ot", calculationType: "ENTEREARNINGSRATE", ratePerUnit: 87 },
        { earningsRateID: "er-ord", calculationType: "ENTEREARNINGSRATE", ratePerUnit: 58 },
      ],
    },
    // things on the detail payload that must not survive
    bankAccounts: [{ accountNumber: "123456" }],
    superMemberships: [{ superFundID: "sf-1" }],
  };

  /* A pay template carries overtime and allowance lines too. Picking the wrong
     one would compare an overtime rate to a base wage — and $87 would look
     like a very generous employer. */
  it("picks the line the employee names as ordinary, not the first one", () => {
    expect(shapeOrdinaryLine(employee)?.ratePerUnit).toBe(58);
  });

  it("takes the only line when a template has exactly one", () => {
    const single = {
      payTemplate: { earningsLines: [{ earningsRateID: "er-x", ratePerUnit: 45 }] },
    };
    expect(shapeOrdinaryLine(single)?.ratePerUnit).toBe(45);
  });

  /* Never guess among several — that is the overtime-vs-base mistake again. */
  it("refuses to guess when several lines exist and none is named ordinary", () => {
    const ambiguous = {
      payTemplate: {
        earningsLines: [
          { earningsRateID: "er-a", ratePerUnit: 50 },
          { earningsRateID: "er-b", ratePerUnit: 90 },
        ],
      },
    };
    expect(shapeOrdinaryLine(ambiguous)).toBeNull();
  });

  it("drops everything else on the detail payload", () => {
    const json = JSON.stringify(shapeOrdinaryLine(employee));
    expect(json).not.toContain("123456");
    expect(json).not.toContain("sf-1");
  });

  it("degrades to null on anything unusable", () => {
    expect(shapeOrdinaryLine(null)).toBeNull();
    expect(shapeOrdinaryLine({})).toBeNull();
    expect(shapeOrdinaryLine({ payTemplate: { earningsLines: [] } })).toBeNull();
  });
});

describe("shapeEarningsRates", () => {
  it("parses the string rate Xero puts on org-level rates", () => {
    expect(
      shapeEarningsRates([
        { earningsRateID: "er-1", name: "Ordinary Hours", rateType: "rateperunit", ratePerUnit: "61.5000" },
      ])
    ).toEqual([
      { earningsRateID: "er-1", name: "Ordinary Hours", rateType: "RATEPERUNIT", ratePerUnit: 61.5 },
    ]);
  });

  it("keeps a rate with no amount, so the caller can say why it's unusable", () => {
    expect(shapeEarningsRates([{ earningsRateID: "er-1", name: "Bonus" }])[0]).toMatchObject({
      ratePerUnit: null,
    });
  });

  it("drops a rate with no id and degrades for a non-array", () => {
    expect(shapeEarningsRates([{ name: "Nameless" }])).toEqual([]);
    expect(shapeEarningsRates(undefined)).toEqual([]);
  });
});
