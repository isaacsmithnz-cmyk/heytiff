/* THE JOURNAL — pure derivations.

   Every capture ever made is already stored verbatim: `workboard_notes` keeps
   the transcript as the evidence for what was applied (the audio is not kept),
   and `applied` records exactly which rows the confirmation created. Nothing
   in the app has ever read it back to a person — the table is write-only to
   humans, and the journal is the missing reader, not a new store.

   So there is no migration here and no change to the capture flow. */

/** The groups a capture can produce, in the order `applyNote` records them,
    with the exact words it counts them in.

    THE WORDING IS COPIED ON PURPOSE. `applyNote` builds its "Saved — 2 tasks ·
    1 line kept" line from these same eight keys as it inserts each group, so
    the two cannot be shared without unpicking that flow. They CAN drift, which
    is why the test pins them against the singular/plural pairs in
    `actions/workboard-notes.ts`. If you add a group there, add it here. */
const GROUPS: readonly (readonly [key: string, one: string, many: string, kind: OutcomeKind])[] = [
  ["taskIds", "task", "tasks", "todo"],
  ["flagIds", "flag", "flags", "todo"],
  ["entryIds", "entry", "entries", "kept"],
  ["entryLines", "entry", "entries", "kept"],
  ["issueIds", "issue", "issues", "todo"],
  ["bringItems", "bring-item", "bring-items", "todo"],
  ["kbIds", "knowledge entry", "knowledge entries", "kept"],
  ["noteLines", "line kept", "lines kept", "kept"],
];

/* TWO KINDS, NOT EIGHT. Each chip carries a glyph, and eight glyphs would be a
   new vocabulary to learn for a row that is meant to be read at a glance. The
   split that matters is the one the reader acts on: something now WANTS you
   (a task, a flag, an issue, a thing to bring), or something was WRITTEN DOWN
   (an entry, a knowledge line, a kept line). */
export type OutcomeKind = "todo" | "kept";

export type Outcome = { kind: OutcomeKind; text: string };

/** What a capture turned into: [{kind:"todo",text:"2 tasks"}, …].

    Empty when it produced nothing, which is a real outcome and not an error —
    you can untick every line and still have said the thing. The row renders
    with the words and no outcomes rather than disappearing. */
export function describeApplied(applied: unknown): Outcome[] {
  if (!applied || typeof applied !== "object") return [];
  const rec = applied as Record<string, unknown>;
  const out: Outcome[] = [];
  for (const [key, one, many, kind] of GROUPS) {
    const v = rec[key];
    // every group is recorded as an array of ids or lines; anything else is
    // a shape we did not write, and guessing at it would invent a number
    if (!Array.isArray(v) || v.length === 0) continue;
    out.push({ kind, text: `${v.length} ${v.length === 1 ? one : many}` });
  }
  return out;
}

/** Exported for the test that pins the wording against the write side. */
export const APPLIED_GROUPS = GROUPS;

export type JournalEntry = {
  id: string;
  /** Verbatim — what was actually said or typed. */
  said: string;
  /** The AU calendar day it happened on, ISO yyyy-mm-dd, for grouping. */
  day: string;
  /** "6:52 am" on the yard's clock. */
  at: string;
  /** What it became, each with the glyph its chip wears. */
  outcomes: Outcome[];
  spoken: boolean;
};

export type JournalDay = {
  /** ISO yyyy-mm-dd. */
  day: string;
  /** "Today" · "Yesterday" · "Fri 7 Aug". */
  label: string;
  entries: JournalEntry[];
};

/* "Today" and "Yesterday" earn their names; everything older says its date,
   because "3 days ago" makes you do arithmetic to find Thursday. */
function dayLabel(day: string, today: string, fmt: (iso: string) => string): string {
  if (day === today) return "Today";
  const y = new Date(`${today}T00:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (day === y.toISOString().slice(0, 10)) return "Yesterday";
  return fmt(day);
}

/** Group a flat, newest-first list into days, preserving that order.

    Newest first throughout: what you just said is where your eye already is,
    and the day you are in is the one you are adding to. */
export function groupByDay(
  entries: readonly JournalEntry[],
  today: string,
  fmt: (iso: string) => string,
): JournalDay[] {
  const days: JournalDay[] = [];
  for (const e of entries) {
    const last = days[days.length - 1];
    if (last && last.day === e.day) last.entries.push(e);
    else days.push({ day: e.day, label: dayLabel(e.day, today, fmt), entries: [e] });
  }
  return days;
}
