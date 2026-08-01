/* The projects Urgent queue's data contract — the L1 discipline, projects side.

   Every row is DERIVED: it exists iff its rule fires, and it clears itself
   the moment the underlying fact changes (book the trip, clear the block,
   move the stage, tick the gate). Nothing is stored, so nothing goes stale
   and "remove" still isn't an operation.

   Two kinds of row, deliberately:
     VISIT rows — a specific trip is late or unready. Actionable on the
     visit (book it, close it out, tick the gate, assign the crew).
     PROJECT rows — the project's own state is the news (blocked, promise
     slipping, hours burned past budget, gone quiet). One row per project,
     worst reason wins, the rest ride along as chips — the board's one rule
     is that nothing appears twice.

   Tasks stay on the maintenance board's queue (they aren't project-scoped);
   flags arrive here already routed by the caller (target = a project or a
   project's visit). Pure: callers pass `today` on the account's clock. */

import {
  daysBetween,
  gateStateOf,
  missingGates,
  type GateName,
} from "./board-status";
import type { ReadinessKey } from "./visit-schedule";
import { stageIndex } from "./stages";

/** Gate/crew gaps become today's business inside this window — same number
    as the maintenance side, because it's the same kind of news. */
export const PROJECT_GAP_WINDOW_DAYS = 7;

/** A promised finish starts counting down out loud inside this window. */
export const PROMISE_WINDOW_DAYS = 7;

/** No movement for a fortnight isn't "in progress", whatever the stage says.
    Same threshold the old vitals used for its urgent flag. */
export const PROJECT_STALE_DAYS = 14;

/** The promise countdown only shouts while the job is honestly behind: at or
    past Commission the finish line is in sight and the row would be noise. */
const PROMISE_CALM_FROM = stageIndex("Commission");

export type ProjectRuleInput = {
  id: string;
  name: string;
  clientName: string | null;
  siteLabel: string | null;
  /** active | blocked | on_hold | done | archived */
  status: string;
  stage: string;
  blockedReason: string | null;
  blockedOn: string | null;
  blockedAt: string | null;
  promisedFinish: string | null;
  /** Last movement (ISO timestamp) — creation counts as movement. */
  updatedAt: string | null;
  hoursBudget: number | null;
  hoursLogged: number;
};

export type ProjectVisitRuleInput = {
  visitId: string;
  projectId: string;
  projectName: string;
  clientName: string | null;
  siteLabel: string | null;
  label: string;
  /** upcoming | booked (callers pass open visits only; others are ignored) */
  status: string;
  dueDate: string;
  bookedDate: string | null;
  readiness: Record<ReadinessKey, boolean>;
  techCount: number;
};

export type ProjectFlagRuleInput = {
  flagId: string;
  message: string;
  severity: string; // 'warn' | 'danger' (unknown reads as warn)
  createdAt: string;
};

export type ProjectUrgentReason =
  | "visit_overdue"
  | "blocked"
  | "promise"
  | "gate_gap"
  | "no_tech"
  | "burn"
  | "stale"
  | "flag";

export type ProjectUrgentAction =
  | "book"
  | "close_out"
  | "confirm_gates"
  | "assign_tech"
  | "open_project"
  | "clear_flag";

export type ProjectUrgentRow = {
  /** Stable identity for keys and undo toasts: `${reason}:${sourceId}`. */
  key: string;
  reason: ProjectUrgentReason;
  severity: "danger" | "warn";
  headline: string;
  /** Secondary reasons riding along — gate names, promise notes, never invented text. */
  also: string[];
  action: ProjectUrgentAction;
  leadGate?: GateName;
  projectId?: string;
  visitId?: string;
  flagId?: string;
  /** Visit label or project name — whatever the row is about. */
  label?: string;
  clientName?: string | null;
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

const daysWord = (n: number): string => (n === 1 ? "1 day" : `${n} days`);

/** The project-level verdict for ONE project — exported so the detail page
    can show the same news the board shows (one law, every surface). */
export function projectStateRow(p: ProjectRuleInput, today: string): ProjectUrgentRow | null {
  if (p.status === "done" || p.status === "archived" || p.status === "on_hold") return null;

  const findings: { reason: ProjectUrgentReason; severity: "danger" | "warn"; headline: string; chip: string }[] = [];

  if (p.status === "blocked") {
    const who = p.blockedOn ? ` on ${p.blockedOn}` : "";
    const since = p.blockedAt ? daysBetween(p.blockedAt.slice(0, 10), today) : 0;
    findings.push({
      reason: "blocked",
      severity: "danger",
      headline: `Blocked${who}${p.blockedReason ? ` — ${p.blockedReason}` : ""}`,
      chip: since > 0 ? `Blocked ${daysWord(since)}` : "Blocked",
    });
  }

  if (p.promisedFinish && stageIndex(p.stage) < PROMISE_CALM_FROM) {
    const n = daysBetween(today, p.promisedFinish);
    if (n < 0) {
      findings.push({
        reason: "promise",
        severity: "danger",
        headline: `Promised finish ${daysWord(-n)} ago — still at ${p.stage}`,
        chip: "Promise passed",
      });
    } else if (n <= PROMISE_WINDOW_DAYS) {
      findings.push({
        reason: "promise",
        severity: "warn",
        headline:
          n === 0
            ? `Promised finish is today — still at ${p.stage}`
            : `Promised finish in ${daysWord(n)} — still at ${p.stage}`,
        chip: "Promise close",
      });
    }
  }

  if (p.hoursBudget !== null && p.hoursBudget > 0 && p.hoursLogged > p.hoursBudget) {
    findings.push({
      reason: "burn",
      severity: "warn",
      headline: `Over the hours budget — ${p.hoursLogged} of ${p.hoursBudget} h`,
      chip: `${p.hoursLogged} of ${p.hoursBudget} h`,
    });
  }

  if (p.status === "active" && p.updatedAt) {
    const quiet = daysBetween(p.updatedAt.slice(0, 10), today);
    if (quiet >= PROJECT_STALE_DAYS) {
      findings.push({
        reason: "stale",
        severity: "warn",
        headline: `No movement for ${daysWord(quiet)}`,
        chip: `Quiet ${daysWord(quiet)}`,
      });
    }
  }

  if (findings.length === 0) return null;

  // Worst wins the row; the rest become chips. Order of `findings` IS the
  // precedence: blocked, promise, burn, stale.
  const lead = findings.find((f) => f.severity === "danger") ?? findings[0];
  const also = findings.filter((f) => f !== lead).map((f) => f.chip);

  return {
    key: `${lead.reason}:${p.id}`,
    reason: lead.reason,
    severity: lead.severity,
    headline: lead.headline,
    also,
    action: "open_project",
    projectId: p.id,
    label: p.name,
    clientName: p.clientName,
    siteLabel: p.siteLabel,
  };
}

/** Where a HeyTiff plan and the ServiceM8 diary disagree on a linked job —
    a chip, never an auto-write in either direction (decision: show + chip). */
export function sm8BookingMismatch(
  bookedDate: string | null,
  mirrorNextStart: string | null
): "none" | "differs" | "diary_only" {
  if (!mirrorNextStart) return "none";
  const diaryDay = mirrorNextStart.slice(0, 10);
  if (!bookedDate) return "diary_only";
  return diaryDay === bookedDate ? "none" : "differs";
}

export function projectUrgentRows(input: {
  today: string;
  projects: ProjectRuleInput[];
  visits: ProjectVisitRuleInput[];
  flags: ProjectFlagRuleInput[];
}): ProjectUrgentRow[] {
  const { today } = input;
  const liveProject = new Map(
    input.projects
      .filter((p) => p.status === "active" || p.status === "blocked")
      .map((p) => [p.id, p])
  );

  const overdue: ProjectUrgentRow[] = [];
  const gaps: ProjectUrgentRow[] = [];

  for (const v of input.visits) {
    if (v.status !== "upcoming" && v.status !== "booked") continue;
    // A held project's trips are parked with it — its rows would be nagging
    // about work nobody intends to run this week.
    if (!liveProject.has(v.projectId)) continue;

    const gates = gateStateOf(v.readiness, v.techCount);
    const missing = missingGates(gates);
    const base = {
      visitId: v.visitId,
      projectId: v.projectId,
      label: `${v.projectName} · ${v.label}`,
      clientName: v.clientName,
      siteLabel: v.siteLabel,
      dueDate: v.dueDate,
    };

    if (v.dueDate < today) {
      const daysOver = daysBetween(v.dueDate, today);
      overdue.push({
        ...base,
        key: `visit_overdue:${v.visitId}`,
        reason: "visit_overdue",
        severity: "danger",
        headline: daysOver === 1 ? "1 day over" : `${daysOver} days over`,
        also: missing.map(gateChip),
        action: v.bookedDate ? "close_out" : "book",
        daysOver,
      });
      continue;
    }

    if (missing.length === 0) continue;
    if (daysBetween(today, v.dueDate) > PROJECT_GAP_WINDOW_DAYS) continue;

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

  const projectRows = input.projects
    .map((p) => projectStateRow(p, today))
    .filter((r): r is ProjectUrgentRow => r !== null);
  const projDanger = projectRows.filter((r) => r.severity === "danger");
  const projWarn = projectRows.filter((r) => r.severity === "warn");

  const flagRows = input.flags.map((f) => ({
    row: {
      key: `flag:${f.flagId}`,
      reason: "flag" as const,
      severity: (f.severity === "danger" ? "danger" : "warn") as "danger" | "warn",
      headline: f.message,
      also: [],
      action: "clear_flag" as const,
      flagId: f.flagId,
    },
    createdAt: f.createdAt,
  }));

  /* Order: fires first. Overdue trips most-over first; blocked/broken-promise
     projects with the danger flags; then gate gaps soonest-due; then the warn
     project rows; warn flags last. Stable keys break every tie so the queue
     never reshuffles under a reader's feet. */
  const byKey = (a: ProjectUrgentRow, b: ProjectUrgentRow) => (a.key < b.key ? -1 : 1);
  overdue.sort((a, b) => b.daysOver! - a.daysOver! || byKey(a, b));
  gaps.sort((a, b) =>
    a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : byKey(a, b)
  );
  projDanger.sort(byKey);
  projWarn.sort(byKey);
  const newestFirst = (want: "danger" | "warn") =>
    flagRows
      .filter((f) => f.row.severity === want)
      .sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : byKey(a.row, b.row)
      )
      .map((f) => f.row);

  return [
    ...overdue,
    ...projDanger,
    ...newestFirst("danger"),
    ...gaps,
    ...projWarn,
    ...newestFirst("warn"),
  ];
}
