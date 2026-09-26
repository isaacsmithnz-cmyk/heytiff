import { supabaseAdmin } from "@/lib/supabase-server";
import type { Capability } from "@/lib/permissions";
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { sm8Roster } from "@/lib/workboard/job-notes-query";
import { quotedNote } from "@/lib/workboard/sm8-mentions";
import { handleWords } from "./diary-feed";
import { issueWhere } from "./issues";
import { isDelegated, sortTasks } from "./tasks";
import { TASK_COLUMNS, toTask, type StaffNames } from "./tasks-query";
import { asTargetKind, targetWords } from "./target-words";
import { TASK_EVENT_KINDS, missingTable, type TaskEventKind } from "./task-events";
import type { TaskDoneLines } from "./task-done-query";
import {
  jobLabelOf,
  momentOf,
  sm8Moment,
  typedAbout,
  type RecordTask,
  type TaskAbout,
  type TaskEvent,
  type TaskJob,
  type TaskRecord,
} from "./task-record";

/* THE TASKS FACE — the reads. The words are ./task-record; this file fetches
   the tasks and what the face says about each.

   One door, `loadTasksFace(ctx)`, for the new Home's loader (desk-data's
   `loadDesk`, behind HOME_DESK). It reads its own tasks rather than taking
   the old Home's: `loadDesk` runs inside the same batch as today's
   `loadTasks`, so neither can wait for the other, and the face wants three
   columns and a Done list today's Home never read. For a manager that is
   one read of the org's open tasks, the same read `teamTasks` makes.

     open    yours, and with `team` the team's delegated work — the same set
             today's Tasks face shows (its own mine + team's others).
     done    what you finished, what you handed out and came back finished,
             and what you ticked: done in the last 90 days, newest first, at
             most 100 (`doneTaskRecord`).
     about   where each came from and what happened to it since, in four
             reads side by side, then the names of what they point at:
               (a) the diary entry that made it — `workboard_notes`, applied,
                   whose `applied.taskIds` holds the task;
               (b) the ServiceM8 note it came off — `job_note_actions`;
               (c) the project whose defects period made it — `projects`;
               (d) its `task_events`.
             (b) and (c), and everything that names a job, a visit, an
             agreement or a project, are the board's, and are read only
             with `workboard`.

   NO SESSION HERE: the loader hands in what the viewer may see.

   THEIR OWN WORDS. A diary entry's words come back only to its author —
   journal-query's rule: nobody reads someone else's diary, and a task Tiff
   made for Luke from Isaac's diary tells Luke where it came from, never what
   Isaac said. A ServiceM8 note comes back quoted the way the diary quotes
   one (sm8-mentions' `quotedNote`): the handles it opens with, and the
   viewer's own, are who it was to and go; every other handle ServiceM8
   knows is said by name, by the diary's own rule (`handleWords`); an
   unknown @word, and so an email address, stays as written. */

/** What the Tasks face needs from the page loader — a part of the new Home's
    shared context (`DeskContext`, ./desk-data), so that context can be
    handed in as it is. */
export type TasksFaceContext = {
  orgId: string;
  viewerStaffId: string | null;
  caps: ReadonlySet<Capability>;
  names: StaffNames;
  /** Which ServiceM8 person the viewer is, so a quoted note leaves out the
      handle it addressed them by. */
  mineUuid?: string | null;
};

/** How far back Done reaches, and how much of it: Isaac's "every task" read
    as the last 90 days, up to 100 (the spec's call; the table is empty
    today, so it only matters later). */
export const DONE_DAYS = 90;
export const DONE_LIMIT = 100;

/** `.in()` rides in the URL; keep it short. */
const CHUNK = 100;
/** One `.or()` condition per task, each about sixty characters. */
const NOTE_CHUNK = 40;

/* Every id this file puts inside a filter string is one of our own uuids,
   read from our own rows. Checked anyway: a filter is built by joining text,
   and a comma or a bracket in it would change what it asks. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RECORD_COLUMNS = `${TASK_COLUMNS}, acknowledged_at`;

type Rec = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/* A FAILED READ OF WHERE A TASK CAME FROM IS NOT ONLY QUIETER. The face
   still renders, but a task whose diary entry, ServiceM8 note or project
   could not be read falls through to typed ("Isaac typed it."), and one
   whose events could not be read dates its hand-over to the day it was
   made. So each of the four reads says in the log when it failed; a page
   that tells somebody something wrong leaves a line saying why. The one
   failure that is expected, task_events before its migration runs, stays
   quiet. */
type ReadError = { code?: unknown; message?: unknown } | null;
function readFailed(what: string, error: ReadError): void {
  if (!error) return;
  console.warn(`tasks face: ${what} not read, so the record may be wrong: ${String(error.message ?? error.code)}`);
}

function toRecordTask(r: Rec, names: StaffNames): RecordTask {
  const name = (id: string) => names.get(id) ?? "Unnamed";
  const t = toTask(r, name);
  return {
    ...t,
    createdByName: t.createdBy ? name(t.createdBy) : null,
    doneById: str(r.done_by),
    acknowledgedAt: str(r.acknowledged_at),
  };
}

/** The Tasks face's data, for the new Home's loader. */
export async function loadTasksFace(ctx: TasksFaceContext, now: Date = new Date()): Promise<TaskRecord> {
  const viewer = ctx.viewerStaffId;
  const canManage = ctx.caps.has("team");
  const [open, done] = await Promise.all([
    openTaskRecord(ctx.orgId, viewer, canManage, ctx.names),
    viewer ? doneTaskRecord(ctx.orgId, viewer, ctx.names, now) : Promise.resolve({ done: [], capped: false }),
  ]);
  const tasks = [...open, ...done.done];
  const about = await taskAbout(ctx.orgId, viewer, tasks, ctx.caps.has("workboard"), ctx.mineUuid ?? null);
  return { open, done: done.done, doneCapped: done.capped, about, people: peopleOf(ctx.names, tasks, about) };
}

const NO_LINES: TaskDoneLines = { lines: {}, sender: null };

/** Where each of the face's tasks stands with ServiceM8 — its Done, or the
    reply that closed it (two-way phase 2, PR C; ./task-done-query) — read
    for the tasks THIS face holds, which reach back 90 days where today's
    Tasks face holds five done. Nothing is read, and the module is not even
    loaded, until the deployment sends notes; nor without the Workboard, a
    Done being a note on a job; nor for somebody with no staff card, who
    ticks nothing. A read that fails draws no line and keeps the page. */
export async function loadTaskLines(ctx: TasksFaceContext, record: Pick<TaskRecord, "open" | "done">): Promise<TaskDoneLines> {
  const viewer = ctx.viewerStaffId;
  if (!viewer || !ctx.caps.has("workboard") || !sm8NotesAllowed()) return NO_LINES;
  const ids = [...record.open, ...record.done].map((t) => t.id);
  if (ids.length === 0) return NO_LINES;
  const { readTaskDoneLines } = await import("./task-done-query");
  return readTaskDoneLines(ctx.orgId, viewer, ids).catch(() => NO_LINES);
}

/** Open tasks: yours, and with `team` everyone else's DELEGATED work — a
    to-do someone wrote for themselves stays theirs (./tasks-query's
    `teamTasks` rule). Most urgent first. */
export async function openTaskRecord(
  orgId: string,
  viewer: string | null,
  canManage: boolean,
  names: StaffNames,
): Promise<RecordTask[]> {
  if (!canManage && !viewer) return [];
  let q = supabaseAdmin.from("tasks").select(RECORD_COLUMNS).eq("org_id", orgId).eq("status", "open");
  if (!canManage) q = q.eq("assigned_to", viewer!);
  const { data } = await q;
  const rows = ((data ?? []) as Rec[]).map((r) => toRecordTask(r, names));
  return sortTasks(rows.filter((t) => (!!viewer && t.assigneeId === viewer) || (canManage && isDelegated(t))));
}

/** Done in the last 90 days that the viewer had a hand in: assigned it,
    made it, or ticked it. Newest first; `capped` when the limit bit. */
export async function doneTaskRecord(
  orgId: string,
  viewer: string,
  names: StaffNames,
  now: Date = new Date(),
): Promise<{ done: RecordTask[]; capped: boolean }> {
  if (!UUID.test(viewer)) return { done: [], capped: false };
  const since = new Date(now.getTime() - DONE_DAYS * 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from("tasks")
    .select(RECORD_COLUMNS)
    .eq("org_id", orgId)
    .eq("status", "done")
    .gte("done_at", since)
    .or(`assigned_to.eq.${viewer},created_by.eq.${viewer},done_by.eq.${viewer}`)
    .order("done_at", { ascending: false })
    .limit(DONE_LIMIT);
  const rows = (data ?? []) as Rec[];
  return { done: rows.map((r) => toRecordTask(r, names)), capped: rows.length >= DONE_LIMIT };
}

/* ── where each came from ── */

type DiaryNote = {
  id: string;
  authorId: string | null;
  spoken: boolean;
  transcript: string;
  createdAt: string;
  targetKind: string;
  targetId: string | null;
  taskIds: string[];
};

type NoteAction = { taskId: string; noteUuid: string; jobUuid: string | null; actedBy: string | null; actedAt: string | null };

type DefectsProject = { taskId: string; id: string; name: string | null; clientName: string | null };

/** Reads `ids` in chunks, side by side, and puts the answers back together. */
async function chunked<T>(ids: readonly string[], size: number, read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const parts: string[][] = [];
  for (let i = 0; i < ids.length; i += size) parts.push(ids.slice(i, i + size));
  return (await Promise.all(parts.map(read))).flat();
}

/** The ids a capture recorded under `taskIds` — journal-query's reading. */
function appliedTaskIds(applied: unknown): string[] {
  if (!applied || typeof applied !== "object") return [];
  const v = (applied as Rec).taskIds;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

/** (a) The diary entries that made these tasks. JSON containment on
    `applied->taskIds`, one condition per task: PostgREST reads
    `cs.["<id>"]` on a jsonb path as `@> '["<id>"]'`. The request this
    sends is written out in task_events.sql's header, to be run against
    production before merging: if PostgREST turned the filter down, every
    diary task would read as typed, and only the log would say so. */
async function diaryNotesFor(orgId: string, ids: readonly string[]): Promise<DiaryNote[]> {
  const safe = ids.filter((id) => UUID.test(id));
  return chunked(safe, NOTE_CHUNK, async (chunk) => {
    const { data, error } = await supabaseAdmin
      .from("workboard_notes")
      .select("id, author_id, source, transcript, created_at, target_kind, target_id, applied")
      .eq("org_id", orgId)
      .eq("status", "applied")
      .or(chunk.map((id) => `applied->taskIds.cs.${JSON.stringify([id])}`).join(","));
    readFailed("the diary entries that made tasks (workboard_notes)", error);
    return ((data ?? []) as Rec[]).map((r) => ({
      id: String(r.id),
      authorId: str(r.author_id),
      spoken: r.source === "voice",
      transcript: typeof r.transcript === "string" ? r.transcript : "",
      createdAt: String(r.created_at),
      targetKind: String(r.target_kind ?? "none"),
      targetId: str(r.target_id),
      taskIds: appliedTaskIds(r.applied),
    }));
  });
}

/** (b) The ServiceM8 notes these tasks were made from. */
async function noteActionsFor(orgId: string, ids: readonly string[]): Promise<NoteAction[]> {
  return chunked(ids, CHUNK, async (chunk) => {
    const { data, error } = await supabaseAdmin
      .from("job_note_actions")
      .select("task_id, sm8_note_uuid, sm8_job_uuid, acted_by, acted_at")
      .eq("org_id", orgId)
      .eq("action", "task")
      .in("task_id", chunk);
    readFailed("the ServiceM8 notes that made tasks (job_note_actions)", error);
    return ((data ?? []) as Rec[]).map((r) => ({
      taskId: String(r.task_id),
      noteUuid: String(r.sm8_note_uuid),
      jobUuid: str(r.sm8_job_uuid),
      actedBy: str(r.acted_by),
      actedAt: str(r.acted_at),
    }));
  });
}

/** (c) The projects whose defects period made these tasks. */
async function defectsProjectsFor(orgId: string, ids: readonly string[]): Promise<DefectsProject[]> {
  return chunked(ids, CHUNK, async (chunk) => {
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("id, name, client_name, defects_task_id")
      .eq("org_id", orgId)
      .in("defects_task_id", chunk);
    readFailed("the projects whose defects period made tasks (projects)", error);
    return ((data ?? []) as Rec[]).map((r) => ({
      taskId: String(r.defects_task_id),
      id: String(r.id),
      name: str(r.name),
      clientName: str(r.client_name),
    }));
  });
}

const KINDS: ReadonlySet<string> = new Set(TASK_EVENT_KINDS);

/** (d) What happened to these tasks, oldest first. A missing table (before
    task_events.sql runs) is no events, and so is any failed read; the
    first is expected and quiet, the second goes in the log (see
    `readFailed`). */
async function eventsFor(orgId: string, ids: readonly string[]): Promise<Map<string, TaskEvent[]>> {
  const rows = await chunked(ids, CHUNK, async (chunk) => {
    /* A failed read answers with no data, which is no events. */
    const { data, error } = await supabaseAdmin
      .from("task_events")
      .select("task_id, kind, by_staff, at, due_from, due_to, from_staff, to_staff")
      .eq("org_id", orgId)
      .in("task_id", chunk)
      .order("at", { ascending: true });
    if (!missingTable((error as ReadError)?.code)) readFailed("what happened to tasks (task_events)", error);
    return (data ?? []) as Rec[];
  });
  const out = new Map<string, TaskEvent[]>();
  for (const r of rows) {
    if (!KINDS.has(String(r.kind))) continue;
    const taskId = String(r.task_id);
    const list = out.get(taskId) ?? [];
    list.push({
      kind: String(r.kind) as TaskEventKind,
      at: String(r.at),
      by: str(r.by_staff),
      dueFrom: r.due_from ? String(r.due_from).slice(0, 10) : null,
      dueTo: r.due_to ? String(r.due_to).slice(0, 10) : null,
      from: str(r.from_staff),
      to: str(r.to_staff),
    });
    out.set(taskId, list);
  }
  /* The chunks came back side by side, each in order; put them in one. */
  for (const list of out.values()) list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return out;
}

/** Where every task came from and what happened to it since. */
export async function taskAbout(
  orgId: string,
  viewer: string | null,
  tasks: readonly RecordTask[],
  board: boolean,
  mineUuid: string | null = null,
): Promise<Record<string, TaskAbout>> {
  const ids = [...new Set(tasks.map((t) => t.id))];
  if (ids.length === 0) return {};

  const [notes, actions, projects, events] = await Promise.all([
    diaryNotesFor(orgId, ids),
    board ? noteActionsFor(orgId, ids) : Promise.resolve([] as NoteAction[]),
    board ? defectsProjectsFor(orgId, ids) : Promise.resolve([] as DefectsProject[]),
    eventsFor(orgId, ids),
  ]);

  const wanted = new Set(ids);
  const noteOf = new Map<string, DiaryNote>();
  for (const n of notes) for (const id of n.taskIds) if (wanted.has(id) && !noteOf.has(id)) noteOf.set(id, n);
  const actionOf = new Map(actions.map((a) => [a.taskId, a]));
  const projectOf = new Map(projects.map((p) => [p.taskId, p]));

  /* Then what those point at, side by side: the ServiceM8 notes (and after
     them their writers), the jobs, and the words for any other target. All
     of it is the board's. */
  const noteUuids = [...new Set(actions.map((a) => a.noteUuid))];
  const jobUuids = [
    ...new Set([
      ...actions.map((a) => a.jobUuid).filter((x): x is string => !!x),
      ...[...noteOf.values()].filter((n) => asTargetKind(n.targetKind) === "job" && n.targetId).map((n) => n.targetId!),
    ]),
  ];
  const others = [...noteOf.values()].filter(
    (n) => n.targetId && ["visit", "agreement", "project"].includes(asTargetKind(n.targetKind)),
  );
  const [sm8Notes, jobs, where] = board
    ? await Promise.all([
        sm8NotesFor(orgId, noteUuids, mineUuid),
        sm8JobsFor(orgId, jobUuids),
        others.length
          ? targetWords(
              orgId,
              others.map((n) => ({ key: n.id, target_kind: n.targetKind, target_id: n.targetId })),
            )
          : Promise.resolve(new Map<string, string>()),
      ])
    : [new Map<string, Sm8Note>(), new Map<string, string>(), new Map<string, string>()];

  const out: Record<string, TaskAbout> = {};
  for (const id of ids) {
    const evts = events.get(id) ?? [];
    const action = actionOf.get(id);
    const note = noteOf.get(id);
    const project = projectOf.get(id);

    if (action) {
      const sm8 = sm8Notes.get(action.noteUuid);
      out[id] = {
        ...typedAbout(evts),
        source: "sm8",
        sm8NoteUuid: action.noteUuid,
        askerName: sm8?.author ?? null,
        actedBy: action.actedBy,
        said: sm8Moment(sm8?.createDate) ?? momentOf(action.actedAt),
        words: sm8?.text || null,
        job: jobDoor(action.jobUuid, jobs),
      };
    } else if (note) {
      const kind = asTargetKind(note.targetKind);
      const job: TaskJob | null =
        kind === "job"
          ? jobDoor(note.targetId, jobs)
          : where.has(note.id)
            ? { label: where.get(note.id)!, uuid: null }
            : null;
      out[id] = {
        ...typedAbout(evts),
        source: "diary",
        noteId: note.id,
        authorId: note.authorId,
        spoken: note.spoken,
        said: momentOf(note.createdAt),
        words: viewer && note.authorId === viewer ? note.transcript || null : null,
        job,
      };
    } else if (project) {
      const label = issueWhere({ clientName: project.clientName, label: project.name });
      out[id] = {
        ...typedAbout(evts),
        source: "project",
        project: project.name,
        job: label ? { label, uuid: null } : null,
      };
    } else {
      out[id] = typedAbout(evts);
    }
  }
  return out;
}

/** A ServiceM8 job as the Job fact: its label and the door to its card, or
    nothing when the mirror no longer holds it. */
function jobDoor(uuid: string | null, labels: ReadonlyMap<string, string>): TaskJob | null {
  const label = uuid ? labels.get(uuid) : undefined;
  return uuid && label ? { label, uuid } : null;
}

type Sm8Note = { text: string; author: string | null; createDate: string | null };

/** The ServiceM8 notes, quoted as the diary quotes them, with their writers
    named as ServiceM8 spells them — the same "First Last" the job card's
    strip names them by. The roster is every handle there is (sm8Roster, the
    one read the diary and the job card name people from), read beside the
    notes rather than after them. */
async function sm8NotesFor(
  orgId: string,
  uuids: readonly string[],
  mineUuid: string | null,
): Promise<Map<string, Sm8Note>> {
  const out = new Map<string, Sm8Note>();
  if (uuids.length === 0) return out;
  const [rows, people] = await Promise.all([
    chunked(uuids, CHUNK, async (chunk) => {
      const { data } = await supabaseAdmin
        .from("sm8_job_notes")
        .select("uuid, note, edit_by_staff_uuid, create_date")
        .eq("org_id", orgId)
        .in("uuid", chunk);
      return (data ?? []) as Rec[];
    }),
    sm8Roster(orgId),
  ]);
  const byUuid = new Map(people.map((p) => [p.uuid, p]));
  const names = handleWords(people);
  const me = mineUuid ? byUuid.get(mineUuid) : undefined;
  const addressing = me ? [me.handle] : [];
  for (const r of rows) {
    const by = str(r.edit_by_staff_uuid);
    out.set(String(r.uuid), {
      text: quotedNote(typeof r.note === "string" ? r.note : "", { names, addressing }),
      author: (by && byUuid.get(by)?.name) || null,
      createDate: str(r.create_date),
    });
  }
  return out;
}

/** job uuid → "2041 Wollstonecraft", for the jobs the mirror holds. */
async function sm8JobsFor(orgId: string, uuids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (uuids.length === 0) return out;
  const rows = await chunked(uuids, CHUNK, async (chunk) => {
    const { data } = await supabaseAdmin
      .from("sm8_jobs")
      .select("uuid, generated_job_id, geo_city")
      .eq("org_id", orgId)
      .in("uuid", chunk);
    return (data ?? []) as Rec[];
  });
  for (const r of rows) {
    const label = jobLabelOf(str(r.generated_job_id), str(r.geo_city));
    if (label) out.set(String(r.uuid), label);
  }
  return out;
}

/** staff id → display name, for every person the record names, and nobody
    else: the face gets the names it prints, not the staff list. */
function peopleOf(names: StaffNames, tasks: readonly RecordTask[], about: Record<string, TaskAbout>): Record<string, string> {
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (id) ids.add(id);
  };
  for (const t of tasks) {
    add(t.assigneeId);
    add(t.createdBy);
    add(t.doneById);
  }
  for (const a of Object.values(about)) {
    add(a.authorId);
    add(a.actedBy);
    for (const e of a.events) {
      add(e.by);
      add(e.from);
      add(e.to);
    }
  }
  const out: Record<string, string> = {};
  for (const id of ids) {
    const name = names.get(id);
    if (name) out[id] = name;
  }
  return out;
}
