import type { TimesheetStatus } from "@/lib/timepay/query";

/* Money-flavoured dashboard items — shown only to `financials` holders.

   The scope is "other people's money": a pay run covers the team, so it belongs
   here, not on anyone's personal screen. Pure over counts the loader tallies.

   Honest about what the schema knows: a timesheet has draft / submitted /
   approved / sent_back — there is no "paid" marker yet (pay runs aren't tracked
   as records). So this reports the period's payroll STATE rather than asserting
   an unpaid debt we can't actually see: how many sheets are approved and ready,
   and how many are still waiting on an approver. It warns only once the period
   has closed with work still unresolved — that is the genuinely actionable
   moment. Once a paid-run record exists, this gains a real "due/overdue". */

export type MoneyItem = {
  key: string;
  label: string;
  detail: string;
  href: string;
  state: "warn" | "ok";
};

/** Count timesheets by status across a period. */
export function tallySheets(statuses: readonly TimesheetStatus[]): {
  submitted: number;
  approved: number;
} {
  let submitted = 0;
  let approved = 0;
  for (const s of statuses) {
    if (s === "submitted") submitted += 1;
    else if (s === "approved") approved += 1;
  }
  return { submitted, approved };
}

export function payRunItem(input: {
  periodLabel: string;
  /** ISO end date of the period being reported. */
  periodEnd: string;
  today: string;
  submitted: number;
  approved: number;
}): MoneyItem | null {
  const { submitted, approved, periodLabel, periodEnd, today } = input;
  // Nothing submitted or approved yet — no payroll prompt worth making.
  if (submitted === 0 && approved === 0) return null;

  /* `periodEnd` is the period's LAST DAY, inclusive — so the run is due once
     that day is BEHIND us, not while it is still being worked. On the final
     day people are legitimately mid-shift and haven't submitted; calling the
     pay run due then warns about staff who aren't late yet. (Same off-by-one
     the timesheet had: "is today the last day" is not "the last day is
     over".) */
  const closed = today > periodEnd;
  const parts: string[] = [];
  if (approved > 0) parts.push(`${approved} ready to pay`);
  if (submitted > 0) parts.push(`${submitted} awaiting approval`);

  return {
    key: "pay-run",
    // Once closed the run is actionable; while open it's just a status.
    label: closed ? "Pay run due" : "Timesheets this period",
    detail: `${periodLabel} · ${parts.join(", ")}`,
    href: "/dashboard/timepay",
    // Warn when the period has closed and anything is still outstanding — that's
    // when payroll can't complete without action. An all-clear open period is ok.
    state: closed ? "warn" : "ok",
  };
}
