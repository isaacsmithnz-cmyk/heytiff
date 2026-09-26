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
import { sm8NoteSender } from "@/lib/integrations/links";
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { UNDO_HOLD_COLUMNS, undoHeldBySm8, type CreateRow } from "@/lib/integrations/sm8-note-plan";
import { offersSend } from "@/lib/integrations/sm8-write-plan";
import { plusDays, todayInZone } from "@/lib/workboard/dates";
import { keptWords, readNoteLines, type NotesViewer } from "@/lib/workboard/job-notes-query";
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
import { replyLine, type DiaryReply, type ReplyLine } from "./diary-reply";
import { ACTED_KINDS } from "./task-events";
import { DIARY_ENTRY_LIMIT, DIARY_REPLY_LIMIT } from "./diary-feed";

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
/** Whether ServiceM8 holds a note too — the diary's Edit is not offered
    for one that does (`inSm8`). */
const SM8_COLUMNS = "target_kind, reply_to_sm8_note_uuid, is_task_done";
/* A reply of yours to a ServiceM8 note, or a task's Done (two-way phase
   2): the note it answers, the job it is on, and why a press didn't queue
   it. Read only where the deployment sends notes (./diary-reply). */
const REPLY_COLUMNS = "target_id, reply_to_sm8_note_uuid, sm8_refusal";
/* Your replies on their own, for the conversations (listDiaryReplies):
   what an entry of them says, what they answer, and whether one was taken
   back. */
const REPLY_READ_COLUMNS = `${COLUMNS}, ${REPLY_COLUMNS}, removed_at`;
/** Column lists as one select, each column once: the diary's read asks
    SM8_COLUMNS and, where the deployment sends notes, REPLY_COLUMNS, and
    the two share the note a reply answers. */
function columnsOf(...lists: readonly string[]): string {
  return [...new Set(lists.flatMap((l) => l.split(",").map((c) => c.trim())))].join(", ");
}
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
  /** Only in the diary's read, where the database has them (two-way
      phase 2): where the note went, and whether ServiceM8 holds it. */
  target_kind?: string | null;
  reply_to_sm8_note_uuid?: string | null;
  is_task_done?: boolean | null;
  /** Only in the diary's read, where the deployment sends notes: the job
      a reply is on, and why a press didn't queue it. */
  target_id?: string | null;
  sm8_refusal?: string | null;
  /** Only in the read of your replies: taken back (a tombstone). */
  removed_at?: string | null;
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

   And, where the deployment sends notes (two-way phase 2):

     reply     your reply to a ServiceM8 note from a job card, or a task's
               Done: the note it answers, the job, its words in English,
               when it was saved to the second, and where it stands with
               ServiceM8 (./diary-reply). The diary draws it in the
               conversation holding that note, once.

   The conversations read your replies on their own as well
   (`listDiaryReplies`, below), over the mentions' reach rather than your
   newest DIARY_ENTRY_LIMIT entries, so an older one is still in its thread.

   The old Home keeps `listJournal`, unchanged, until the new one replaces
   it: it still reads only what is filed, and never a status or a turn. */

/** Everything this person has told Tiff, newest first, dressed for the
    diary. `tz` is the ServiceM8 account's zone; null is Sydney, the clock
    the diary has always used. `viewer`, where the diary also reads your
    replies on their own, is the one read of who you are to ServiceM8 that
    both reads share (`replyViewerOf`). */
export async function listDiaryEntries(
  orgId: string,
  staffId: string,
  tz: string | null,
  limit = DIARY_ENTRY_LIMIT,
  viewer?: ReplyViewer,
): Promise<DiaryEntry[]> {
  /* A note somebody took back is on nobody's diary, as on the journal
     (listJournal): the same rows. An entry Undo took back stays — its words
     stay when what they made goes. Where the deployment sends notes, each
     row also says whether it is a reply of yours (REPLY_COLUMNS); with
     files only (production today) the read is the one it always was. */
  const replies = sm8NotesAllowed();
  const read = (phase2: boolean) => {
    /* chosen at run time, so the client cannot type the rows; the
       tombstone came with the columns that say ServiceM8 holds a note, so
       a database without one has neither */
    const columns: string = phase2
      ? columnsOf(DIARY_COLUMNS, SM8_COLUMNS, ...(replies ? [REPLY_COLUMNS] : []))
      : DIARY_COLUMNS;
    let q = supabaseAdmin
      .from("workboard_notes")
      .select(columns)
      .eq("org_id", orgId)
      .eq("author_id", staffId)
      .in("status", DIARY_STATUSES);
    if (phase2) q = q.is("removed_at", null);
    return q.order("created_at", { ascending: false }).limit(limit);
  };
  let { data, error } = await read(true);
  if (error?.code === "42703" || error?.code === "PGRST204") ({ data, error } = await read(false));

  /* either select, so the typed parser can't read it: the row is ours */
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return [];
  const undone = (r: Row) => r.status === "undone";
  const filed = rows.filter((r) => !undone(r));
  const isReply = (r: Row) => replies && !!r.reply_to_sm8_note_uuid && !!r.target_id;
  const answers = filed.filter(isReply);
  const [found, held, sent, lines] = await Promise.all([
    resolveOutcomes(orgId, staffId, filed, true),
    heldBySm8(
      orgId,
      filed.filter((r) => appliedOf(r.applied).v === APPLIED_V).map((r) => r.id),
    ),
    sentToSm8(orgId, rows.filter((r) => r.target_kind === "job").map((r) => r.id)),
    replyLinesOf(orgId, staffId, answers, viewer),
  ]);
  const inSm8 = (r: Row) =>
    !!r.reply_to_sm8_note_uuid || !!r.is_task_done || (r.target_kind === "job" && (sent === "all" || sent.has(r.id)));
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
    if (undone(r)) return [{ ...entry, ...said, outcomes: [], taskFor: {}, undo: false, undone: true, inSm8: inSm8(r) }];

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
    const reply = isReply(r) ? replyOf(r, tz, lines) : null;
    return [{ ...entry, ...said, taskFor, undo, undone: false, inSm8: inSm8(r), ...(reply ? { reply } : {}) }];
  });
}

/* A NOTE SERVICEM8 HOLDS TOO: a create was ever queued for it, whatever
   became of it — the rule actions/diary's `editDiaryEntry` refuses by, so
   Edit is drawn only where a press would not be refused. Job notes only,
   the one kind that goes; a read that fails holds every one of them. */
async function sentToSm8(orgId: string, noteIds: readonly string[]): Promise<ReadonlySet<string> | "all"> {
  if (noteIds.length === 0) return new Set();
  const { data, error } = await supabaseAdmin
    .from("sm8_writes")
    .select("note_id")
    .eq("org_id", orgId)
    .eq("kind", "note")
    .in("note_id", [...noteIds]);
  if (error) return "all";
  return new Set(((data ?? []) as { note_id: string }[]).map((r) => String(r.note_id)));
}

/** A reply row as the diary threads it (./diary-reply): what it answers,
    the job, its words in English, when it was saved to the second, and its
    line. Null for a row that isn't one. */
function replyOf(r: Row, tz: string | null, lines: ReadonlyMap<string, ReplyLine | null>): DiaryReply | null {
  const at = secondsInZone(r.created_at, tz);
  if (!r.reply_to_sm8_note_uuid || !r.target_id || !at) return null;
  return {
    to: r.reply_to_sm8_note_uuid,
    jobUuid: r.target_id,
    words: keptWords(r.applied as Record<string, unknown> | null) ?? r.transcript.trim(),
    at,
    savedAt: r.created_at,
    line: lines.get(r.id) ?? null,
    ...(r.removed_at ? { takenBack: true as const } : {}),
  };
}

/** YOUR REPLIES ON THEIR OWN, for the conversations (./diary-reply): every
    reply of yours to a ServiceM8 note, and every task's Done, saved since
    `since` — the first day the mentions read reaches, on the account's
    clock — newest first, DIARY_REPLY_LIMIT of them. Read apart from your
    entries so a reply older than your newest DIARY_ENTRY_LIMIT entries is
    still threaded in a conversation that is on the page; the entry read
    and the column's reach are as they were.

    ONE YOU TOOK BACK is read too, and kept only while something of it may
    still be in ServiceM8 (decision 8, as the job card's readOurRows and
    shapeOurNotes keep it): it is drawn in its thread with "Still in
    ServiceM8 …" and Try again, and nothing else. One whose take-back
    settled, or whose queue can't be read, is left out.

    Each comes as an entry of yours carrying its `reply`: what threads it,
    and, for one taken back that no conversation holds, all its entry
    draws — ServiceM8's too (`inSm8`), as every reply is, so the diary
    offers no Edit on it. Nothing is read where the deployment sends files
    only. */
export async function listDiaryReplies(
  orgId: string,
  staffId: string,
  tz: string | null,
  since: string,
  viewer?: ReplyViewer,
): Promise<DiaryEntry[]> {
  if (!sm8NotesAllowed()) return [];
  const { data, error } = await supabaseAdmin
    .from("workboard_notes")
    .select(REPLY_READ_COLUMNS)
    .eq("org_id", orgId)
    .eq("author_id", staffId)
    .eq("target_kind", "job")
    .not("reply_to_sm8_note_uuid", "is", null)
    /* filed, or taken back: the rollback may have set a removed row
       dismissed, so a removed row is read whatever its status */
    .or("status.eq.applied,removed_at.not.is.null")
    /* the day before, at midnight UTC: at or before that day's first
       moment on any account's clock */
    .gte("created_at", `${plusDays(since, -1)}T00:00:00Z`)
    .order("created_at", { ascending: false })
    .limit(DIARY_REPLY_LIMIT);
  if (error) {
    /* a database without two-way phase 2's columns has no replies to read */
    if (error.code !== "42703" && error.code !== "PGRST204") {
      console.error(`[diary] couldn't read org ${orgId}'s replies for the conversations:`, error);
    }
    return [];
  }
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => !!r.reply_to_sm8_note_uuid && !!r.target_id);
  if (rows.length === 0) return [];
  const lines = await replyLinesOf(orgId, staffId, rows, viewer);
  return rows.flatMap((r): DiaryEntry[] => {
    const reply = replyOf(r, tz, lines);
    const stamp = naiveInZone(r.created_at, tz);
    /* taken back: only while its line says something of it may be there */
    if (!reply || !stamp || (reply.takenBack && !reply.line)) return [];
    const when = new Date(r.created_at);
    return [
      {
        id: r.id,
        said: r.transcript,
        day: todayInZone(tz, when),
        at: clockIn(tz, when),
        outcomes: [],
        spoken: r.source === "voice",
        stamp,
        routed: false,
        taskFor: {},
        turns: [],
        undo: false,
        undone: false,
        /* it answers a ServiceM8 note: changed there, never here */
        inSm8: true,
        reply,
      },
    ];
  });
}

/** Who you are to ServiceM8, read once for a page however many readers ask
    (`replyLinesOf`): the workspace's sending state, and who you are there
    on the account connected now. A sender that can't be read is nobody,
    so no door that needs the link is offered. The sending state's module
    is reached lazily, as job-notes-query reaches it: it brings the whole
    sender (and the session) with it, which the journal's other readers
    never need. Nothing is read until a reader asks. */
export type ReplyViewer = () => Promise<NotesViewer>;

export function replyViewerOf(orgId: string, staffId: string): ReplyViewer {
  let read: Promise<NotesViewer> | null = null;
  return () =>
    (read ??= (async () => {
      const { readSm8WriteState } = await import("@/lib/integrations/sm8-writes");
      const state = await readSm8WriteState(orgId);
      const sender = await sm8NoteSender(orgId, staffId, state.tenantId ?? undefined).catch(() => null);
      return { staffId, state, sender };
    })());
}

/* YOUR REPLIES, AND WHERE THEY STAND WITH SERVICEM8 (./diary-reply): the
   job card's line for each (job-notes-query's noteLinesOf, so the two never
   disagree), read as the person who sent them — the workspace's sending
   state, who they are in ServiceM8, then their queue rows and names. A row
   taken back is read as one (its `removed_at`), so its line says whether
   anything of it may still be there. One saved but never queued, with no
   refusal kept, is "In HeyTiff" with the job card's Send to ServiceM8. Only
   for rows that are replies, so a diary without one reads nothing more. A
   read that fails says nothing about ServiceM8, rather than something
   wrong. */
async function replyLinesOf(
  orgId: string,
  staffId: string,
  rows: readonly Row[],
  viewer: ReplyViewer = replyViewerOf(orgId, staffId),
): Promise<ReadonlyMap<string, ReplyLine | null>> {
  const out = new Map<string, ReplyLine | null>();
  if (rows.length === 0) return out;
  try {
    const { state, sender } = await viewer();
    const read = await readNoteLines(
      orgId,
      rows.map((r) => ({ id: r.id, author_id: staffId, removed_at: r.removed_at ?? null, sm8_refusal: r.sm8_refusal ?? null })),
      { staffId, state, sender },
    );
    const offered = offersSend(state, "note");
    for (const r of rows) {
      /* saved and never queued: when nothing was kept to say why, its line
         says nothing (a refusal kept says it — replyLine's own rule) */
      const unsent = !!read && !r.removed_at && !read.created.has(r.id);
      out.set(r.id, replyLine(read?.lines.get(r.id), sender, { unsent, offered }));
    }
  } catch (err) {
    console.error(
      `[diary] couldn't read where org ${orgId}'s replies stand with ServiceM8: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return out;
}

/* The moment a reply was saved, to the second, on the account's clock:
   "2026-09-25 13:42:50". The entry's stamp keeps the minute (naiveInZone,
   which the job's story shares); a reply threads among ServiceM8's notes,
   which carry seconds, so two sent in one minute, or one sent seconds after
   his, keep their order. */
function secondsInZone(iso: string, tz: string | null): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz ?? "Australia/Sydney",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    // some ICU builds say "24" for midnight; keep it sortable
    const hour = get("hour") === "24" ? "00" : get("hour");
    return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}:${get("second")}`;
  } catch {
    return iso.slice(0, 19).replace("T", " ");
  }
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
