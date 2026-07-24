"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";

/* Dashboard mutations — tasks and the noticeboard.

   The UI is never the control; every rule is re-decided here.

     ASSIGN / POST   creating a task for someone, or posting a notice, needs
                     `team`. It's a management action about other people.
     COMPLETE        finishing a task is intrinsic to the person it's assigned
                     to (it's their to-do); a `team` holder can also close one.
     ACK             acknowledging a notice is intrinsic — it's your own read.
*/

export type DashResult = { ok: true } | { ok: false; error: string };

type Ctx = { orgId: string; staffId: string | null };

async function context(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, staffId: await staffProfileIdFor(orgId, userId) };
}

const refresh = () => revalidatePath("/dashboard");

const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/* ---------------- tasks ---------------- */

export async function createTask(input: {
  assignedTo: string;
  title: string;
  detail?: string;
  dueDate?: string;
}): Promise<DashResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("team"))) return { ok: false, error: "You can't assign tasks." };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the task a title." };
  if (input.dueDate && !isISODate(input.dueDate)) return { ok: false, error: "Check the due date." };

  // the assignee must belong to this org — scoped lookup, never id alone
  const { data: target } = await supabaseAdmin
    .from("staff_profiles")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("id", input.assignedTo)
    .maybeSingle();
  if (!target) return { ok: false, error: "That person isn't in this organisation." };

  const { error } = await supabaseAdmin.from("tasks").insert({
    org_id: ctx.orgId,
    title: title.slice(0, 200),
    detail: input.detail?.trim().slice(0, 1000) || null,
    assigned_to: input.assignedTo,
    created_by: ctx.staffId,
    due_date: input.dueDate || null,
    status: "open",
  });
  if (error) return { ok: false, error: "Couldn't create that task." };
  refresh();
  return { ok: true };
}

export async function completeTask(taskId: string): Promise<DashResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const { data } = await supabaseAdmin
    .from("tasks")
    .select("assigned_to, status")
    .eq("org_id", ctx.orgId)
    .eq("id", taskId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That task no longer exists." };
  if (data.status === "done") return { ok: false, error: "That task is already done." };

  // your own to-do, or a manager closing one out
  const mine = ctx.staffId && ctx.staffId === data.assigned_to;
  if (!mine && !(await can("team"))) return { ok: false, error: "That task isn't yours to complete." };

  const { error } = await supabaseAdmin
    .from("tasks")
    .update({
      status: "done",
      done_at: new Date().toISOString(),
      done_by: ctx.staffId,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", taskId);
  if (error) return { ok: false, error: "Couldn't complete that task." };
  refresh();
  return { ok: true };
}

/* ---------------- notices ---------------- */

export async function postNotice(input: {
  title: string;
  body?: string;
  pinned?: boolean;
}): Promise<DashResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("team"))) return { ok: false, error: "You can't post notices." };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the notice a title." };

  const { error } = await supabaseAdmin.from("notices").insert({
    org_id: ctx.orgId,
    title: title.slice(0, 200),
    body: input.body?.trim().slice(0, 2000) || null,
    posted_by: ctx.staffId,
    pinned: input.pinned === true,
  });
  if (error) return { ok: false, error: "Couldn't post that notice." };
  refresh();
  return { ok: true };
}

/** Acknowledge a notice — intrinsic, your own read. Idempotent. */
export async function ackNotice(noticeId: string): Promise<DashResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  // confirm the notice belongs to this org before recording a read against it
  const { data } = await supabaseAdmin
    .from("notices")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("id", noticeId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That notice no longer exists." };

  const { error } = await supabaseAdmin.from("notice_reads").upsert(
    {
      org_id: ctx.orgId,
      notice_id: noticeId,
      staff_profile_id: ctx.staffId,
      read_at: new Date().toISOString(),
    },
    { onConflict: "notice_id,staff_profile_id" },
  );
  if (error) return { ok: false, error: "Couldn't record that." };
  refresh();
  return { ok: true };
}
