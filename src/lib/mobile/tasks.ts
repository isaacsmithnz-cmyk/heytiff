import "server-only";

import { staffProfileIdFor } from "@/lib/fleet/query";
import { loadStaffNames, myTasks } from "@/lib/dashboard/tasks-query";
import { sortTasks } from "@/lib/dashboard/tasks";
import type { TaskActor } from "@/lib/dashboard/task-actions";
import type { RemindKind } from "@/lib/dashboard/reminders";
import type { MobileCtx } from "./auth";

/* YOUR TASKS, FOR THE PHONE'S TO DO (Isaac, 27 October 2026: "I'm also
   missing to do on the app. That should probably go on today?"): the same
   open tasks as your list on the web's Home (tasks-query's myTasks), in its
   order (sortTasks: dated first, then the newest), with who gave each one
   where it wasn't you. The rules for changing one are the web's own
   (lib/dashboard/task-actions). */

export type PhoneTask = {
  id: string;
  title: string;
  detail: string | null;
  dueDate: string | null;
  /** the hour it names, as an instant; null for "some time that day" */
  remindAt: string | null;
  remindKind: RemindKind;
  createdAt: string;
  /** who gave it to you; null for your own */
  from: string | null;
  /** you made it, so you may delete it */
  own: boolean;
};

/** The phone's person, as the task rules take them: their staff card, and
    whether they hold `team`. Null without a card: there are no tasks to have. */
export async function phoneActor(ctx: MobileCtx): Promise<TaskActor | null> {
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!staffId) return null;
  return { orgId: ctx.orgId, staffId, team: async () => ctx.caps.has("team") };
}

export async function phoneTasks(orgId: string, staffId: string): Promise<PhoneTask[]> {
  const names = await loadStaffNames(orgId);
  const mine = sortTasks(await myTasks(orgId, staffId, names));
  return mine.map((t) => ({
    id: t.id,
    title: t.title,
    detail: t.detail,
    dueDate: t.dueDate,
    remindAt: t.remindAt,
    remindKind: t.remindKind,
    createdAt: t.createdAt,
    from: t.createdBy && t.createdBy !== staffId ? (names.get(t.createdBy) ?? null) : null,
    own: t.createdBy === staffId,
  }));
}
