/* The board's one status law — derived, never stored (L7).

   Every surface (Urgent, Upcoming, Calendar, Completed, Agreements) reads
   the SAME derivation, so the three-ledgers-disagree failure (K2: the
   agreements table knew a visit was overdue while the urgent queue and
   calendar shrugged) is impossible by construction. Nothing here touches a
   database or a clock: callers pass `today` (todayInZone — the connected
   account's wall clock) and plain facts.

   The colour law is the BUILT one, canonised 2026-08-01 (decision C1):
   green = ready to run, orange = gaps 8–14 days out, red = overdue or gaps
   inside 7 days. Green/red are the app's semantic ok/danger pair and mean
   STATE here, never decoration. */

import type { ReadinessKey } from "./visit-schedule";

/* ── the three gates ── */

/** Spine order — Equipment, Access, Crew — everywhere: chips, missing-gate
    lists, and the lead gate that names an urgent row. */
export const GATE_ORDER = ["equipment", "access", "crew"] as const;

export type GateName = (typeof GATE_ORDER)[number];

export type GateState = Record<GateName, boolean>;

/** Two gates are stored ticks; Crew derives from assignment (D2): one
    assigned technician satisfies it, and the chip may still say "1 of 2"
    from techsNeeded — capacity is information, not a gate. */
export function gateStateOf(
  readiness: Record<ReadinessKey, boolean>,
  techCount: number
): GateState {
  return {
    equipment: readiness.equipment_ready,
    access: readiness.access_confirmed,
    crew: techCount >= 1,
  };
}

export function missingGates(gates: GateState): GateName[] {
  return GATE_ORDER.filter((g) => !gates[g]);
}

/* ── date arithmetic (dates only, zone handled by the caller's `today`) ── */

/** Whole days from a to b (positive when b is later). Midday-UTC pinning
    makes DST a non-event, same trick as the rest of the board. */
export function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(`${aISO}T12:00:00Z`);
  const b = Date.parse(`${bISO}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function isWeekendISO(iso: string): boolean {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Sat/Sun → the following Monday; weekdays pass through. This is the
    DISPLAY and default-suggestion rule (B11: never advertise a Sunday the
    engine won't book) — deliberate weekend placement stays allowed (B9). */
export function rollToBusinessDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (dow === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* ── the visit tone ── */

export type VisitTone =
  | "done"
  | "skipped"
  | "quote"
  | "over"
  | "go"
  | "flash"
  | "soon"
  | "asp";

export const FLASH_WINDOW_DAYS = 7;
export const SOON_WINDOW_DAYS = 14;

export type VisitToneInput = {
  /** upcoming | booked | done | skipped */
  status: string;
  dueDate: string;
  gates: GateState;
  /** The linked ServiceM8 job's mirrored status; 'Quote' renders as a quote,
      not as late work — a quote isn't booked work yet. */
  mirrorStatus?: string | null;
};

/** One function, all five screens. Precedence mirrors the design's legend:
    history first, quotes out of the urgency business, then overdue DERIVED
    from the due date (K2's fix — no stored `late` string exists anywhere),
    then ready-is-ready regardless of distance, then the gap windows. */
export function visitTone(v: VisitToneInput, todayISO: string): VisitTone {
  if (v.status === "done") return "done";
  if (v.status === "skipped") return "skipped";
  if (v.mirrorStatus === "Quote") return "quote";
  if (v.dueDate < todayISO) return "over";
  if (missingGates(v.gates).length === 0) return "go";
  const n = daysBetween(todayISO, v.dueDate);
  if (n <= FLASH_WINDOW_DAYS) return "flash";
  if (n <= SOON_WINDOW_DAYS) return "soon";
  return "asp";
}

/* ── the calendar day tone ── */

export type DayTone = "" | "over" | "done" | "quote" | "go" | "flash" | "soon" | "open";

/** A cell summarises the visits sitting on that day. Worst news wins:
    anything overdue paints the day red; a day of history is a quiet tick;
    every live visit ready = green; otherwise the DAY's distance from today
    picks the gap window (every visit on a day shares that distance). */
export function dayTone(tones: VisitTone[], daysToDay: number): DayTone {
  if (tones.length === 0) return "";
  if (tones.includes("over")) return "over";
  const live = tones.filter((t) => t !== "done" && t !== "quote" && t !== "skipped");
  if (live.length === 0) {
    if (tones.includes("done")) return "done";
    return tones.includes("quote") ? "quote" : "";
  }
  if (live.every((t) => t === "go")) return "go";
  if (daysToDay <= FLASH_WINDOW_DAYS) return "flash";
  if (daysToDay <= SOON_WINDOW_DAYS) return "soon";
  return "open";
}

/* ── display windows ── */

/** How far ahead the Upcoming tab displays open visits. The loader brings
    every open row (the 13-month horizon caps generation at ~13 per
    agreement); trimming the long tail is a display decision made here so
    client and server agree on it. */
export const BOARD_AHEAD_DAYS = 120;

/** How much history Completed shows — eight weeks, matching the old board's
    look-back so nothing shipping today loses reach. */
export const BOARD_DONE_DAYS = 56;

/* ── "N to confirm" (B8) ── */

/** Gaps two weeks out are normal and must not shout: the header counts
    missing gates only inside this horizon, so the chip going orange MEANS
    something. */
export const TO_CONFIRM_HORIZON_DAYS = 14;

export type ToConfirmInput = {
  status: string;
  dueDate: string;
  gates: GateState;
  mirrorStatus?: string | null;
};

export function toConfirmCount(
  visits: ToConfirmInput[],
  todayISO: string
): { gaps: number; services: number } {
  let gaps = 0;
  let services = 0;
  for (const v of visits) {
    if (v.status !== "upcoming" && v.status !== "booked") continue;
    if (v.mirrorStatus === "Quote") continue;
    if (v.dueDate < todayISO) continue; // overdue is the Urgent queue's news
    if (daysBetween(todayISO, v.dueDate) > TO_CONFIRM_HORIZON_DAYS) continue;
    const missing = missingGates(v.gates).length;
    if (missing > 0) {
      gaps += missing;
      services += 1;
    }
  }
  return { gaps, services };
}

/* ── completion timing (B12/G3: "done on time" must be earned) ── */

export function completionTiming(
  dueISO: string,
  completedISO: string
): { onTime: boolean; daysLate: number } {
  const daysLate = Math.max(0, daysBetween(dueISO, completedISO));
  return { onTime: daysLate === 0, daysLate };
}

/* ── placement vs promise (K4) ── */

/** A visit booked after its due date is late by construction — the pair is
    SURFACED, never silently accepted (the create form and the sheet both
    say so and offer the roll). */
export function placementMismatch(
  dueISO: string,
  bookedISO: string
): { late: boolean; daysAfterDue: number } {
  const days = Math.max(0, daysBetween(dueISO, bookedISO));
  return { late: days > 0, daysAfterDue: days };
}

/* ── week grouping (C4) ── */

/** Monday of the week holding the date — the board's weeks run Mon–Sun,
    matching how a trades week is actually spoken about. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = d.getUTCDay(); // Sun=0
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export type WeekGroupKey = "overdue" | "this_week" | "next_week" | string;

/** Group key for the Upcoming list: Overdue first, then This week, Next
    week, then each later week keyed by its Monday's ISO date (stable,
    sortable, label-agnostic — labels are the UI's business). */
export function weekGroupKey(dateISO: string, todayISO: string): WeekGroupKey {
  if (dateISO < todayISO) return "overdue";
  const week = mondayOf(dateISO);
  const thisWeek = mondayOf(todayISO);
  if (week === thisWeek) return "this_week";
  if (daysBetween(thisWeek, week) === 7) return "next_week";
  return week;
}

/** Sort order for group keys: overdue, this week, next week, then Mondays
    ascending. */
export function weekGroupRank(key: WeekGroupKey): string {
  if (key === "overdue") return "0";
  if (key === "this_week") return "1";
  if (key === "next_week") return "2";
  return `3:${key}`;
}
