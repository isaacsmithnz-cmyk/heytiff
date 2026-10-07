import { WORK_KIND_WORDS, type WorkKind } from "@/lib/quotes/labour-history";

/** A kind of job in the figures: the progress line's kinds, and ventilation,
    which the analytics read (job-analytics) and the labour memory doesn't. */
export type JobKind = WorkKind | "ventilation";

/* THE TO DECIDE QUESTIONS (Isaac, 2026-10-07: "anything unknown or
   questionable should be manually decided"). What can be asked about a job,
   the answers each takes, and the words for both, in one place: the figures
   (job-analytics), the action that keeps an answer (analytics-decide) and the
   tab read the same list, so an answer one of them accepts the others
   understand. Kept in job_analytics_decisions, one row per job and
   question. Pure and client-safe. */

export type Question = "quote" | "outcome" | "kind" | "price" | "void";

/** The order the tab asks them in: what moves the win rate first. Void is
    not asked: it can be said of any job (Isaac, 2026-10-07: "i also need a
    way to mark jobs void or something, unsuccessful isnt accurate for invalid
    jobs"). A void job is not a job at all, a duplicate, a test, spam or one
    raised by mistake, and is left out of every figure, enquiries included. */
export const QUESTIONS: readonly Question[] = ["quote", "outcome", "kind", "price"];

export const KINDS: readonly JobKind[] = ["split", "multi", "ducted", "vrf", "ventilation", "service", "maintenance"];

export const ANSWERS: Record<Question, readonly string[]> = {
  quote: ["quote", "not_quote"],
  outcome: ["won", "lost"],
  kind: KINDS,
  price: ["count", "leave_out"],
  void: ["void"],
};

export function isQuestion(v: unknown): v is Question {
  return v === "quote" || v === "outcome" || v === "kind" || v === "price" || v === "void";
}

/** Whether `answer` is one the question takes. */
export function isAnswer(question: Question, answer: unknown): answer is string {
  return typeof answer === "string" && ANSWERS[question].includes(answer);
}

/** One job's answers, by question. */
export type JobDecisions = Partial<Record<Question, string>>;
/** Every job's answers, by ServiceM8 job uuid. */
export type Decisions = ReadonlyMap<string, JobDecisions>;

/** The rows as stored, made one map; an answer the code no longer knows is
    left out rather than guessed at. */
export function decisionsFrom(rows: readonly { sm8_job_uuid: string; question: string; answer: string }[]): Map<string, JobDecisions> {
  const out = new Map<string, JobDecisions>();
  for (const r of rows) {
    if (!isQuestion(r.question) || !isAnswer(r.question, r.answer)) continue;
    out.set(r.sm8_job_uuid, { ...(out.get(r.sm8_job_uuid) ?? {}), [r.question]: r.answer });
  }
  return out;
}

/** A kind of work as a row's label: "Wall split", "VRF". */
export const kindLabel = (k: JobKind | null) =>
  k === null
    ? "Not known"
    : k === "vrf"
      ? "VRF"
      : k === "ventilation"
        ? "Ventilation"
        : WORK_KIND_WORDS[k].charAt(0).toUpperCase() + WORK_KIND_WORDS[k].slice(1);

/* ── the words ── */

export const QUESTION_WORDS: Record<Question, { title: string; why: string }> = {
  quote: {
    title: "Is it a quote?",
    why: "Jobs of {from} ex GST or more with no sign of a quote leaving ServiceM8: a work order that reads like an install, or a job marked Unsuccessful. A quote counts toward the win rate; a call-out, or an enquiry never quoted, doesn't.",
  },
  outcome: { title: "Won or lost?", why: "ServiceM8's status and the money, a claim or the proposal disagree." },
  kind: {
    title: "What kind of job?",
    why: "The job type couldn't be read from the job's words, its lines or its category. The job is in every figure already; its type only places it in the job-type breakdowns, where it shows as Not known until it's given.",
  },
  price: { title: "Does this price belong?", why: "Far from what won jobs of the kind usually cost." },
  void: { title: "Void", why: "Not real jobs: duplicates, tests, spam, raised by mistake. Left out of every figure." },
};

/** Why a question is asked, with the business's quote line in it. */
export const questionWhy = (q: Question, quoteFromCents: number) =>
  QUESTION_WORDS[q].why.replace("{from}", `$${Math.round(quoteFromCents / 100).toLocaleString("en-AU")}`);

/** The button that gives an answer. */
export function answerLabel(question: Question, answer: string): string {
  if (question === "kind") return kindLabel(answer as JobKind);
  return (
    {
      quote: "A quote, won",
      not_quote: "Not a quote",
      won: "Won",
      lost: "Lost",
      count: "Count it",
      leave_out: "Leave it out of prices",
      void: "Void",
    }[answer] ?? answer
  );
}

/** What an answer did, said once it's given. */
export function answerSaid(question: Question, answer: string): string {
  if (question === "kind") return `Counted as ${kindLabel(answer as JobKind).replace(/^(?!VRF)./, (c) => c.toLowerCase())}.`;
  return (
    {
      quote: "A quote, won.",
      not_quote: "Not a quote. Left out of the win rate.",
      won: "Counted as won.",
      lost: "Counted as lost.",
      count: "Counted in prices.",
      leave_out: "Left out of prices. Still counts as won.",
      void: "Void. Left out of every figure.",
    }[answer] ?? ""
  );
}

/* ── the clean-up in ServiceM8 ── */

/** What ServiceM8 should change for an answer to agree with it: a Quote made
    a Work Order (the one write HeyTiff has for it), something else to change
    there by hand, or nothing. Only "Won or lost?" disagrees with ServiceM8:
    the other answers are HeyTiff's own reading. */
export function cleanupFor(question: Question, answer: string, status: string | null): "work_order" | "by_hand" | null {
  if (question !== "outcome") return null;
  const s = (status ?? "").trim().toLowerCase();
  if (answer === "won" && s === "quote") return "work_order";
  if (answer === "won" && s === "unsuccessful") return "by_hand";
  if (answer === "lost" && s === "quote") return "by_hand";
  return null;
}
