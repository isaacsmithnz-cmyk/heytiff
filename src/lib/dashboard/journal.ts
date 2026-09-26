/* THE JOURNAL — pure derivations.

   Every capture ever made is already stored verbatim: `workboard_notes` keeps
   the transcript as the evidence for what was applied (the audio is not kept),
   and `applied` records exactly which rows the confirmation created. Nothing
   in the app has ever read it back to a person — the table is write-only to
   humans, and the journal is the missing reader, not a new store.

   So there is no migration here and no change to the capture flow. */

import type { EarlierTurn } from "@/lib/workboard/note-turns";
import type { DiaryReply } from "./diary-reply";

/** The groups a capture can produce, in the order the write side records them,
    with the exact words it counts them in.

    THE WORDING IS COPIED ON PURPOSE. The writer (`applyConfirmed`) builds its
    "Saved — 2 tasks, 1 flag." line from these same keys as it inserts each
    group, so the two cannot be shared without unpicking that flow. They CAN
    drift, which is why `journal-groups.test.ts` reads
    `actions/workboard-notes.ts` and fails if a key or a plural stops
    matching. If you add a group there, add it here.

    THE LAST TWO ARE THE WORDS KEPT AS SAID. A note filed on a ServiceM8 job
    keeps its words on the job (`jobNotes`); `noteLines` is on rows from
    before, which the old capture card's keep-rungs and the Debrief wrote,
    and still reads. */
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
export type OutcomeDoor = { type: "task" | "kb" | "note" | "issue"; id: string };

export type Outcome = { kind: OutcomeKind; text: string; go?: OutcomeDoor };

/** What the resolver found, per entry. Absent map = "nothing was looked up",
    which is how the plain count wording is still reachable. */
export type AppliedLookups = {
  /** taskId → title, for the tasks that still exist. */
  tasks?: ReadonlyMap<string, string>;
  /** kb documentId → title, for the documents that still exist. */
  kb?: ReadonlyMap<string, string>;
  /** issueId → summary. Resolved or not: a resolved issue still has its
      words, and its door lands on the face that lists issues. */
  issues?: ReadonlyMap<string, string>;
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

   AN ISSUE HAS A DOOR SINCE 2026-09-15, when Home began listing them: given
   the lookup, each issue is a chip wearing its summary that lands on its row.
   Without the lookup it stays the count it always was.

   The other groups keep their counts and stay unlinked on purpose: a flag, a
   diary entry and a bring-item have no canonical page in this app, and
   sending them "to the workboard, roughly" would be a lie. Words
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
      key === "taskIds"
        ? lookups.tasks
        : key === "kbIds"
          ? lookups.kb
          : key === "issueIds"
            ? lookups.issues
            : undefined;
    const door: OutcomeDoor["type"] = key === "taskIds" ? "task" : key === "kbIds" ? "kb" : "issue";

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
          go: { type: door, id: id as string },
        });
      }
      if (gone.length > 0)
        out.push({ kind, text: `${gone.length} ${gone.length === 1 ? one : many} removed` });
      continue;
    }

    const text = `${v.length} ${v.length === 1 ? one : many}`;
    /* Kept lines are the odd one out: they were filed as ONE note (the old
       Debrief grouped its leftovers into one, and "Keep it in my notes" keeps
       the whole of what was said as one), so they get one door for the lot
       rather than a chip each — the words themselves aren't stored per line
       anywhere the reader can open. */
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
};

/** A journal entry as the new Home's diary holds it (journal-query's
    `listDiaryEntries`). `day` and `at` are on the ServiceM8 account's clock
    here, the same clock as `stamp`. */
export type DiaryEntry = JournalEntry & {
  /** "2026-09-21 13:42", naive, in the account's zone: sortable beside a
      ServiceM8 note's own stamp. */
  stamp: string;
  /** Tiff read the words. False for a Save, which files them as typed and
      routes nothing — so only a routed entry can say "Nothing filed." */
  routed: boolean;
  /** taskId → the staff card the task is on (null: nobody), for each task
      this entry made that still exists. A removed task isn't here; its
      outcome already says "removed". */
  taskFor: Record<string, string | null>;
  /** The conversation with Tiff the entry came out of, as the modal said
      it (note-turns' `conversationOf`): her last turn is the line under the
      words, and the line opens the rest. Empty when she said nothing — a
      Save, a note the review card filed, one from before the modal. */
  turns: EarlierTurn[];
  /** Undo would take back what it filed: a note filed with the record Undo
      reads, something it made is still there, and nobody has acted on a row
      it filed (a task ticked, "Got it", given, moved or reopened, a flag
      cleared, an issue counted again, a line bought, the job's notes
      edited) — the rule `undoNote` refuses on (note-applied's
      `undoBlocked`). */
  undo: boolean;
  /** Taken back. Your words stay, with Tiff's line saying so, and nothing
      under them: what they made has gone. */
  undone: boolean;
  /** Something of it has left HeyTiff — queued for ServiceM8, sent there,
      a reply or a Done posted there — so ServiceM8 holds the words too, and
      they are changed there, not here (actions/diary's `editDiaryEntry`
      refuses by the same rule). Absent: HeyTiff's alone. */
  inSm8?: boolean;
  /** Your reply to a ServiceM8 note, or a task's Done (two-way phase 2):
      the conversation holding the note it answers draws it there, in its
      place (./diary-reply). Only where the deployment sends notes. */
  reply?: DiaryReply;
};

/** The entry a task came from, or null for a task that was typed straight in.

    No query and no column: a task's door is recorded on the entry that made
    it (`outcomes[].go`), and the journal is already in the page's hands. The
    Tasks face reads the words a task was born from off the same list the
    Diary face draws, so the two can never disagree about which note it was. */
export function entryForTask(
  entries: readonly JournalEntry[],
  taskId: string,
): JournalEntry | null {
  return entryForDoor(entries, "task", taskId);
}

/** The same lookup for anything a door can name — a task, or an issue. */
export function entryForDoor(
  entries: readonly JournalEntry[],
  type: OutcomeDoor["type"],
  id: string,
): JournalEntry | null {
  for (const e of entries)
    if (e.outcomes.some((o) => o.go?.type === type && o.go.id === id)) return e;
  return null;
}
