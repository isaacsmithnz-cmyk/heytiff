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

   Pure, so the card and the tests read the same line. */

export type StepKey = "enquiry" | "quoted" | "accepted" | "deposit" | "materials" | "installation" | "paid";

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
};

const LABEL: Record<StepKey, string> = {
  enquiry: "Enquiry",
  quoted: "Quoted",
  accepted: "Accepted",
  deposit: "Deposit paid",
  materials: "Materials sorted",
  installation: "Installation",
  paid: "Paid",
};

const day = (d: string | null | undefined) => (d ? fmtAuDayMonth(d) : "");

export function jobSteps(j: StepInput, moneyVisible: boolean): JobStep[] {
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
      ? { key: "accepted", state: "bad", fact: "Declined" }
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

  if (moneyVisible && !j.family) steps.push({ key: "paid", state: "next", fact: "" });
  else if (moneyVisible && j.family) {
    const f = j.family;
    const settled = f.paidCents > 0 && f.awaitingCents === 0 && f.toComeCents === 0;
    const lastPaid = f.claims.map((c) => c.paidOn).filter((d): d is string => !!d).sort().at(-1) ?? null;
    if (settled) steps.push({ key: "paid", state: "done", fact: lastPaid ? `Paid ${day(lastPaid)}` : "Paid in full" });
    else if (completed && (f.awaitingCents ?? 0) > 0) steps.push({ key: "paid", state: "warn", fact: "Invoiced, not paid" });
    else steps.push({ key: "paid", state: "next", fact: "" });
  }

  /* A job on site is at Installation, whatever is still open behind it.
     Otherwise it is at the first step it hasn't done or skipped; a warning
     or a refusal there is already its own state. */
  const installing = steps.some((s) => s.state === "now");
  const at = steps.findIndex((s) => s.state !== "done" && s.state !== "skip");
  if (!installing && at >= 0 && steps[at]!.state === "next" && !declined) steps[at] = { ...steps[at]!, state: "now" };
  /* a declined quote stops the line there: nothing after it is to come */
  if (declined) for (let i = 3; i < steps.length; i++) steps[i] = { ...steps[i]!, state: "next", fact: "" };

  /* a deposit ticked as not needed was never paid: the step says Deposit,
     and its fact says why it's done (Isaac, 2026-10-03: "it says deposit
     paid when i tick not needed") */
  return steps.map((s) => ({ ...s, label: s.key === "deposit" && s.fact === "Not needed" ? "Deposit" : LABEL[s.key] }));
}

/** The step the job is at, for the card to open beside. */
export const currentStep = (steps: JobStep[]): JobStep | null =>
  steps.find((s) => s.state === "now" || s.state === "warn" || s.state === "bad") ?? null;
