import { VISIT_STAGES, type VisitStage } from "@/lib/quotes/buildup";

/* WHAT GOT DONE, AND HOW FAR THE QUOTE IS (Isaac, 11 November 2026: "Looking
   at the tasks that are created from quotes. They should help decide",
   "the worked out tasks and quotes should be able to decide that"; boards 9
   and 10 of https://claude.ai/artifact/ESTib5qakLMfgTXmUW9vCy v4, "Build
   from mocks approved"). Pure.

   - The tasks to tick in the wrap-up: the visit's own (job_tasks.visit, as
     the quote planned them) and any left from the visits before; with no
     visit to go by, what's left of the first stage not finished.
   - From the quote: the stage's quoted hours done (each task's hours times
     how far it got), the job's, and which visit of how many. By quoted
     hours, never a count: a 20-hour rough-in isn't one tick. */

export type WrapTask = { id: string; name: string; stage: VisitStage; visit: number | null; progress: number; hours: number | null };
export type FromQuote = {
  stage: VisitStage;
  stageDone: number;
  stageQuoted: number;
  jobDone: number;
  jobQuoted: number;
  visit: number | null;
  visits: number;
};

const order = (a: WrapTask, b: WrapTask) => VISIT_STAGES.indexOf(a.stage) - VISIT_STAGES.indexOf(b.stage);
const done = (t: WrapTask) => (t.hours ?? 0) * (Math.min(100, Math.max(0, t.progress)) / 100);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The visit a day is, counted from 1 by the days booked on the job up to it; null when the job has none. */
export function visitOn(bookedDays: readonly string[], day: string): number | null {
  const days = [...new Set(bookedDays.map((d) => d.slice(0, 10)))].filter((d) => d <= day).sort();
  return days.length ? days.length : null;
}

/** The tasks the wrap-up shows to tick. */
export function tasksToTick(tasks: readonly WrapTask[], visit: number | null): WrapTask[] {
  if (visit !== null) {
    const mine = tasks.filter((t) => t.visit !== null && (t.visit === visit || (t.visit < visit && t.progress < 100)));
    if (mine.length) return [...mine].sort(order);
  }
  const open = [...tasks].sort(order).find((t) => t.progress < 100);
  return open ? tasks.filter((t) => t.stage === open.stage) : [];
}

/** How far the quote is: the stage being worked, and the job. Null when no task has quoted hours. */
export function fromQuote(tasks: readonly WrapTask[], visit: number | null, shown: readonly WrapTask[]): FromQuote | null {
  const quoted = tasks.filter((t) => (t.hours ?? 0) > 0);
  if (quoted.length === 0) return null;
  const counts = new Map<VisitStage, number>();
  for (const t of shown) counts.set(t.stage, (counts.get(t.stage) ?? 0) + 1);
  const stage =
    [...counts.entries()].sort((a, b) => b[1] - a[1] || VISIT_STAGES.indexOf(a[0]) - VISIT_STAGES.indexOf(b[0]))[0]?.[0] ??
    [...quoted].sort(order).find((t) => t.progress < 100)?.stage ??
    quoted[quoted.length - 1]!.stage;
  const inStage = quoted.filter((t) => t.stage === stage);
  return {
    stage,
    stageDone: round1(inStage.reduce((s, t) => s + done(t), 0)),
    stageQuoted: round1(inStage.reduce((s, t) => s + (t.hours ?? 0), 0)),
    jobDone: round1(quoted.reduce((s, t) => s + done(t), 0)),
    jobQuoted: round1(quoted.reduce((s, t) => s + (t.hours ?? 0), 0)),
    visit,
    visits: Math.max(0, ...tasks.map((t) => t.visit ?? 0)),
  };
}
