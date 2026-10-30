/* THE QUOTE'S PROGRESS LINE, small at the top of the quote page's rail
   (layout C, Isaac's pick on 18 October 2026; it was the band where Home has
   "Your day", 2026-10-06): Brief, Scope, Priced, Approved, Sent, Accepted
   (Q7, 17 October), each with its date or what's left to settle. Approved,
   Sent and Accepted are a person's say-so ("You should still be able to manually
   approve"), and Accepted can be marked at any point: a client who says yes
   on the phone skips the two before it. Pure.

   DESIGN, BETWEEN SCOPE AND PRICED (Isaac, 28 October 2026: "Brief, Scope,
   Design (skippable), Priced, with the Studio opening from the Design
   step"). The scope says what goes in; the design measures it; the price
   takes its quantities from the design, or assumes them where there isn't
   one. A job with nothing to measure skips it, and the line says "No
   design". Only for someone with the Studio: without it the line has no
   Design step at all. */

import { auDayOf, fmtAuDayMonth } from "@/lib/au-dates";

export type StepKey = "brief" | "questions" | "design" | "buildup" | "approved" | "sent" | "accepted";
/** done: settled. due: needs something before the quote is whole. next:
    the one the corner button does. todo: not yet. skipped: passed by on
    purpose, which the line counts as settled (the Design step's No design). */
export type StepState = "done" | "due" | "next" | "todo" | "skipped";
export type QuoteStep = { key: StepKey; label: string; state: StepState; words: string };

/** Where the job's design is, for the Design step: drawn, a design of the
    job's is in the Studio; skipped, No design was pressed, or the quote was
    approved without one; open, neither yet. */
export type DesignState = "drawn" | "skipped" | "open";

/** A step the line counts as behind it: settled, or skipped on purpose. */
export const stepPassed = (s: QuoteStep) => s.state === "done" || s.state === "skipped";

/** The Design step's state: a design of the job's always counts, whatever
    was pressed before it; then No design; then a quote approved, sent or
    accepted without one, which went on without it. */
export function designState(input: { designs: number; noDesign: boolean; onWithout: boolean }): DesignState {
  if (input.designs > 0) return "drawn";
  return input.noDesign || input.onWithout ? "skipped" : "open";
}

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
  questions: "Scope",
  design: "Design",
  buildup: "Priced",
  approved: "Approved",
  sent: "Sent",
  accepted: "Accepted",
};

/** The Design step: Design while it's drawn or still to do, No design once
    it's skipped. */
const designStep = (d: DesignState): QuoteStep =>
  d === "drawn"
    ? { key: "design", label: LABELS.design, state: "done", words: "Drawn" }
    : d === "skipped"
      ? { key: "design", label: "No design", state: "skipped", words: "" }
      : { key: "design", label: LABELS.design, state: "todo", words: "" };

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
  /** sent to ServiceM8 as a quote (7.3), or only a trial run of it, and when */
  sent?: { trial: boolean; at?: string } | null;
  /** when the approval that stands was given */
  approvedAt?: string | null;
  /** where the job's design is (designState); absent without the Studio,
      and then the line has no Design step */
  design?: DesignState | null;
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
            ? step("buildup", "done", "All priced")
            : step("buildup", "next", "");
  /* a day said as the rail has room for it, "17 Oct" */
  const day = (at: string | null | undefined) => (at ? fmtAuDayMonth(auDayOf(at)) : "");
  return [
    step("brief", lines > 0 ? "done" : "next", "By hand"),
    /* Unknowns on the page of 7 Oct; To confirm from 10 Oct (Isaac: "an
       unknown could just be something that we haven't told Tiff yet");
       Scope, with what's left to settle, in layout C */
    /* approved, a person has stood behind it: the line never sits back on
       Scope past a green Approved (3423, Isaac, 30 October 2026) */
    step("questions", unknown > 0 && !input.approved ? "due" : lines > 0 ? "done" : "todo", unknown > 0 && !input.approved ? `${unknown} to settle` : lines > 0 ? "Settled" : ""),
    ...(input.design ? [designStep(input.design)] : []),
    built,
    /* version 2 on, the version it's at (quote-versions.ts) */
    input.approved
      ? step("approved", "done", (input.version ?? 1) > 1 ? `Version ${input.version} approved` : day(input.approvedAt) || "Approved")
      : step("approved", "todo", (input.version ?? 1) > 1 ? `Version ${input.version}` : ""),
    input.sent ? step("sent", "done", input.sent.trial ? "Trial run" : day(input.sent.at) || "To ServiceM8") : step("sent", "todo", ""),
    input.accepted?.length ? step("accepted", "done", acceptedWords(input.accepted)) : step("accepted", "todo", ""),
  ];
}
