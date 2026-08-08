/* The search animation's brain: what the lines and the four shelves are doing
   at each moment of a research question, as a value.

   IT IS A STATE MACHINE BECAUSE THE GEOMETRY IS UNPROVABLE. jsdom reports
   every rect as 0×0, so no test can say where a line goes — the same reason
   the system map's own tests assert cards and selection and never a
   coordinate. What CAN be proven is the choreography: which line is drawing,
   which shelf is lit, and what the microline under it says. All of that lives
   here, pure, and both the overlay and the rail are thin renderings of it.

   NOTHING HERE INVENTS A NUMBER, AND NOTHING HERE HOLDS A CLOCK. `hits` and
   `winners` arrive on the server's `trace` event, counted against real rows;
   the machine never fills in a plausible count while it waits, never delays a
   transition to make the search look harder, and contains no timer at all.
   Every duration below is a CSS duration this file only names so tests and the
   stylesheet can agree on it. The one piece of theatre is the draw and the
   pulse, and both run only while something is genuinely outstanding.

   WHY A PHASE AND NOT FOUR BOOLEANS: the same card can be `winner` because the
   answer is being written from it or because the answer has finished and it is
   the provenance left behind, and those two look different. A phase says which
   moment we are in; the trace says what was found. Selectors read both. */

import { KB_CATEGORIES, type KbCategory } from "./files";

/* ── durations (paired with the `.tk-line` / `.tk-rcat` rules in shell.css) ── */

/** A line drawing itself from the composer out to a shelf. */
export const DRAW_MS = 450;

/** One trip of the travelling pulse along a line that is still waiting. */
export const PULSE_MS = 1500;

/** Lines going out once the answer has landed. */
export const FADE_MS = 600;

/** A card changing state — colour, ring, dim. */
export const CARD_MS = 250;

/* ── the state ───────────────────────────────────────────────────────────── */

/** idle → searching → traced → answering → settled, and back to idle on reset. */
export type VizPhase = "idle" | "searching" | "traced" | "answering" | "settled";

export type ResearchViz = {
  phase: VizPhase;
  /** The shelves this question actually went out to — the stocked ones, named
      on submit. A shelf that isn't here stays at rest for the whole question:
      no lane, no shimmer, no "Searching…" over a card whose own count reads
      "—". That combination shipped once, and it was the machine performing a
      search of nothing for the sake of symmetry. */
  searched: readonly KbCategory[];
  /** Per-shelf hit counts from the trace. Null until one lands. */
  hits: Record<KbCategory, number> | null;
  /** The best-ranked document per shelf, from the same trace. Null until one
      lands, and null per shelf when retrieval didn't name one. */
  topDocs: Record<KbCategory, string | null> | null;
  /** The shelves the answer is actually built from. Empty until the trace. */
  winners: KbCategory[];
  /** True when the search came back with nothing — the miss owns the story. */
  missed: boolean;
};

export const IDLE_VIZ: ResearchViz = Object.freeze({
  phase: "idle",
  searched: [],
  hits: null,
  topDocs: null,
  winners: [],
  missed: false,
});

/* ── what the screen is told ─────────────────────────────────────────────── */

/** A line's class. `pulse` belongs to the second path drawn over the first. */
export type LineState = "draw" | "pulse" | "hit" | "dim" | "lit" | "kept" | "fade" | "off";

/** The travelling pulse on one lane: outbound while searching, back along the
    winner while the answer is written, or absent. */
export type LanePulse = "out" | "back" | "off";

export type CardState = "searching" | "hit" | "winner" | "dim" | "idle";

/** The microline under a shelf while it is being searched. */
export const SEARCHING_NOTE = "Searching…";

/** The microline under a shelf the search went through and found nothing in. */
export const NOTHING_NOTE = "—";

/* ── events ──────────────────────────────────────────────────────────────── */

export type VizEvent =
  /** A research question was sent. General-mode questions send `reset`.
      `searched` names the stocked shelves; omitted means all of them, which is
      what every caller before the gate existed meant. */
  | { t: "submit"; searched?: readonly KbCategory[] }
  /** Retrieval reported: where it looked and what it found. `topDocs` is
      optional — a trace without document titles still reports its counts. */
  | {
      t: "trace";
      winners: readonly KbCategory[];
      hits: Readonly<Partial<Record<KbCategory, number>>>;
      topDocs?: Readonly<Partial<Record<KbCategory, string | null>>>;
    }
  /** Retrieval found nothing anywhere. */
  | { t: "miss" }
  /** The first word of the answer arrived. */
  | { t: "firstDelta" }
  | { t: "done" }
  | { t: "error" }
  /** A new question, a thread switch, or a general-mode send. */
  | { t: "reset" };

/** The phases where a question is still in flight. */
const IN_FLIGHT: ReadonlySet<VizPhase> = new Set<VizPhase>(["searching", "traced", "answering"]);

const emptyHits = (): Record<KbCategory, number> => ({
  install: 0,
  faults: 0,
  specs: 0,
  sops: 0,
  field: 0,
});

/* A count that isn't a non-negative number is a count we don't have. Reading a
   malformed trace as zero is the honest failure: the shelf goes dim and says
   "—" rather than lighting up on a NaN. */
function normaliseHits(raw: Readonly<Partial<Record<KbCategory, number>>>): Record<KbCategory, number> {
  const out = emptyHits();
  for (const cat of KB_CATEGORIES) {
    const n = raw?.[cat];
    if (typeof n === "number" && Number.isFinite(n) && n > 0) out[cat] = Math.floor(n);
  }
  return out;
}

/* The best-ranked document per shelf, and only for a shelf that actually held
   something. A title beside a count of zero would be naming a document the
   search didn't find, which is worse than saying nothing. */
function normaliseTopDocs(
  raw: Readonly<Partial<Record<KbCategory, string | null>>> | undefined,
  hits: Record<KbCategory, number>
): Record<KbCategory, string | null> {
  const out: Record<KbCategory, string | null> = {
    install: null,
    faults: null,
    specs: null,
    sops: null,
    field: null,
  };
  for (const cat of KB_CATEGORIES) {
    if (hits[cat] <= 0) continue;
    const title = raw?.[cat];
    if (typeof title !== "string") continue;
    const clean = title.replace(/\s+/g, " ").trim();
    if (clean) out[cat] = clean;
  }
  return out;
}

/* The shelves a submit names, filtered to real categories and deduped.
   Undefined means the caller predates the gate (or genuinely searched
   everywhere) — every shelf, which is exactly the old behaviour. */
function normaliseSearched(raw: readonly KbCategory[] | undefined): readonly KbCategory[] {
  if (raw === undefined) return KB_CATEGORIES;
  const out: KbCategory[] = [];
  for (const cat of raw) {
    if (!KB_CATEGORIES.includes(cat)) continue;
    if (out.includes(cat)) continue;
    out.push(cat);
  }
  return out;
}

/* Winners, deduped and in the order the server ranked them — minus any shelf
   that contributed nothing. A winner with zero hits would light a card whose
   own microline reads "—", which is not a state anybody should have to read. */
function normaliseWinners(
  raw: readonly KbCategory[] | undefined,
  hits: Record<KbCategory, number>
): KbCategory[] {
  const out: KbCategory[] = [];
  for (const cat of raw ?? []) {
    if (!KB_CATEGORIES.includes(cat)) continue;
    if (out.includes(cat)) continue;
    if (hits[cat] <= 0) continue;
    out.push(cat);
  }
  return out;
}

/* The reducer.

   OUT-OF-ORDER EVENTS DO NOT LIE. Every event that isn't `submit`, `reset` or
   `error` only means something while a question is in flight, so a stray
   `trace` after an answer has settled is dropped rather than relighting the
   rail behind a finished answer. And a delta arriving BEFORE the trace leaves
   the rail searching: in research mode retrieval always reports first, so if
   the words start without it, the honest thing on screen is still "looking". */
export function reduceViz(state: ResearchViz, event: VizEvent): ResearchViz {
  switch (event.t) {
    case "submit":
      return {
        phase: "searching",
        searched: normaliseSearched(event.searched),
        hits: null,
        topDocs: null,
        winners: [],
        missed: false,
      };

    case "reset":
    /* An error takes the rail away entirely. A half-drawn search sitting under
       a failure message is decoration on top of bad news. */
    case "error":
      return IDLE_VIZ;

    case "trace": {
      if (!IN_FLIGHT.has(state.phase)) return state;
      const hits = normaliseHits(event.hits);
      return {
        // a trace that lands after the words started doesn't rewind the phase
        phase: state.phase === "answering" ? "answering" : "traced",
        searched: state.searched,
        hits,
        topDocs: normaliseTopDocs(event.topDocs, hits),
        winners: normaliseWinners(event.winners, hits),
        missed: false,
      };
    }

    case "miss":
      if (!IN_FLIGHT.has(state.phase)) return state;
      // nothing was found, so nothing is lit: the miss banner is the story
      return {
        phase: "settled",
        searched: state.searched,
        hits: null,
        topDocs: null,
        winners: [],
        missed: true,
      };

    case "firstDelta":
      if (state.phase !== "traced") return state;
      return { ...state, phase: "answering" };

    case "done":
      if (!IN_FLIGHT.has(state.phase)) return state;
      return { ...state, phase: "settled" };
  }
}

/* ── selectors ───────────────────────────────────────────────────────────── */

const hitsFor = (state: ResearchViz, cat: KbCategory): number => state.hits?.[cat] ?? 0;

/* The gate on the PERFORMANCE, never on the RESULT. `searched` decides which
   shelves act out the search — draw, shimmer, "Searching…" — and which
   "found nothing" is worth saying about ("—" belongs to a shelf that was
   worth looking in; an empty one already says "—" at rest). It must never
   silence a shelf the trace actually found something in: field notes carry a
   ready-doc count of zero and can still win the whole question — the exact
   shape of the four-against-five bug this file is already scarred by. */
const searchedHere = (state: ResearchViz, cat: KbCategory): boolean =>
  state.searched.includes(cat);

/** Whether the SVG underlay has anything to say at all. */
export function overlayVisible(state: ResearchViz): boolean {
  return state.phase !== "idle";
}

/* The base path's class, per shelf.

   A HIT AND A MISS ARE DIFFERENT SENTENCES NOW. They both rendered `dim` on
   the theory that the line only ever says where the answer came from — but on
   screen `.12` grey next to `.12` grey meant "we found four things here" and
   "we found nothing here" were indistinguishable, and the card's tinted border
   was the only witness. So a hit keeps a faint trace of its category colour
   and a miss drops nearly to nothing; the winner stays the loud one.

   AND SETTLING KEEPS THE WINNER'S THREAD. Every line used to fade to zero
   while the winner CARD kept its ring and its note — provenance on the card,
   amnesia on the line. `kept` is the line-side of the same statement, faint
   enough to read as residue rather than activity. */
export function lineState(state: ResearchViz, cat: KbCategory): LineState {
  switch (state.phase) {
    case "idle":
      return "off";
    case "searching":
      return searchedHere(state, cat) ? "draw" : "off";
    case "traced":
    case "answering":
      if (state.winners.includes(cat)) return "lit";
      if (hitsFor(state, cat) > 0) return "hit";
      // "we looked and found nothing" is only true of a shelf we looked in
      return searchedHere(state, cat) ? "dim" : "off";
    case "settled":
      if (state.winners.includes(cat)) return "kept";
      return searchedHere(state, cat) || hitsFor(state, cat) > 0 ? "fade" : "off";
  }
}

/* The travelling pulse, per lane — and its direction is the meaning. While
   the search is out, every lane pulses AWAY from the composer: the question
   is travelling to the shelves. Once the words are streaming, only the
   winner's lane pulses, and it runs the other way: the answer is being drawn
   FROM that shelf. `traced` sits between the two with no pulse at all, which
   is what finally makes it look different from `answering`. */
export function lanePulse(state: ResearchViz, cat: KbCategory): LanePulse {
  switch (state.phase) {
    case "searching":
      return searchedHere(state, cat) ? "out" : "off";
    case "answering":
      // a winner pulses whatever its shelf count said — field notes win at zero
      return state.winners.includes(cat) ? "back" : "off";
    default:
      return "off";
  }
}

export function cardState(state: ResearchViz, cat: KbCategory): CardState {
  switch (state.phase) {
    case "idle":
      return "idle";
    case "searching":
      return searchedHere(state, cat) ? "searching" : "idle";
    case "traced":
    case "answering":
      if (state.winners.includes(cat)) return "winner";
      if (hitsFor(state, cat) > 0) return "hit";
      return searchedHere(state, cat) ? "dim" : "idle";
    case "settled":
      /* The answer has landed: the rail goes back to being the way into the
         library, except the shelf it came from, which stays lit as provenance
         beside the source chips. */
      return state.winners.includes(cat) ? "winner" : "idle";
  }
}

const matches = (n: number): string =>
  `${n.toLocaleString("en-AU")} ${n === 1 ? "match" : "matches"}`;

/** What separates the count from the document, when there is a document. */
const NOTE_SEP = " · ";

/** The best-ranked document on a shelf, or null when the trace didn't name
    one. Only ever consulted for a shelf the answer was actually built from. */
export function topDocFor(state: ResearchViz, cat: KbCategory): string | null {
  return state.topDocs?.[cat] ?? null;
}

/* THE WINNER NAMES ITS DOCUMENT, and only the winner. "4 matches" answers
   "did you look here"; "4 matches · City Multi fault codes" answers "what did
   you read", which is the question a citation is about to be checked against —
   and it is the one card whose answer matters, because it is where the words
   came from. Putting a title under every hit shelf would turn the rail into a
   second search-results list nobody asked for. */
const noteFor = (state: ResearchViz, cat: KbCategory, n: number): string => {
  const doc = state.winners.includes(cat) ? topDocFor(state, cat) : null;
  return doc ? `${matches(n)}${NOTE_SEP}${doc}` : matches(n);
};

/* What replaces the shelf's document count, or null to leave the count alone. */
export function cardNote(state: ResearchViz, cat: KbCategory): string | null {
  switch (state.phase) {
    case "idle":
      return null;
    case "searching":
      return searchedHere(state, cat) ? SEARCHING_NOTE : null;
    case "traced":
    case "answering": {
      const n = hitsFor(state, cat);
      if (n > 0) return noteFor(state, cat, n);
      // an unsearched shelf's resting "—" already says everything true of it
      return searchedHere(state, cat) ? NOTHING_NOTE : null;
    }
    case "settled": {
      if (!state.winners.includes(cat)) return null;
      const n = hitsFor(state, cat);
      return n > 0 ? noteFor(state, cat, n) : null;
    }
  }
}
