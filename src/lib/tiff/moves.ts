/* "TAKE ME TO…" — the local test for a move request (universal Tiff 1C).

   One matcher, used in two places: the modal, to send a move to the ask
   route rather than file it as a note (until Phase 2's one conversation
   retires the regex), and the route, to move to a named screen with no model
   call at all.

   IT LEANS HARD TOWARD NOTES, as `looksLikeQuestion` does, because the costs
   are lopsided: a move missed is one extra model call or a note to discard;
   a note eaten is a site instruction that never gets filed. So a move is only
   a shape a note essentially never takes, anchored at both ends:

     screen  take me to · bring me to · take me back to · open · pull up ·
             show me · switch to · jump to — then optional "the"/"my", a
             screen's name, optional "screen"/"page"/"tab", and the end.
             "Go to" counts only with "screen"/"page"/"tab" after the name:
             "go to the toolbox" is a toolbox talk.
     record  take me to · bring me to · open · pull up · show me — then
             "Dane's card|profile", "job 1044", or "the" + one to three words
             with no preposition or conjunction + "job|project" (+ "card"/
             "sheet"), and the end.

   "Open up" and "bring up" never count: they are site verbs ("open up the
   ceiling", "bring up the ladder"). A move may be wrapped in a leading
   "please", "can you", "could you", "hey Tiff" or "Tiff" and a trailing
   "please" or "thanks", and nothing else.

   ENGLISH ONLY in Phase 1. A move in another language reaches the loop only
   through a question mark or a question cue (docs/universal-tiff-phase-1-
   spec.md, D10). */

import { ALL_SCREENS, SCREEN_ALIASES, squash } from "@/components/shell/nav";

export type Move = { kind: "screen"; label: string } | { kind: "record" };

const LABEL_BY_SQUASH: ReadonlyMap<string, string> = new Map([
  ...ALL_SCREENS.map((n): [string, string] => [squash(n.label), n.label]),
  ...Object.entries(SCREEN_ALIASES),
]);

const LEADING = /^(?:(?:please|can you|could you|would you|hey tiff|tiff)[\s,]+)+/;
const TRAILING = /(?:[\s,]+(?:please|thanks|thank you))+$/;
const SCREEN_VERBS = "take me to|take me back to|bring me to|open|pull up|show me|switch to|jump to";
const RECORD_VERBS = "take me to|bring me to|open|pull up|show me";
const JOINERS = new Set([
  "and", "or", "but", "on", "at", "in", "for", "to", "from", "with", "before", "after", "of", "by", "into", "onto",
  "off", "over", "under", "up", "then", "so",
]);

/** The words with their wrapping and end punctuation off, lowercase. */
function bare(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[\s.!?？,]+$/u, "")
    .replace(LEADING, "")
    .replace(TRAILING, "")
    .trim();
}

function screenOf(words: string): string | null {
  return LABEL_BY_SQUASH.get(squash(words)) ?? null;
}

/** A move request, or null for everything else (which is almost everything). */
export function parseMove(text: string): Move | null {
  const t = bare(text);
  if (!t || t.length > 120) return null;
  if (t === "take me home" || t === "go home") return { kind: "screen", label: "Home" };

  const s = new RegExp(`^(${SCREEN_VERBS}|go to)\\s+(?:the\\s+|my\\s+)?(.+?)(\\s+(?:screen|page|tab))?$`).exec(t);
  if (s) {
    const [, verb, name, suffix] = s;
    const label = screenOf(name);
    if (label && (verb !== "go to" || suffix)) return { kind: "screen", label };
  }

  if (new RegExp(`^(?:${RECORD_VERBS})\\s+[a-z][a-z-]*'s\\s+(?:card|profile)$`).test(t)) return { kind: "record" };
  if (new RegExp(`^(?:${RECORD_VERBS})\\s+job\\s+#?\\d+$`).test(t)) return { kind: "record" };
  const r = new RegExp(`^(?:${RECORD_VERBS})\\s+the\\s+(.+?)\\s+(?:job|project)(?:\\s+(?:card|sheet))?$`).exec(t);
  if (r) {
    const words = r[1].split(/\s+/);
    if (words.length <= 3 && !words.some((w) => JOINERS.has(w))) return { kind: "record" };
  }
  return null;
}

/* THE NAME IN AN OPEN REQUEST, for the free open (registry/screens'
   `openByName`). Looser than `parseMove` on purpose, because nothing acts on
   it alone: the name only opens something when exactly one record is called
   exactly that, and otherwise the words go on as they would have. So "open
   up" and "bring up" count here, and so does a bare name ("open up Isaac
   Smith"); "open up the ceiling" gives "ceiling", which names nothing and
   files as the note it is. A trailing "'s card", "profile", "page",
   "project", "job" or "client" comes off, and so does a leading "the". One
   to five words, none of them a joiner, or "job" and a number. */
const OPEN_VERBS = "open up|open|pull up|bring up|show me|take me to|bring me to|go to|jump to";

export function openName(text: string): string | null {
  const t = bare(text);
  if (!t || t.length > 80) return null;
  const m = new RegExp(`^(?:${OPEN_VERBS})\\s+(.+)$`).exec(t);
  if (!m) return null;
  const name = m[1]
    .replace(/^the\s+/, "")
    .replace(/'s\s+(?:card|profile|page)$/, "")
    .replace(/\s+(?:card|profile|page|project|job sheet|job|client)$/, "")
    .trim();
  if (/^job\s+#?\d+$/.test(name)) return name;
  const words = name.split(/\s+/);
  if (!name || words.length > 5 || words.some((w) => JOINERS.has(w) || w === "the" || w === "a")) return null;
  return name;
}
