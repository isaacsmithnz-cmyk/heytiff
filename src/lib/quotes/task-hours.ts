import { rollMetresOf } from "./components";
import type { QuoteLine } from "./lines";
import type { LineVisit } from "./line-visit";
import { labourVisits, linesHours } from "./lines-job";
import type { TaskKey } from "./settings";
import { plannedVisits } from "@/lib/workboard/task-plan";

/* THE BUSINESS'S OWN HOURS, AS A CHECK (slice 8.1) — hours for a zone, an
   outlet or grille, a metre of pipe and a visit, set in Quoting (empty for
   a new business). A quote's lines are counted for each, and what those
   hours come to is set beside the hours the quote carries. Nothing is ever
   priced from them: the labour on a quote is the person's, or Tiff's with
   her reason. Pure. */

export type TaskCount = Record<TaskKey, number>;

const ZONE = /damper|zone motor/i;
const GRILLE = /grille|diffuser|outlet|register/i;
const PIPE = /\bcoil\b|\bpipe\b/i;
const NOT_PIPE = /cover|trunking|duct/i;

/** One option's tasks, off its lines: dampers or zone motors for zones,
    grilles and diffusers for outlets, pipe in metres (a roll is its length),
    and the visits its labour lines plan. */
export function tasksOf(lines: readonly QuoteLine[], dayHours: number | null): TaskCount {
  const parts = lines.filter((l) => l.kind !== "labour");
  const sum = (re: RegExp, not?: RegExp) => parts.filter((l) => re.test(l.name) && !(not && not.test(l.name))).reduce((n, l) => n + l.qty, 0);
  const metres = parts
    .filter((l) => PIPE.test(l.name) && !NOT_PIPE.test(l.name))
    .reduce((n, l) => n + (l.unit === "m" ? l.qty : l.qty * (rollMetresOf(l.name) ?? 0)), 0);
  return {
    zone: sum(ZONE),
    grille: sum(GRILLE),
    metre: Math.round(metres * 10) / 10,
    visit: plannedVisits(labourVisits(lines, dayHours)).length,
  };
}

const WORDS: Record<TaskKey, (n: number) => string> = {
  zone: (n) => `${n} ${n === 1 ? "zone" : "zones"}`,
  grille: (n) => `${n} ${n === 1 ? "outlet" : "outlets"}`,
  metre: (n) => `${n} m of pipe`,
  visit: (n) => `${n} ${n === 1 ? "visit" : "visits"}`,
};

export type TaskCheck = { hours: number; words: string; quoted: number };

const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** What the business's hours make one option's labour, beside the hours it
    carries; null when no hours are set or nothing on it counts. */
export function taskCheck(lines: readonly QuoteLine[], hours: Record<TaskKey, number | null>, dayHours: number | null): TaskCheck | null {
  const count = tasksOf(lines, dayHours);
  const keys = (Object.keys(count) as TaskKey[]).filter((k) => hours[k] != null && count[k] > 0);
  if (keys.length === 0) return null;
  const total = keys.reduce((n, k) => n + count[k] * hours[k]!, 0);
  return { hours: Math.round(total * 10) / 10, words: andList(keys.map((k) => WORDS[k](count[k]))), quoted: linesHours(lines) };
}

/* WHAT EACH DAMPER AND OUTLET GETS (the 3465 review, 5 November 2026: seven
   dampers, six sensors and the zone controller went on as one 4 h task, a
   little over half an hour a damper fitted in its run and wired back). The
   parts labour is counted by, off the lines, beside the person-hours of the
   tasks that name them, so a part lumped in with others, or with no task,
   shows when the labour is worked out. Nothing is priced from it. */
const TASK_NAMES: Partial<Record<TaskKey, RegExp>> = { zone: /damper|\bzones?\b/i, grille: /grille|diffuser|outlet|register|\bflex\b/i };
const PART_WORDS: Partial<Record<TaskKey, (n: number) => string>> = {
  zone: (n) => `${n} ${n === 1 ? "damper" : "dampers"}`,
  grille: (n) => `${n} ${n === 1 ? "outlet" : "outlets"}`,
};

export function hoursByPart(lines: readonly QuoteLine[], visits: readonly LineVisit[], dayHours: number | null): string[] {
  const count = tasksOf(lines, dayHours);
  return (["zone", "grille"] as const).flatMap((k) => {
    const n = count[k];
    if (!(n > 0)) return [];
    const tasks = visits.flatMap((v) => v.tasks).filter((t) => TASK_NAMES[k]!.test(t.task));
    if (tasks.length === 0) return [`${PART_WORDS[k]!(n)} on the quote, and no task names them`];
    const h = Math.round(tasks.reduce((sum, t) => sum + t.hours, 0) * 4) / 4;
    return [`${PART_WORDS[k]!(n)} on the quote: ${h} h in ${andList(tasks.map((t) => `"${t.task}"`))}, ${Math.round((h / n) * 10) / 10} h each`];
  });
}
