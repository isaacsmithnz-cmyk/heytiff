import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { supabaseAdmin } from "@/lib/supabase-server";
import { listJobDiaryEntries } from "@/lib/dashboard/journal-query";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import { todayInZone } from "@/lib/workboard/dates";
import {
  madeCards,
  railTasksOf,
  repliesOf,
  taskLine,
  talkWithoutMoney,
  withoutMoney,
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
                 notes link; nothing else changes.

   MONEY IS HELD BACK HERE (decision 15, 6-revisions.md), for a viewer
   without `workboard_money`, so the figures never reach their browser:
   Tiff's lines and the cards she made say each figure in words
   (`talkWithoutMoney`), and so do the rail's tasks a note made ("Claim a
   cost at Reece"). The words a person typed stay as typed: a note's own
   words, their answers to her, and a task New › Task put on the job. The
   diary's money entries (claims, payments, the invoice) never come this
   way: the card's own reads leave them out without the same right. */

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
  /** `workboard_money`: the figures in Tiff's lines and cards. Without it
      each is said in words (decision 15). */
  money: boolean;
}): Promise<JobConversationRead> {
  const { orgId, staffId, jobUuid, tz, undoAny, money } = input;
  const today = todayInZone(tz);
  const entries = await listJobDiaryEntries(orgId, staffId, jobUuid, tz);

  const noteTaskIds = [...new Set(entries.flatMap((e) => e.record.taskIds))];
  const flagIds = [...new Set(entries.flatMap((e) => e.record.flagIds))];
  const issueIds = [...new Set(entries.flatMap((e) => e.record.issueIds))];

  const fortnight = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [linked, onJob, flags, issues, doneOnJob] = await Promise.all([
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
    /* the done ones are a nicety: a read that fails is none, never the card's failure */
    (async () => {
      try {
        const r = await supabaseAdmin
          .from("tasks")
          .select("id, title, done_at, done_by")
          .eq("org_id", orgId)
          .eq("sm8_job_uuid", jobUuid)
          .eq("status", "done")
          .gte("done_at", fortnight)
          .order("done_at", { ascending: false })
          .limit(5);
        return r.error ? { data: [] } : r;
      } catch {
        return { data: [] };
      }
    })(),
  ]);
  const doneRows = (doneOnJob.data ?? []) as { id: string; title: string | null; done_at: string | null; done_by: string | null }[];

  const taskRows = [...((linked.data ?? []) as TaskRow[]), ...((onJob.data ?? []) as TaskRow[])];
  const names = await staffDisplayNames(orgId, [
    ...taskRows.map((t) => t.assigned_to),
    ...doneRows.map((t) => t.done_by),
    ...entries.map((e) => e.authorId),
    staffId,
  ]);

  const lineOf = (t: TaskRow) =>
    taskLine(
      {
        /* a job's task for nobody in particular is anyone's (Isaac, 24 October 2026) */
        who: t.assigned_to === null ? "Anyone" : t.assigned_to === staffId ? "you" : firstName(names.get(t.assigned_to)),
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
    const talk: JobNoteTalk = {
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
    return money ? talk : talkWithoutMoney(talk);
  });

  /* a task a note made is Tiff's words; one New › Task put on the job is a
     person's, and stays as they typed it */
  const tiffMade = new Set(noteTaskIds);
  const titleOf = (t: TaskRow) => {
    const title = (t.title ?? "").trim() || "A task";
    return money || !tiffMade.has(t.id) ? title : withoutMoney(title);
  };

  return {
    today,
    notes,
    tasks: railTasksOf(
      taskRows.map((t) => ({
        id: t.id,
        title: titleOf(t),
        status: t.status ?? "open",
        dueDate: t.due_date,
        line: lineOf(t),
        assigneeId: t.assigned_to,
      })),
    ),
    done: doneRows.map((t) => {
      const day = t.done_at ? todayInZone(tz, new Date(t.done_at)) : null;
      const at = t.done_at ? clockIn(tz, t.done_at) : null;
      const who = t.done_by === staffId ? "you" : (names.get(t.done_by ?? "") ?? "someone");
      const when = day ? (day === today ? `today${at ? `, ${at}` : ""}` : `${fmtAuWeekdayDayMonth(day)}${at ? `, ${at}` : ""}`) : "";
      return { id: t.id, title: (t.title ?? "").trim() || "A task", line: `Done by ${who}${when ? `, ${when}` : ""}` };
    }),
    viewer: { id: staffId, name: staffId ? (names.get(staffId) ?? null) : null },
  };
}
