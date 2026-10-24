/* A VARIATION FROM A JOB'S CONVERSATION — pure, on both sides of the wire.

   v2 step 6, slice D. "The client wants a return grille added in Bed 2",
   said in a job's conversation, starts a variation on the job's accepted
   quote. The router reads it into the `variations` lane (note-brain); this
   file holds what one is, what Tiff says, and the card the conversation
   draws once it is started.

   A DRAFT, NEVER A PRICE (decision 13, 6-revisions.md: any price change is
   drafted and asked first). The lane does what the quote page's Start a
   variation does and nothing more: `startVariation` copies the accepted
   option to a new one, named Variation N, with the client's words as what's
   changing. Nobody prices it, approves it or sends it from here; Open takes
   you to the quote page on it, and Undo takes the empty draft back.

   BEHIND THE QUOTE PAGE'S OWN GATE. Starting a variation is a money op on
   the quote's route (`MONEY_OPS`, "Pricing and approving a quote need money
   access"), so the lane asks the same of the speaker. Without it the words
   become the speaker's own task, and Tiff says why. A job with no accepted
   quote has no variation (a change before acceptance is the quote's next
   version): she says so, and the words become a task to change the quote.

   ON A SERVICEM8 JOB. A variation lives on a job's quote, so the note must
   be on a job; one said off any job is asked "Which job is this for?", as a
   cost is. */

/** At most this many variations come off one note: one client's change is
    one variation, however many parts it touches. */
import { quoteHref } from "@/lib/shell/links";
export const VARIATIONS_MAX = 1;

/** The most of what's changing a variation keeps (lines-job's own). */
export const VARIATION_WHAT_MAX = 500;

export type ProposedVariation = {
  /** What the client wants changed, in the record's language: "return
      grille in Bed 2". */
  what: string;
};

const text = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "").slice(0, max) : "";

/** One variation, re-derived from what came in (the model's, or a stored
    proposal's). Null when it says nothing to change. */
export function variationFields(r: { what: unknown }): ProposedVariation | null {
  const what = text(r.what, VARIATION_WHAT_MAX);
  return what ? { what } : null;
}

/* ── what a variation became ─────────────────────────────────────────── */

/** How a variation was made:
      started  a variation on the accepted quote, its draft to price;
      task     it couldn't be one (`why`), so it is the speaker's task. */
export const VARIATION_HOWS = ["started", "task"] as const;
export type VariationHow = (typeof VARIATION_HOWS)[number];

/** Why a variation became a task:
      unaccepted  the job has no accepted quote, so there is nothing to vary;
      money       starting one needs money access, as on the quote page. */
export const VARIATION_WHYS = ["unaccepted", "money"] as const;
export type VariationWhy = (typeof VARIATION_WHYS)[number];

/** A variation a note made, as `workboard_notes.applied.variations` records
    it: enough to draw its card, open it and for Undo to take it back. */
export type VariationMade = {
  /** Its place in the stored proposal's `variations`. */
  index: number;
  how: VariationHow;
  why: VariationWhy | null;
  what: string;
  /** The ServiceM8 job whose quote it is on. */
  jobUuid: string | null;
  /** Variation 1, 2…, for a `started` one. */
  n: number | null;
  /** The quote's option it is, for a `started` one: what Open opens and
      Undo takes back. */
  option: number | null;
  /** The task it is, for a `task`. */
  taskId: string | null;
  /** Taken back by its own Undo. */
  undone: boolean;
};

const s = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/** The column's `variations`, shaped: anything that is not one we wrote is
    dropped. */
export function variationsOf(raw: unknown): VariationMade[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x): VariationMade[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    if (!Number.isInteger(r.index) || !(VARIATION_HOWS as readonly unknown[]).includes(r.how)) return [];
    const how = r.how as VariationHow;
    const option = int(r.option);
    /* a started one names its option, or there is nothing to open or take back */
    if (how === "started" && (option === null || option < 1 || !s(r.jobUuid))) return [];
    return [
      {
        index: r.index as number,
        how,
        why: (VARIATION_WHYS as readonly unknown[]).includes(r.why) ? (r.why as VariationWhy) : null,
        what: s(r.what),
        jobUuid: s(r.jobUuid) || null,
        n: int(r.n),
        option,
        taskId: s(r.taskId) || null,
        undone: r.undone === true,
      },
    ];
  });
}

/** Its variations started and not taken back since: what Undo takes back. */
export const startedVariations = (made: readonly VariationMade[]): VariationMade[] =>
  made.filter((v) => v.how === "started" && !v.undone && v.option !== null && !!v.jobUuid);

/** "Started variation 1: return grille in Bed 2". */
export const variationTitle = (v: Pick<VariationMade, "n" | "what">): string =>
  `Started variation ${v.n ?? 1}${v.what.trim() ? `: ${v.what.trim()}` : ""}`;

/** The quote page, open on the variation. */
export const variationHref = (jobUuid: string, option: number): string => quoteHref(jobUuid, { option });

/** The task a variation became: "Add to the quote: return grille in Bed 2"
    when nothing is accepted, "Start variation: …" without money access. */
export function variationTaskTitle(what: string, why: VariationWhy): string {
  const w = what.trim() || "the client's change";
  return (why === "unaccepted" ? `Add to the quote: ${w}` : `Start variation: ${w}`).slice(0, 200);
}

/** What that task says. */
export function variationTaskDetail(why: VariationWhy, job: string | null): string {
  const on = job ? ` on ${job}` : "";
  return why === "unaccepted"
    ? `Nothing is accepted on the quote${on} yet, so this changes the quote itself rather than starting a variation.`
    : `Starting a variation${on} needs money access: someone who has it starts it on the job's quote.`;
}

/** The card the conversation draws for a variation made. */
export type VariationCard = {
  index: number;
  how: VariationHow;
  /** "Started variation 1: return grille in Bed 2"; the task's title for a `task`. */
  title: string;
  /** Under it: what happens next. */
  line: string;
  /** The quote page on the variation, for a `started` one: its Open. */
  href: string | null;
  /** Its own Undo is offered. */
  undo: boolean;
};

export const VARIATION_LINE = {
  started: "A draft to change and price on the quote.",
  task: "A task for you.",
} as const;

/** The cards, one per variation still standing, in the order they were said. */
export function variationCards(made: readonly VariationMade[]): VariationCard[] {
  return made
    .filter((v) => !v.undone)
    .sort((a, b) => a.index - b.index)
    .map((v) => ({
      index: v.index,
      how: v.how,
      title: v.how === "task" ? variationTaskTitle(v.what, v.why ?? "unaccepted") : variationTitle(v),
      line: VARIATION_LINE[v.how],
      href: v.how === "started" && v.jobUuid && v.option !== null ? variationHref(v.jobUuid, v.option) : null,
      undo: v.how === "started" ? true : !!v.taskId,
    }));
}

/* ── what Tiff says ──────────────────────────────────────────────────── */

/** Her line for a variation made, in the record's language like her other
    server lines. */
export function variationDoneLine(v: VariationMade): string {
  if (v.how === "started") {
    return `${variationTitle(v)}. It's a copy of the accepted quote to change and price; nothing goes to the client or ServiceM8 until it's approved.`;
  }
  const title = variationTaskTitle(v.what, v.why ?? "unaccepted");
  return v.why === "money"
    ? `Starting a variation needs money access, so I've made it a task for you: ${title}.`
    : `There's no accepted quote on this job, so there's no variation to start. I've made it a task instead: ${title}.`;
}

/** Her line when `startVariation` refused it: its own words. */
export const variationRefusedLine = (what: string, error: string): string =>
  `The variation${what.trim() ? ` for ${what.trim()}` : ""} wasn't started. ${error.trim()}`;

/** Her line when its own Undo took it back. */
export const variationUndoneLine = (v: Pick<VariationMade, "how" | "why" | "n" | "what">): string =>
  v.how === "started" ? `Variation ${v.n ?? 1} taken back.` : `The task "${variationTaskTitle(v.what, v.why ?? "unaccepted")}" taken back.`;

/** The variation as the router is told it on a reply. */
export const variationRowLine = (v: ProposedVariation): string => `Variation to the accepted quote: ${v.what}`;
