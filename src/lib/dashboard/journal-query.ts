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
import { todayInZone } from "@/lib/workboard/dates";
import { naiveInZone } from "@/lib/workboard/job-story";
import { describeAppliedResolved, type DiaryEntry, type JournalEntry } from "./journal";
import { DIARY_ENTRY_LIMIT } from "./diary-feed";

/* NO DEBRIEF COLUMN, WRITTEN OR READ. The Debrief left the router and this
   read in the same change (#818), and note_is_debrief_drop.sql drops the
   column. Naming it here again would empty every diary once that has run:
   PostgREST fails the whole select on a column that isn't there. An old
   Debrief row needs nothing from the column to keep its place: it is an
   applied note like any other, and its grouped note's door is resolved from
   `applied.noteLines` below. A test in journal-query.test.ts refuses a
   migration that drops a column this list still names. */
const COLUMNS = "id, transcript, source, applied, created_at";
/* The diary's read is the journal's plus whether Tiff routed the words at
   all. Built ON the journal's list rather than beside it, so whatever the
   journal stops reading (as it did the Debrief's column) the diary stops
   reading in the same edit. */
const DIARY_COLUMNS = `${COLUMNS}, proposal`;

type Row = {
  id: string;
  transcript: string;
  source: string;
  applied: unknown;
  created_at: string;
  /** Only in the diary's read. */
  proposal?: unknown;
};

/** What the chips on this page can be doors to. Everything here was read
    org-scoped in one batch per kind — see `resolveOutcomes`. */
type Resolved = {
  /** taskId → title, for the tasks that still exist. */
  tasks: Map<string, string>;
  /** taskId → the staff card it is on (null: nobody), for the same tasks. */
  owners: Map<string, string | null>;
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
   — that is the whole point of resolving rather than trusting the stored id. */
async function resolveOutcomes(orgId: string, staffId: string, rows: readonly Row[]): Promise<Resolved> {
  const taskIds = [...new Set(rows.flatMap((r) => appliedIds(r.applied, "taskIds")))];
  const kbIds = [...new Set(rows.flatMap((r) => appliedIds(r.applied, "kbIds")))];
  const issueIds = [...new Set(rows.flatMap((r) => appliedIds(r.applied, "issueIds")))];
  // only the entries that actually kept lines have a note to find
  const keptIds = rows.filter((r) => appliedIds(r.applied, "noteLines").length > 0).map((r) => r.id);

  const [tasks, kb, notes, issues] = await Promise.all([
    taskIds.length
      ? supabaseAdmin.from("tasks").select("id, title, assigned_to").eq("org_id", orgId).in("id", taskIds)
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
    /* Resolved or not — the row keeps its words either way, and Home's
       issues list is where the door lands. */
    issueIds.length
      ? supabaseAdmin.from("workboard_issues").select("id, summary").eq("org_id", orgId).in("id", issueIds)
      : Promise.resolve({ data: [] }),
  ]);

  const found: Resolved = { tasks: new Map(), owners: new Map(), kb: new Map(), notes: new Map(), issues: new Map() };
  for (const r of (tasks.data ?? []) as Record<string, unknown>[]) {
    found.tasks.set(String(r.id), String(r.title ?? ""));
    found.owners.set(String(r.id), typeof r.assigned_to === "string" && r.assigned_to ? r.assigned_to : null);
  }
  for (const r of (kb.data ?? []) as Record<string, unknown>[])
    found.kb.set(String(r.id), String(r.title ?? ""));
  for (const r of (notes.data ?? []) as Record<string, unknown>[])
    found.notes.set(String(r.source_note_id), String(r.id));
  for (const r of (issues.data ?? []) as Record<string, unknown>[])
    found.issues.set(String(r.id), String(r.summary ?? ""));
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

   The old Home keeps `listJournal`, unchanged, until the new one replaces
   it. */

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
     (listJournal): the same rows. */
  const read = (tombstones: boolean) => {
    let q = supabaseAdmin
      .from("workboard_notes")
      .select(DIARY_COLUMNS)
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
  return rows.flatMap((r): DiaryEntry[] => {
    const stamp = naiveInZone(r.created_at, tz);
    if (!stamp) return [];
    const when = new Date(r.created_at);
    const taskFor: Record<string, string | null> = {};
    for (const id of appliedIds(r.applied, "taskIds"))
      if (found.owners.has(id)) taskFor[id] = found.owners.get(id) ?? null;
    return [
      {
        ...toEntry(r, found),
        day: todayInZone(tz, when),
        at: clockIn(tz, when),
        stamp,
        /* Every row written before Save existed went through the router and
           carries its proposal; a Save writes none. */
        routed: r.proposal !== null && r.proposal !== undefined,
        taskFor,
      },
    ];
  });
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
