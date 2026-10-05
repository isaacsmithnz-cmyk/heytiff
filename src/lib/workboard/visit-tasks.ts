import { VISIT_STAGES, type VisitStage } from "@/lib/quotes/buildup";
import { andList } from "@/lib/swms/library";

/* A JOB'S TASKS, BY VISIT (Isaac, 2026-10-06: "create a task list from the
   TIFF quote, which can then be allocated to visits, or they can just be
   viewed as a whole list… on day one or visit one… they can view the list
   of tasks… pipe work complete can be marked as percentages with a note,
   and they can carry through to the following day… tasks can move across
   visits as they are not completed on that day").

   A VISIT is a day on site, counted from 1 from the day the job became a
   work order: the days already worked, today, then the days booked ahead,
   then the visits the quote planned that aren't booked yet. A day on site
   before the work order (a site measure) is a site visit, not counted.

   A TASK is planned for a visit, or for none yet. Each day's work on it is
   an update: how far it went, and a note. A visit's card is the record of
   what was done that day — its updates — and the work still to do on it:
   the open tasks planned for it, and any not finished on an earlier visit,
   which carry to the first visit still to come. Nothing is rewritten to
   move a task; where it shows is worked out here, from what happened. Pure. */

export const TASK_KINDS = ["tick", "progress", "unit"] as const;
/** tick: done or not. progress: how far, with a note, over visits. unit: a
    unit to put in, with its photos and its plate read. */
export type TaskKind = (typeof TASK_KINDS)[number];

/** The quote's unit a unit task is for, as it stood when the task was made. */
export type TaskUnit = {
  role: "outdoor" | "indoor" | "fan";
  room: string;
  model: string;
  capacity: string;
  type: string;
  /** which accepted option it's in, counted from 0 (its systems are numbered within it) */
  option?: number;
  /** the outdoor unit it runs from (its own number, for an outdoor); 0 for a fan */
  system?: number;
  /** identical units in the same place: each has its own serial */
  qty?: number;
};

export type JobTask = {
  id: string;
  name: string;
  stage: VisitStage;
  kind: TaskKind;
  unit: TaskUnit | null;
  /** The visit it's planned for, counted from 1; null: not on a visit yet. */
  visit: number | null;
  sort: number;
  /** 0–100; 100 is done. */
  progress: number;
  serial: string | null;
  modelRead: string | null;
  source: "quote" | "person";
};

/** A photo taken on a task: the unit in place, its rating plate, or other. */
export type TaskPhoto = { id: string; taskId: string; role: "unit" | "plate" | "other"; url: string | null };
export const PHOTO_ROLES: readonly TaskPhoto["role"][] = ["unit", "plate", "other"];

/** One day's work on a task. `day` is the account's own date, YYYY-MM-DD. */
export type TaskUpdate = { id: string; taskId: string; day: string; from: number; to: number; note: string; by: string | null; at: string };

/** A visit: a day on site (done, today, booked) or one the quote planned
    that isn't booked yet (no day). */
export type VisitSlot = { n: number; day: string | null; state: "done" | "today" | "booked" | "planned" };

export const MAX_TASKS = 40;
export const MAX_TASK_NAME = 200;
export const MAX_NOTE = 500;

/** The job's visits, numbered: days on site and booked from the work
    order's day on, then the quote's planned visits beyond them. */
export function visitSlots(input: {
  days: readonly string[];
  today: string;
  /** The work order's day; days before it are site visits, not counted. */
  from: string | null;
  /** How many visits the tasks are planned over. */
  planned: number;
}): VisitSlot[] {
  const from = input.from ? input.from.slice(0, 10) : null;
  const days = [...new Set(input.days.map((d) => d.slice(0, 10)))].filter((d) => !from || d >= from).sort();
  const slots: VisitSlot[] = days.map((day, i) => ({ n: i + 1, day, state: day < input.today ? "done" : day === input.today ? "today" : "booked" }));
  for (let n = slots.length + 1; n <= input.planned; n++) slots.push({ n, day: null, state: "planned" });
  return slots;
}

/** The visit a day's work belongs to: the visit on that day, else the last
    one before it (work logged from the office the day after). */
export function visitOfDay(slots: readonly VisitSlot[], day: string): number | null {
  let best: VisitSlot | null = null;
  for (const s of slots) if (s.day && s.day <= day && (!best || s.day > best.day!)) best = s;
  return best?.n ?? null;
}

const still = (s: VisitSlot | undefined) => !!s && s.state !== "done";

/** The last note among some updates. */
const noteOf = (ups: readonly TaskUpdate[]) => {
  const u = [...ups].reverse().find((x) => x.note.trim());
  return u ? { by: u.by, text: u.note.trim() } : null;
};

type Facts = {
  task: JobTask;
  ups: TaskUpdate[];
  /** each visit's updates, in the order the visits were worked; a visit
      whose work cancels out (ticked, then unticked, no note) did nothing */
  byVisit: Map<number, TaskUpdate[]>;
  worked: number[];
  /** where it shows now, while it's open; null: not on a visit */
  shownOn: number | null;
  /** the visit it carries from, when it shows on a later one */
  from: number | null;
};

function factsOf(task: JobTask, ups: TaskUpdate[], slots: readonly VisitSlot[]): Facts {
  const byVisit = new Map<number, TaskUpdate[]>();
  for (const u of ups) {
    const v = visitOfDay(slots, u.day);
    if (v != null) byVisit.set(v, [...(byVisit.get(v) ?? []), u]);
  }
  for (const [v, mine] of byVisit) if (mine[0]!.from === mine[mine.length - 1]!.to && !noteOf(mine)) byVisit.delete(v);
  const worked = [...byVisit.keys()];
  const facts = { task, ups, byVisit, worked };
  if (task.progress >= 100) return { ...facts, shownOn: null, from: null };
  const last = worked.length ? worked[worked.length - 1]! : null;
  const planned = task.visit;
  /* planned for a visit still to come, and not carried past it */
  if (planned != null && still(slots.find((s) => s.n === planned)) && (last == null || planned >= last)) {
    return { ...facts, shownOn: planned, from: last != null && last < planned ? last : null };
  }
  if (planned == null && last == null) return { ...facts, shownOn: null, from: null };
  /* its visit has gone, or it was worked on later: the first visit to come */
  const fromN = last ?? planned!;
  const next = slots.find((s) => still(s) && s.n >= fromN);
  return { ...facts, shownOn: next?.n ?? null, from: next && next.n === fromN ? null : fromN };
}

/** Each task's updates, oldest first. */
function updatesByTask(updates: readonly TaskUpdate[]): Map<string, TaskUpdate[]> {
  const out = new Map<string, TaskUpdate[]>();
  for (const u of [...updates].sort((a, b) => a.at.localeCompare(b.at))) out.set(u.taskId, [...(out.get(u.taskId) ?? []), u]);
  return out;
}

type TaskMark = "done" | "part" | "open";
export type TaskLine = {
  task: JobTask;
  mark: TaskMark;
  pct: number;
  /** "50%" and where it went or came from; null for a plain open task */
  pctWords: string | null;
  meta: string | null;
  note: { by: string | null; text: string } | null;
  /** the day of the last work this line shows; null for work still to do */
  lastDay: string | null;
};

const markOf = (pct: number): TaskMark => (pct >= 100 ? "done" : pct > 0 ? "part" : "open");

/** Each visit's card — what was done on it, and what's still to do on it —
    and the tasks on no visit. */
export function placeTasks(
  tasks: readonly JobTask[],
  updates: readonly TaskUpdate[],
  slots: readonly VisitSlot[]
): { visits: { slot: VisitSlot; lines: TaskLine[] }[]; unplaced: TaskLine[] } {
  const upsOf = updatesByTask(updates);
  const visits = slots.map((slot) => ({ slot, lines: [] as TaskLine[] }));
  const at = (n: number) => visits.find((v) => v.slot.n === n);
  const unplaced: TaskLine[] = [];

  for (const task of [...tasks].sort((a, b) => a.sort - b.sort)) {
    const { byVisit, worked, shownOn, from } = factsOf(task, upsOf.get(task.id) ?? [], slots);
    /* what each visit did to it */
    worked.forEach((n, idx) => {
      const mine = byVisit.get(n)!;
      const first = mine[0]!;
      const last = mine[mine.length - 1]!;
      const before = idx > 0 ? worked[idx - 1]! : null;
      const after = idx < worked.length - 1 ? worked[idx + 1]! : shownOn != null && shownOn > n ? shownOn : null;
      const up = last.to - first.from;
      const words: string[] = [];
      if (before != null && first.from > 0 && up > 0) words.push(`Up ${up}% from visit ${before}`);
      if (last.to < 100 && after != null) words.push(`carried to visit ${after}`);
      /* worked on today and still going, it stays on this visit */
      else if (last.to < 100 && n !== shownOn) words.push("carries to the next visit");
      const joined = words.join(", ");
      at(n)?.lines.push({
        task,
        mark: markOf(last.to),
        pct: last.to,
        pctWords: last.to > 0 && last.to < 100 ? `${last.to}%` : null,
        meta: joined ? joined[0]!.toUpperCase() + joined.slice(1) : null,
        note: noteOf(mine),
        lastDay: last.day,
      });
    });
    /* still to do: on the visit it shows on, unless that visit already
       drew it from the day's own work */
    if (task.progress < 100) {
      const line: TaskLine = {
        task,
        mark: markOf(task.progress),
        pct: task.progress,
        pctWords: task.progress > 0 ? `${task.progress}%` : null,
        meta: from != null ? `From visit ${from}` : null,
        note: null,
        lastDay: null,
      };
      if (shownOn == null) unplaced.push(line);
      else if (!worked.includes(shownOn)) at(shownOn)?.lines.push(line);
    } else if (worked.length === 0) {
      /* done with no day's work on record (ticked before any visit) */
      const line: TaskLine = { task, mark: "done", pct: 100, pctWords: null, meta: null, note: null, lastDay: null };
      const v = task.visit != null ? at(task.visit) : undefined;
      if (v) v.lines.push(line);
      else unplaced.push(line);
    }
  }
  return { visits, unplaced };
}

/* ── the whole list ── */

export type TaskRow = {
  task: JobTask;
  mark: TaskMark;
  pct: number;
  /** "Visit 2", "Visits 1, 2 and 3"; null: not on a visit */
  visits: string | null;
  status: { text: string; tone: "ok" | "info" | "quiet" | "ink" } | null;
  note: { by: string | null; text: string } | null;
};

/** Every task, in the quote's order of work, each with the visits it's on
    and where it stands. `dayWords` turns a booked day into "Mon 12 Oct". */
export function taskRows(
  tasks: readonly JobTask[],
  updates: readonly TaskUpdate[],
  slots: readonly VisitSlot[],
  dayWords: (day: string) => string
): { stage: VisitStage; rows: TaskRow[] }[] {
  const upsOf = updatesByTask(updates);
  const ordered = [...tasks].sort((a, b) => VISIT_STAGES.indexOf(a.stage) - VISIT_STAGES.indexOf(b.stage) || a.sort - b.sort);
  const groups: { stage: VisitStage; rows: TaskRow[] }[] = [];
  for (const task of ordered) {
    const ups = upsOf.get(task.id) ?? [];
    const f = factsOf(task, ups, slots);
    const ns = [...f.worked];
    if (f.shownOn != null && !ns.includes(f.shownOn)) ns.push(f.shownOn);
    if (task.progress >= 100 && ns.length === 0 && task.visit != null) ns.push(task.visit);
    const visits = ns.length === 0 ? null : ns.length === 1 ? `Visit ${ns[0]}` : `Visits ${andList(ns.map(String))}`;
    const slot = f.shownOn != null ? slots.find((s) => s.n === f.shownOn) : undefined;
    const status: TaskRow["status"] =
      task.progress >= 100
        ? { text: "Done", tone: "ok" }
        : task.progress > 0
          ? { text: `${task.progress}%`, tone: "ink" }
          : slot?.state === "today"
            ? { text: "Today", tone: "info" }
            : slot?.state === "booked" && slot.day
              ? { text: dayWords(slot.day), tone: "quiet" }
              : slot?.state === "planned"
                ? { text: "Not booked", tone: "quiet" }
                : null;
    const row: TaskRow = { task, mark: markOf(task.progress), pct: task.progress, visits, status, note: noteOf(ups) };
    const g = groups.find((x) => x.stage === task.stage);
    if (g) g.rows.push(row);
    else groups.push({ stage: task.stage, rows: [row] });
  }
  return groups;
}

/** How many are done, of how many. */
export function doneCount(tasks: readonly JobTask[]): { done: number; of: number } {
  return { done: tasks.filter((t) => t.progress >= 100).length, of: tasks.length };
}
