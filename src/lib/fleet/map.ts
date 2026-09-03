/* Row <-> view-model mapping for the fleet. Pure and jest-covered; the only
   place that knows `vehicles.rego_expiry` is a date and `Vehicle.regoDays` is
   a number of days.

   Direction matters. Reading, a date becomes a day-count against an AU
   calendar date. Writing, a day-count becomes a date against the same anchor.
   Both live here so they can't drift apart. */

import type {
  AiValuation,
  BodyType,
  FinanceKind,
  InsuranceCover,
  LogKind,
  PaymentFrequency,
  PolicySource,
  Vehicle,
  VehicleFinance,
  VehicleIdentity,
  VehicleLog,
  VehicleStatus,
  VehicleWithFacts,
} from "@/components/fleet/logic";
import {
  BODY_TYPES,
  FINANCE_KINDS,
  INSURANCE_COVERS,
  PAYMENT_FREQUENCIES,
  daysUntil,
  serviceDaysUntil,
} from "@/components/fleet/logic";

export type Row = Record<string, unknown>;

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const dateStr = (v: unknown): string | null =>
  typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null;
/* Nullable columns keep their null. `num`/`str` above default a missing value
   to 0/"" because the columns they read are NOT NULL and a fallback is the
   honest shape of "the row is malformed"; a spec nobody entered is not
   malformed, it is absent, and 0 kg would be a claim. */
const numN = (v: unknown): number | null => (v == null ? null : num(v));
const strN = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;

/** ISO date -> whole days from `today`. Null column, null answer: every number
    here is a claim about a date, and there is no number that honestly stands
    for one nobody entered. */
function daysFrom(iso: unknown, today: string): number | null {
  const d = dateStr(iso);
  return d ? daysUntil(d, today) : null;
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
    // an unset expiry must not read as "expired", and must not read as a date
    // either — it reads as nothing, and every consumer treats null as silent
    regoDays: daysFrom(r.rego_expiry, today),
    insuranceDays: daysFrom(r.insurance_expiry, today),
    ctpDays: daysFrom(r.ctp_expiry, today),
    /* Null now means "no distance limit" — a trailer has none — so it must
       survive the mapping rather than being defaulted back into one. */
    serviceIntervalKm: r.service_interval_km == null ? null : num(r.service_interval_km),
    lastServiceOdo: num(r.last_service_odo),
    serviceIntervalMonths:
      r.service_interval_months == null ? null : num(r.service_interval_months),
    /* The time limit as a day count, measured here against the SERVER's date
       for the same reason regoDays is: a clock read in a render body breaks
       hydration for the whole tree. Needs BOTH an interval and an anchor —
       with either missing there is no countdown to report. */
    serviceDays: serviceDaysUntil(
      dateStr(r.last_service_on),
      r.service_interval_months == null ? null : num(r.service_interval_months),
      today,
    ),
    motorised: r.motorised !== false,
  };
}

export function toVehicle(r: Row, today: string): Vehicle {
  const purchase = dateStr(r.purchase_date);
  const lastService = dateStr(r.last_service_on);
  return {
    ...toVehicleWithFacts(r, today),
    assignedTo: typeof r.assigned_to === "string" ? r.assigned_to : null,
    // the certificate's facts — see VehicleSpecs for why every one is nullable
    bodyType: oneOf<BodyType>(r.body_type, BODY_TYPES),
    colour: strN(r.colour),
    vin: strN(r.vin),
    engineNumber: strN(r.engine_number),
    engineCapacityCc: numN(r.engine_capacity_cc),
    seating: numN(r.seating),
    tareKg: numN(r.tare_kg),
    gvmKg: numN(r.gvm_kg),
    atmKg: numN(r.atm_kg),
    variant: strN(r.variant),
    regoCustomerNo: strN(r.rego_customer_no),
    photoDocumentId: strN(r.photo_document_id),
    value: num(r.value),
    purchasePrice: num(r.purchase_price),
    // the invoice's own fields — nullable, like the specs, and for the same reason
    purchaseSupplier: strN(r.purchase_supplier),
    purchaseInvoiceNo: strN(r.purchase_invoice_no),
    purchaseExGst: numN(r.purchase_ex_gst),
    purchaseGst: numN(r.purchase_gst),
    purchaseOnRoad: numN(r.purchase_on_road),
    purchaseDeposit: numN(r.purchase_deposit),
    purchaseOdometer: numN(r.purchase_odometer),
    // stored as a date; the UI thinks in "days since"
    purchaseDateDays: purchase ? Math.max(0, -daysUntil(purchase, today)) : 0,
    lastServiceDays: lastService ? -daysUntil(lastService, today) : null,
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
    edited: r.edited_at ? true : undefined,
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
    /* A cleared field writes NULL, not a date a year out. This is the write
       half of the same rule: the form can no longer hand back a stand-in, so
       the column can no longer be filled with one. */
    rego_expiry: v.regoDays == null ? null : dateFromDays(v.regoDays, today),
    insurance_expiry: v.insuranceDays == null ? null : dateFromDays(v.insuranceDays, today),
    ctp_expiry: v.ctpDays == null ? null : dateFromDays(v.ctpDays, today),
    service_interval_km: v.serviceIntervalKm,
    last_service_odo: v.lastServiceOdo,
    service_interval_months: v.serviceIntervalMonths,
    last_service_on: v.lastServiceDays == null ? null : dateFromDays(-v.lastServiceDays, today),
    motorised: v.motorised,
    notes: v.notes ?? null,
    body_type: v.bodyType ?? null,
    colour: v.colour ?? null,
    vin: v.vin ?? null,
    engine_number: v.engineNumber ?? null,
    engine_capacity_cc: v.engineCapacityCc ?? null,
    seating: v.seating ?? null,
    tare_kg: v.tareKg ?? null,
    gvm_kg: v.gvmKg ?? null,
    atm_kg: v.atmKg ?? null,
    variant: v.variant ?? null,
    rego_customer_no: v.regoCustomerNo ?? null,
    purchase_supplier: v.purchaseSupplier ?? null,
    purchase_invoice_no: v.purchaseInvoiceNo ?? null,
    purchase_ex_gst: v.purchaseExGst ?? null,
    purchase_gst: v.purchaseGst ?? null,
    purchase_on_road: v.purchaseOnRoad ?? null,
    purchase_deposit: v.purchaseDeposit ?? null,
    purchase_odometer: v.purchaseOdometer ?? null,
    /* Deliberately NOT written here: the photo is set by its own action, which
       adopts the document at the same time. A form save that carried the
       pointer would let a stale form detach a photo somebody just set. */
  };
}

/** A policy row as the app's record, detail columns included. */
export function policyDetail(r: Row): {
  policyNumber: string | null;
  cover: InsuranceCover | null;
  excess: number | null;
  termMonths: number | null;
  garagingPostcode: string | null;
  inspectionOn: string | null;
  source: PolicySource | null;
} {
  return {
    policyNumber: strN(r.policy_number),
    cover: oneOf<InsuranceCover>(r.cover, INSURANCE_COVERS),
    excess: numN(r.excess),
    termMonths: numN(r.term_months),
    garagingPostcode: strN(r.garaging_postcode),
    inspectionOn: dateStr(r.inspection_on),
    source: oneOf<PolicySource>(r.source, ["scan", "manual"] as const),
  };
}

/** A finance row as the app's record — or null when the row cannot state a
    schedule, because an agreement with no lender, start or term is not one. */
export function toFinance(r: Row): VehicleFinance | null {
  const lender = strN(r.lender);
  const startsOn = dateStr(r.starts_on);
  const termMonths = numN(r.term_months);
  if (!lender || !startsOn || !termMonths || termMonths <= 0) return null;
  return {
    id: String(r.id),
    lender,
    agreementNo: strN(r.agreement_no),
    kind: oneOf<FinanceKind>(r.kind, FINANCE_KINDS),
    startsOn,
    termMonths: Math.round(termMonths),
    repayment: numN(r.repayment),
    frequency: oneOf<PaymentFrequency>(r.frequency, PAYMENT_FREQUENCIES) ?? "monthly",
    ratePct: numN(r.rate_pct),
    balloon: numN(r.balloon),
    amountFinanced: numN(r.amount_financed),
    documentId: strN(r.document_id),
    source: oneOf<PolicySource>(r.source, ["scan", "manual"] as const),
    createdAt: typeof r.created_at === "string" ? r.created_at : undefined,
  };
}
