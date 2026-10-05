import { VISIT_STAGES, type Visit, type VisitStage } from "@/lib/quotes/buildup";
import type { ProposalOption, UnitLine } from "@/lib/quotes/proposal";
import { MAX_TASKS, MAX_TASK_NAME, TASK_KINDS, type TaskKind, type TaskUnit } from "./visit-tasks";

/* THE TASK LIST TIFF WRITES FROM THE ACCEPTED QUOTE, as data (Isaac,
   2026-10-06: "create a task list from the TIFF quote… things such as
   install living room unit, install kitchen unit, complete pipe work, take
   photos of wall controller locations").

   What Tiff is handed: the accepted option's scope, its units numbered, and
   the visits its labour plans — each of a stage's days is a visit, in the
   order the work happens. What comes back is checked here: a stage from
   the list, a kind, a unit that exists, a visit that's planned. Every unit
   gets its own task, whether Tiff wrote one or not. Pure. */

/** A visit the quote's labour plans: the stage and the crew for that day. */
type PlannedVisit = { n: number; stage: VisitStage; people: number };

/** The quote's labour as visits, one a day: "Rough-in, 2 people, 3 days" is
    visits 1 to 3. A part day is a visit of its own. A site measure comes
    before the work order and is no visit of the work; several options'
    labour runs in the order of the work, stage by stage. */
export function plannedVisits(labour: readonly Visit[]): PlannedVisit[] {
  const out: PlannedVisit[] = [];
  const work = labour
    .filter((v) => v.stage !== "Site measure")
    .map((v, i) => ({ v, i }))
    .sort((a, b) => VISIT_STAGES.indexOf(a.v.stage) - VISIT_STAGES.indexOf(b.v.stage) || a.i - b.i)
    .map((x) => x.v);
  for (const v of work) {
    const days = Math.max(1, Math.ceil(v.days - 1e-9));
    for (let i = 0; i < days && out.length < 60; i++) out.push({ n: out.length + 1, stage: v.stage, people: v.people });
  }
  return out;
}

/** A unit of an accepted option, with the option it's in. */
type OptionUnit = UnitLine & { option: number };

/** The units of the accepted options, numbered from 1 across them all. */
export function unitsOf(options: readonly ProposalOption[]): OptionUnit[] {
  return options.flatMap((o, option) => o.units.map((u) => ({ ...u, option })));
}

/** What a unit task is for, kept on the task. */
const taskUnitOf = (u: OptionUnit): TaskUnit => ({
  role: u.role,
  room: u.room,
  model: u.model,
  capacity: u.capacity,
  type: u.type,
  option: u.option,
  system: u.system,
  qty: u.qty,
});

/** A unit's task, worded the way the crew says it. */
export function unitTaskName(u: UnitLine): string {
  const n = u.qty > 1 ? `${u.qty} ` : "";
  if (u.role === "outdoor") return u.room ? `Set the outdoor unit, ${u.room}` : "Set the outdoor unit";
  if (u.role === "fan") return u.room ? `Fit the ${u.room} fan${u.qty > 1 ? "s" : ""}` : `Fit the ${n}fan${u.qty > 1 ? "s" : ""}`;
  return u.room ? `Hang the ${u.room} unit${u.qty > 1 ? "s" : ""}` : `Hang the ${n}indoor unit${u.qty > 1 ? "s" : ""}`;
}

/** The structured answer Tiff gives: plain fields, no nullable one (0 says
    "no unit" and "no visit"). */
export const TASKS_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          stage: { type: "string", enum: VISIT_STAGES },
          kind: { type: "string", enum: TASK_KINDS },
          unit: { type: "integer" },
          visit: { type: "integer" },
        },
        required: ["name", "stage", "kind", "unit", "visit"],
        additionalProperties: false,
      },
    },
  },
  required: ["tasks"],
  additionalProperties: false,
} as const;

/** THE SAME FOR EVERY BUSINESS: nothing here names one. */
export const TASKS_SYSTEM = `You turn an accepted air-conditioning quote into the installer's task list for an Australian installer's job. Each task is one piece of work the crew does on site, in plain trade words of a few words, in the order the work happens. For example: "Garage penetrations and the two sheet metal ducts to the roof garden", "Rough-in pipe and cable, garage to the six heads", "Drains for the Level 1 and Level 2 heads", "Hang the Level 2 Bedroom 3 unit", "Set the outdoor unit in the garage", "Photos of the wall controller locations", "Connect, pressure test and vacuum", "Commission the system", "Handover photos", "Register the warranty".

The fields:
- name: the task.
- stage: the stage of the work it belongs to.
- kind: "unit" for putting in one of the quote's units: exactly one task for each unit listed, naming its room or place, with unit set to that unit's number. "progress" for work that runs over more than one visit and is measured by how far it has got (pipe and cable runs, ductwork, drains across several levels). "tick" for everything else.
- unit: the unit's number for a unit task; 0 otherwise.
- visit: the visit it is planned for, from the visits listed, spreading the work across them in order the way the crew would do it, a stage's work on that stage's visits. 0 when no visits are listed.

Only work the quote says or plainly needs (every install is commissioned and handed over). No prices, no materials lists, nothing for the office (ordering, invoicing). At most ${MAX_TASKS} tasks. Never invent a model, a room or a fact.`;

/** The user turn: the job, the accepted options and their units, the site's
    known facts, and the visits planned. */
export function tasksPrompt(input: {
  site: string | null;
  options: readonly ProposalOption[];
  facts: readonly string[];
  visits: readonly PlannedVisit[];
}): string {
  const units = unitsOf(input.options);
  const parts = [
    input.site ? `Site: ${input.site.replace(/\n+/g, ", ")}` : null,
    ...input.options.map((o) => `The accepted option, "${o.name}":\n${o.lines.map((l) => `- ${l}`).join("\n")}`),
    units.length
      ? `Its units, numbered:\n${units
          .map((u, i) => `${i + 1}. ${u.role}: ${[u.room, u.capacity, u.type, u.model, u.qty > 1 ? `${u.qty} of them` : ""].filter(Boolean).join(", ")}`)
          .join("\n")}`
      : "It puts in no units.",
    input.facts.length ? `What's known about the site:\n${input.facts.map((f) => `- ${f}`).join("\n")}` : null,
    input.visits.length
      ? `The visits planned, in order:\n${input.visits.map((v) => `${v.n}. ${v.stage}, ${v.people} ${v.people === 1 ? "person" : "people"}`).join("\n")}`
      : "No visits are planned yet: visit is 0 for every task.",
  ];
  return `${parts.filter(Boolean).join("\n\n")}\n\nWrite the task list.`;
}

type NewTask = { name: string; stage: VisitStage; kind: TaskKind; unit: TaskUnit | null; visit: number | null; sort: number };

const clean = (s: unknown) =>
  typeof s === "string" ? s.replace(/^[-*•–]\s*/, "").replace(/\s+/g, " ").trim().slice(0, MAX_TASK_NAME) : "";

/** Tiff's answer, checked: each task with a stage, a kind, a unit that
    exists and a visit that's planned; every unit with a task of its own. */
export function parseTasks(raw: unknown, units: readonly OptionUnit[], visits: readonly PlannedVisit[]): NewTask[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { tasks?: unknown }).tasks) ? ((raw as { tasks: unknown[] }).tasks) : [];
  const out: NewTask[] = [];
  const covered = new Set<number>();
  for (const x of list) {
    if (out.length >= MAX_TASKS) break;
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const name = clean(o.name);
    if (!name) continue;
    const stage = VISIT_STAGES.includes(o.stage as VisitStage) ? (o.stage as VisitStage) : "Install";
    const unitN = typeof o.unit === "number" && Number.isInteger(o.unit) ? o.unit : 0;
    const unit = unitN >= 1 && unitN <= units.length && !covered.has(unitN) ? units[unitN - 1]! : null;
    let kind: TaskKind = TASK_KINDS.includes(o.kind as TaskKind) ? (o.kind as TaskKind) : "tick";
    if (kind === "unit" && !unit) kind = "tick";
    if (unit && kind === "unit") covered.add(unitN);
    const v = typeof o.visit === "number" && Number.isInteger(o.visit) ? o.visit : 0;
    const visit = v >= 1 && v <= visits.length ? v : null;
    out.push({ name, stage, kind, unit: kind === "unit" && unit ? taskUnitOf(unit) : null, visit, sort: out.length });
  }
  /* a unit Tiff left out still gets its task, on the first install visit */
  const installVisit = visits.find((v) => v.stage === "Install")?.n ?? null;
  units.forEach((u, i) => {
    if (covered.has(i + 1) || out.length >= MAX_TASKS) return;
    out.push({ name: unitTaskName(u), stage: "Install", kind: "unit", unit: taskUnitOf(u), visit: installVisit, sort: out.length });
  });
  return out;
}
