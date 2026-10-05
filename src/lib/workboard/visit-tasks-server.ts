import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET, signMany } from "@/lib/documents/query";
import { imageForClaude } from "@/lib/images/for-claude";
import { VISIT_STAGES, type Visit, type VisitStage } from "@/lib/quotes/buildup";
import { CHECKLIST } from "@/lib/quotes/checklist";
import { acceptedOptions, type ProposalOption } from "@/lib/quotes/proposal";
import { MODEL, readStoredProposal } from "@/lib/quotes/proposal-writer";
import { readQuoteLabour } from "@/lib/quotes/quote-labour-server";
import { getSm8Timezone } from "./query";
import { todayInZone } from "./dates";
import { TASKS_SCHEMA, TASKS_SYSTEM, parseTasks, plannedVisits, tasksPrompt, unitsOf } from "./task-plan";
import { PLATE_PROMPT, PLATE_SCHEMA, parsePlate, plateCode } from "./plate-read";
import {
  MAX_NOTE,
  MAX_TASK_NAME,
  MAX_TASKS,
  PHOTO_ROLES,
  TASK_KINDS,
  type JobTask,
  type TaskKind,
  type TaskPhoto,
  type TaskUnit,
  type TaskUpdate,
} from "./visit-tasks";

/* A JOB'S TASKS, READ AND WRITTEN (visit-tasks.ts says what a task and an
   update are). Every read and write is this org's, by the job's own card
   uuid; the route gates who may do what. Service role. */

const FALLBACK_MODEL = "claude-opus-4-8";
const MAX_TOKENS = 16000;

type TaskRow = {
  id: string;
  name: string;
  stage: string;
  kind: string;
  unit: TaskUnit | null;
  visit: number | null;
  sort: number;
  progress: number;
  done_at: string | null;
  done_by: string | null;
  serial: string | null;
  model_read: string | null;
  source: string;
};
type UpdateRow = { id: string; task_id: string; day: string; pct_from: number; pct_to: number; note: string; by_name: string | null; created_at: string };

const TASK_COLUMNS = "id, name, stage, kind, unit, visit, sort, progress, done_at, done_by, serial, model_read, source";

const taskOf = (r: TaskRow): JobTask => ({
  id: r.id,
  name: r.name,
  stage: (VISIT_STAGES as readonly string[]).includes(r.stage) ? (r.stage as VisitStage) : "Install",
  kind: (TASK_KINDS as readonly string[]).includes(r.kind) ? (r.kind as TaskKind) : "tick",
  unit: r.unit,
  visit: r.visit,
  sort: r.sort,
  progress: r.progress,
  doneAt: r.done_at,
  doneBy: r.done_by,
  serial: r.serial,
  modelRead: r.model_read,
  source: r.source === "person" ? "person" : "quote",
});
const updateOf = (r: UpdateRow): TaskUpdate => ({ id: r.id, taskId: r.task_id, day: r.day, from: r.pct_from, to: r.pct_to, note: r.note, by: r.by_name, at: r.created_at });

export type JobTasks = { tasks: JobTask[]; updates: TaskUpdate[]; photos: TaskPhoto[] };

export async function readJobTasks(orgId: string, cardId: string): Promise<JobTasks> {
  const [{ data: tasks }, { data: updates }] = await Promise.all([
    supabaseAdmin.from("job_tasks").select(TASK_COLUMNS).eq("org_id", orgId).eq("sm8_job_uuid", cardId).order("sort", { ascending: true }),
    supabaseAdmin
      .from("job_task_updates")
      .select("id, task_id, day, pct_from, pct_to, note, by_name, created_at")
      .eq("org_id", orgId)
      .eq("sm8_job_uuid", cardId)
      .order("created_at", { ascending: true }),
  ]);
  const list = ((tasks ?? []) as TaskRow[]).map(taskOf);
  return { tasks: list, updates: ((updates ?? []) as UpdateRow[]).map(updateOf), photos: await readTaskPhotos(orgId, list.map((t) => t.id)) };
}

/** The tasks' photos, each with a link that lasts the page's view. */
async function readTaskPhotos(orgId: string, taskIds: readonly string[]): Promise<TaskPhoto[]> {
  if (taskIds.length === 0) return [];
  const { data: links } = await supabaseAdmin
    .from("job_task_photos")
    .select("id, task_id, document_id, role, created_at")
    .eq("org_id", orgId)
    .in("task_id", [...taskIds])
    .order("created_at", { ascending: true });
  const rows = (links ?? []) as { id: string; task_id: string; document_id: string; role: string; created_at: string }[];
  if (rows.length === 0) return [];
  const { data: docs } = await supabaseAdmin.from("documents").select("id, storage_ref").eq("org_id", orgId).in("id", rows.map((r) => r.document_id));
  const refOf = new Map(((docs ?? []) as { id: string; storage_ref: string }[]).map((d) => [d.id, d.storage_ref]));
  const urls = await signMany([...refOf.values()]);
  return rows.map((r) => {
    const ref = refOf.get(r.document_id);
    return {
      id: r.id,
      taskId: r.task_id,
      role: (PHOTO_ROLES as readonly string[]).includes(r.role) ? (r.role as TaskPhoto["role"]) : "other",
      url: ref ? (urls.get(ref) ?? null) : null,
      at: r.created_at,
    };
  });
}

/** A rating plate's model and serial, read from its photo; null when the
    photo can't be read or holds neither. */
export async function readPlate(storageRef: string, mime: string | null, client: Anthropic = new Anthropic()): Promise<{ model: string; serial: string } | null> {
  const { data: blob } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(storageRef);
  if (!blob) return null;
  const image = await imageForClaude(Buffer.from(await blob.arrayBuffer()), mime);
  if (!image) return null;
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: FALLBACK_MODEL }],
      output_config: { effort: "low", format: { type: "json_schema", schema: PLATE_SCHEMA as unknown as Record<string, unknown> } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mime, data: image.bytes.toString("base64") } },
            { type: "text", text: PLATE_PROMPT },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
    const block = [...response.content].reverse().find((b) => b.type === "text");
    return block && block.type === "text" ? parsePlate(JSON.parse(block.text)) : null;
  } catch (err) {
    console.error("[visit-tasks] couldn't read a rating plate:", err);
    return null;
  }
}

/** The days booked on the job since its work order and before today, with
    who was booked: a day the crew went but nobody checked in is still a
    visit, or every visit after it would be numbered one short. */
export async function pastBookedDays(orgId: string, cardId: string, today: string): Promise<{ day: string; crew: string[] }[]> {
  const { data: job } = await supabaseAdmin.from("sm8_jobs").select("work_order_date").eq("org_id", orgId).eq("uuid", cardId).maybeSingle();
  const from = ((job as { work_order_date: string | null } | null)?.work_order_date ?? "").slice(0, 10);
  const { data } = await supabaseAdmin
    .from("sm8_job_activities")
    .select("start_date, staff_uuid")
    .eq("org_id", orgId)
    .eq("active", 1)
    .eq("job_uuid", cardId)
    .eq("activity_was_scheduled", 1)
    .lt("start_date", `${today} 00:00:00`)
    .order("start_date", { ascending: true });
  const rows = ((data ?? []) as { start_date: string | null; staff_uuid: string | null }[]).filter((r) => r.start_date && (!from || r.start_date.slice(0, 10) >= from));
  if (rows.length === 0) return [];
  const staffIds = [...new Set(rows.map((r) => r.staff_uuid).filter((s): s is string => !!s))];
  const { data: staff } = staffIds.length
    ? await supabaseAdmin.from("sm8_staff").select("uuid, first, last").eq("org_id", orgId).in("uuid", staffIds)
    : { data: [] };
  const nameOf = new Map(((staff ?? []) as { uuid: string; first: string | null; last: string | null }[]).map((s) => [s.uuid, [s.first, s.last].filter(Boolean).join(" ")]));
  const days = new Map<string, Set<string>>();
  for (const r of rows) {
    const day = r.start_date!.slice(0, 10);
    const set = days.get(day) ?? new Set<string>();
    const name = r.staff_uuid ? nameOf.get(r.staff_uuid) : "";
    if (name) set.add(name);
    days.set(day, set);
  }
  return [...days.entries()].map(([day, crew]) => ({ day, crew: [...crew] }));
}

/** The account's own today, the day an update is logged against. */
export async function accountToday(orgId: string): Promise<string> {
  return todayInZone(await getSm8Timezone(orgId));
}

/** The accepted options and the visits their labour plans: an option's own
    labour, else the brief's, else none. */
async function quotePlan(orgId: string, cardId: string): Promise<{ options: ProposalOption[]; labour: Visit[]; facts: string[] } | null> {
  const [proposal, labour] = await Promise.all([readStoredProposal(orgId, cardId).catch(() => null), readQuoteLabour(orgId, cardId).catch(() => null)]);
  if (!proposal) return null;
  const options = acceptedOptions(proposal.draft);
  if (options.length === 0) return null;
  const own = options.flatMap((o) => o.labour?.visits ?? []);
  /* a brief's visit in hours, with no working day set, is still one visit */
  const brief: Visit[] = (labour?.brief?.visits ?? []).map((v) => ({
    stage: v.stage,
    people: v.people,
    days: v.days ?? (v.hours != null ? (labour?.dayHours ? v.hours / labour.dayHours : 1) : 1),
  }));
  const facts = proposal.draft.checklist.filter((i) => i.state === "known" && i.answer.trim()).map((i) => `${CHECKLIST[i.key].label}: ${i.answer.trim()}`);
  return { options, labour: own.length ? own : brief, facts };
}

/** Whether the quote has an accepted option to make the tasks from. */
export async function canMakeTasks(orgId: string, cardId: string): Promise<boolean> {
  const proposal = await readStoredProposal(orgId, cardId).catch(() => null);
  return !!proposal && acceptedOptions(proposal.draft).length > 0;
}

export type MakeResult = { ok: true; made: number } | { ok: false; reason: string };

/** Tiff's task list from the accepted quote, onto a job with none yet. */
export async function makeTasksFromQuote(orgId: string, userId: string, cardId: string, client: Anthropic = new Anthropic()): Promise<MakeResult> {
  const { count } = await supabaseAdmin.from("job_tasks").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("sm8_job_uuid", cardId);
  if ((count ?? 0) > 0) return { ok: false, reason: "This job already has its tasks." };
  const plan = await quotePlan(orgId, cardId);
  if (!plan) return { ok: false, reason: "No option is marked accepted on the quote yet." };
  const { data: job } = await supabaseAdmin.from("sm8_jobs").select("job_address").eq("org_id", orgId).eq("uuid", cardId).maybeSingle();
  const visits = plannedVisits(plan.labour);
  const units = unitsOf(plan.options);
  const prompt = tasksPrompt({ site: (job as { job_address: string | null } | null)?.job_address ?? null, client: null, options: plan.options, facts: plan.facts, visits });

  let raw: unknown;
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: FALLBACK_MODEL }],
      output_config: { effort: "low", format: { type: "json_schema", schema: TASKS_SCHEMA as unknown as Record<string, unknown> } },
      system: TASKS_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return { ok: false, reason: "Tiff couldn't write the tasks for this one. Add them yourself." };
    const block = [...response.content].reverse().find((b) => b.type === "text");
    if (!block || block.type !== "text") return { ok: false, reason: "Tiff returned nothing. Try again." };
    raw = JSON.parse(block.text);
  } catch (err) {
    console.error(`[visit-tasks] couldn't write job ${cardId}'s tasks:`, err);
    return { ok: false, reason: "Tiff couldn't be reached. Try again." };
  }
  const tasks = parseTasks(raw, units, visits);
  if (tasks.length === 0) return { ok: false, reason: "Tiff couldn't write the tasks for this one. Add them yourself." };
  /* asked again after the call: a second press, or a second manager, may
     have made them meanwhile */
  const { count: since } = await supabaseAdmin.from("job_tasks").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("sm8_job_uuid", cardId);
  if ((since ?? 0) > 0) return { ok: false, reason: "This job already has its tasks." };
  const { error } = await supabaseAdmin.from("job_tasks").insert(
    tasks.map((t) => ({ org_id: orgId, sm8_job_uuid: cardId, name: t.name, stage: t.stage, kind: t.kind, unit: t.unit, visit: t.visit, sort: t.sort, source: "quote", created_by: userId }))
  );
  if (error) {
    console.error(`[visit-tasks] couldn't store job ${cardId}'s tasks:`, error);
    return { ok: false, reason: "The tasks couldn't be saved. Try again." };
  }
  return { ok: true, made: tasks.length };
}

/* ── a person's edits ── */

export type TaskEdit =
  /** how far it's got today, with a note; 100 is done, 0 undoes it */
  | { kind: "progress"; id: string; to: number; note: string }
  | { kind: "visit"; id: string; visit: number | null }
  | { kind: "add"; name: string; stage: VisitStage; taskKind: TaskKind; visit: number | null }
  | { kind: "rename"; id: string; name: string }
  | { kind: "remove"; id: string }
  /** a photo uploaded onto the job, taken on this task; a plate's is read */
  | { kind: "photo"; id: string; documentId: string; role: TaskPhoto["role"] }
  /** a person's own model and serial, over what was read */
  | { kind: "plate"; id: string; model: string; serial: string }
  /** a photo off the task (it stays on the job) */
  | { kind: "unphoto"; id: string; photoId: string };

/** Edits that change the list itself, not the work done on it. */
export const LIST_EDITS: ReadonlySet<TaskEdit["kind"]> = new Set(["visit", "add", "rename", "remove"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const visitIn = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 99 ? v : null);
const nameIn = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_TASK_NAME) : "");

/** An edit as the browser sent it, checked; null when it isn't one. */
export function editOf(raw: unknown): TaskEdit | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" && UUID.test(o.id) ? o.id : null;
  switch (o.kind) {
    case "progress": {
      const to = typeof o.to === "number" && Number.isFinite(o.to) ? Math.round(o.to) : NaN;
      if (!id || !(to >= 0 && to <= 100)) return null;
      return { kind: "progress", id, to, note: typeof o.note === "string" ? o.note.trim().slice(0, MAX_NOTE) : "" };
    }
    case "visit":
      return id ? { kind: "visit", id, visit: visitIn(o.visit) } : null;
    case "add": {
      const name = nameIn(o.name);
      const stage = VISIT_STAGES.includes(o.stage as VisitStage) ? (o.stage as VisitStage) : null;
      const taskKind = o.taskKind === "progress" ? "progress" : "tick";
      return name && stage ? { kind: "add", name, stage, taskKind, visit: visitIn(o.visit) } : null;
    }
    case "rename": {
      const name = nameIn(o.name);
      return id && name ? { kind: "rename", id, name } : null;
    }
    case "remove":
      return id ? { kind: "remove", id } : null;
    case "photo": {
      const documentId = typeof o.documentId === "string" && UUID.test(o.documentId) ? o.documentId : null;
      const role = PHOTO_ROLES.includes(o.role as TaskPhoto["role"]) ? (o.role as TaskPhoto["role"]) : "other";
      return id && documentId ? { kind: "photo", id, documentId, role } : null;
    }
    case "plate":
      return id ? { kind: "plate", id, model: plateCode(o.model), serial: plateCode(o.serial) } : null;
    case "unphoto": {
      const photoId = typeof o.photoId === "string" && UUID.test(o.photoId) ? o.photoId : null;
      return id && photoId ? { kind: "unphoto", id, photoId } : null;
    }
    default:
      return null;
  }
}

export type EditResult = { ok: true } | { ok: false; reason: string };

/** One edit, on this job's own task. `who` names the person for the
    update's line. */
export async function applyTaskEdit(
  orgId: string,
  cardId: string,
  who: { userId: string; name: string | null },
  edit: TaskEdit,
  read: typeof readPlate = readPlate
): Promise<EditResult> {
  if (edit.kind === "add") {
    const { count } = await supabaseAdmin.from("job_tasks").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("sm8_job_uuid", cardId);
    if ((count ?? 0) >= MAX_TASKS) return { ok: false, reason: `A job holds ${MAX_TASKS} tasks at most.` };
    const { error } = await supabaseAdmin.from("job_tasks").insert({
      org_id: orgId,
      sm8_job_uuid: cardId,
      name: edit.name,
      stage: edit.stage,
      kind: edit.taskKind,
      visit: edit.visit,
      sort: (count ?? 0) + 1000,
      source: "person",
      created_by: who.userId,
    });
    return error ? { ok: false, reason: "The task couldn't be added. Try again." } : { ok: true };
  }

  const { data } = await supabaseAdmin.from("job_tasks").select("id, progress").eq("org_id", orgId).eq("sm8_job_uuid", cardId).eq("id", edit.id).maybeSingle();
  const row = data as { id: string; progress: number } | null;
  if (!row) return { ok: false, reason: "That task isn't on this job any more." };
  const now = new Date().toISOString();

  switch (edit.kind) {
    case "progress": {
      if (edit.to === row.progress && !edit.note) return { ok: true };
      const done = edit.to >= 100;
      /* the day's work goes on record first; the task moves only once it is,
         so progress never changes with no day to show for it */
      const { data: logged, error: logError } = await supabaseAdmin
        .from("job_task_updates")
        .insert({
          org_id: orgId,
          task_id: edit.id,
          sm8_job_uuid: cardId,
          day: await accountToday(orgId),
          pct_from: row.progress,
          pct_to: edit.to,
          note: edit.note,
          by_user: who.userId,
          by_name: who.name,
        })
        .select("id")
        .single();
      if (logError || !logged) return { ok: false, reason: "That couldn't be saved. Try again." };
      const { error } = await supabaseAdmin
        .from("job_tasks")
        .update({ progress: edit.to, done_at: done ? now : null, done_by: done ? who.name : null, updated_at: now })
        .eq("org_id", orgId)
        .eq("id", edit.id);
      if (error) {
        await supabaseAdmin.from("job_task_updates").delete().eq("org_id", orgId).eq("id", (logged as { id: string }).id);
        return { ok: false, reason: "That couldn't be saved. Try again." };
      }
      return { ok: true };
    }
    case "visit": {
      const { error } = await supabaseAdmin.from("job_tasks").update({ visit: edit.visit, updated_at: now }).eq("org_id", orgId).eq("id", edit.id);
      return error ? { ok: false, reason: "That couldn't be moved. Try again." } : { ok: true };
    }
    case "rename": {
      const { error } = await supabaseAdmin.from("job_tasks").update({ name: edit.name, updated_at: now }).eq("org_id", orgId).eq("id", edit.id);
      return error ? { ok: false, reason: "That couldn't be renamed. Try again." } : { ok: true };
    }
    case "remove": {
      const { error } = await supabaseAdmin.from("job_tasks").delete().eq("org_id", orgId).eq("sm8_job_uuid", cardId).eq("id", edit.id);
      return error ? { ok: false, reason: "That couldn't be taken off. Try again." } : { ok: true };
    }
    case "photo": {
      /* the photo is a landed job document on THIS job: the id is a choice
         the browser handed in */
      const { data: doc } = await supabaseAdmin
        .from("documents")
        .select("id, kind, sm8_job_uuid, uploaded_at, storage_ref, mime_type")
        .eq("org_id", orgId)
        .eq("id", edit.documentId)
        .maybeSingle();
      const d = doc as { kind: string; sm8_job_uuid: string | null; uploaded_at: string | null; storage_ref: string; mime_type: string | null } | null;
      if (!d || d.kind !== "job_document" || !d.uploaded_at || d.sm8_job_uuid !== cardId) return { ok: false, reason: "That photo didn't land on this job." };
      const { error } = await supabaseAdmin
        .from("job_task_photos")
        .upsert({ org_id: orgId, task_id: edit.id, document_id: edit.documentId, role: edit.role, created_by: who.userId }, { onConflict: "task_id,document_id" });
      if (error) return { ok: false, reason: "That photo couldn't be kept. Try again." };
      if (edit.role === "plate") {
        const plate = await read(d.storage_ref, d.mime_type);
        if (!plate) return { ok: false, reason: "The plate couldn't be read from that photo. Type the model and serial instead." };
        await supabaseAdmin
          .from("job_tasks")
          .update({ model_read: plate.model || null, serial: plate.serial || null, updated_at: now })
          .eq("org_id", orgId)
          .eq("id", edit.id);
      }
      return { ok: true };
    }
    case "plate": {
      const { error } = await supabaseAdmin
        .from("job_tasks")
        .update({ model_read: edit.model || null, serial: edit.serial || null, updated_at: now })
        .eq("org_id", orgId)
        .eq("id", edit.id);
      return error ? { ok: false, reason: "That couldn't be saved. Try again." } : { ok: true };
    }
    case "unphoto": {
      const { error } = await supabaseAdmin.from("job_task_photos").delete().eq("org_id", orgId).eq("task_id", edit.id).eq("id", edit.photoId);
      return error ? { ok: false, reason: "That photo couldn't be taken off. Try again." } : { ok: true };
    }
  }
}
