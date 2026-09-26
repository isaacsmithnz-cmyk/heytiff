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
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { UNDO_HOLD_COLUMNS, undoHeldBySm8, type CreateRow } from "@/lib/integrations/sm8-note-plan";
import { todayInZone } from "@/lib/workboard/dates";
import { naiveInZone } from "@/lib/workboard/job-story";
import {
  APPLIED_V,
  TEXT_COLUMNS,
  appliedOf,
  stillThere,
  takesBack,
  textKey,
  undoBlocked,
  type AppliedRecord,
  type FiledNow,
  type NowRow,
  type TextTable,
} from "@/lib/workboard/note-applied";
import { conversationOf, lastTiff, turnsOf } from "@/lib/workboard/note-turns";
import { describeAppliedResolved, type DiaryEntry, type JournalEntry } from "./journal";
import { ACTED_KINDS } from "./task-events";
import { DIARY_ENTRY_LIMIT } from "./diary-feed";

/* NO `is_debrief`, WRITTEN OR READ. The Debrief left the router and this
   read in the same change, so the column's drop (note_is_debrief_drop.sql) is
   safe to apply once that change is live, and not before: the code before it
   names the column here, and PostgREST fails the whole select on a column
   that isn't there, which would empty every diary. An old Debrief row needs
   nothing from the column to keep its place: it is an applied note like any
   other, and its grouped note's door is resolved from `applied.noteLines`
   below. A test in journal-query.test.ts refuses a migration that drops a
   column this list still names. */
const COLUMNS = "id, transcript, source, applied, created_at";
/* The diary's read is the journal's plus whether Tiff routed the words at
   all, where the note ended up and the conversation it was. Built ON the
   journal's list rather than beside it, so whatever the journal stops
   reading (the Debrief's column is on its way out) the diary stops reading
   in the same edit. `status` has always been there; `turns` and the
   `undone` status are tiff_modal_turns.sql's, applied before the modal
   shipped. */
const DIARY_COLUMNS = `${COLUMNS}, proposal, status, turns`;
/** What the diary reads: what was filed, and what Undo has taken back since
    — your words stay when what they made goes. */
const DIARY_STATUSES = ["applied", "undone"];

type Row = {
  id: string;
  transcript: string;
  source: string;
  applied: unknown;
  created_at: string;
  /** Only in the diary's read. */
  proposal?: unknown;
  status?: string;
  turns?: unknown;
};

/** What the chips on this page can be doors to. Everything here was read
    org-scoped in one batch per kind — see `resolveOutcomes`. */
type Resolved = {
  /** taskId → title, for the tasks that still exist. */
  tasks: Map<string, string>;
  /** taskId → the staff card it is on (null: nobody), for the same tasks. */
  owners: Map<string, string | null>;
  /** Every row a filed record names, as it reads now, in the shape Undo's
      rule reads (note-applied's `undoBlocked`). Asked only by the diary,
      whose Undo is drawn where a press would not be refused; empty for the
      journal. */
  now: FiledNow;
  /** kb documentId → title, for the documents that still exist. */
  kb: Map<string, string>;
  /** journal entry id → the grouped note its kept lines were filed as. */
  notes: Map<string, string>;
  /** issueId → summary, resolved or not. */
  issues: Map<string, string>;
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
    issues: found.issues,
    noteId: found.notes.get(r.id) ?? null,
  }),
  spoken: r.source === "voice",
});

/** The ids a capture recorded under one group. Anything that isn't a string is
    not an id we wrote, and is left for `describeAppliedResolved` to count as
    gone rather than sent to the database. */
function appliedIds(applied: unknown, key: string): string[] {
  if (!applied || typeof applied !== "object") return [];
  const v = (applied as Record<string, unknown>)[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

/* FOUR BATCHED READS FOR THE WHOLE PAGE, not one per chip. Sixty entries with
   a task each would otherwise be sixty round trips to render one panel.

   Org-scoped like everything else, and the notes read is person-scoped too:
   `staff_notes` is somebody's own notebook, and the door only opens onto the
   reader's own. A row that isn't returned is a row that has been deleted since
   — that is the whole point of resolving rather than trusting the stored id.

   THE DIARY ASKS MORE (`withStatus`): whether Undo would still take each
   filed note back, which is every row its record names, as it reads now.
   The chips' own reads carry the extra columns (a task's status, an
   issue's count, a Library entry's kind); what no chip reads — flags,
   checklist and picklist rows, project entries, the text a note appended
   to — is one read more per kind, only for records Undo reads (`v: 2`),
   and only where one of them names any. */
async function resolveOutcomes(
  orgId: string,
  staffId: string,
  rows: readonly Row[],
  /** The diary's read: every row a filed record names, for its Undo. */
  withStatus = false,
): Promise<Resolved> {
  const taskIds = [...new Set(rows.flatMap((r) => appliedIds(r.applied, "taskIds")))];
  const kbIds = [...new Set(rows.flatMap((r) => appliedIds(r.applied, "kbIds")))];
  const issueIds = [...new Set(rows.flatMap((r) => appliedIds(r.applied, "issueIds")))];
  // only the entries that actually kept lines have a note to find
  const keptIds = rows.filter((r) => appliedIds(r.applied, "noteLines").length > 0).map((r) => r.id);
  const taskColumns: string = withStatus
    ? "id, title, assigned_to, status, acknowledged_at"
    : "id, title, assigned_to";

  /* What only Undo reads, from the records it reads. */
  const undoable = withStatus ? rows.map((r) => appliedOf(r.applied)).filter((a) => a.v === APPLIED_V) : [];
  const ids = (pick: (a: AppliedRecord) => readonly string[]) => [...new Set(undoable.flatMap(pick))];
  const byStatus = (table: string, columns: string, list: readonly string[]) =>
    list.length
      ? supabaseAdmin.from(table).select(columns).eq("org_id", orgId).in("id", list)
      : Promise.resolve({ data: [] });
  const written = new Map<TextTable, Set<string>>();
  for (const w of undoable.flatMap((a) => a.textWrites)) {
    const at = written.get(w.table) ?? new Set<string>();
    written.set(w.table, at.add(w.id));
  }
  const history = ids((a) => a.taskIds);

  const [tasks, kb, notes, issues, events, flags, checklist, picklist, entries, text] = await Promise.all([
    taskIds.length
      ? supabaseAdmin
          .from("tasks")
          .select(taskColumns)
          .eq("org_id", orgId)
          .in("id", taskIds)
      : Promise.resolve({ data: [] }),
    kbIds.length
      ? supabaseAdmin
          .from("kb_documents")
          .select(withStatus ? "id, title, category" : "id, title")
          .eq("org_id", orgId)
          .in("id", kbIds)
      : Promise.resolve({ data: [] }),
    keptIds.length
      ? supabaseAdmin
          .from("staff_notes")
          .select("id, source_note_id")
          .eq("org_id", orgId)
          .eq("staff_id", staffId)
          .in("source_note_id", keptIds)
      : Promise.resolve({ data: [] }),
    /* Resolved or not — the row keeps its words either way, and Home's
       issues list is where the door lands. */
    issueIds.length
      ? supabaseAdmin
          .from("workboard_issues")
          .select(withStatus ? "id, summary, occurrences, resolved" : "id, summary")
          .eq("org_id", orgId)
          .in("id", issueIds)
      : Promise.resolve({ data: [] }),
    /* What an open task's row cannot say: given, moved, ticked and reopened
       (task_events). The diary's only. */
    history.length
      ? supabaseAdmin
          .from("task_events")
          .select("task_id")
          .eq("org_id", orgId)
          .in("task_id", history)
          .in("kind", ACTED_KINDS)
      : Promise.resolve({ data: [] }),
    byStatus("workboard_flags", "id, active", ids((a) => a.flagIds)),
    byStatus("project_checklist_items", "id, done", ids((a) => a.checklistIds)),
    byStatus("job_picklist_items", "id, picked", ids((a) => a.picklistIds)),
    byStatus("project_entries", "id", ids((a) => a.entryIds)),
    /* The rows a note appended to, one read per table, every column a note
       may write there. */
    Promise.all(
      [...written].map(([table, at]) =>
        byStatus(table, ["id", ...TEXT_COLUMNS[table]].join(", "), [...at]).then(({ data }) =>
          ((data ?? []) as unknown as Record<string, unknown>[]).map(
            (r): [string, NowRow] => [textKey(table, String(r.id)), r],
          ),
        ),
      ),
    ),
  ]);

  // the column lists are chosen at run time, so the client cannot type the rows
  const list = (res: { data: unknown }) => (res.data ?? []) as Record<string, unknown>[];
  const byId = (res: { data: unknown }) => new Map(list(res).map((r): [string, NowRow] => [String(r.id), r]));
  const found: Resolved = {
    tasks: new Map(),
    owners: new Map(),
    now: {
      tasks: withStatus ? byId(tasks) : new Map(),
      taskHistory: new Set(list(events).map((r) => String(r.task_id))),
      flags: byId(flags),
      issues: withStatus ? byId(issues) : new Map(),
      checklist: byId(checklist),
      picklist: byId(picklist),
      entries: new Set(list(entries).map((r) => String(r.id))),
      kb: new Set(withStatus ? list(kb).filter((r) => r.category === "field").map((r) => String(r.id)) : []),
      text: new Map(text.flat()),
    },
    kb: new Map(),
    notes: new Map(),
    issues: new Map(),
  };
  for (const r of list(tasks)) {
    found.tasks.set(String(r.id), String(r.title ?? ""));
    found.owners.set(String(r.id), typeof r.assigned_to === "string" && r.assigned_to ? r.assigned_to : null);
  }
  for (const r of list(kb)) found.kb.set(String(r.id), String(r.title ?? ""));
  for (const r of list(notes)) found.notes.set(String(r.source_note_id), String(r.id));
  for (const r of list(issues)) found.issues.set(String(r.id), String(r.summary ?? ""));
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
  /* A NOTE SOMEBODY TOOK BACK (removed_at, the tombstone a take-back
     leaves: two-way phase 2) isn't on anybody's journal. A database
     without the column yet reads as it always has. */
  const read = (tombstones: boolean) => {
    let q = supabaseAdmin
      .from("workboard_notes")
      .select(COLUMNS)
      .eq("org_id", orgId)
      .eq("author_id", staffId)
      .eq("status", "applied");
    if (tombstones) q = q.is("removed_at", null);
    return q.order("created_at", { ascending: false }).limit(limit);
  };
  let { data, error } = await read(true);
  if (error?.code === "42703" || error?.code === "PGRST204") ({ data, error } = await read(false));

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];
  const found = await resolveOutcomes(orgId, staffId, rows);
  return rows.map((r) => toEntry(r, found));
}

/* ── THE NEW HOME'S DIARY ────────────────────────────────────────────────

   The same rows, the same person scope, the same doors, and three things
   the journal never needed because it never stood beside anything else:

     stamp     the moment as a naive stamp in the ServiceM8 account's zone,
               so an entry sorts beside Luke's note from the same afternoon.
               `day` and `at` are said on that same clock here, so an entry
               can't file under one day and sort under another.
     routed    whether Tiff read the words at all. A Save files them as they
               were typed and routes nothing; an entry Tiff read that filed
               nothing can say "Nothing filed." and a Save says nothing.
     taskFor   who each task it made is on, so the diary can say "2 tasks for
               Luke", and "1 task" for your own.

   And what the Tiff modal left on the row (H23):

     turns     the conversation, as the modal said it: Tiff's last turn is
               the line under your words ("Tiff: Done. …"), and the line
               opens the rest in the modal again.
     undo      whether Undo would take back what it filed, by the rule
               `undoNote` refuses on (note-applied's `undoBlocked`), so a
               press on it is never refused for something already known.
               The record must be the one Undo reads (`v: 2`), something it
               made must still be there (a row somebody deleted is not Undo's
               to take), and nobody may have acted on a row it filed: a task
               ticked off, answered "Got it", given on, moved or reopened, a
               flag cleared, an issue counted again or resolved, a line
               bought or ticked, the job's notes edited since. Read in
               `resolveOutcomes`, a batch per kind for the page. Nor may
               it be queued for ServiceM8 (two-way phase 2): such a note
               is taken back from the job's diary (`heldBySm8`, below).
     undone    Undo took it back. The row stays in the diary, your words with
               Tiff's "1 task taken back." under them, and nothing else: what
               they made has gone, so nothing is looked up for it.

   The old Home keeps `listJournal`, unchanged, until the new one replaces
   it: it still reads only what is filed, and never a status or a turn. */

/** Everything this person has told Tiff, newest first, dressed for the
    diary. `tz` is the ServiceM8 account's zone; null is Sydney, the clock
    the diary has always used. */
export async function listDiaryEntries(
  orgId: string,
  staffId: string,
  tz: string | null,
  limit = DIARY_ENTRY_LIMIT,
): Promise<DiaryEntry[]> {
  /* A note somebody took back is on nobody's diary, as on the journal
     (listJournal): the same rows. An entry Undo took back stays — its words
     stay when what they made goes. */
  const read = (tombstones: boolean) => {
    let q = supabaseAdmin
      .from("workboard_notes")
      .select(DIARY_COLUMNS)
      .eq("org_id", orgId)
      .eq("author_id", staffId)
      .in("status", DIARY_STATUSES);
    if (tombstones) q = q.is("removed_at", null);
    return q.order("created_at", { ascending: false }).limit(limit);
  };
  let { data, error } = await read(true);
  if (error?.code === "42703" || error?.code === "PGRST204") ({ data, error } = await read(false));

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];
  const undone = (r: Row) => r.status === "undone";
  const filed = rows.filter((r) => !undone(r));
  const [found, held] = await Promise.all([
    resolveOutcomes(orgId, staffId, filed, true),
    heldBySm8(
      orgId,
      filed.filter((r) => appliedOf(r.applied).v === APPLIED_V).map((r) => r.id),
    ),
  ]);
  return rows.flatMap((r): DiaryEntry[] => {
    const stamp = naiveInZone(r.created_at, tz);
    if (!stamp) return [];
    const when = new Date(r.created_at);
    const turns = conversationOf(turnsOf(r.turns));
    const said = {
      day: todayInZone(tz, when),
      at: clockIn(tz, when),
      stamp,
      /* Every row written before Save existed went through the router and
         carries its proposal; a Save writes none. */
      routed: r.proposal !== null && r.proposal !== undefined,
      /* A note Tiff never answered has no conversation to open. */
      turns: lastTiff(turns) ? turns : [],
    };
    const entry = toEntry(r, found);
    if (undone(r)) return [{ ...entry, ...said, outcomes: [], taskFor: {}, undo: false, undone: true }];

    const taskFor: Record<string, string | null> = {};
    for (const id of appliedIds(r.applied, "taskIds"))
      if (found.owners.has(id)) taskFor[id] = found.owners.get(id) ?? null;
    const record = appliedOf(r.applied);
    const undo =
      record.v === APPLIED_V &&
      !undoBlocked(record, found.now) &&
      takesBack(stillThere(record, found.now)) &&
      held !== "all" &&
      !held.has(r.id);
    return [{ ...entry, ...said, taskFor, undo, undone: false }];
  });
}

/* A NOTE QUEUED FOR SERVICEM8 is taken back from the job's diary, not by
   Undo (two-way phase 2): undoNote refuses one while something of it can
   still go or may be in ServiceM8, so the diary doesn't offer it, by the
   same rule (sm8-note-plan's `undoHeldBySm8`). One read for the page, of
   the records Undo reads; only where this deployment sends notes, so
   production gains no read; and a read that fails holds every Undo, as it
   holds the press. */
async function heldBySm8(orgId: string, noteIds: readonly string[]): Promise<ReadonlySet<string> | "all"> {
  if (noteIds.length === 0 || !sm8NotesAllowed()) return new Set();
  const { data, error } = await supabaseAdmin
    .from("sm8_writes")
    .select(`note_id, ${UNDO_HOLD_COLUMNS}`)
    .eq("org_id", orgId)
    .eq("kind", "note")
    .eq("op", "create")
    .in("note_id", [...noteIds]);
  if (error) return "all";
  const now = Date.now();
  const held = new Set<string>();
  for (const c of (data ?? []) as unknown as (CreateRow & { note_id: string })[])
    if (undoHeldBySm8(c, now)) held.add(String(c.note_id));
  return held;
}

/* fmtAuTime's words, on the account's clock. */
function clockIn(tz: string | null, when: Date): string {
  if (!tz) return fmtAuTime(when);
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(when);
  } catch {
    return fmtAuTime(when);
  }
}
