import { supabaseAdmin } from "@/lib/supabase-server";
import { listJobDiaryEntries } from "@/lib/dashboard/journal-query";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import { todayInZone } from "@/lib/workboard/dates";
import {
  madeCards,
  railTasksOf,
  repliesOf,
  taskLine,
  type JobConversationRead,
  type JobNoteTalk,
} from "./job-conversation";

/* WHAT A JOB'S OVERVIEW READS BEYOND THE CARD'S RECORD (v2, step 6).

   NO SESSION HERE: the action (app/actions/job-conversation) establishes
   the right to ask and hands in the org, the viewer and the clock, the
   posture of every read module in the feature.

   Two things, three reads and a name lookup:

     the notes   every note filed on this job, and what each made, with
                 Undo where it would still take it back (journal-query's
                 `listJobDiaryEntries`, the diary's own rule) and where the
                 viewer may press it: their own note, or anyone's with
                 `team`, as `undoNote` decides.
     the tasks   what Tiff made from the job's notes, named for the cards
                 and the rail, and what New › Task put on the job by its
                 column, `tasks.sm8_job_uuid` (docs/migrations/tasks_job.sql,
                 NOT YET APPLIED). Until the column is there its read fails
                 with a missing column and the job's tasks are the ones its
                 notes link; nothing else changes. */

type TaskRow = {
  id: string;
  title: string | null;
  assigned_to: string | null;
  status: string | null;
  due_date: string | null;
  remind_at: string | null;
  remind_kind: string | null;
};

const TASK_COLUMNS = "id, title, assigned_to, status, due_date, remind_at, remind_kind";

type DbError = { code?: string } | null;
const missingColumn = (e: DbError) => e?.code === "42703" || e?.code === "PGRST204";

/** The clock time of an instant on the account's clock: "12:30 pm". */
function clockIn(tz: string | null, iso: string): string | null {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone: tz ?? "Australia/Sydney", hour: "numeric", minute: "2-digit", hour12: true })
      .format(when)
      .replace(/ /g, " ")
      .toLowerCase();
  } catch {
    return null;
  }
}

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || null;

export async function readJobConversationFor(input: {
  orgId: string;
  staffId: string | null;
  jobUuid: string;
  tz: string | null;
  /** `team`: Undo on anyone's note, as `undoNote` allows. */
  undoAny: boolean;
}): Promise<JobConversationRead> {
  const { orgId, staffId, jobUuid, tz, undoAny } = input;
  const today = todayInZone(tz);
  const entries = await listJobDiaryEntries(orgId, staffId, jobUuid, tz);

  const noteTaskIds = [...new Set(entries.flatMap((e) => e.record.taskIds))];
  const flagIds = [...new Set(entries.flatMap((e) => e.record.flagIds))];
  const issueIds = [...new Set(entries.flatMap((e) => e.record.issueIds))];

  const [linked, onJob, flags, issues] = await Promise.all([
    noteTaskIds.length
      ? supabaseAdmin.from("tasks").select(TASK_COLUMNS).eq("org_id", orgId).in("id", noteTaskIds)
      : Promise.resolve({ data: [], error: null }),
    /* the column may not be there yet: then this is nothing, not a failure */
    supabaseAdmin
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("org_id", orgId)
      .eq("sm8_job_uuid", jobUuid)
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(50)
      .then((r) => (missingColumn(r.error as DbError) ? { data: [], error: null } : r)),
    flagIds.length
      ? supabaseAdmin.from("workboard_flags").select("id, message, active").eq("org_id", orgId).in("id", flagIds)
      : Promise.resolve({ data: [] }),
    issueIds.length
      ? supabaseAdmin.from("workboard_issues").select("id, summary").eq("org_id", orgId).in("id", issueIds)
      : Promise.resolve({ data: [] }),
  ]);

  const taskRows = [...((linked.data ?? []) as TaskRow[]), ...((onJob.data ?? []) as TaskRow[])];
  const names = await staffDisplayNames(orgId, [
    ...taskRows.map((t) => t.assigned_to),
    ...entries.map((e) => e.authorId),
    staffId,
  ]);

  const lineOf = (t: TaskRow) =>
    taskLine(
      {
        who: t.assigned_to && t.assigned_to === staffId ? "you" : firstName(t.assigned_to ? names.get(t.assigned_to) : null),
        dueDate: t.due_date,
        time: t.remind_at ? clockIn(tz, t.remind_at) : null,
        by: t.remind_kind === "by",
        done: t.status === "done",
      },
      today,
    );
  const tasks = new Map(taskRows.map((t) => [t.id, { title: (t.title ?? "").trim() || "A task", line: lineOf(t) }]));
  const flagMap = new Map(
    ((flags.data ?? []) as { id: string; message: string | null; active: boolean | null }[]).map((f) => [
      f.id,
      { message: (f.message ?? "").trim() || "A flag", active: f.active === true },
    ]),
  );
  const issueMap = new Map(
    ((issues.data ?? []) as { id: string; summary: string | null }[]).map((i) => [i.id, (i.summary ?? "").trim() || "An issue"]),
  );

  const notes: JobNoteTalk[] = entries.map((e) => {
    const made = e.undone ? [] : madeCards(e.record, { tasks, flags: flagMap, issues: issueMap });
    return {
      id: e.id,
      authorId: e.authorId,
      authorName: e.authorId ? (names.get(e.authorId) ?? null) : null,
      said: e.said,
      stamp: e.stamp,
      day: e.day,
      spoken: e.spoken,
      replies: repliesOf(e.turns, made.length),
      made,
      undo: e.undo && (undoAny || (!!staffId && e.authorId === staffId)),
      undone: e.undone,
    };
  });

  return {
    today,
    notes,
    tasks: railTasksOf(
      taskRows.map((t) => ({
        id: t.id,
        title: (t.title ?? "").trim() || "A task",
        status: t.status ?? "open",
        dueDate: t.due_date,
        line: lineOf(t),
        assigneeId: t.assigned_to,
      })),
    ),
    viewer: { id: staffId, name: staffId ? (names.get(staffId) ?? null) : null },
  };
}
