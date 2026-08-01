/* Client-safe derivations for the board components — thin adapters from the
   loaded BoardVisit shape onto the status law in lib/workboard/board-status.
   No fetching, no dates invented: `today` always arrives from the server on
   the account's clock. */

import {
  dayTone,
  daysBetween,
  gateStateOf,
  missingGates,
  visitTone,
  type DayTone,
  type GateName,
  type GateState,
  type VisitTone,
} from "@/lib/workboard/board-status";
import type { BoardVisit } from "@/lib/workboard/board-query";

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
    },
    today
  );
}

export function missingOf(v: BoardVisit): GateName[] {
  return missingGates(gatesOf(v));
}

/** Triage order inside a week group — trouble first, then the calm end. */
export const TONE_RANK: Record<VisitTone, number> = {
  over: 0,
  flash: 1,
  soon: 2,
  asp: 3,
  go: 4,
  quote: 5,
  done: 6,
  skipped: 7,
};

/** The day a visit actually sits on: manual placement wins, then the linked
    job's diary; an unplaced visit sits nowhere. */
export function placedDayOf(v: BoardVisit): string | null {
  if (v.bookedDate) return v.bookedDate;
  if (v.bookedStart) return v.bookedStart.slice(0, 10);
  return null;
}

export function calendarToneFor(visits: BoardVisit[], dayISO: string, today: string): DayTone {
  return dayTone(
    visits.map((v) => toneOf(v, today)),
    daysBetween(today, dayISO)
  );
}

/* ── words ── */

export const GATE_LABEL: Record<GateName, string> = {
  equipment: "Equipment",
  access: "Access",
  crew: "Crew",
};

export const GATE_FULL: Record<GateName, string> = {
  equipment: "Equipment ready",
  access: "Access confirmed",
  crew: "Crew assigned",
};

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

export function isWeekendClass(iso: string): string {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? " we" : "";
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
