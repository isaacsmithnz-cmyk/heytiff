import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET, signMany } from "@/lib/documents/query";
import { imageForClaude } from "@/lib/images/for-claude";
import { VISIT_STAGES, type Visit, type VisitStage } from "@/lib/quotes/buildup";
import { CHECKLIST } from "@/lib/quotes/checklist";
import { acceptedOptions, type ProposalOption } from "@/lib/quotes/proposal";
import { FALLBACK_MODEL, MODEL } from "@/lib/quotes/proposal-writer";
import { labourTasks, linesHours } from "@/lib/quotes/lines-job";
import { readJobQuote } from "@/lib/quotes/lines-job-server";
import { readQuoteLabour } from "@/lib/quotes/quote-labour-server";
import { getSm8Timezone } from "./query";
import { todayInZone } from "./dates";
import { TASKS_SCHEMA, TASKS_SYSTEM, parseTasks, plannedVisits, tasksFromQuote, tasksPrompt, unitsOf, type QuoteVisit } from "./task-plan";
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

type TaskRow = {
  id: string;
  name: string;
  stage: string;
  kind: string;
  unit: TaskUnit | null;
  visit: number | null;
  sort: number;
  progress: number;
  serial: string | null;
  model_read: string | null;
  source: string;
  hours: number | string | null;
};
type UpdateRow = { id: string; task_id: string; day: string; pct_from: number; pct_to: number; note: string; by_name: string | null; created_at: string };

const taskOf = (r: TaskRow): JobTask => ({
  id: r.id,
  name: r.name,
  stage: (VISIT_STAGES as readonly string[]).includes(r.stage) ? (r.stage as VisitStage) : "Install",
  kind: (TASK_KINDS as readonly string[]).includes(r.kind) ? (r.kind as TaskKind) : "tick",
  unit: r.unit,
  visit: r.visit,
  sort: r.sort,
  progress: r.progress,
  serial: r.serial,
  modelRead: r.model_read,
  source: r.source === "person" ? "person" : "quote",
  hours: r.hours == null ? null : Number(r.hours),
});
const updateOf = (r: UpdateRow): TaskUpdate => ({ id: r.id, taskId: r.task_id, day: r.day, from: r.pct_from, to: r.pct_to, note: r.note, by: r.by_name, at: r.created_at });

const taskCount = async (orgId: string, cardId: string) =>
  (await supabaseAdmin.from("job_tasks").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("sm8_job_uuid", cardId)).count ?? 0;

export async function readJobTasks(orgId: string, cardId: string): Promise<{ tasks: JobTask[]; updates: TaskUpdate[]; photos: TaskPhoto[] }> {
  const [{ data: tasks }, { data: updates }] = await Promise.all([
    supabaseAdmin
      .from("job_tasks")
      .select("id, name, stage, kind, unit, visit, sort, progress, serial, model_read, source, hours")
      .eq("org_id", orgId)
      .eq("sm8_job_uuid", cardId)
      .order("sort", { ascending: true }),
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
    .select("id, task_id, document_id, role")
    .eq("org_id", orgId)
    .in("task_id", [...taskIds])
    .order("created_at", { ascending: true });
  const rows = (links ?? []) as { id: string; task_id: string; document_id: string; role: string }[];
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
    };
  });
}

/** One structured answer from Claude, the writer's model with its
    fallback; null when there's no key, no answer, or nothing readable. */
async function askClaude(
  request: { system?: string; content: Anthropic.Beta.Messages.BetaMessageParam["content"]; schema: unknown },
  client?: Anthropic
): Promise<unknown | null> {
  if (!client && !process.env.ANTHROPIC_API_KEY) return null;
  try {
    const response = await (client ?? new Anthropic()).beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: FALLBACK_MODEL }],
      output_config: { effort: "low", format: { type: "json_schema", schema: request.schema as Record<string, unknown> } },
      ...(request.system ? { system: request.system } : {}),
      messages: [{ role: "user", content: request.content }],
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
    const block = [...response.content].reverse().find((b) => b.type === "text");
    return block && block.type === "text" ? JSON.parse(block.text) : null;
  } catch (err) {
    console.error("[visit-tasks] Claude couldn't answer:", err);
    return null;
  }
}

/** A rating plate's model and serial, read from its photo; null when the
    photo can't be read or holds neither. */
export async function readPlate(storageRef: string, mime: string | null): Promise<{ model: string; serial: string } | null> {
  const { data: blob } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(storageRef);
  if (!blob) return null;
  const image = await imageForClaude(Buffer.from(await blob.arrayBuffer()), mime);
  if (!image) return null;
  const raw = await askClaude({
    content: [
      { type: "image", source: { type: "base64", media_type: image.mime, data: image.bytes.toString("base64") } },
      { type: "text", text: PLATE_PROMPT },
    ],
    schema: PLATE_SCHEMA,
  });
  return parsePlate(raw);
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

export type QuotePlan = {
  options: ProposalOption[];
  /** every option's labour, its own else the brief's, as visits */
  labour: Visit[];
  /** the labour in person-hours, as priced; null when nothing gives hours */
  hours: number | null;
  facts: string[];
  /** the same visits with the tasks the quote worked them out from (8.2);
      null when the quote has none to hand over */
  quoteVisits: QuoteVisit[] | null;
  dayHours: number | null;
};

/** The accepted options and their labour, option by option as the price is
    worked out: an option's own labour, else the brief's. Null when no option
    is accepted. */
export async function quotePlan(orgId: string, cardId: string): Promise<QuotePlan | null> {
  const [quote, labour] = await Promise.all([readJobQuote(orgId, cardId).catch(() => null), readQuoteLabour(orgId, cardId).catch(() => null)]);
  if (!quote) return null;
  const options = acceptedOptions(quote.draft);
  if (options.length === 0) return null;
  /* a quote built on its lines holds its hours as typed: no working day
     needed to tell them */
  const taken = quote.draft.accepted.length ? quote.draft.accepted : [0];
  const linesOwn = quote.lines ? taken.map((i) => linesHours(quote.lines!.filter((l) => l.optionIndex === i))) : null;
  const dayHours = labour?.dayHours ?? null;
  /* a brief's visit in hours, with no working day set, is still one visit */
  const brief: Visit[] = (labour?.brief?.visits ?? []).map((v) => ({
    stage: v.stage,
    people: v.people,
    days: v.days ?? (v.hours != null && dayHours ? v.hours / dayHours : 1),
  }));
  const each = options.map((o, i) => (o.labour?.visits.length ? { visits: o.labour.visits, own: true, typed: linesOwn?.[i] ?? null } : { visits: brief, own: false, typed: null }));
  const hoursOf = (e: (typeof each)[number]): number | null => {
    const personDays = e.visits.reduce((a, v) => a + v.people * v.days, 0);
    if (e.typed != null) return e.typed;
    if (!e.own && labour?.brief?.personHours != null) return labour.brief.personHours;
    return dayHours ? personDays * dayHours : null;
  };
  /* the tasks each accepted option's labour lines hold, line for visit */
  const tasksOwn = quote.lines ? taken.map((i) => labourTasks(quote.lines!.filter((l) => l.optionIndex === i))) : null;
  const quoteVisits: QuoteVisit[] = each.flatMap((e, k) => e.visits.map((v, j) => ({ ...v, tasks: (e.own && tasksOwn?.[k]?.[j]) || [] })));
  const hours = each.map(hoursOf).filter((h): h is number => h != null);
  const total = hours.length === each.length ? Math.round(hours.reduce((a, h) => a + h, 0) * 10) / 10 : null;
  return {
    options,
    labour: each.flatMap((e) => e.visits),
    hours: total && total > 0 ? total : null,
    facts: quote.draft.checklist.filter((i) => i.state === "known" && i.answer.trim()).map((i) => `${CHECKLIST[i.key].label}: ${i.answer.trim()}`),
    quoteVisits: quoteVisits.some((v) => v.tasks.length > 0) ? quoteVisits : null,
    dayHours,
  };
}

/** THE HOURS QUOTED: the labour in person-hours, with its crew and its
    visits, for the bar on Installation. Null when nothing gives hours. */
export function quotedHours(plan: QuotePlan | null): { hours: number; people: number; visits: number } | null {
  if (!plan || plan.hours == null || plan.labour.length === 0) return null;
  return { hours: plan.hours, people: Math.max(...plan.labour.map((v) => v.people)), visits: plannedVisits(plan.labour).length };
}

/** The accepted quote's tasks onto a job with none yet: the tasks its
    labour was worked out from, placed on its visits (tasksFromQuote), or,
    for a quote with none, the list Tiff writes from it — a paid call, never
    made when `quoteOnly` (an option being accepted). */
export async function makeTasksFromQuote(
  orgId: string,
  userId: string,
  cardId: string,
  opts: { client?: Anthropic; quoteOnly?: boolean } = {}
): Promise<{ ok: true; made: number } | { ok: false; reason: string }> {
  if ((await taskCount(orgId, cardId)) > 0) return { ok: false, reason: "This job already has its tasks." };
  const plan = await quotePlan(orgId, cardId);
  if (!plan) return { ok: false, reason: "No option is marked accepted on the quote yet." };
  const units = unitsOf(plan.options);
  let tasks = plan.quoteVisits ? tasksFromQuote(plan.quoteVisits, plan.dayHours, units) : [];
  if (tasks.length === 0) {
    if (opts.quoteOnly) return { ok: false, reason: "The quote has no tasks of its own." };
    if (!opts.client && !process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "Tiff is offline: no API key is configured." };
    const { data: job } = await supabaseAdmin.from("sm8_jobs").select("job_address").eq("org_id", orgId).eq("uuid", cardId).maybeSingle();
    const visits = plannedVisits(plan.labour);
    const site = (job as { job_address: string | null } | null)?.job_address ?? null;
    const raw = await askClaude({ system: TASKS_SYSTEM, content: tasksPrompt({ site, options: plan.options, facts: plan.facts, visits }), schema: TASKS_SCHEMA }, opts.client);
    tasks = parseTasks(raw, units, visits);
    if (tasks.length === 0) return { ok: false, reason: "Tiff couldn't write the tasks for this one. Add them yourself." };
  }
  /* asked again after the call: a second press, or a second manager, may
     have made them meanwhile */
  if ((await taskCount(orgId, cardId)) > 0) return { ok: false, reason: "This job already has its tasks." };
  const { error } = await supabaseAdmin.from("job_tasks").insert(
    tasks.map((t) => ({ org_id: orgId, sm8_job_uuid: cardId, name: t.name, stage: t.stage, kind: t.kind, unit: t.unit, visit: t.visit, sort: t.sort, hours: t.hours, source: "quote", created_by: userId }))
  );
  if (error) {
    console.error(`[visit-tasks] couldn't store job ${cardId}'s tasks:`, error);
    return { ok: false, reason: "The tasks couldn't be saved. Try again." };
  }
  return { ok: true, made: tasks.length };
}

/* ── a person's edits ── */

type TaskEdit =
  /** how far it's got today, with a note; 100 is done, 0 undoes it */
  | { kind: "progress"; id: string; to: number; note: string }
  | { kind: "visit"; id: string; visit: number | null }
  | { kind: "add"; name: string; stage: VisitStage; taskKind: TaskKind; visit: number | null }
  | { kind: "rename"; id: string; name: string }
  | { kind: "remove"; id: string }
  /** a photo uploaded onto the job, taken on this task; a plate's is read */
  | { kind: "photo"; id: string; documentId: string; role: TaskPhoto["role"] }
  /** a person's own model and serial, over what was read */
  | { kind: "plate"; id: string; model: string; serial: string };

/** Edits that change the list itself, not the work done on it. */
export const LIST_EDITS: ReadonlySet<TaskEdit["kind"]> = new Set(["visit", "add", "rename", "remove"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const visitIn = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 99 ? v : null);
const nameIn = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_TASK_NAME) : "");

/** A task's serials with one more read: a row of several identical units
    collects one each, comma between, never twice; a single unit's is the
    newest. `full`: a new serial on a row that already has all of its own. */
export function serialsWith(have: string | null, read: string, qty: number): { serials: string; full: boolean } {
  if (qty <= 1 || !have) return { serials: read, full: false };
  const list = have.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.includes(read)) return { serials: list.join(", "), full: false };
  return list.length >= qty ? { serials: list.join(", "), full: true } : { serials: [...list, read].join(", "), full: false };
}

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
      return name && stage ? { kind: "add", name, stage, taskKind: o.taskKind === "progress" ? "progress" : "tick", visit: visitIn(o.visit) } : null;
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
      return id
        ? { kind: "plate", id, model: plateCode(o.model), serial: (typeof o.serial === "string" ? o.serial : "").split(",").map(plateCode).filter(Boolean).join(", ") }
        : null;
    default:
      return null;
  }
}

const SAVE_FAILED = "That couldn't be saved. Try again.";

/** One edit, on this job's own task. `who` names the person for the
    update's line. `note`: done, with something to say. */
export async function applyTaskEdit(
  orgId: string,
  cardId: string,
  who: { userId: string; name: string | null },
  edit: TaskEdit,
  read: typeof readPlate = readPlate
): Promise<{ ok: true; note?: string } | { ok: false; reason: string }> {
  if (edit.kind === "add") {
    const count = await taskCount(orgId, cardId);
    if (count >= MAX_TASKS) return { ok: false, reason: `A job holds ${MAX_TASKS} tasks at most.` };
    const { error } = await supabaseAdmin.from("job_tasks").insert({
      org_id: orgId,
      sm8_job_uuid: cardId,
      name: edit.name,
      stage: edit.stage,
      kind: edit.taskKind,
      visit: edit.visit,
      sort: count + 1000,
      source: "person",
      created_by: who.userId,
    });
    return error ? { ok: false, reason: "The task couldn't be added. Try again." } : { ok: true };
  }

  const { data } = await supabaseAdmin.from("job_tasks").select("id, progress, unit, serial").eq("org_id", orgId).eq("sm8_job_uuid", cardId).eq("id", edit.id).maybeSingle();
  const row = data as { id: string; progress: number; unit?: TaskUnit | null; serial?: string | null } | null;
  if (!row) return { ok: false, reason: "That task isn't on this job any more." };
  const now = new Date().toISOString();
  /** the task's own row, changed */
  const patch = async (fields: Record<string, unknown>) =>
    !(await supabaseAdmin.from("job_tasks").update({ ...fields, updated_at: now }).eq("org_id", orgId).eq("id", edit.id)).error;

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
      if (logError || !logged) return { ok: false, reason: SAVE_FAILED };
      if (await patch({ progress: edit.to, done_at: done ? now : null, done_by: done ? who.name : null })) return { ok: true };
      await supabaseAdmin.from("job_task_updates").delete().eq("org_id", orgId).eq("id", (logged as { id: string }).id);
      return { ok: false, reason: SAVE_FAILED };
    }
    case "visit":
      return (await patch({ visit: edit.visit })) ? { ok: true } : { ok: false, reason: "That couldn't be moved. Try again." };
    case "rename":
      return (await patch({ name: edit.name })) ? { ok: true } : { ok: false, reason: "That couldn't be renamed. Try again." };
    case "remove": {
      const { error } = await supabaseAdmin.from("job_tasks").delete().eq("org_id", orgId).eq("sm8_job_uuid", cardId).eq("id", edit.id);
      return error ? { ok: false, reason: "That couldn't be taken off. Try again." } : { ok: true };
    }
    case "photo": {
      /* the photo is a landed job document on THIS job: the id is a choice
         the browser handed in */
      const { data: doc } = await supabaseAdmin
        .from("documents")
        .select("kind, sm8_job_uuid, uploaded_at, storage_ref, mime_type")
        .eq("org_id", orgId)
        .eq("id", edit.documentId)
        .maybeSingle();
      const d = doc as { kind: string; sm8_job_uuid: string | null; uploaded_at: string | null; storage_ref: string; mime_type: string | null } | null;
      if (!d || d.kind !== "job_document" || !d.uploaded_at || d.sm8_job_uuid !== cardId) return { ok: false, reason: "That photo didn't land on this job." };
      const { error } = await supabaseAdmin
        .from("job_task_photos")
        .upsert({ org_id: orgId, task_id: edit.id, document_id: edit.documentId, role: edit.role, created_by: who.userId }, { onConflict: "task_id,document_id" });
      if (error) return { ok: false, reason: "That photo couldn't be kept. Try again." };
      if (edit.role !== "plate") return { ok: true };
      /* the photo stays on the task either way; a plate that can't be read
         is typed in instead, and only what was read is written */
      const plate = await read(d.storage_ref, d.mime_type);
      if (!plate) return { ok: true, note: "The plate couldn't be read from that photo. Type the model and serial instead." };
      const qty = row.unit?.qty ?? 1;
      const serials = plate.serial ? serialsWith(row.serial ?? null, plate.serial, qty) : null;
      const fields: Record<string, unknown> = {};
      if (plate.model) fields.model_read = plate.model;
      if (serials && !serials.full) fields.serial = serials.serials;
      if (Object.keys(fields).length && !(await patch(fields))) return { ok: false, reason: SAVE_FAILED };
      return serials?.full ? { ok: true, note: `This row has its ${qty} serials. Change what was read to replace one with ${plate.serial}.` } : { ok: true };
    }
    case "plate":
      return (await patch({ model_read: edit.model || null, serial: edit.serial || null })) ? { ok: true } : { ok: false, reason: SAVE_FAILED };
  }
}
