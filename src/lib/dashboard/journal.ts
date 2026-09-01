/* THE JOURNAL — pure derivations.

   Every capture ever made is already stored verbatim: `workboard_notes` keeps
   the transcript as the evidence for what was applied (the audio is not kept),
   and `applied` records exactly which rows the confirmation created. Nothing
   in the app has ever read it back to a person — the table is write-only to
   humans, and the journal is the missing reader, not a new store.

   So there is no migration here and no change to the capture flow. */

/** The groups a capture can produce, in the order the write side records them,
    with the exact words it counts them in.

    THE WORDING IS COPIED ON PURPOSE. `applyNote` builds its "Saved — 2 tasks ·
    1 line kept" line from these same keys as it inserts each group, so the two
    cannot be shared without unpicking that flow. They CAN drift, which is why
    `journal-groups.test.ts` reads `actions/workboard-notes.ts` and fails if a
    key or a plural stops matching. If you add a group there, add it here.

    THE LAST TWO ARE THE KEEP-RUNGS, not `applyNote` at all — the endings that
    file the words as they were said. They are last because they are the
    cascade's own order: the job first, yourself only when nothing else fits. */
const GROUPS: readonly (readonly [key: string, one: string, many: string, kind: OutcomeKind])[] = [
  ["taskIds", "task", "tasks", "todo"],
  ["flagIds", "flag", "flags", "todo"],
  ["entryIds", "entry", "entries", "kept"],
  ["entryLines", "entry", "entries", "kept"],
  ["issueIds", "issue", "issues", "todo"],
  ["bringItems", "bring-item", "bring-items", "todo"],
  ["kbIds", "knowledge entry", "knowledge entries", "kept"],
  ["jobNotes", "note on the job", "notes on the job", "kept"],
  ["noteLines", "line kept", "lines kept", "kept"],
];

/* TWO KINDS, NOT EIGHT. Each chip carries a glyph, and eight glyphs would be a
   new vocabulary to learn for a row that is meant to be read at a glance. The
   split that matters is the one the reader acts on: something now WANTS you
   (a task, a flag, an issue, a thing to bring), or something was WRITTEN DOWN
   (an entry, a knowledge line, a kept line). */
export type OutcomeKind = "todo" | "kept";

/** Where a chip goes when it is the thing it names. Resolved server-side, so
    a door only ever exists for a row that was still there when the page was
    built — see `describeAppliedResolved`. */
export type OutcomeDoor = { type: "task" | "kb" | "note"; id: string };

export type Outcome = { kind: OutcomeKind; text: string; go?: OutcomeDoor };

/** What the resolver found, per entry. Absent map = "nothing was looked up",
    which is how the plain count wording is still reachable. */
export type AppliedLookups = {
  /** taskId → title, for the tasks that still exist. */
  tasks?: ReadonlyMap<string, string>;
  /** kb documentId → title, for the documents that still exist. */
  kb?: ReadonlyMap<string, string>;
  /** The grouped note THIS capture's kept lines were filed as, if still there. */
  noteId?: string | null;
};

/* A chip is a line of a row, not a paragraph. Long enough for a real task
   ("Order 2× MERV 11 filters for the Clyde plant room" is 47), short enough
   that three of them still wrap tidily. */
export const CHIP_TITLE_MAX = 48;

function chipTitle(title: string): string {
  const t = title.trim().replace(/\s+/g, " ");
  return t.length <= CHIP_TITLE_MAX ? t : `${t.slice(0, CHIP_TITLE_MAX - 1).trimEnd()}…`;
}

/** What a capture turned into: [{kind:"todo",text:"2 tasks"}, …].

    Empty when it produced nothing, which is a real outcome and not an error —
    you can untick every line and still have said the thing. The row renders
    with the words and no outcomes rather than disappearing. */
export function describeApplied(applied: unknown): Outcome[] {
  return describeAppliedResolved(applied);
}

/* THE CHIPS BECOME THE THINGS THEY NAME — given the rows to name them with.

   "2 tasks" told you the capture worked and nothing else; the point of saying
   "Order 2× MERV 11 filters" is that you can then go and tick it off. So the
   two groups that have somewhere to go expand: one chip per row, wearing its
   own title, carrying a door.

   WHAT IS GONE IS COUNTED, NEVER LINKED. A stored id whose row has since been
   deleted collapses back into the old count wording with "removed" on it —
   the capture really did make it, and it really isn't there any more. Both
   halves of that are true and a dead door would be neither.

   The other six groups keep their counts and stay unlinked on purpose: a
   flag, an issue, a diary entry and a bring-item have no canonical page in
   this app, and sending them "to the workboard, roughly" would be a lie. Words
   kept on a job are the same answer for a different reason — they are text in
   somebody else's `notes` column, and a visit or an agreement opens in a sheet
   ON the board rather than at a route a chip could point at. */
export function describeAppliedResolved(
  applied: unknown,
  lookups: AppliedLookups = {},
): Outcome[] {
  if (!applied || typeof applied !== "object") return [];
  const rec = applied as Record<string, unknown>;
  const out: Outcome[] = [];

  for (const [key, one, many, kind] of GROUPS) {
    const v = rec[key];
    // every group is recorded as an array of ids or lines; anything else is
    // a shape we did not write, and guessing at it would invent a number
    if (!Array.isArray(v) || v.length === 0) continue;

    const named =
      key === "taskIds" ? lookups.tasks : key === "kbIds" ? lookups.kb : undefined;

    if (named) {
      const gone: unknown[] = [];
      for (const id of v) {
        const title = typeof id === "string" ? named.get(id) : undefined;
        if (title === undefined) {
          gone.push(id);
          continue;
        }
        out.push({
          kind,
          text: chipTitle(title),
          go: { type: key === "taskIds" ? "task" : "kb", id: id as string },
        });
      }
      if (gone.length > 0)
        out.push({ kind, text: `${gone.length} ${gone.length === 1 ? one : many} removed` });
      continue;
    }

    const text = `${v.length} ${v.length === 1 ? one : many}`;
    /* Kept lines are the odd one out: the debrief files them as ONE grouped
       note, so they get one door for the lot rather than a chip each — the
       words themselves aren't stored per line anywhere the reader can open. */
    out.push(
      key === "noteLines" && lookups.noteId
        ? { kind, text, go: { type: "note", id: lookups.noteId } }
        : { kind, text },
    );
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
  /** Did this come through the Debrief face, or an ordinary note/diary
      capture? Both write the same row and always did — this is the one thing
      that tells them apart, and it only exists for rows written after the
      column did. */
  isDebrief: boolean;
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
/** How far under the scroller's top edge a day's block must be before it
    counts as the one you are reading. The sticky heading occupies that band,
    so a day is "reached" at the moment its own heading becomes the stuck one. */
export const DAY_FOLD_PX = 44;

/** Which day the reader is in, from scroll position alone.

    THE RULE THIS REPLACED WAS WRONG, and only real data showed it. It used an
    IntersectionObserver and took "the newest day with any intersection" —
    correct exactly while the list is long enough that one day fills the
    viewport. On a three-day diary in a 361px scroller every day intersects at
    once, so the newest always won and the label never moved, even scrolled to
    the bottom. That is why this is a pure function with tests rather than a
    closure inside an effect: it is arithmetic, and arithmetic that is wrong
    should fail in a suite rather than in a browser someone happens to open.

    `offsets` is each day's `offsetTop` within the scroller. Days come
    newest-first, matching the record, and the answer is the LAST one that has
    already passed the fold — walking in order and stopping at the first that
    has not, because a list in order cannot have a later one qualify. */
export function topDayAt(
  order: readonly string[],
  offsets: ReadonlyMap<string, number>,
  scrollTop: number,
  fold: number = DAY_FOLD_PX,
): string | null {
  if (order.length === 0) return null;
  const line = scrollTop + fold;
  /* The newest day is the answer before anything has scrolled, and stays the
     answer for a list too short for any other day to reach the fold — which
     is honest: no other day IS at the top. */
  let top = order[0];
  for (const day of order) {
    const at = offsets.get(day);
    if (at === undefined) continue;
    if (at <= line) top = day;
    else break;
  }
  return top;
}

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
