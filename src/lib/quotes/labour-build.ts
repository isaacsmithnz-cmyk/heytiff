import { MAX_TASKS, visitHours, visitName, visitOf, type LineVisit } from "./line-visit";

/* THE LABOUR, TASK BY TASK (Isaac, 2026-10-09: "If a new org starts up it
   needs realistic estimates… it shouldn't rely on sm8 information… all that
   you are doing is tuning it to our org"). A business with no history and no
   task hours still gets a realistic figure: the work is broken into the
   visits it takes, who's on each, and every task in it with the
   person-hours an experienced crew takes for it in this job's conditions.
   The sum is the labour; the tasks are the line's own (line-visit.ts), on
   the quote for anyone to check and change, and onto the job once it's
   accepted. No business's own numbers are in here: the business's task
   hours, and later its reviewed jobs, are what sharpen it. Pure. */

export type LabourTask = { task: string; hours: number };
export type LabourVisit = { stage: string; people: number; tasks: LabourTask[] };

const MAX_VISITS = 12;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Visits as Tiff gives them, held to what a line can carry; or why not. */
export function labourVisitsOf(raw: unknown): LabourVisit[] | string {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0) return "Give the visits the job takes, each with its people and its tasks.";
  const out: LabourVisit[] = [];
  for (const v of list.slice(0, MAX_VISITS)) {
    const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    const stage = text(o.stage, 60);
    const people = typeof o.people === "number" && Number.isFinite(o.people) ? Math.round(o.people) : 0;
    if (!stage || people < 1 || people > 12) return `Each visit needs a stage and between 1 and 12 people${stage ? ` (${stage})` : ""}.`;
    const tasks: LabourTask[] = [];
    for (const t of (Array.isArray(o.tasks) ? o.tasks : []).slice(0, MAX_TASKS)) {
      const x = t && typeof t === "object" ? (t as Record<string, unknown>) : {};
      const task = text(x.task, 80);
      const hours = typeof x.hours === "number" && Number.isFinite(x.hours) ? x.hours : NaN;
      if (!task || !(hours > 0) || hours > 200) return `Every task needs a name and its person-hours (${stage}).`;
      tasks.push({ task, hours });
    }
    if (tasks.length === 0) return `${stage} has no tasks.`;
    out.push({ stage, people, tasks });
  }
  return out;
}

/** A visit as its labour line: every person's hours added up, named for its
    crew and how long they're there, its tasks kept on it. */
export function visitLine(v: LabourVisit, dayHours: number | null): { name: string; qty: number; why: string; visit: LineVisit } {
  /* to the quarter hour, as the line keeps them */
  const visit = visitOf({ stage: v.stage, people: v.people, dayHours, tasks: v.tasks })!;
  return { name: visitName(visit), qty: visitHours(visit), why: "Worked out task by task", visit };
}
