/* A LABOUR LINE'S TASKS (slice 8.2; Isaac, 2026-10-09: "displaying the list
   of tasks will help both tiff and the user to figure out the correct
   labour… those tasks then get put straight on to the job").

   A labour line Tiff works out task by task is one visit: its stage, who's
   on it, the working day it was planned on, and every task with its
   person-hours. The tasks are the line's own record, not words in its why:
   a person changes an hour or adds a task on the quote, the line's hours
   and its days follow, and the same tasks go onto the job when the quote
   is accepted.

   A task a person changed keeps the hours Tiff had (`was`); a task a person
   added has none and is theirs. Pure. */

export type LineTask = {
  task: string;
  hours: number;
  /** Tiff's hours, when a person changed them */
  was: number | null;
  /** a person changed or added it */
  byHand: boolean;
};

export type LineVisit = {
  stage: string;
  people: number;
  /** the working day the days were counted on; null when the business hasn't set one */
  dayHours: number | null;
  tasks: LineTask[];
};

export const MAX_TASKS = 40;
export const MAX_TASK = 80;
export const MAX_STAGE = 60;
/** a task's person-hours: a typo's ceiling, not a guide */
export const MAX_TASK_HOURS = 200;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
/** to the quarter hour */
const quarter = (n: number) => Math.round(n * 4) / 4;
const halfOf = (n: number) => Math.round(n * 2) / 2;

/** A task made safe; null when it can't be one (no name, no hours). */
function taskOf(raw: unknown): LineTask | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const task = text(o.task, MAX_TASK);
  const hours = num(o.hours);
  if (!task || hours == null || !(hours > 0)) return null;
  const was = num(o.was);
  return {
    task,
    hours: Math.min(MAX_TASK_HOURS, Math.max(0.25, quarter(hours))),
    was: was != null && was > 0 ? Math.min(MAX_TASK_HOURS, quarter(was)) : null,
    byHand: o.byHand === true,
  };
}

/** A visit as stored or given, made safe; null when it isn't one. */
export function visitOf(raw: unknown): LineVisit | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const stage = text(o.stage, MAX_STAGE);
  const people = num(o.people);
  if (!stage || people == null || people < 1 || people > 12) return null;
  const day = num(o.dayHours);
  const tasks = (Array.isArray(o.tasks) ? o.tasks : [])
    .slice(0, MAX_TASKS)
    .map(taskOf)
    .filter((t): t is LineTask => !!t);
  if (tasks.length === 0) return null;
  return { stage, people: Math.round(people), dayHours: day != null && day > 0 && day <= 24 ? day : null, tasks };
}

/** Every person's hours on the visit, added up. */
export const visitHours = (v: LineVisit) => quarter(v.tasks.reduce((n, t) => n + t.hours, 0));

/** How many days the crew is there, to the half day; null with no working day. */
export function visitDays(v: LineVisit): number | null {
  if (!v.dayHours) return null;
  return Math.max(0.5, halfOf(visitHours(v) / v.people / v.dayHours));
}

const daysWords = (d: number) => (d <= 0.5 ? "half a day" : d === 1 ? "1 day" : `${d} days`);
const crewWords = (people: number) => `${people} ${people === 1 ? "person" : "people"}`;

/** The line's name: the stage, its crew, and how long they're there. */
export function visitName(v: LineVisit): string {
  const days = visitDays(v);
  return `${v.stage}: ${crewWords(v.people)}${days != null ? `, ${daysWords(days)}` : ""}`;
}

/** The footer's words: the hours, and who for how long. */
export function visitSummary(v: LineVisit): string {
  const days = visitDays(v);
  return `${visitHours(v)} h${days != null ? `, ${crewWords(v.people)} for ${days === 0.5 ? "half a day" : `${days} ${days === 1 ? "day" : "days"}`}` : `, ${crewWords(v.people)}`}`;
}

/** Two visits the same, task for task. */
export function sameVisit(a: LineVisit | null | undefined, b: LineVisit | null | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** A task's hours changed by a person: Tiff's hours kept, the first time. */
export function withHours(v: LineVisit, i: number, hours: number): LineVisit {
  return {
    ...v,
    tasks: v.tasks.map((t, j) => (j !== i || t.hours === hours ? t : { ...t, hours, byHand: true, was: t.byHand ? t.was : t.hours })),
  };
}

/** A task a person added, at the end. */
export const withTask = (v: LineVisit, task: string, hours: number): LineVisit => ({ ...v, tasks: [...v.tasks, { task, hours, was: null, byHand: true }] });

/** A task taken off. */
export const withoutTask = (v: LineVisit, i: number): LineVisit => ({ ...v, tasks: v.tasks.filter((_, j) => j !== i) });

const keyOf = (stage: string, task: string) => `${stage.toLowerCase()}|${task.toLowerCase()}`;

/** Tiff working the labour out again keeps what people did to it: a task's
    hours a person changed stay theirs (her new hours become its `was`), and
    a task a person added stays on its stage's visit (else the first). */
export function keepPeoplesTasks(next: LineVisit[], before: LineVisit[]): LineVisit[] {
  if (next.length === 0) return next;
  const changed = new Map<string, LineTask>();
  const added: { stage: string; task: LineTask }[] = [];
  for (const v of before)
    for (const t of v.tasks) {
      if (!t.byHand) continue;
      if (t.was != null) changed.set(keyOf(v.stage, t.task), t);
      else added.push({ stage: v.stage, task: t });
    }
  const out = next.map((v) => ({
    ...v,
    tasks: v.tasks.map((t) => {
      const mine = changed.get(keyOf(v.stage, t.task));
      return mine && mine.hours !== t.hours ? { ...t, hours: mine.hours, was: t.hours, byHand: true } : t;
    }),
  }));
  for (const a of added) {
    const v = out.find((x) => x.stage.toLowerCase() === a.stage.toLowerCase()) ?? out[0]!;
    if (v.tasks.length < MAX_TASKS && !v.tasks.some((t) => t.task.toLowerCase() === a.task.task.toLowerCase())) v.tasks.push(a.task);
  }
  return out;
}
