/* Visit generation and bucketing — pure, and paranoid about calendars.

   THE ONE RULE OF THE MATHS: occurrence k is anchor + k×interval_months,
   clamped to the target month's length. Never iterate from the previous due
   date — Jan 31 → Feb 28 → Mar 28 is how a monthly service drifts three days
   in two hops and nobody can say why. Clamping from the ANCHOR keeps the
   31st meaning "end of month" forever.

   Dates only, no times, no zones: a due date is a calendar promise, and the
   zone question lives entirely in "what is today" (todayInZone). */

/* The two STORED gates (decision D1, 2026-08-01). Crew is derived from the
   visit's technician assignment and is never a key here; time_confirmed
   folded into placement (booked_date) — placing a visit on a day IS the
   time confirmation. */
export const READINESS_KEYS = ["equipment_ready", "access_confirmed"] as const;

export type ReadinessKey = (typeof READINESS_KEYS)[number];

/* The retired four-key model. Old rows may still carry these until their
   next tick rebuilds the jsonb from the new whitelist; the pristine check
   below honours them so nobody's half-done confirmations mark a visit
   untouched. */
export const LEGACY_READINESS_KEYS = [
  "access_confirmed",
  "time_confirmed",
  "parts_ready",
  "customer_notified",
] as const;

export function isReadinessKey(v: unknown): v is ReadinessKey {
  return typeof v === "string" && (READINESS_KEYS as readonly string[]).includes(v);
}

/** Read a stored readiness jsonb by iterating the WHITELIST — junk keys and
    non-boolean values are ignored, never interpreted (the resolve() idiom). */
export function readReadiness(raw: unknown): Record<ReadinessKey, boolean> {
  const out = {} as Record<ReadinessKey, boolean>;
  const obj = rawObject(raw);
  for (const key of READINESS_KEYS) {
    out[key] = Object.hasOwn(obj, key) && obj[key] === true;
  }
  return out;
}

export function readinessCount(raw: unknown): { ready: number; total: number } {
  const r = readReadiness(raw);
  return { ready: READINESS_KEYS.filter((k) => r[k]).length, total: READINESS_KEYS.length };
}

function rawObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** The D1 mapping, as a pure function (the SQL migration is its mirror):
    parts_ready → equipment_ready; access OR customer_notified → access
    (OR, not AND — nobody's half-done work gets un-confirmed); time_confirmed
    → nothing, placement carries it now. Already-migrated keys pass through. */
export function migrateLegacyReadiness(raw: unknown): Record<ReadinessKey, boolean> {
  const obj = rawObject(raw);
  const on = (k: string) => Object.hasOwn(obj, k) && obj[k] === true;
  return {
    equipment_ready: on("equipment_ready") || on("parts_ready"),
    access_confirmed: on("access_confirmed") || on("customer_notified"),
  };
}

/* ── date maths (UTC-pinned, calendar-safe) ── */

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  return { y, m, d };
}

function daysInMonth(y: number, m: number): number {
  // day 0 of the NEXT month is this month's last day
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** anchor + months, clamped to the target month's length. */
export function addMonthsClamped(anchorISO: string, months: number): string {
  const a = parts(anchorISO);
  const total = a.y * 12 + (a.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const d = Math.min(a.d, daysInMonth(y, m));
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** ~13 months of due dates: far enough that an annual service is always on
    the board, near enough that the table stays honest about what's real. */
export const ENSURE_HORIZON_MONTHS = 13;

/** Every due date an agreement should hold between one interval ago and the
    horizon (or contract end, whichever is nearer). The lookback is exactly
    one interval, which by construction holds exactly ONE past occurrence —
    the most recent missed visit. An agreement entered late therefore shows
    the one visit it already owes (the radar's overdue row), without dredging
    up a decades-old anchor's worth of history nobody wants generated. */
export function dueDatesFor(input: {
  anchorISO: string;
  intervalMonths: number;
  fromISO: string;
  contractEndISO?: string | null;
  horizonMonths?: number;
}): string[] {
  const { anchorISO, intervalMonths, fromISO } = input;
  if (intervalMonths < 1) return [];
  const horizon = addMonthsClamped(fromISO, input.horizonMonths ?? ENSURE_HORIZON_MONTHS);
  const cap = input.contractEndISO && input.contractEndISO < horizon ? input.contractEndISO : horizon;
  const floor = addMonthsClamped(fromISO, -intervalMonths);

  const out: string[] = [];
  for (let k = 0; ; k += 1) {
    const due = addMonthsClamped(anchorISO, k * intervalMonths);
    if (due > cap) break;
    if (due > floor) out.push(due);
    // Safety rail: a 1-month interval over a 13-month horizon from a very old
    // anchor still terminates fast, but a malformed anchor must not spin.
    if (k > 1200) break;
  }
  return out;
}

/* ── the prune-pristine rule ── */

export type PristineCheck = {
  status: string;
  remoteId: string | null;
  jobNumber: string | null;
  readiness: unknown;
  notes: string | null;
  dueDate: string;
  /** Placement is a human act — a placed visit is not clutter. */
  bookedDate?: string | null;
  /** Assignment and packing live in join tables; callers count them. */
  techCount?: number;
  packedCount?: number;
};

/** May regeneration delete this future visit? Only if NOBODY touched it:
    still upcoming, never placed on a day, no job typed or linked, no gate
    ticked under EITHER readiness model, nobody assigned, nothing packed,
    no notes, and not already in the past (a missed visit is history, not
    clutter). */
export function isPristineFuture(v: PristineCheck, todayISO: string): boolean {
  if (v.dueDate <= todayISO) return false;
  if (v.status !== "upcoming") return false;
  if (v.remoteId || v.jobNumber) return false;
  if (v.bookedDate) return false;
  if ((v.techCount ?? 0) > 0 || (v.packedCount ?? 0) > 0) return false;
  if (v.notes && v.notes.trim()) return false;
  const obj = rawObject(v.readiness);
  const touched = new Set<string>([...READINESS_KEYS, ...LEGACY_READINESS_KEYS]);
  for (const key of touched) {
    if (Object.hasOwn(obj, key) && obj[key] === true) return false;
  }
  return true;
}

/* ── buckets ── */

export type VisitBucket = "overdue" | "due_soon" | "upcoming";

export const DUE_SOON_DAYS = 14;

/** Derived, never stored: overdue is a date comparison on the account's
    clock, so it can't go stale and can't lie. Only open visits bucket at
    all — done/skipped are history. */
export function bucketFor(dueISO: string, todayISO: string): VisitBucket {
  if (dueISO < todayISO) return "overdue";
  const soonEdge = addDaysISO(todayISO, DUE_SOON_DAYS);
  return dueISO <= soonEdge ? "due_soon" : "upcoming";
}

function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
