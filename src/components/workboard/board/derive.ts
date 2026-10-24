/* Client-safe derivations for the board components — thin adapters from the
   loaded BoardVisit shape onto the status law in lib/workboard/board-status.
   No fetching, no dates invented: `today` always arrives from the server on
   the account's clock. */

import {
  daysBetween,
  gateStateOf,
  missingGates,
  visitTone,
  type GateName,
  type GateState,
  type VisitTone,
} from "@/lib/workboard/board-status";
import type { BoardVisit } from "@/lib/workboard/board-query";
import type { ProjectBoardVisit } from "@/lib/workboard/projects-board-query";

export function gatesOf(v: BoardVisit): GateState {
  return gateStateOf(v.readiness, v.techs.length);
}

export function toneOf(v: BoardVisit, today: string): VisitTone {
  return visitTone(
    {
      status: v.status,
      dueDate: v.dueDate,
      gates: gatesOf(v),
      mirrorStatus: v.mirrorStatus,
      bookedDate: placedDayOf(v),
    },
    today
  );
}

export function missingOf(v: BoardVisit): GateName[] {
  return missingGates(gatesOf(v));
}

/** The day a visit actually sits on: manual placement wins, then the linked
    job's diary; an unplaced visit sits nowhere. */
export function placedDayOf(v: BoardVisit): string | null {
  if (v.bookedDate) return v.bookedDate;
  if (v.bookedStart) return v.bookedStart.slice(0, 10);
  return null;
}

/* ── project-side derivations (same law, other shape) ── */

export function projectGatesOf(v: ProjectBoardVisit): GateState {
  return gateStateOf(v.readiness, v.techs.length);
}

export function projectMissingOf(v: ProjectBoardVisit): GateName[] {
  return missingGates(projectGatesOf(v));
}

/** The day a trip actually sits on — placement wins, then the linked diary. */
export function projectPlacedDayOf(v: ProjectBoardVisit): string | null {
  if (v.bookedDate) return v.bookedDate;
  if (v.bookedStart) return v.bookedStart.slice(0, 10);
  return null;
}

/* ── words ── */

export const GATE_LABEL: Record<GateName, string> = {
  equipment: "Equipment",
  access: "Access",
  crew: "Crew",
};

/** What is known about a piece of equipment, or that nothing is — one line
    under the unit's name, said the same way on the agreement sheet and the
    visit card's Summary. Out here because React Compiler 1.0 refuses a
    logical whose test is itself a logical inside a component. */
export const equipmentLine = (e: {
  model: string | null;
  serial: string | null;
  location: string | null;
}) =>
  [e.model && `Model ${e.model}`, e.serial && `Serial ${e.serial}`, e.location]
    .filter(Boolean)
    .join(", ") || "no details recorded";

/* `cadencePhrase` (the mid-sentence form) died with the visit card's
   "Comes round …" hint — the cadence is a band chip now, and a NAME is all
   a chip says. */
export function cadenceLabel(months: number): string {
  if (months === 1) return "Monthly";
  if (months === 2) return "Every 2 months";
  if (months === 3) return "Quarterly";
  if (months === 6) return "6-monthly";
  if (months === 12) return "Annual";
  return `Every ${months} months`;
}

/** Rounded up the way the office says it — and it graduates to months where
    the prototype stalled at "in 14 weeks" forever (G11). */
export function untilLabel(dueISO: string, today: string): { t: string; tone: "" | "warn" | "dan" } {
  const n = daysBetween(today, dueISO);
  if (n < 0) return { t: n === -1 ? "1 day over" : `${-n} days over`, tone: "dan" };
  if (n === 0) return { t: "Due today", tone: "warn" };
  if (n === 1) return { t: "Due tomorrow", tone: "warn" };
  if (n < 14) return { t: `In ${n} days`, tone: n <= 7 ? "warn" : "" };
  if (n < 56) return { t: `In ${Math.ceil(n / 7)} weeks`, tone: "" };
  return { t: `In ${Math.ceil(n / 30.4)} months`, tone: "" };
}

export function agoLabel(iso: string, today: string): string {
  const n = daysBetween(iso, today);
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  if (n < 14) return `${n} days ago`;
  if (n < 56) return `${Math.ceil(n / 7)} weeks ago`;
  return `${Math.ceil(n / 30.4)} months ago`;
}

export function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function hoursLabel(n: number): string {
  return `${Math.round(n * 10) / 10} h`;
}

/** The crew estimate said in people, not in a bare digit — "2" in a tile
    labelled "Estimated crew size" reads as an id as easily as a count. */
export function crewLabel(n: number): string {
  return `${n} ${n === 1 ? "technician" : "technicians"}`;
}
