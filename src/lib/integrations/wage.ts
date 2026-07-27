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
     ANNUALSALARY       they're on a salary. THIS IS NOT AN HOURLY RATE, and it
                        is deliberately never converted into one — see below.

   WHY A SALARY IS REPORTED AND NEVER CONVERTED. Turning $95,000/yr into an
   hourly figure needs an hours-per-year assumption, and the Rate Calculator
   already has a considered one that is NOT 52×38: it uses `working_weeks`,
   defaulted to 46, precisely because a paid year is not a worked year. Any
   conversion done here would either contradict that model or silently
   duplicate it. So the salary is shown as a salary, no adopt button is
   offered, and a human decides what hourly figure it means for their business. */

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
  /** A comparable hourly rate. */
  | { kind: "hourly"; rate: number; source: "template" | "earnings-rate" }
  /** A salary. Real, but not an hourly rate — reported, never converted. */
  | { kind: "salary"; annual: number; hoursPerWeek: number | null }
  /** Xero has a pay template but nothing hourly in it (a multiplier or a
      fixed amount), or the rate it points at doesn't exist. */
  | { kind: "not-hourly"; note: string }
  /** No pay template, or no ordinary line on it. */
  | { kind: "unknown" };

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
    // hoursPerWeek is carried for DISPLAY only — it is never used to divide.
    return { kind: "salary", annual, hoursPerWeek: num(line.numberOfUnitsPerWeek) };
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

export type WageDrift =
  /** Both sides agree, within rounding. */
  | { kind: "match"; rate: number }
  /** Both are hourly and they differ — the case with an adopt button. */
  | { kind: "differs"; here: number | null; xero: number; delta: number }
  /** Xero has a salary. Real information, no adopt. */
  | { kind: "salary"; annual: number; hoursPerWeek: number | null; here: number | null }
  /** Nothing comparable to say. */
  | { kind: "none"; note: string | null };

/** Cents. Two rates that differ by less than this are the same rate that has
    been rounded differently somewhere, not a disagreement worth a prompt. */
const TOLERANCE = 0.005;

export function wageDrift(here: number | null, xero: XeroPay): WageDrift {
  switch (xero.kind) {
    case "hourly": {
      if (here === null || !(here > 0)) {
        // No wage recorded here at all — Xero's is strictly new information,
        // and it is the case where adopting is most obviously right.
        return { kind: "differs", here: null, xero: xero.rate, delta: xero.rate };
      }
      const delta = Math.round((xero.rate - here) * 100) / 100;
      if (Math.abs(xero.rate - here) < TOLERANCE) return { kind: "match", rate: here };
      return { kind: "differs", here, xero: xero.rate, delta };
    }
    case "salary":
      return { kind: "salary", annual: xero.annual, hoursPerWeek: xero.hoursPerWeek, here };
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
