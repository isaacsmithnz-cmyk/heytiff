/* What Xero pays somebody, and how that differs from what HeyTiff thinks —
   pure, because every judgement in here is one that must be inspectable.

   HEYTIFF OWNS `staff_profiles.hourly_wage`. Nothing in this module writes
   anything; it reports a difference and lets a person decide. That is the same
   doctrine as employment type, and it matters more here, because this number
   is the one every charge-out rate in the Rate Calculator is derived from.

   THE HARD PART IS THAT XERO HAS THREE WAYS TO SAY "what they're paid", and
   only two of them are an hourly rate:

     ENTEREARNINGSRATE  the rate is on the employee's own pay template. This is
                        the ordinary case for a tradesperson, and it is directly
                        comparable.
     USEEARNINGSRATE    the employee inherits the rate from the ORGANISATION's
                        earnings rate — so the number isn't on the employee at
                        all and has to be looked up.
     ANNUALSALARY       they're on a salary — converted to hourly the one way
                        payroll actually does it: ÷ 52, ÷ hours per week.

   THE SALARY DIVISOR IS 52, NOT working_weeks. These are different domains and
   conflating them was a real bug in this module's first version. The Rate
   Calculator's `working_weeks` (46) is a CHARGE-OUT concept — how many weeks
   of the year are billable when spreading costs into a price. It is a pricing
   tool, not a payroll engine. Payroll pays every week of the year: Xero takes
   the annual salary and divides by 52 to cut each pay, so the true hourly PAY
   rate behind a $95,000 salary at 38h/week is 95000 ÷ 52 ÷ 38 — the same
   number Xero itself is paying from. When the template doesn't say the weekly
   hours, there is no denominator and the salary is reported unconverted. */

/** An earnings rate as defined on the ORGANISATION (Xero's pay items). */
export type EarningsRate = {
  earningsRateID: string;
  name: string;
  /** RATEPERUNIT | MULTIPLE | FIXEDAMOUNT — only the first is an hourly rate. */
  rateType: string | null;
  /** Xero types this as a string on the org-level rate. */
  ratePerUnit: number | null;
};

/** The line on an employee's pay template that pays their ordinary hours. */
export type OrdinaryLine = {
  earningsRateID: string;
  /** USEEARNINGSRATE | ENTEREARNINGSRATE | ANNUALSALARY */
  calculationType: string | null;
  ratePerUnit: number | null;
  annualSalary: number | null;
  numberOfUnitsPerWeek: number | null;
};

/** What Xero pays them, resolved as far as it honestly can be. */
export type XeroPay =
  /** A comparable hourly rate. A salary-derived one carries its provenance so
      the screen can show the working (annual ÷ 52 ÷ hours). */
  | {
      kind: "hourly";
      rate: number;
      source: "template" | "earnings-rate" | "salary";
      annual?: number;
      hoursPerWeek?: number;
    }
  /** A salary whose weekly hours Xero doesn't state — no denominator, so no
      honest hourly figure. Reported unconverted. */
  | { kind: "salary"; annual: number; hoursPerWeek: null }
  /** Xero has a pay template but nothing hourly in it (a multiplier or a
      fixed amount), or the rate it points at doesn't exist. */
  | { kind: "not-hourly"; note: string }
  /** No pay template, or no ordinary line on it. */
  | { kind: "unknown" };

/** Weeks in a pay year. Payroll's constant, not the Rate Calculator's
    `working_weeks` — a salary pays every week, worked or not. */
export const PAY_WEEKS = 52;

/** annual ÷ 52 ÷ hours-per-week, to the cent — the same arithmetic Xero uses
    to cut each pay from the salary. */
export function salaryToHourly(annual: number, hoursPerWeek: number): number {
  return Math.round((annual / PAY_WEEKS / hoursPerWeek) * 100) / 100;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
};

/** Resolve what Xero pays someone for their ordinary hours.

    `rates` is the organisation's earnings-rate list, needed only for the
    USEEARNINGSRATE case — one call for the whole org, not one per person. */
export function resolveXeroPay(
  line: OrdinaryLine | null,
  rates: EarningsRate[]
): XeroPay {
  if (!line) return { kind: "unknown" };

  const calc = (line.calculationType ?? "").toUpperCase();

  if (calc === "ANNUALSALARY") {
    const annual = num(line.annualSalary);
    if (!annual) return { kind: "unknown" };
    const hoursPerWeek = num(line.numberOfUnitsPerWeek);
    // With the weekly hours known, the hourly rate is fully determined — it is
    // what Xero itself pays from. Without them there's no denominator.
    if (hoursPerWeek) {
      return {
        kind: "hourly",
        rate: salaryToHourly(annual, hoursPerWeek),
        source: "salary",
        annual,
        hoursPerWeek,
      };
    }
    return { kind: "salary", annual, hoursPerWeek: null };
  }

  if (calc === "ENTEREARNINGSRATE") {
    const rate = num(line.ratePerUnit);
    return rate
      ? { kind: "hourly", rate, source: "template" }
      : { kind: "not-hourly", note: "Xero has no rate on their pay template." };
  }

  if (calc === "USEEARNINGSRATE") {
    const rate = rates.find((r) => r.earningsRateID === line.earningsRateID);
    if (!rate) {
      return { kind: "not-hourly", note: "Xero's pay rate for them couldn't be found." };
    }
    if ((rate.rateType ?? "").toUpperCase() !== "RATEPERUNIT") {
      // A multiplier or fixed amount is not an hourly wage, and pretending
      // otherwise would put a meaningless number next to a real one.
      return { kind: "not-hourly", note: `Xero pays them on "${rate.name}", which isn't an hourly rate.` };
    }
    const value = num(rate.ratePerUnit);
    return value
      ? { kind: "hourly", rate: value, source: "earnings-rate" }
      : { kind: "not-hourly", note: `Xero's "${rate.name}" rate has no amount set.` };
  }

  /* An employee's template can carry a rate with no calculation type at all —
     fall back to it rather than reporting nothing, since a bare ratePerUnit is
     unambiguous. */
  const bare = num(line.ratePerUnit);
  if (bare) return { kind: "hourly", rate: bare, source: "template" };

  return { kind: "unknown" };
}

/* ── drift ── */

/** How the screen shows a salary-derived rate's working. */
export type SalaryBasis = { annual: number; hoursPerWeek: number };

export type WageDrift =
  /** Both sides agree, within rounding. */
  | { kind: "match"; rate: number; basis?: SalaryBasis }
  /** Both are hourly and they differ — the case with an adopt button. A
      salary-derived rate carries its basis so the row can show the ÷52 working
      instead of presenting a computed number as if Xero typed it. */
  | { kind: "differs"; here: number | null; xero: number; delta: number; basis?: SalaryBasis }
  /** A salary with no stated weekly hours — no denominator, nothing to adopt. */
  | { kind: "salary"; annual: number; hoursPerWeek: null; here: number | null }
  /** Nothing comparable to say. */
  | { kind: "none"; note: string | null }
  /** The read itself failed — Xero wasn't asked or didn't answer. Produced by
      the comparison layer, never by `wageDrift`: "we couldn't look" must stay
      distinguishable from "we looked and there's nothing to compare", because
      only the second may lower the drift count. The audit found a transient
      Xero failure across linked staff writing drift_count = 0 and taking the
      warning down. */
  | { kind: "unreadable" };

/** Cents. Two rates that differ by less than this are the same rate that has
    been rounded differently somewhere, not a disagreement worth a prompt. */
const TOLERANCE = 0.005;

export function wageDrift(here: number | null, xero: XeroPay): WageDrift {
  switch (xero.kind) {
    case "hourly": {
      const basis =
        xero.source === "salary" && xero.annual && xero.hoursPerWeek
          ? { annual: xero.annual, hoursPerWeek: xero.hoursPerWeek }
          : undefined;
      if (here === null || !(here > 0)) {
        // No wage recorded here at all — Xero's is strictly new information,
        // and it is the case where adopting is most obviously right.
        return { kind: "differs", here: null, xero: xero.rate, delta: xero.rate, basis };
      }
      const delta = Math.round((xero.rate - here) * 100) / 100;
      if (Math.abs(xero.rate - here) < TOLERANCE) return { kind: "match", rate: here, basis };
      return { kind: "differs", here, xero: xero.rate, delta, basis };
    }
    case "salary":
      return { kind: "salary", annual: xero.annual, hoursPerWeek: null, here };
    case "not-hourly":
      return { kind: "none", note: xero.note };
    case "unknown":
      return { kind: "none", note: null };
  }
}

/** Does this drift have a number a person could adopt? Only an hourly-vs-hourly
    difference does — the salary case deliberately does not. */
export function isAdoptable(drift: WageDrift): drift is Extract<WageDrift, { kind: "differs" }> {
  return drift.kind === "differs";
}

/** The most a wage can be set to by adopting. Not a policy about pay — a guard
    against a mis-read rate (a cents/dollars confusion in a pay template)
    writing an absurd figure into the column every charge-out rate derives from. */
export const MAX_HOURLY = 1000;

export function isPlausibleHourly(rate: number): boolean {
  return Number.isFinite(rate) && rate > 0 && rate <= MAX_HOURLY;
}
