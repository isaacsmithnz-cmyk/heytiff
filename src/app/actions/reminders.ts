"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { getSm8Timezone } from "@/lib/workboard/query";
import { isSnooze, snoozeUntil, type DueReminder } from "@/lib/dashboard/reminders";
import { dueReminders, reminderTask, workdayHours } from "@/lib/dashboard/reminders-query";

/* REMINDERS — the bell's read, and the one thing you can do to one from there.

   NO CAPABILITY GATES ANY OF THIS, and that is deliberate rather than an
   oversight. `createTask` requires `team` because assigning work to somebody
   else is a management action; asking to be nudged about your own task is not,
   and gating it would mean a tradesperson without `team` could dictate "remind
   me on Monday" and never be reminded. `keepNoteForMe` takes the same posture
   for the same reason — your own words, your own eyes, no permission needed.

   What replaces the gate is OWNERSHIP: every read and every write is filtered
   to the caller's own staff id inside an org-scoped query, so a task id from
   another workspace, or another person's task, resolves to nothing. A Server
   Function is reachable by direct POST — the bell's UI is a courtesy and this
   is the enforcement. */

export type ReminderResult = { ok: true } | { ok: false; error: string };

type Ctx = { orgId: string; staffId: string | null };

async function context(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, staffId: await staffProfileIdFor(orgId, userId) };
}

/** Your reminders whose time has passed.

    Returns an empty list rather than an error for a signed-out or
    staff-cardless caller: this drives a badge in the topbar on every screen,
    and a topbar that throws is a worse answer than a topbar with nothing on
    it. Same posture as `actionRequiredItems` on a failed read. */
export async function myDueReminders(): Promise<DueReminder[]> {
  const ctx = await context();
  if (!ctx?.staffId) return [];
  return dueReminders(ctx.orgId, ctx.staffId);
}

/** Put a reminder off — an hour, tomorrow, or next week.

    A snooze MOVES the nudge; it does not record that one was dismissed. That
    is what keeps the whole feature derived: there is no "seen" flag to go
    stale, and the reminder is due again at the new time by the same rule that
    made it due at the old one.

    The due DATE is left alone on purpose. Snoozing says "not yet, ask me
    later", which is a statement about the nudge; the day the thing is actually
    wanted by has not changed, and silently moving it would rewrite the task's
    deadline behind a button labelled "tomorrow". */
export async function snoozeReminder(taskId: string, preset: string): Promise<ReminderResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "Not signed in." };
  if (!isSnooze(preset)) return { ok: false, error: "Couldn't snooze that." };

  const task = await reminderTask(ctx.orgId, taskId);
  if (!task) return { ok: false, error: "That task no longer exists." };
  // Yours to put off, and only yours — a reminder is not a team object.
  if (task.assignedTo !== ctx.staffId) return { ok: false, error: "That reminder isn't yours." };
  if (task.status === "done") return { ok: false, error: "That task is already done." };

  const [tz, day] = await Promise.all([
    getSm8Timezone(ctx.orgId),
    workdayHours(ctx.orgId, ctx.staffId),
  ]);

  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ remind_at: snoozeUntil(preset, day.start, tz), updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", taskId)
    .eq("assigned_to", ctx.staffId);
  if (error) return { ok: false, error: "Couldn't snooze that." };

  revalidatePath("/dashboard");
  return { ok: true };
}
