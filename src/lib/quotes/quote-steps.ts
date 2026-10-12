/* THE QUOTE'S PROGRESS LINE, where Home has "Your day" (Isaac, 2026-10-06,
   the quote page mock-up he called "much cleaner"): Brief, To confirm,
   Build-up, Approved, Sent, Accepted, each in its state's colour. Approved,
   Sent and Accepted are a person's say-so ("You should still be able to manually
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

/** A quote built on its kept lines (the engine rebuild): the brief is the
    lines themselves, the questions are the lines nobody knows yet, and the
    build-up is priced when nothing is left to price. Approved and Sent
    wait for the proposal, which these quotes don't write yet; Accepted is
    the option a person marked. */
export function linesSteps(input: {
  lines: number;
  unknown: number;
  price: PriceState;
  accepted?: readonly number[];
  approved?: boolean;
  version?: number;
  /** sent to ServiceM8 as a quote (7.3), or only a trial run of it */
  sent?: { trial: boolean } | null;
}): QuoteStep[] {
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
    /* Unknowns on the page of 7 Oct; To confirm since 10 Oct (Isaac: "an
       unknown could just be something that we haven't told Tiff yet") */
    { ...step("questions", unknown > 0 ? "due" : lines > 0 ? "done" : "todo", unknown > 0 ? `${unknown} to confirm` : lines > 0 ? "None" : ""), label: "To confirm" },
    built,
    /* version 2 on, the version it's at (quote-versions.ts) */
    input.approved
      ? step("approved", "done", (input.version ?? 1) > 1 ? `Version ${input.version} approved` : "Approved")
      : step("approved", "todo", (input.version ?? 1) > 1 ? `Version ${input.version}` : ""),
    input.sent ? step("sent", "done", input.sent.trial ? "Trial run" : "To ServiceM8") : step("sent", "todo", ""),
    input.accepted?.length ? step("accepted", "done", acceptedWords(input.accepted)) : step("accepted", "todo", ""),
  ];
}
