/* The journal — the read side. Server only, org-scoped AND person-scoped.

   NO SESSION HERE: callers establish the right to ask and hand in an orgId,
   the same posture as every other read module in this feature.

   THE PERSON SCOPE IS NOT OPTIONAL, for the same reason `my-notes-query` says
   it isn't: this is a record of what someone said, in their own words, and the
   reader is the author and nobody else. It filters on `author_id` every time.

   READS ONLY WHAT WAS APPLIED. `pending` and `clarifying` are captures still
   mid-flight — a half-finished sentence is not a journal entry. An APPLIED
   capture that produced nothing (everything unticked) does stay: you still
   said it, and the row reads honestly with no outcomes after it.

   ALL FOUR ENDINGS ARE HERE, and `status` is what tells them apart. Every one
   of them writes this table, and for a while only one of them showed up:

     applyNote       The rows were created. `applied`, with the ids to prove it.
     keepNoteForMe   Writes the words to `staff_notes`. A SUCCESS, so it records
                     one `noteLines` — literally what that group means, down to
                     the `source_note_id` this file resolves the door from.
     keepNoteOnJob   Appends the words to the job's own notes. Also a success,
                     recorded as `jobNotes`.
     dismissNote     Escape, ×, walking away. `dismissed`, and it stays out.

   The two keep-rungs used to borrow the discard status, which meant saying
   something and choosing "Keep it in my notes" left the record saying you
   never said it — while the empty state promised that anything you tell Tiff
   lands here with what it turned into. THE STATUS IS THE WHOLE DISTINCTION
   NOW: filing is `applied`, abandoning is not. Do not let a fourth thing start
   writing `dismissed` on a path where something actually happened. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { auDayOf, fmtAuTime } from "@/lib/au-dates";
import { describeAppliedResolved, type JournalEntry } from "./journal";

const COLUMNS = "id, transcript, source, applied, created_at, is_debrief";

type Row = {
  id: string;
  transcript: string;
  source: string;
  applied: unknown;
  created_at: string;
  is_debrief: boolean | null;
};

/** What the chips on this page can be doors to. Everything here was read
    org-scoped in one batch per kind — see `resolveOutcomes`. */
type Resolved = {
  /** taskId → title, for the tasks that still exist. */
  tasks: Map<string, string>;
  /** kb documentId → title, for the documents that still exist. */
  kb: Map<string, string>;
  /** journal entry id → the grouped note its kept lines were filed as. */
  notes: Map<string, string>;
};

const toEntry = (r: Row, found: Resolved): JournalEntry => ({
  id: r.id,
  said: r.transcript,
  /* Both derived from the AU anchor, so an entry made at 7am in the yard files
     under today rather than under yesterday, which is what reading the raw
     timestamp on a UTC server would do. */
  day: auDayOf(r.created_at),
  at: fmtAuTime(new Date(r.created_at)),
  outcomes: describeAppliedResolved(r.applied, {
    tasks: found.tasks,
    kb: found.kb,
    noteId: found.notes.get(r.id) ?? null,
  }),
  spoken: r.source === "voice",
  /* Null for every row written before the column existed, and read as false —
     not a guess about the past, just the absence of a claim. See
     docs/migrations/note_is_debrief.sql. */
  isDebrief: r.is_debrief === true,
});

/** The ids a capture recorded under one group. Anything that isn't a string is
    not an id we wrote, and is left for `describeAppliedResolved` to count as
    gone rather than sent to the database. */
function appliedIds(applied: unknown, key: string): string[] {
  if (!applied || typeof applied !== "object") return [];
  const v = (applied as Record<string, unknown>)[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

/* THREE BATCHED READS FOR THE WHOLE PAGE, not one per chip. Sixty entries with
   a task each would otherwise be sixty round trips to render one panel.

   Org-scoped like everything else, and the notes read is person-scoped too:
   `staff_notes` is somebody's own notebook, and the door only opens onto the
   reader's own. A row that isn't returned is a row that has been deleted since
   — that is the whole point of resolving rather than trusting the stored id. */
async function resolveOutcomes(orgId: string, staffId: string, rows: readonly Row[]): Promise<Resolved> {
  const taskIds = [...new Set(rows.flatMap((r) => appliedIds(r.applied, "taskIds")))];
  const kbIds = [...new Set(rows.flatMap((r) => appliedIds(r.applied, "kbIds")))];
  // only the entries that actually kept lines have a note to find
  const keptIds = rows.filter((r) => appliedIds(r.applied, "noteLines").length > 0).map((r) => r.id);

  const [tasks, kb, notes] = await Promise.all([
    taskIds.length
      ? supabaseAdmin.from("tasks").select("id, title").eq("org_id", orgId).in("id", taskIds)
      : Promise.resolve({ data: [] }),
    kbIds.length
      ? supabaseAdmin.from("kb_documents").select("id, title").eq("org_id", orgId).in("id", kbIds)
      : Promise.resolve({ data: [] }),
    keptIds.length
      ? supabaseAdmin
          .from("staff_notes")
          .select("id, source_note_id")
          .eq("org_id", orgId)
          .eq("staff_id", staffId)
          .in("source_note_id", keptIds)
      : Promise.resolve({ data: [] }),
  ]);

  const found: Resolved = { tasks: new Map(), kb: new Map(), notes: new Map() };
  for (const r of (tasks.data ?? []) as Record<string, unknown>[])
    found.tasks.set(String(r.id), String(r.title ?? ""));
  for (const r of (kb.data ?? []) as Record<string, unknown>[])
    found.kb.set(String(r.id), String(r.title ?? ""));
  for (const r of (notes.data ?? []) as Record<string, unknown>[])
    found.notes.set(String(r.source_note_id), String(r.id));
  return found;
}

/** Everything this person has told Tiff, newest first.

    The default reaches back further than a day on purpose — the panel groups
    by day and scrolls, so the history IS the feature; a limit of "today" would
    make the scroll a lie. */
export async function listJournal(
  orgId: string,
  staffId: string,
  limit = 60,
): Promise<JournalEntry[]> {
  const { data } = await supabaseAdmin
    .from("workboard_notes")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("author_id", staffId)
    .eq("status", "applied")
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];
  const found = await resolveOutcomes(orgId, staffId, rows);
  return rows.map((r) => toEntry(r, found));
}
