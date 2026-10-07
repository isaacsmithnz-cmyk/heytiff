import { checklistCounts } from "./checklist";
import type { ProposalDraft } from "./proposal";

/* THE QUOTE'S PROGRESS LINE, where Home has "Your day" (Isaac, 2026-10-06,
   the quote page mock-up he called "much cleaner"): Brief, Questions,
   Build-up, Approved, Sent, Accepted, each in its state's colour, and the
   button in the page's corner is the next of the last three. Approved, Sent
   and Accepted are a person's say-so ("You should still be able to manually
   approve"), and Accepted can be marked at any point: a client who says yes
   on the phone skips the two before it. Pure. */

export type StepKey = "brief" | "questions" | "buildup" | "approved" | "sent" | "accepted";
/** done: settled. due: needs something before the quote is whole. next:
    the one the corner button does. todo: not yet. */
export type StepState = "done" | "due" | "next" | "todo";
export type QuoteStep = { key: StepKey; label: string; state: StepState; words: string };

/** What the price says, as far as the progress line needs it. */
export type PriceState =
  /** no money grant, or not read yet: the line says nothing about it */
  | { kind: "hidden" }
  /** the business hasn't set what pricing needs in Quoting */
  | { kind: "unset" }
  /** nothing on the quote prices yet */
  | { kind: "empty" }
  | { kind: "priced"; left: number };

/** The corner button: the next of Approved, Sent, Accepted. */
export type NextStep = "approve" | "sent" | "accepted" | null;

const LABELS: Record<StepKey, string> = {
  brief: "Brief",
  questions: "Questions",
  buildup: "Build-up",
  approved: "Approved",
  sent: "Sent",
  accepted: "Accepted",
};

const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The options marked accepted, "Option 1", "Options 1 and 3". */
export function acceptedWords(accepted: readonly number[]): string {
  const n = accepted.map((i) => String(i + 1));
  return n.length === 1 ? `Option ${n[0]}` : `Options ${andList(n)}`;
}

export function quoteSteps(input: {
  /** null: nothing drafted yet */
  draft: ProposalDraft | null;
  /** when the draft was written or last changed */
  drafted: { at: string; changed: boolean } | null;
  price: PriceState;
  /** a date in words, "Tue 6 Oct" */
  when: (iso: string) => string;
}): { steps: QuoteStep[]; next: NextStep } {
  const { draft, drafted, price, when } = input;
  const step = (key: StepKey, state: StepState, words: string): QuoteStep => ({ key, label: LABELS[key], state, words });

  if (!draft) {
    return {
      steps: [
        step("brief", "next", "Not drafted yet"),
        step("questions", "todo", ""),
        step("buildup", "todo", ""),
        step("approved", "todo", ""),
        step("sent", "todo", ""),
        step("accepted", "todo", ""),
      ],
      next: null,
    };
  }

  const counts = checklistCounts(draft.checklist);
  const fresh = draft.checklist.filter((i) => i.fresh).length;
  const questions =
    counts.ask > 0
      ? step("questions", "due", `${counts.ask} to answer`)
      : fresh > 0
        ? step("questions", "due", "Putting the answers in")
        : step("questions", "done", "Answered");

  const buildup =
    price.kind === "hidden"
      ? step("buildup", "todo", "")
      : price.kind === "unset"
        ? step("buildup", "due", "Quoting isn't set")
        : price.kind === "empty"
          ? step("buildup", "due", "Nothing to price yet")
          : price.left > 0
            ? step("buildup", "due", `${price.left} still to price`)
            : step("buildup", "done", "Every line priced");

  const approvedAt = draft.status?.approvedAt ?? null;
  const sentAt = draft.status?.sentAt ?? null;
  const accepted = draft.accepted.length > 0;
  const next: NextStep = accepted ? null : !approvedAt && !sentAt ? "approve" : !sentAt ? "sent" : "accepted";

  return {
    steps: [
      step("brief", "done", drafted ? `${drafted.changed ? "Changed" : "Drafted"} ${when(drafted.at)}` : "Drafted"),
      questions,
      buildup,
      approvedAt
        ? step("approved", "done", `Approved ${when(approvedAt)}`)
        : step("approved", next === "approve" ? "next" : "todo", accepted || sentAt ? "Not marked" : "Not yet"),
      sentAt
        ? step("sent", "done", `Sent ${when(sentAt)}`)
        : step("sent", next === "sent" ? "next" : "todo", accepted ? "Not marked" : "Not yet"),
      accepted ? step("accepted", "done", acceptedWords(draft.accepted)) : step("accepted", next === "accepted" ? "next" : "todo", "Not yet"),
    ],
    next,
  };
}

/** A quote built on its kept lines (the engine rebuild): the brief is the
    lines themselves, the questions are the lines nobody knows yet, and the
    build-up is priced when nothing is left to price. Approved, Sent and
    Accepted wait for the proposal, which these quotes don't write yet. */
export function linesSteps(input: { lines: number; unknown: number; price: PriceState }): QuoteStep[] {
  const step = (key: StepKey, state: StepState, words: string): QuoteStep => ({ key, label: LABELS[key], state, words });
  const { lines, unknown, price } = input;
  const built =
    lines === 0
      ? step("buildup", "next", "No lines yet")
      : price.kind === "unset"
        ? step("buildup", "due", "Set Quoting to price it")
        : price.kind === "priced" && price.left > 0
          ? step("buildup", "due", `${price.left} to price`)
          : price.kind === "priced"
            ? step("buildup", "done", "Every line priced")
            : step("buildup", "next", "Pricing");
  return [
    step("brief", lines > 0 ? "done" : "next", "By hand"),
    /* his word for them on the new quote page (7 Oct): Unknowns */
    { ...step("questions", unknown > 0 ? "due" : lines > 0 ? "done" : "todo", unknown > 0 ? `${unknown} unknown` : lines > 0 ? "None" : ""), label: "Unknowns" },
    built,
    step("approved", "todo", ""),
    step("sent", "todo", ""),
    step("accepted", "todo", ""),
  ];
}
