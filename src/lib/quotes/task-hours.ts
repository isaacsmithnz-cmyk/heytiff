import { rollMetresOf } from "./components";
import type { QuoteLine } from "./lines";
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
