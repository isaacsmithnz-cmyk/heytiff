import { fmtAuDayMonth } from "@/lib/au-dates";
import type { FamilyMoney } from "./job-family";

/* THE PROGRESS LINE — where a job is up to, as the seven steps every install
   walks (Isaac, 2026-10-01): Enquiry, Quoted, Accepted, Deposit paid,
   Materials sorted, Installation, Paid. Handover is part of Installation.

   Each step says one short fact under its name ("Sent 27 Aug", "Day 2",
   "Invoiced 31 Aug") and wears a state: done, the one the job is at now, a
   warning, skipped (no deposit on this job), declined, or still to come. The
   job is at the first step that is neither done nor skipped.

   The two money steps need the money grant. Without it they are ABSENT, the
   way the Billing section is: the server never sent what would fill them.

   A WORK ORDER WALKS ITS OWN LINE (Isaac, 2026-10-03: "i suppose its just a
   work order"). A job that became a Work Order without a quote going out —
   a service call, a warranty visit, "do and charge" decided on site — has
   no quote to accept, no deposit and no materials to sort: Enquiry, Booked,
   On site, Done, Invoiced, Paid. Which line is decided by whether a quote
   was SENT, so a job booked as a Quote that became do-and-charge moves to
   the work-order line on its own (lineOf).

   Pure, so the card and the tests read the same line. */

export type StepKey =
  | "enquiry"
  | "quoted"
  | "accepted"
  | "deposit"
  | "materials"
  | "installation"
  | "paid"
  /* the work-order line's own */
  | "booked"
  | "onsite"
  | "done"
  | "invoiced";

/** Which line a job walks. */
export type JobLine = "quote" | "work";

export type StepState = "done" | "now" | "warn" | "skip" | "bad" | "next";

export type JobStep = { key: StepKey; label: string; state: StepState; fact: string };

export type StepInput = {
  status: string | null;
  /** when the enquiry came in — ServiceM8's job date */
  date: string | null;
  /** the day the quote was SENT — never quote_date, which ServiceM8 sets
      the moment a job is made a Quote, priced or not */
  quoteSentOn: string | null;
  workOrderDate: string | null;
  completionDate: string | null;
  /** past days on site, any order */
  visitDays: string[];
  /** the next standing booking's day, if any */
  nextBookingDay: string | null;
  /** our checklist's material rows: how many, and how many are in */
  materials: { total: number; in: number } | null;
  /** the job's claims, once read; null until then, or without the grant */
  family: FamilyMoney | null;
  /** somebody ticked the job as taking no deposit (job_no_deposit) */
  noDeposit?: boolean;
  /** a booking still on the job that it no longer needs (isLeftover) */
  leftover?: boolean;
};

const LABEL: Record<StepKey, string> = {
  enquiry: "Enquiry",
  quoted: "Quoted",
  accepted: "Accepted",
  deposit: "Deposit paid",
  materials: "Materials sorted",
  installation: "Installation",
  paid: "Paid",
  booked: "Booked",
  onsite: "On site",
  done: "Done",
  invoiced: "Invoiced",
};

/** The work-order line, for a job past Quote that no quote went out for.
    A Quote still waiting, a declined one, and any job a quote was sent for
    walk the quote line. */
export function lineOf(j: Pick<StepInput, "status" | "quoteSentOn">): JobLine {
  const status = (j.status ?? "").trim().toLowerCase();
  return (status === "work order" || status === "completed") && !j.quoteSentOn ? "work" : "quote";
}

const day = (d: string | null | undefined) => (d ? fmtAuDayMonth(d) : "");

export function jobSteps(j: StepInput, moneyVisible: boolean): JobStep[] {
  if (lineOf(j) === "work") return workSteps(j, moneyVisible);
  const status = (j.status ?? "").trim().toLowerCase();
  const declined = status === "unsuccessful";
  const completed = status === "completed";
  const accepted = !declined && (!!j.workOrderDate || status === "work order" || completed);
  const quoted = !!j.quoteSentOn || accepted;
  const days = [...new Set(j.visitDays)].sort();

  const steps: Omit<JobStep, "label">[] = [];

  steps.push({ key: "enquiry", state: "done", fact: day(j.date) });

  steps.push(
    quoted
      ? { key: "quoted", state: "done", fact: j.quoteSentOn ? `Sent ${day(j.quoteSentOn)}` : "" }
      : { key: "quoted", state: "next", fact: "" }
  );

  steps.push(
    declined
      ? { key: "accepted", state: "bad", fact: "" }
      : accepted
        ? { key: "accepted", state: "done", fact: day(j.workOrderDate) }
        : { key: "accepted", state: "next", fact: "" }
  );

  /* With the grant the money steps are there from first paint; until the
     claims are read they say nothing, rather than popping in when they land. */
  const started = j.visitDays.length > 0 || completed;
  if (moneyVisible && !j.family) steps.push({ key: "deposit", state: j.noDeposit ? "done" : "next", fact: j.noDeposit ? "Not needed" : "" });
  else if (moneyVisible && j.family) {
    const first = j.family.claims[0];
    const deposit = first && first.stage === "Deposit" ? first : null;
    /* NONE INVOICED is asked, not guessed (Isaac, 2026-10-03: "if no deposit
       required make that as an option so it can get ticked off"). Ticked,
       it is done. Unticked, an accepted job waits here for a deposit or the
       tick; once the work has started, there was none, and it is passed. */
    if (!deposit && j.noDeposit) steps.push({ key: "deposit", state: "done", fact: "Not needed" });
    else if (!deposit) steps.push({ key: "deposit", state: started ? "skip" : "next", fact: started ? "No deposit" : "" });
    else if (deposit.state === "paid" || deposit.state === "paid_unknown")
      steps.push({ key: "deposit", state: "done", fact: deposit.paidOn ? `Paid ${day(deposit.paidOn)}` : "Paid" });
    else if (deposit.state === "awaiting" || deposit.state === "part")
      steps.push({ key: "deposit", state: "warn", fact: deposit.raisedOn ? `Invoiced ${day(deposit.raisedOn)}` : "Invoiced" });
    else steps.push({ key: "deposit", state: "next", fact: "" });
  }

  const m = j.materials;
  if (!m || m.total === 0) steps.push({ key: "materials", state: accepted || started ? "skip" : "next", fact: accepted || started ? "None listed" : "" });
  else if (m.in >= m.total) steps.push({ key: "materials", state: "done", fact: "All in" });
  /* once the work has started, what's still unticked is a fact, not where the job is */
  else steps.push({ key: "materials", state: started ? "skip" : "next", fact: `${m.in} of ${m.total} in` });

  if (completed) steps.push({ key: "installation", state: "done", fact: j.completionDate ? `Done ${day(j.completionDate)}` : "Done" });
  else if (days.length > 0) steps.push({ key: "installation", state: "now", fact: `Day ${days.length}` });
  else steps.push({ key: "installation", state: "next", fact: j.nextBookingDay ? `Booked ${day(j.nextBookingDay)}` : "" });

  if (moneyVisible) steps.push(paidStep(j.family, completed));

  /* A job on site is at Installation, whatever is still open behind it.
     Otherwise it is at the first step it hasn't done or skipped; a warning
     or a refusal there is already its own state. */
  if (!declined) markNow(steps);
  /* A DECLINED QUOTE ENDS THE LINE (Isaac, 2026-10-08: "say Declined and end
     the line there"). The step says Declined, not "Accepted · Declined", and
     nothing after it is drawn: none of it is to come... */
  if (declined) steps.length = 3;
  /* ...unless a booking is still on it: Installation stays, to clear it */
  if (declined && j.leftover) steps.push({ key: "installation", state: "warn", fact: "Still booked" });

  /* a deposit ticked as not needed was never paid: the step says Deposit,
     and its fact says why it's done (Isaac, 2026-10-03: "it says deposit
     paid when i tick not needed") */
  return steps.map((s) => ({
    ...s,
    label:
      s.key === "deposit" && s.fact === "Not needed"
        ? "Deposit"
        : s.key === "accepted" && s.state === "bad"
          ? "Declined"
          : LABEL[s.key],
  }));
}

/** Paid, on either line: settled across the family, or invoiced and not
    paid on a finished job, or still to come. Until the claims are read it
    says nothing, rather than popping in when they land. */
function paidStep(f: FamilyMoney | null, completed: boolean): Omit<JobStep, "label"> {
  if (!f) return { key: "paid", state: "next", fact: "" };
  const settled = f.paidCents > 0 && f.awaitingCents === 0 && f.toComeCents === 0;
  const lastPaid = f.claims.map((c) => c.paidOn).filter((d): d is string => !!d).sort().at(-1) ?? null;
  if (settled) return { key: "paid", state: "done", fact: lastPaid ? `Paid ${day(lastPaid)}` : "Paid in full" };
  if (completed && (f.awaitingCents ?? 0) > 0) return { key: "paid", state: "warn", fact: "Invoiced, not paid" };
  return { key: "paid", state: "next", fact: "" };
}

/** A job on site is at its on-site step, whatever is still open behind it;
    otherwise it is at the first step it hasn't done or skipped. */
function markNow(steps: Omit<JobStep, "label">[]): void {
  if (steps.some((s) => s.state === "now")) return;
  const at = steps.findIndex((s) => s.state !== "done" && s.state !== "skip");
  if (at >= 0 && steps[at]!.state === "next") steps[at] = { ...steps[at]!, state: "now" };
}

/** THE WORK-ORDER LINE: Enquiry, Booked, On site, Done, Invoiced, Paid. */
function workSteps(j: StepInput, moneyVisible: boolean): JobStep[] {
  const completed = (j.status ?? "").trim().toLowerCase() === "completed";
  const days = [...new Set(j.visitDays)].sort();
  const steps: Omit<JobStep, "label">[] = [];

  steps.push({ key: "enquiry", state: "done", fact: day(j.date) });

  /* booked once somebody has been, or is going: the day they're going, or
     the first day they went */
  if (j.nextBookingDay) steps.push({ key: "booked", state: "done", fact: day(j.nextBookingDay) });
  else if (days.length > 0 || completed) steps.push({ key: "booked", state: "done", fact: day(days[0]) });
  else steps.push({ key: "booked", state: "next", fact: "" });

  if (completed) steps.push({ key: "onsite", state: "done", fact: days.length > 0 ? `${days.length} day${days.length === 1 ? "" : "s"}` : "" });
  else if (days.length > 0) steps.push({ key: "onsite", state: "now", fact: `Day ${days.length}` });
  else steps.push({ key: "onsite", state: "next", fact: "" });

  steps.push(completed ? { key: "done", state: "done", fact: day(j.completionDate) } : { key: "done", state: "next", fact: "" });

  if (moneyVisible) {
    const f = j.family;
    const raised = f?.claims.map((c) => c.raisedOn).filter((d): d is string => !!d).sort()[0] ?? null;
    /* ServiceM8 completes a work order by invoicing it, so a Completed job
       is invoiced; a claim raised earlier says so before that */
    if (f && (raised || (f.invoicedCents ?? 0) > 0)) steps.push({ key: "invoiced", state: "done", fact: day(raised) });
    else if (completed) steps.push({ key: "invoiced", state: "done", fact: "" });
    else steps.push({ key: "invoiced", state: "next", fact: "" });
    steps.push(paidStep(f, completed));
  }

  markNow(steps);
  return steps.map((s) => ({ ...s, label: LABEL[s.key] }));
}

/** The step the job is at, for the card to open beside. */
export const currentStep = (steps: JobStep[]): JobStep | null =>
  steps.find((s) => s.state === "now" || s.state === "warn" || s.state === "bad") ?? null;
