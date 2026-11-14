/* SITE NOTES, WHAT THE PAGE IS HANDED (docs/migrations/site_notes.sql; the
   pop-up drawn on https://claude.ai/artifact/DqJvanQJMJgjs5ZTRySYpB, Isaac,
   14 November 2026: "Build all as recommended").

   Client-safe: the read's shapes, the kinds' words, and the plain-text test
   that picks likely codes out of old ServiceM8 notes. No model reads them, so
   the list costs nothing. */

export const SITE_NOTE_KINDS = ["access", "issue", "other"] as const;
export type SiteNoteKind = (typeof SITE_NOTE_KINDS)[number];

export function isSiteNoteKind(v: unknown): v is SiteNoteKind {
  return typeof v === "string" && (SITE_NOTE_KINDS as readonly string[]).includes(v);
}

/** The section each kind stands in, and its word on the form. */
export const KIND_WORDS: Record<SiteNoteKind, { section: string; choice: string }> = {
  access: { section: "Access", choice: "Access" },
  issue: { section: "Issues found", choice: "Issue found" },
  other: { section: "Other notes", choice: "Other" },
};

export const SITE_NOTE_MAX = 2000;

export type SiteNoteVideo = {
  /** a job photo's remote id: `doc:<id>` for one of ours, else ServiceM8's uuid */
  ref: string;
  /** ours: a signed address to play it; ServiceM8's: null, it plays there */
  url: string | null;
  /** ServiceM8 keeps the clip: the job's door in ServiceM8 */
  inSm8: string | null;
};

export type SiteNoteRow = {
  id: string;
  kind: SiteNoteKind;
  words: string;
  /** null: the whole building */
  unit: string | null;
  /** "Isaac Smith", or null when nobody can be named */
  by: string | null;
  /** "9 Nov", "2 Feb 2025" */
  when: string;
  /** the job it was written on */
  job: { uuid: string; number: string | null } | null;
  video: SiteNoteVideo | null;
};

export type SiteJobRow = {
  uuid: string;
  number: string | null;
  /** "Unit 2: Check Bedroom AC system": the description's first line */
  title: string;
  /** "Done 11 Jun 2026", "Work order since 16 Jun 2025" */
  line: string;
  /** not finished: Still open in the warn colour */
  open: boolean;
};

export type SiteVideoChoice = { ref: string; name: string };

export type SiteNotesRead = {
  /** The job's address doesn't name a building: no notes can be kept. */
  noSite: boolean;
  /** "106 Kirribilli Avenue" */
  street: string;
  /** "Kirribilli NSW 2061" */
  place: string;
  /** this job's unit, "2", or null */
  unit: string | null;
  /** the building's notes, then this unit's, oldest first in each */
  notes: SiteNoteRow[];
  /** every other job at the building, newest first */
  jobs: SiteJobRow[];
  /** this job's clips, to keep one with an issue */
  videos: SiteVideoChoice[];
};

/* ---- likely codes in old ServiceM8 notes ---------------------------------

   Plain text, no model: a note is likely when a word for a way in sits near a
   number ("Lockbox code 4821", "Gate Code 2011", "4821 is lockbox", "Key
   1234"), or it names a way in without one ("Lockbox inside the
   switchboard", "Parking via the rear lane"). Error and fault codes, access
   panels and parking paid on a card are not. A long report counts only for
   the lines that hold the code, which are what's offered to file. */

/** What the database is asked for first: any note naming a way in. */
export const OLD_NOTE_SEARCH = "(lock ?box|key|gate|door|code|pin|alarm|intercom|concierge|manager|parking|car ?park)";

const NEAR_CODE =
  /(lock ?box|\bkey ?(safe|box|code)?\b|\bgate\b|\bdoors?\b|access ?code|\balarm\b|\bpin\b|\bcode\b|intercom)[^\n\d]{0,30}(?<!\d)\d{3,8}(?!\d)#?|(?<![\d.])\d{3,8}(?!\d)#?\s*(is\s+)?(the\s+)?(lock ?box|\bkey\b|\bgate\b|\bdoor\b|job code|\bcode\b|\bpin\b|\balarm\b)/i;
const WAY_IN = /(lock ?box|key ?safe|intercom code|concierge|building manager|strata manager|parking( access)? (in|via|at|on|behind|is|under|out)|loading (zone|dock))/i;
const NOT_A_CODE =
  /(\berror\b|\bfault\b|\berr\b|serial|model|(service|product)[ -]?code|access (panel|pannel|hatch)|\$\s?\d|grill|\d\s?x\s?\d{2}|\d\s?mm\b|\bwide\b|\b0[2-478]\d{2}\s?\d{3}\s?\d{3}\b)/i;

/** The lines of a note worth filing as a code, or null when it isn't one. */
export function likelyCodeLines(note: string): string | null {
  const text = (note ?? "").replace(/\r/g, "").trim();
  if (!text) return null;
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const hits = lines.filter((l) => (NEAR_CODE.test(l) || WAY_IN.test(l)) && !NOT_A_CODE.test(l));
  if (hits.length === 0) {
    /* a short note can say it over two lines: "Pin Code:\n4821" */
    if (text.length <= 60 && NEAR_CODE.test(lines.join(" ")) && !NOT_A_CODE.test(text)) return lines.join(" ");
    return null;
  }
  /* a report of a page or more names a code once: only its code lines count,
     and only when one carries the code itself */
  if (text.length > 300 && !hits.some((l) => NEAR_CODE.test(l))) return null;
  return hits.join("\n").slice(0, SITE_NOTE_MAX);
}

export type OldCodeNote = {
  /** sm8_job_notes.uuid */
  uuid: string;
  /** the lines offered to file, which can be changed before filing */
  words: string;
  /** the note as it was written */
  note: string;
  job: { uuid: string; number: string | null; address: string };
  /** the job's unit, or null: a unit's job can file on the unit or the building */
  unit: string | null;
  by: string | null;
  when: string;
};

/* ---- words for a day ---- */

/** "9 Nov" this year, "2 Feb 2025" another, for an AU calendar day. */
export function dayWords(day: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const d = new Date(`${day}T00:00:00Z`);
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
}
