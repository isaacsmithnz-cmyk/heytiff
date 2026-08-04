/* Row <-> view-model mapping for the fleet. Pure and jest-covered; the only
   place that knows `vehicles.rego_expiry` is a date and `Vehicle.regoDays` is
   a number of days.

   Direction matters. Reading, a date becomes a day-count against an AU
   calendar date. Writing, a day-count becomes a date against the same anchor.
   Both live here so they can't drift apart. */

import type {
  AiValuation,
  LogKind,
  Vehicle,
  VehicleIdentity,
  VehicleLog,
  VehicleStatus,
  VehicleWithFacts,
} from "@/components/fleet/logic";
import { daysUntil } from "@/components/fleet/logic";

export type Row = Record<string, unknown>;

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const dateStr = (v: unknown): string | null =>
  typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null;

/** ISO date -> whole days from `today` (null = unknown, treated as far off). */
function daysFrom(iso: unknown, today: string, unknown: number): number {
  const d = dateStr(iso);
  return d ? daysUntil(d, today) : unknown;
}

/** Days-from-today -> ISO date, the inverse of daysFrom. */
export function dateFromDays(days: number, today: string): string {
  const t = new Date(`${today}T00:00:00Z`).getTime();
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/* ---- read ---- */

export function toIdentity(r: Row): VehicleIdentity {
  return {
    id: str(r.id),
    name: str(r.name),
    make: str(r.make),
    model: str(r.model),
    year: num(r.year),
    plate: str(r.plate),
    plateState: typeof r.plate_state === "string" ? r.plate_state : null,
    status: (str(r.status) || "active") as VehicleStatus,
    odometer: num(r.odometer),
  };
}

export function toVehicleWithFacts(r: Row, today: string): VehicleWithFacts {
  return {
    ...toIdentity(r),
    // an unset expiry must not read as "expired" — it reads as "not soon"
    regoDays: daysFrom(r.rego_expiry, today, 365),
    insuranceDays: daysFrom(r.insurance_expiry, today, 365),
    serviceIntervalKm: num(r.service_interval_km, 10_000),
    lastServiceOdo: num(r.last_service_odo),
  };
}

export function toVehicle(r: Row, today: string): Vehicle {
  const purchase = dateStr(r.purchase_date);
  return {
    ...toVehicleWithFacts(r, today),
    assignedTo: typeof r.assigned_to === "string" ? r.assigned_to : null,
    value: num(r.value),
    purchasePrice: num(r.purchase_price),
    // stored as a date; the UI thinks in "days since"
    purchaseDateDays: purchase ? Math.max(0, -daysUntil(purchase, today)) : 0,
    notes: typeof r.notes === "string" && r.notes ? r.notes : undefined,
  };
}

export function toValuation(r: Row): AiValuation | null {
  const v = r.ai_value;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!Number.isFinite(Number(o.point))) return null;
  return {
    point: num(o.point),
    low: num(o.low),
    high: num(o.high),
    note: str(o.note),
    atOdo: num(o.atOdo),
  };
}

/** "Wed 15 Jul" — the log row's date label, formatted in AU. */
export function whenLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(new Date(`${iso}T00:00:00Z`))
    .replace(",", "");
}

export function toLog(
  r: Row,
  today: string,
  staffName?: (id: string | null) => string | undefined,
): VehicleLog {
  const on = dateStr(r.logged_on) ?? today;
  const staffId = typeof r.staff_profile_id === "string" ? r.staff_profile_id : null;
  const optNum = (v: unknown): number | undefined =>
    v === null || v === undefined ? undefined : num(v);
  return {
    id: str(r.id),
    vehicleId: str(r.vehicle_id),
    staffId,
    staffName: staffName?.(staffId),
    kind: str(r.kind) as LogKind,
    when: whenLabel(on),
    ago: -daysUntil(on, today),
    note: typeof r.note === "string" && r.note ? r.note : undefined,
    litres: optNum(r.litres),
    cost: optNum(r.cost),
    odo: optNum(r.odo),
    status: r.status === "open" || r.status === "resolved" ? r.status : undefined,
    source: r.source === "scan" || r.source === "manual" ? r.source : undefined,
    station: typeof r.station === "string" && r.station ? r.station : undefined,
    gst: optNum(r.gst),
    abn: typeof r.supplier_abn === "string" && r.supplier_abn ? r.supplier_abn : undefined,
  };
}

/* ---- write ---- */

/** A Vehicle from the form -> the column set to insert/update. Day-counts turn
    back into dates here; `id` and `org_id` are the caller's business. */
export function vehicleRow(v: Vehicle, today: string): Row {
  return {
    name: v.name,
    plate: v.plate,
    plate_state: v.plateState,
    make: v.make,
    model: v.model,
    year: v.year,
    status: v.status,
    odometer: v.odometer,
    assigned_to: v.assignedTo,
    value: v.value,
    purchase_price: v.purchasePrice,
    purchase_date: v.purchaseDateDays ? dateFromDays(-v.purchaseDateDays, today) : null,
    rego_expiry: dateFromDays(v.regoDays, today),
    insurance_expiry: dateFromDays(v.insuranceDays, today),
    service_interval_km: v.serviceIntervalKm,
    last_service_odo: v.lastServiceOdo,
    notes: v.notes ?? null,
  };
}
