import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { getSm8Timezone } from "@/lib/workboard/query";
import { zonedParts } from "@/lib/dashboard/day-rail";
import { hhmm, remindAtFrom } from "@/lib/dashboard/reminders";
import { logTaskEvent } from "@/lib/dashboard/task-events";

/* A TASK'S OWN CHANGES, ONE SET OF RULES for every screen that makes them:
   the web's (actions/dashboard, behind its session) and the phone's
   (app/api/mobile/tasks, behind its token). Whoever calls says who is
   acting — the workspace, their staff card, and whether they hold `team` —
   and these decide everything else, in the words a person reads.

     ADD       a task for yourself needs nothing: your own to-do.
     COMPLETE  your own task, a job's task for anyone, or `team`.
     REOPEN    the same as completing it.
     MOVE      the assignee, the creator, or `team`.
     DELETE    whoever CREATED it, or `team`.

   A task given to several people is one job (task_shared_group.sql): ticking
   or reopening one copy moves them all. A task's history is written after
   each change (lib/dashboard/task-events), best effort.

   Nothing here posts a Done to ServiceM8 or takes one back: that follows a
   person's tick on a screen made for ticking, and the screen's own action
   asks for it (actions/task-sm8). Nothing here refreshes a page either. */

/** `note`: something the person should know although the action stood. */
export type DashResult = { ok: true; note?: string } | { ok: false; error: string };
export type AddTaskResult = { ok: true; taskId: string } | { ok: false; error: string };

/** Who is acting: their workspace, their staff card, and whether they hold `team`. */
export type TaskActor = { orgId: string; staffId: string | null; team: () => Promise<boolean> };

const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const now = () => new Date().toISOString();

/** A task for yourself: assigned to you and made by you, whatever the
    request says. `dueDate` where the screen offers one; Home's Save files
    the words as they are, with none. */
export async function addOwnTask(a: TaskActor, title: string, dueDate: string | null = null): Promise<AddTaskResult> {
  if (!a.staffId) return { ok: false, error: "Not signed in." };
  const clean = typeof title === "string" ? title.trim().slice(0, 200).trim() : "";
  if (!clean) return { ok: false, error: "Give the task a title." };
  if (dueDate !== null && !isISODate(dueDate)) return { ok: false, error: "Check the due date." };

  const { data, error } = await supabaseAdmin
    .from("tasks")
    .insert({
      org_id: a.orgId,
      title: clean,
      detail: null,
      assigned_to: a.staffId,
      created_by: a.staffId,
      due_date: dueDate,
      status: "open",
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't save that task." };

  const taskId = String((data as { id: string }).id);
  await logTaskEvent(a.orgId, taskId, a.staffId, { kind: "created", to: a.staffId });
  return { ok: true, taskId };
}

/** Tick a task done, once, and every copy given with it. */
export async function tickTask(a: TaskActor, taskId: string): Promise<DashResult> {
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("assigned_to, status, group_id")
    .eq("org_id", a.orgId)
    .eq("id", taskId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That task no longer exists." };
  if (data.status === "done") return { ok: false, error: "That task is already done." };

  // your own to-do, a job's task for anyone, or a manager closing one out
  const mine = (a.staffId && a.staffId === data.assigned_to) || data.assigned_to === null;
  if (!mine && !(await a.team())) return { ok: false, error: "That task isn't yours to complete." };

  const { data: won, error } = await supabaseAdmin
    .from("tasks")
    .update({ status: "done", done_at: now(), done_by: a.staffId, updated_at: now() })
    .eq("org_id", a.orgId)
    .eq("id", taskId)
    .eq("status", "open")
    .select("id");
  if (error) return { ok: false, error: "Couldn't complete that task." };
  if ((won ?? []).length === 0) return { ok: false, error: "That task is already done." };
  await logTaskEvent(a.orgId, taskId, a.staffId, { kind: "done" });
  /* A task given to several people is one job: the others' copies close with it. */
  if (data.group_id) {
    const { data: rest } = await supabaseAdmin
      .from("tasks")
      .update({ status: "done", done_at: now(), done_by: a.staffId, updated_at: now() })
      .eq("org_id", a.orgId)
      .eq("group_id", data.group_id)
      .eq("status", "open")
      .select("id");
    for (const r of (rest ?? []) as { id: string }[]) {
      await logTaskEvent(a.orgId, r.id, a.staffId, { kind: "done" });
    }
  }
  return { ok: true };
}

/** Reopen a task that is still done, once, and every copy given with it. */
export async function untickTask(a: TaskActor, taskId: string): Promise<DashResult> {
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("assigned_to, status, group_id")
    .eq("org_id", a.orgId)
    .eq("id", taskId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That task no longer exists." };
  if (data.status !== "done") return { ok: false, error: "That task is already open." };

  const mine = (a.staffId && a.staffId === data.assigned_to) || data.assigned_to === null;
  if (!mine && !(await a.team())) return { ok: false, error: "That task isn't yours to reopen." };

  const { data: won, error } = await supabaseAdmin
    .from("tasks")
    .update({ status: "open", done_at: null, done_by: null, updated_at: now() })
    .eq("org_id", a.orgId)
    .eq("id", taskId)
    .eq("status", "done")
    .select("id");
  if (error) return { ok: false, error: "Couldn't reopen that task." };
  if ((won ?? []).length === 0) return { ok: false, error: "That task is already open." };
  await logTaskEvent(a.orgId, taskId, a.staffId, { kind: "reopened" });
  if (data.group_id) {
    const { data: rest } = await supabaseAdmin
      .from("tasks")
      .update({ status: "open", done_at: null, done_by: null, updated_at: now() })
      .eq("org_id", a.orgId)
      .eq("group_id", data.group_id)
      .eq("status", "done")
      .select("id");
    for (const r of (rest ?? []) as { id: string }[]) {
      await logTaskEvent(a.orgId, r.id, a.staffId, { kind: "reopened" });
    }
  }
  return { ok: true };
}

/** Move a task's date, or take it off. A reminder rides with it: its clock
    time is read in the workspace's zone and written back on the new date in
    the same zone; taking the date off takes the reminder with it. */
export async function moveTaskDue(a: TaskActor, taskId: string, dueDate: string | null): Promise<DashResult> {
  if (dueDate !== null && !isISODate(dueDate)) return { ok: false, error: "Check the due date." };

  const { data } = await supabaseAdmin
    .from("tasks")
    .select("assigned_to, created_by, status, remind_at, due_date")
    .eq("org_id", a.orgId)
    .eq("id", taskId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That task no longer exists." };
  if (data.status === "done") return { ok: false, error: "That task is done. Reopen it to change its date." };

  const mine = a.staffId && (a.staffId === data.assigned_to || a.staffId === data.created_by);
  if (!mine && !(await a.team())) return { ok: false, error: "That task isn't yours to move." };

  let remindAt: string | null = null;
  if (dueDate && data.remind_at) {
    const tz = await getSm8Timezone(a.orgId);
    const was = zonedParts(String(data.remind_at), tz);
    remindAt = was ? remindAtFrom(dueDate, hhmm(was.min), tz) : null;
  }

  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ due_date: dueDate, remind_at: remindAt, updated_at: now() })
    .eq("org_id", a.orgId)
    .eq("id", taskId);
  if (error) return { ok: false, error: "Couldn't move that task." };
  /* The history says the date MOVED, so a save that left it where it was
     says nothing. Compared as days: the column is a date, and a driver may
     hand one back with a time on it. */
  const was = data.due_date ? String(data.due_date).slice(0, 10) : null;
  if (was !== dueDate) {
    await logTaskEvent(a.orgId, taskId, a.staffId, { kind: "due", from: was, to: dueDate });
  }
  return { ok: true };
}

/** Delete a task: whoever made it, or `team`. */
export async function removeTask(a: TaskActor, taskId: string): Promise<DashResult> {
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("created_by")
    .eq("org_id", a.orgId)
    .eq("id", taskId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That task is already gone." };

  const mine = a.staffId && a.staffId === data.created_by;
  if (!mine && !(await a.team())) return { ok: false, error: "That task isn't yours to delete." };

  const { error } = await supabaseAdmin.from("tasks").delete().eq("org_id", a.orgId).eq("id", taskId);
  if (error) return { ok: false, error: "Couldn't delete that task." };
  return { ok: true };
}
