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
  /** A research question was sent. General-mode questions send `reset`. */
  | { t: "submit" }
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
      return { phase: "searching", hits: null, topDocs: null, winners: [], missed: false };

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
        hits,
        topDocs: normaliseTopDocs(event.topDocs, hits),
        winners: normaliseWinners(event.winners, hits),
        missed: false,
      };
    }

    case "miss":
      if (!IN_FLIGHT.has(state.phase)) return state;
      // nothing was found, so nothing is lit: the miss banner is the story
      return { phase: "settled", hits: null, topDocs: null, winners: [], missed: true };

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

/* EVERY SHELF PERFORMS THE SEARCH, empty or not. A gate that kept unstocked
   shelves at rest shipped here once, reasoned as honesty — and with one
   stocked shelf it reduced the whole choreography to a single line straight
   to the answer. The owner watched it and called it: the sweep IS the
   product's story, and it isn't a lie — retrieval covers the entire library;
   an empty shelf is a place it looked and a "—" is what it found there. */

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
      return "draw";
    case "traced":
    case "answering":
      if (state.winners.includes(cat)) return "lit";
      return hitsFor(state, cat) > 0 ? "hit" : "dim";
    case "settled":
      return state.winners.includes(cat) ? "kept" : "fade";
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
      return "out";
    case "answering":
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
      return "searching";
    case "traced":
    case "answering":
      if (state.winners.includes(cat)) return "winner";
      return hitsFor(state, cat) > 0 ? "hit" : "dim";
    case "settled":
      /* The answer has landed: the rail goes back to being the way into the
         library, except the shelf it came from, which stays lit as provenance
         beside the source chips. */
      return state.winners.includes(cat) ? "winner" : "idle";
  }
}

/** The microline under a shelf that held something but wasn't built from. */
export const ALSO_MATCHED_NOTE = "Also matched";

/** The winner's microline when the trace didn't name its document. */
export const FOUND_HERE_NOTE = "Found it here";

/** The best-ranked document on a shelf, or null when the trace didn't name
    one. Only ever consulted for a shelf the answer was actually built from. */
export function topDocFor(state: ResearchViz, cat: KbCategory): string | null {
  return state.topDocs?.[cat] ?? null;
}

/* THE WINNER NAMES ITS DOCUMENT, and only the winner — and it names ONLY the
   document. This used to read "56 matches · Daikin VRV Diagnosis Ma…": the
   chunk tally is retrieval's own bookkeeping, no reader can act on it, and on
   the live walk it cost the one fact that matters — the title — its ellipsis.
   A hit shelf says "Also matched" rather than a number for the same reason;
   putting a title under every hit would turn the rail into a second results
   list nobody asked for. */
const noteFor = (state: ResearchViz, cat: KbCategory): string => {
  if (!state.winners.includes(cat)) return ALSO_MATCHED_NOTE;
  return topDocFor(state, cat) ?? FOUND_HERE_NOTE;
};

/* What replaces the shelf's document count, or null to leave the count alone. */
export function cardNote(state: ResearchViz, cat: KbCategory): string | null {
  switch (state.phase) {
    case "idle":
      return null;
    case "searching":
      return SEARCHING_NOTE;
    case "traced":
    case "answering": {
      return hitsFor(state, cat) > 0 ? noteFor(state, cat) : NOTHING_NOTE;
    }
    case "settled": {
      if (!state.winners.includes(cat)) return null;
      return hitsFor(state, cat) > 0 ? noteFor(state, cat) : null;
    }
  }
}
