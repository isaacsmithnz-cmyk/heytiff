/* The Urgent queue's data contract (L1's fix).

   In the prototype every "Deal with it today" row was a hand-written
   fixture — runtime events could clear rows but never create them. Here the
   queue is FULLY DERIVED: a row exists iff its rule fires, and it clears
   itself the moment the underlying fact changes (book the visit, tick the
   gate, assign the tech, complete the task, clear the flag). No row is ever
   stored, so no row can go stale, and "remove" is not an operation that
   exists.

   Pure: callers assemble the inputs (open visits with gates + assignment,
   active flags, open tasks) and pass `today` on the account's clock. */

import {
  daysBetween,
  gateStateOf,
  missingGates,
  type GateName,
} from "./board-status";
import type { ReadinessKey } from "./visit-schedule";

/** Gate/crew gaps only become today's business inside this window — beyond
    it they are the Upcoming tab's quiet work (the calm-board rule). */
export const URGENT_GAP_WINDOW_DAYS = 7;

export type UrgentVisitInput = {
  visitId: string;
  agreementId: string;
  label: string;
  clientName: string;
  siteLabel: string | null;
  /** upcoming | booked (callers pass open visits only; anything else is ignored) */
  status: string;
  dueDate: string;
  bookedDate: string | null;
  readiness: Record<ReadinessKey, boolean>;
  techCount: number;
  /** 'Quote' keeps a visit out of the queue — it isn't booked work yet. */
  mirrorStatus?: string | null;
};

export type UrgentFlagInput = {
  flagId: string;
  message: string;
  severity: string; // 'warn' | 'danger' (anything unknown reads as warn)
  createdAt: string;
  targetKind: string;
  targetId: string | null;
};

export type UrgentTaskInput = {
  taskId: string;
  title: string;
  dueDate: string | null;
  assigneeName: string | null;
};

export type UrgentReason = "overdue" | "gate_gap" | "no_tech" | "flag" | "task";

export type UrgentAction =
  | "book"
  | "close_out"
  | "confirm_gates"
  | "assign_tech"
  | "clear_flag"
  | "complete_task";

export type UrgentRow = {
  /** Stable identity for keys and undo toasts: `${reason}:${sourceId}`. */
  key: string;
  reason: UrgentReason;
  severity: "danger" | "warn";
  headline: string;
  /** Secondary reasons riding along (A2) — gate names, never invented text. */
  also: string[];
  action: UrgentAction;
  /** The gate that names a gap row — the one the row's quick action fixes. */
  leadGate?: GateName;
  visitId?: string;
  agreementId?: string;
  flagId?: string;
  taskId?: string;
  label?: string;
  clientName?: string;
  siteLabel?: string | null;
  dueDate?: string | null;
  daysOver?: number;
};

const GATE_HEADLINE: Record<GateName, string> = {
  equipment: "Equipment not ready",
  access: "Access not confirmed",
  crew: "No technician",
};

const gateChip = (g: GateName): string =>
  g === "equipment" ? "Equipment" : g === "access" ? "Access" : "Crew";

/** One row per visit, worst reason wins: overdue beats a gate gap (the row
    would otherwise appear twice and the board's one rule is that nothing
    does). Within a gate-gap row the LEAD gate names it in spine order —
    Equipment, Access, Crew — and the rest ride along as chips. */
export function urgentRows(input: {
  today: string;
  visits: UrgentVisitInput[];
  flags: UrgentFlagInput[];
  tasks: UrgentTaskInput[];
}): UrgentRow[] {
  const { today } = input;

  const overdue: UrgentRow[] = [];
  const gaps: UrgentRow[] = [];

  for (const v of input.visits) {
    if (v.status !== "upcoming" && v.status !== "booked") continue;
    if (v.mirrorStatus === "Quote") continue;

    const gates = gateStateOf(v.readiness, v.techCount);
    const missing = missingGates(gates);
    const base = {
      visitId: v.visitId,
      agreementId: v.agreementId,
      label: v.label,
      clientName: v.clientName,
      siteLabel: v.siteLabel,
      dueDate: v.dueDate,
    };

    if (v.dueDate < today) {
      const daysOver = daysBetween(v.dueDate, today);
      overdue.push({
        ...base,
        key: `overdue:${v.visitId}`,
        reason: "overdue",
        severity: "danger",
        headline: daysOver === 1 ? "1 day over" : `${daysOver} days over`,
        also: missing.map(gateChip),
        // A placed visit past its due date has a plan in motion — the ask
        // is "did it run?", not "book it".
        action: v.bookedDate ? "close_out" : "book",
        daysOver,
      });
      continue;
    }

    if (missing.length === 0) continue;
    if (daysBetween(today, v.dueDate) > URGENT_GAP_WINDOW_DAYS) continue;

    const lead = missing[0];
    gaps.push({
      ...base,
      key: `${lead === "crew" ? "no_tech" : "gate_gap"}:${v.visitId}`,
      reason: lead === "crew" ? "no_tech" : "gate_gap",
      severity: "warn",
      headline: GATE_HEADLINE[lead],
      also: missing.slice(1).map(gateChip),
      action: lead === "crew" ? "assign_tech" : "confirm_gates",
      leadGate: lead,
    });
  }

  const flagRows: { row: UrgentRow; createdAt: string }[] = input.flags.map((f) => ({
    row: {
      key: `flag:${f.flagId}`,
      reason: "flag",
      severity: f.severity === "danger" ? "danger" : "warn",
      headline: f.message,
      also: [],
      action: "clear_flag",
      flagId: f.flagId,
    },
    createdAt: f.createdAt,
  }));

  const tasks: UrgentRow[] = input.tasks
    .filter((t) => t.dueDate !== null && t.dueDate <= today)
    .map((t) => {
      const daysOver = daysBetween(t.dueDate!, today);
      return {
        key: `task:${t.taskId}`,
        reason: "task" as const,
        severity: "warn" as const,
        headline:
          daysOver === 0
            ? "Due today"
            : daysOver === 1
              ? "1 day over"
              : `${daysOver} days over`,
        also: t.assigneeName ? [t.assigneeName] : [],
        action: "complete_task" as const,
        taskId: t.taskId,
        label: t.title,
        dueDate: t.dueDate,
        daysOver,
      };
    });

  /* Order: fires first. Overdue visits most-over first; danger flags with
     them (newest first); then gaps soonest-due first; then tasks oldest-due
     first; then warn flags newest first. Ties break on the stable key so
     the queue never reshuffles under a reader's feet. */
  const byKey = (a: UrgentRow, b: UrgentRow) => (a.key < b.key ? -1 : 1);
  overdue.sort((a, b) => b.daysOver! - a.daysOver! || byKey(a, b));
  gaps.sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : byKey(a, b)));
  tasks.sort((a, b) => b.daysOver! - a.daysOver! || byKey(a, b));
  const newestFirst = (want: "danger" | "warn") =>
    flagRows
      .filter((f) => f.row.severity === want)
      .sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : byKey(a.row, b.row)
      )
      .map((f) => f.row);

  return [...overdue, ...newestFirst("danger"), ...gaps, ...tasks, ...newestFirst("warn")];
}
