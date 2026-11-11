/* HOW A VISIT ENDED, IN WORDS (the mock https://claude.ai/artifact/ESTib5qakLMfgTXmUW9vCy,
   approved 11 November 2026: "Build from mocks approved"). The answer as the
   phone sends it, checked; and as it reads in the job note's first line,
   where the office and ServiceM8 see it before anything else:
   "Isaac, 8:45 to 2:45 · Coming back, waiting on parts". Pure. */

export const ANSWERS = ["finished", "coming_back", "quote_first", "cant"] as const;
export type Answer = (typeof ANSWERS)[number];
export const WAITING = ["more_time", "parts", "access", "someone_else"] as const;
export type Waiting = (typeof WAITING)[number];
export const REASONS = ["cancelled", "not_ours", "unsafe", "said_no"] as const;
export type Reason = (typeof REASONS)[number];
export const FREE = ["site_meeting", "quote_visit", "goodwill", "warranty", "callback"] as const;
export type Free = (typeof FREE)[number];

export type Detail = {
  quoteToo?: boolean;
  quoteWords?: string;
  quoteWho?: string;
  waiting?: Waiting;
  needed?: string;
  howLong?: string;
  booked?: string;
  reason?: Reason;
};
export type Charge = { kind: "job" } | { kind: "none"; reason: Free; words?: string };
export type Ending = { answer: Answer; detail: Detail; charge: Charge };

const ANSWER_WORDS: Record<Answer, string> = {
  finished: "Finished",
  coming_back: "Coming back",
  quote_first: "Quote needed first",
  cant: "Can’t go ahead",
};
const WAITING_WORDS: Record<Waiting, string> = {
  more_time: "more time needed",
  parts: "waiting on parts",
  access: "no access",
  someone_else: "needs someone else",
};
const REASON_WORDS: Record<Reason, string> = {
  cancelled: "customer cancelled",
  not_ours: "not our work",
  unsafe: "unsafe",
  said_no: "said no to the price",
};
export const FREE_WORDS: Record<Free, string> = {
  site_meeting: "site meeting",
  quote_visit: "quote visit",
  goodwill: "goodwill",
  warranty: "warranty",
  callback: "our callback",
};

const clip = (v: unknown, n: number): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => (list as readonly unknown[]).includes(v) ? (v as T) : undefined;

/** The phone's answer, kept to what it may say; null when it isn't one. */
export function endingOf(raw: unknown): Ending | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const answer = oneOf(ANSWERS, r.answer);
  if (!answer) return null;
  const d = (r.detail && typeof r.detail === "object" ? r.detail : {}) as Record<string, unknown>;
  const detail: Detail = {};
  if (answer === "finished") {
    detail.quoteToo = d.quoteToo === true;
    if (detail.quoteToo) detail.quoteWords = clip(d.quoteWords, 2000);
  } else if (answer === "coming_back") {
    detail.booked = clip(d.booked, 40);
    if (!detail.booked) {
      detail.waiting = oneOf(WAITING, d.waiting);
      if (!detail.waiting) return null;
      if (detail.waiting === "parts") detail.needed = clip(d.needed, 300);
      detail.howLong = clip(d.howLong, 60);
    }
  } else if (answer === "quote_first") {
    detail.quoteWords = clip(d.quoteWords, 2000);
    detail.quoteWho = clip(d.quoteWho, 120);
  } else {
    detail.reason = oneOf(REASONS, d.reason);
    if (!detail.reason) return null;
  }
  const c = (r.charge && typeof r.charge === "object" ? r.charge : {}) as Record<string, unknown>;
  const free = c.kind === "none" ? oneOf(FREE, c.reason) : undefined;
  const charge: Charge = free ? { kind: "none", reason: free, words: clip(c.words, 300) } : { kind: "job" };
  for (const k of Object.keys(detail) as (keyof Detail)[]) if (detail[k] === undefined) delete detail[k];
  return { answer, detail, charge };
}

/** "Coming back, waiting on parts", "Finished, and a quote to build", "Can’t go ahead, unsafe"; then "No charge, site meeting". */
export function endingWords(e: Ending): string {
  let words = ANSWER_WORDS[e.answer];
  if (e.answer === "finished" && e.detail.quoteToo) words += ", and a quote to build";
  if (e.answer === "coming_back") words += e.detail.booked ? `, booked ${e.detail.booked}` : e.detail.waiting ? `, ${WAITING_WORDS[e.detail.waiting]}` : "";
  if (e.answer === "cant" && e.detail.reason) words += `, ${REASON_WORDS[e.detail.reason]}`;
  return e.charge.kind === "none" ? `${words} · No charge, ${FREE_WORDS[e.charge.reason]}` : words;
}

const ENDING_START = /^(Finished|Coming back|Quote needed first|Can’t go ahead|Can't go ahead|No charge)\b/;

/** The note with the ending in its first line, any ending it had before taken out:
    "Isaac, 8:45 to 2:45 · 4 photos" and Finished is "Isaac, 8:45 to 2:45 · 4 photos · Finished". */
export function withEnding(note: string, words: string): string {
  const at = note.indexOf("\n");
  const first = (at < 0 ? note : note.slice(0, at)).trim();
  const rest = at < 0 ? "" : note.slice(at);
  const kept = first.split(" · ").filter((part, i) => i === 0 || !ENDING_START.test(part.trim()));
  return `${[...kept, ...words.split(" · ")].join(" · ")}${rest}`;
}
