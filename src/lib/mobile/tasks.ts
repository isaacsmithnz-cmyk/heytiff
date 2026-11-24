import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { jobLabelOf } from "@/lib/dashboard/task-record";
import { sm8CategoryColour } from "@/lib/workboard/all-jobs";
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
  /** the job it's about, which the task opens: "3516 Mockville", and the note it was read from, where Tiff made it from one;
      its number, client, ServiceM8 colour and status draw the number's box at the row's end (Isaac, 24 November 2026,
      the Star a job mock's To do) */
  job?: { uuid: string; label: string; note: string | null; number: string | null; client: string | null; colour: string | null; status: string | null };
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
  const jobs = await tasksJobs(orgId, mine.map((t) => t.id));
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
    ...(jobs.has(t.id) ? { job: jobs.get(t.id)! } : {}),
  }));
}

/** Each task's job, by the task's id (Isaac, 17 November 2026, bug 7: "It should take me to the job if I click on
    Luke's message about 3516"): the job it was made on (`tasks.sm8_job_uuid`), else the job of the note Tiff read it
    from (`mention_asks`), with that note; named as the diary names a job, its number and suburb. Empty where it can't be
    read: a task still opens, just not its job. */
async function tasksJobs(orgId: string, ids: readonly string[]): Promise<Map<string, NonNullable<PhoneTask["job"]>>> {
  const out = new Map<string, NonNullable<PhoneTask["job"]>>();
  if (ids.length === 0) return out;
  const [{ data: own }, { data: asks }] = await Promise.all([
    supabaseAdmin.from("tasks").select("id, sm8_job_uuid").eq("org_id", orgId).in("id", ids),
    supabaseAdmin.from("mention_asks").select("task_id, sm8_job_uuid, sm8_note_uuid").eq("org_id", orgId).in("task_id", ids),
  ]);
  const of = new Map<string, { uuid: string; note: string | null }>();
  for (const a of (asks ?? []) as { task_id: string; sm8_job_uuid: string | null; sm8_note_uuid: string | null }[]) {
    if (a.sm8_job_uuid) of.set(a.task_id, { uuid: a.sm8_job_uuid, note: a.sm8_note_uuid ?? null });
  }
  for (const t of (own ?? []) as { id: string; sm8_job_uuid: string | null }[]) {
    if (t.sm8_job_uuid && of.get(t.id)?.uuid !== t.sm8_job_uuid) of.set(t.id, { uuid: t.sm8_job_uuid, note: null });
  }
  if (of.size === 0) return out;
  const { data: rows } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, geo_city, status, company_uuid, category_uuid")
    .eq("org_id", orgId)
    .in("uuid", [...new Set([...of.values()].map((j) => j.uuid))]);
  type Row = { uuid: string; generated_job_id: string | null; geo_city: string | null; status: string | null; company_uuid: string | null; category_uuid: string | null };
  const read = (rows ?? []) as Row[];
  const companies = [...new Set(read.map((r) => r.company_uuid).filter((c): c is string => !!c))];
  const categories = [...new Set(read.map((r) => r.category_uuid).filter((c): c is string => !!c))];
  const [{ data: cos }, { data: cats }] = await Promise.all([
    companies.length ? supabaseAdmin.from("sm8_companies").select("uuid, name").eq("org_id", orgId).in("uuid", companies) : Promise.resolve({ data: [] }),
    categories.length ? supabaseAdmin.from("sm8_categories").select("uuid, colour").eq("org_id", orgId).in("uuid", categories) : Promise.resolve({ data: [] }),
  ]);
  const client = new Map(((cos ?? []) as { uuid: string; name: string | null }[]).map((c) => [c.uuid, c.name?.trim() || null]));
  const colour = new Map(((cats ?? []) as { uuid: string; colour: string | null }[]).map((c) => [c.uuid, sm8CategoryColour(c.colour)]));
  const byUuid = new Map(read.map((r) => [r.uuid, r]));
  for (const [id, j] of of) {
    const r = byUuid.get(j.uuid);
    const label = r ? jobLabelOf(r.generated_job_id, r.geo_city) : null;
    if (!r || !label) continue;
    out.set(id, {
      uuid: j.uuid,
      label,
      note: j.note,
      number: r.generated_job_id,
      client: r.company_uuid ? (client.get(r.company_uuid) ?? null) : null,
      colour: r.category_uuid ? (colour.get(r.category_uuid) ?? null) : null,
      status: r.status,
    });
  }
  return out;
}
