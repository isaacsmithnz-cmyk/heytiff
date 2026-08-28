"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { assignmentTask, newAssignments } from "@/lib/dashboard/assignments-query";
import type { NewAssignment } from "@/lib/dashboard/assignments";

/* BEING GIVEN WORK — the bell's read, and the one thing you can do to one
   from there.

   NO CAPABILITY GATES EITHER OF THESE, and that is deliberate rather than an
   oversight — the same reasoning `reminders.ts` spells out. `createTask`
   requires `team` because assigning work to somebody else is a management
   action; being told what you were given is not, and gating it would mean a
   tradesperson without `team` could be assigned work and never told.

   What replaces the gate is OWNERSHIP: every read and every write is filtered
   to the caller's own staff id inside an org-scoped query, so a task id from
   another workspace, or another person's task, resolves to nothing. A Server
   Function is reachable by direct POST — the bell's UI is a courtesy and this
   is the enforcement. */

export type AckResult = { ok: true } | { ok: false; error: string };

type Ctx = { orgId: string; staffId: string | null };

async function context(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, staffId: await staffProfileIdFor(orgId, userId) };
}

/** Work somebody gave you that you haven't answered for yet.

    Returns an empty list rather than an error for a signed-out or
    staff-cardless caller: this drives a badge in the topbar on every screen,
    and a topbar that throws is a worse answer than a topbar with nothing on
    it. Same posture as `myDueReminders` beside it. */
export async function myNewAssignments(): Promise<NewAssignment[]> {
  const ctx = await context();
  if (!ctx?.staffId) return [];
  return newAssignments(ctx.orgId, ctx.staffId);
}

/** "Got it."

    ACKNOWLEDGING IS NOT DOING. This stamps the column the bell reads and
    nothing else — the task stays open, on your list, with its due date
    intact. The two questions are different ones, and a bell that only clears
    when the work is finished is a bell people learn to ignore.

    Idempotent on purpose: acknowledging an already-acknowledged task is a
    double tap on a phone, not an error, and the write simply lands again. */
export async function acknowledgeTask(taskId: string): Promise<AckResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "Not signed in." };

  const task = await assignmentTask(ctx.orgId, taskId);
  if (!task) return { ok: false, error: "That task no longer exists." };
  /* Yours to answer for, and only yours — being given work is not a team
     object, and somebody else's bell is not yours to silence. */
  if (task.assignedTo !== ctx.staffId) return { ok: false, error: "That task isn't yours." };

  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ acknowledged_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", taskId)
    .eq("assigned_to", ctx.staffId);
  if (error) return { ok: false, error: "Couldn't save that." };

  revalidatePath("/dashboard");
  return { ok: true };
}
