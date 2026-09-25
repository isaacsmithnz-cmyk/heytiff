/* A TASK'S DONE, AS THE TASK SHOWS IT — server only (two-way phase 2, PR C).

   Ticking a task made from a ServiceM8 mention files a Done in the job's
   diary ("@lukeingold Done.", threaded under Luke's note) and sends it to
   ServiceM8 as whoever ticked (actions/task-sm8). The diary draws that row
   like any reply of ours. This module is the other two places it shows:

   - THE TASK'S PAGE on Home: the Done's words and where it stands, in the
     very line the diary draws (job-notes-query's noteLinesOf, so the two
     never disagree), with Send again, Try again or the link question where
     the line offers them. A reply that closed its task stands in for the
     Done while the task is done.
   - THE BELL, for the one person whose Done didn't go (or didn't come
     out): one item per task, opening that task.

   NOTHING HERE READS ANYTHING until the deployment sends notes (SM8_WRITES
   names `note`). Production sends files only, and Home loads there exactly
   as it did: both readers return empty before their first read. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { sm8NoteSender, type NoteSender } from "@/lib/integrations/links";
import type { NoteState } from "@/lib/integrations/sm8-note-plan";
import { keptWords, noteLinesOf } from "@/lib/workboard/job-notes-query";

/** One line on a task's page: a Done (or the reply that closed the task),
    its words, and where it stands with ServiceM8. Its doors act on THIS
    row, `noteId`, never on "the task's Done" in general. */
export type TaskDoneLine = { noteId: string; words: string; state: NoteState };

/** Every task's lines, and who the viewer is in ServiceM8 — the link
    question's door answers for that link (`sender.remoteId`). */
export type TaskDoneLines = { lines: Record<string, TaskDoneLine[]>; sender: NoteSender | null };

export const NO_TASK_DONE_LINES: TaskDoneLines = { lines: {}, sender: null };

/** A Done of mine that didn't go, didn't come out, or may not have reached
    ServiceM8 — the bell's item, for the task it stands for. */
export type UnsentDone = { taskId: string; title: string; noteId: string; op: "post" | "take_back" | "check" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DbError = { code?: string; message?: string } | null;
const missingColumn = (e: DbError) => e?.code === "42703" || e?.code === "PGRST204";

type DoneRow = {
  id: string;
  task_id: string | null;
  is_task_done: boolean | null;
  author_id: string | null;
  transcript: string | null;
  applied: Record<string, unknown> | null;
  removed_at: string | null;
  sm8_refusal: string | null;
  created_at: string;
  /** the task, through workboard_notes_task_fkey (PR A's key) */
  task?: { status: string | null } | null;
};

const LINE_COLUMNS =
  "id, task_id, is_task_done, author_id, transcript, applied, removed_at, sm8_refusal, created_at, task:tasks!workboard_notes_task_fkey(status)";

const newestFirst = (a: DoneRow, b: DoneRow) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0);

/** A line's words: what the diary shows. */
const wordsOf = (r: DoneRow) => keptWords(r.applied) ?? r.transcript?.trim() ?? "";

/** The lines of these tasks, as `viewerStaffId` reads them — at most five
    reads (the rows with their task's status, their queue rows, the sending
    state, who the viewer is in ServiceM8, and the names), and none at all
    where the deployment doesn't send notes.

    A TASK'S LINES, IN ORDER:
    1. its live Done; or, while the task is done and has no live Done, the
       latest reply that closed it and hasn't been taken back. A closing
       reply shows nothing once its task is open again;
    2. then each Done of the task that was taken back and is still on its
       way out, or still in ServiceM8 — newest first. So a Done whose
       take-back failed stays on its task's page even after the task was
       ticked again and a new Done went, and the bell's link lands on a line
       that shows it.
    A row whose line says nothing (nothing of it can be in ServiceM8, or it
    never left HeyTiff) isn't drawn. A read error, or a database without the
    columns, draws no line. */
export async function readTaskDoneLines(
  orgId: string,
  viewerStaffId: string | null,
  taskIds: readonly string[]
): Promise<TaskDoneLines> {
  if (!sm8NotesAllowed()) return NO_TASK_DONE_LINES;
  const ids = [...new Set(taskIds.filter((id) => typeof id === "string" && UUID.test(id)))].slice(0, 200);
  if (ids.length === 0) return NO_TASK_DONE_LINES;

  const { data, error } = await supabaseAdmin
    .from("workboard_notes")
    .select(LINE_COLUMNS)
    .eq("org_id", orgId)
    .in("task_id", ids)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    if (!missingColumn(error)) console.error(`[sm8] couldn't read the Dones of org ${orgId}'s tasks:`, error);
    return NO_TASK_DONE_LINES;
  }
  const rows = ((data ?? []) as unknown as DoneRow[]).filter((r) => r.task_id && wordsOf(r));
  if (rows.length === 0) return NO_TASK_DONE_LINES;

  const state = await readSm8WriteState(orgId);
  const sender = await sm8NoteSender(orgId, viewerStaffId, state.tenantId ?? undefined).catch(() => null);
  const states = await noteLinesOf(orgId, rows, { staffId: viewerStaffId, state, sender });
  if (!states) return { lines: {}, sender };

  const byTask = new Map<string, DoneRow[]>();
  for (const r of rows) {
    const list = byTask.get(r.task_id!) ?? [];
    list.push(r);
    byTask.set(r.task_id!, list);
  }

  const lines: Record<string, TaskDoneLine[]> = {};
  for (const [taskId, list] of byTask) {
    const sorted = [...list].sort(newestFirst);
    const taskDone = sorted[0]?.task?.status === "done";
    const live = sorted.find((r) => r.is_task_done && !r.removed_at);
    const closing = !live && taskDone ? sorted.find((r) => !r.is_task_done && !r.removed_at) : undefined;
    const lead = live ?? closing;
    const out: TaskDoneLine[] = [];
    const draw = (r: DoneRow) => {
      const s = states.get(r.id);
      if (s && s.key) out.push({ noteId: r.id, words: wordsOf(r), state: s });
    };
    if (lead) draw(lead);
    for (const r of sorted) if (r.is_task_done && r.removed_at) draw(r);
    if (out.length > 0) lines[taskId] = out;
  }
  return { lines, sender };
}

/** MY DONES THAT DIDN'T GO, for the bell: a tick of mine whose Done was
    refused, failed, may not have reached ServiceM8, or was taken back and is
    still there (its delete failed, or couldn't queue). One item per task
    still present, newest first, at most five — and only mine: the bell
    reaches only the person whose press it was.

    `op` says which: "take_back" when its line offers Try again on a take-
    back, "check" when HeyTiff can't tell whether it reached ServiceM8,
    otherwise "post". Empty, with no read, where the deployment doesn't send
    notes. */
export async function myUnsentDones(orgId: string, staffId: string | null, sinceIso: string): Promise<UnsentDone[]> {
  if (!sm8NotesAllowed() || !staffId) return [];

  const { data, error } = await supabaseAdmin
    .from("workboard_notes")
    .select("id, task_id, is_task_done, author_id, removed_at, sm8_refusal, created_at")
    .eq("org_id", orgId)
    .eq("author_id", staffId)
    .eq("is_task_done", true)
    .not("task_id", "is", null)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    if (!missingColumn(error)) console.error(`[sm8] couldn't read org ${orgId}'s Dones for the bell:`, error);
    return [];
  }
  const rows = (data ?? []) as unknown as DoneRow[];
  if (rows.length === 0) return [];

  const state = await readSm8WriteState(orgId);
  /* the tone is all the bell reads, and it doesn't depend on names */
  const states = await noteLinesOf(orgId, rows, { staffId, state, sender: null });
  if (!states) return [];

  const failed: { row: DoneRow; op: UnsentDone["op"] }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const s = states.get(r.id);
    if (!s || s.tone !== "bad" || seen.has(r.task_id!)) continue;
    seen.add(r.task_id!);
    failed.push({
      row: r,
      op: s.acts.includes("take_out_again") ? "take_back" : s.key === "line.unsure" ? "check" : "post",
    });
    if (failed.length >= 5) break;
  }
  if (failed.length === 0) return [];

  const { data: tasks } = await supabaseAdmin
    .from("tasks")
    .select("id, title")
    .eq("org_id", orgId)
    .in(
      "id",
      failed.map((f) => f.row.task_id!)
    );
  const titleOf = new Map(((tasks ?? []) as { id: string; title: string | null }[]).map((t) => [t.id, t.title ?? ""]));
  return failed
    .filter((f) => titleOf.has(f.row.task_id!))
    .map((f) => ({ taskId: f.row.task_id!, title: titleOf.get(f.row.task_id!) || "A task", noteId: f.row.id, op: f.op }));
}
