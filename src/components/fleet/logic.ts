/* Fleet — pure logic: vehicle status derivation, the odometer guardrail,
   valuation parsing, filtering, sorting & formatting. Mirrors timepay/logic.ts:
   everything here is side-effect free and jest-covered. Data comes from
   lib/fleet/query.ts and mutations go through app/actions/fleet.ts; this file
   knows about neither. */

import { agoLabel, expiryClause, inLabel } from "@/lib/format/duration";

export type VehicleStatus = "active" | "offroad" | "sold";

/* The vehicle type comes in three widths, and they are the projection boundary
   (lib/projections.ts) written as types — a function that only needs identity
   takes VehicleIdentity, so it cannot accidentally be passed data a staff
   member was never sent.

   Day-counts (regoDays, insuranceDays) are a VIEW of real `date` columns,
   derived once at the query boundary against an AU calendar date. Nothing
   below this line knows a date exists. */

/** What anyone may see about a vehicle they're allowed to act on — the pool
    picker's payload, and nothing more (VEHICLE_PICKER_FIELDS). */
export type VehicleIdentity = {
  id: string;
  /** Optional friendly name / fleet no. (e.g. "VRF-04"); rego is the fallback identity. */
  name: string;
  make: string;
  model: string;
  year: number;
  plate: string; // rego plate — the primary identifier
  /** AU plates are only unique within a state/territory; null = unstated. */
  plateState: string | null;
  status: VehicleStatus;
  odometer: number; // km — drives the can't-go-backwards guardrail
};

/** Your own vehicle: identity plus the compliance facts My vehicle exists to
    show. Still no money and no assignment — those are register knowledge. */
export type VehicleWithFacts = VehicleIdentity & {
  regoDays: number; // days until rego expires (negative = expired)
  insuranceDays: number; // days until insurance expires
  serviceIntervalKm: number; // service every N km
  lastServiceOdo: number; // odometer at the last completed service
};

/** The full register record — `assets_all` only. */
export type Vehicle = VehicleWithFacts & {
  assignedTo: string | null; // staff_profiles.id; null = pool / unassigned
  value: number; // $ book value
  purchasePrice: number; // $ — 0 = unknown; feeds the Tiff estimate
  purchaseDateDays: number; // days since purchase (0 = unknown/new)
  notes?: string;
};

/** The roster as Fleet knows it. Assigning a vehicle needs a name and whether
    they still work here — not an HR record. Sourced by lib/fleet/query.ts. */
export type FleetStaff = { id: string; name: string; status: "Active" | "Inactive" };

export type LogKind = "fuel" | "odo" | "issue" | "service";

/** What the log modal submits. Who logged it, when, and which org are the
    server's to decide — a client that could name the author could name
    someone else. */
/* WHOSE MONEY BOUGHT THE FUEL. It decides what the log produces beyond itself:
   a company card is the business's own spend and stops at the vehicle log (and
   the tax line it feeds), while a personal card leaves someone out of pocket
   and must also raise an expense claim so they get paid back. */
export const FUEL_PAYERS = ["company", "own"] as const;
export type FuelPayer = (typeof FUEL_PAYERS)[number];

export const FUEL_PAYER_LABEL: Record<FuelPayer, string> = {
  company: "Company card",
  own: "My own money",
};

export function isFuelPayer(v: unknown): v is FuelPayer {
  return typeof v === "string" && (FUEL_PAYERS as readonly string[]).includes(v);
}

export type NewLog = {
  vehicleId: string;
  kind: LogKind;
  note?: string;
  litres?: number;
  cost?: number;
  odo?: number;
  source?: "scan" | "manual";
  station?: string;
  /* ---- the tax half of a fuel log ---- */
  /** GST as printed on the docket. Absent means the docket didn't show one —
      never a calculated eleventh. */
  gst?: number;
  /** Supplier ABN, eleven digits, no spaces. */
  abn?: string;
  /** The date on the docket. Absent = bought today, which is the common case;
      the server decides either way and refuses anything implausible. */
  purchasedOn?: string;
  /** The stored receipt photo, already uploaded, waiting to be adopted. */
  receiptDocumentId?: string;
  /** Fuel only. Defaults to `company` — the common case, and the one that
      raises nothing extra. `own` also raises a reimbursement claim. */
  paidWith?: FuelPayer;
};

export type VehicleLog = {
  id: string;
  vehicleId: string;
  staffId: string | null; // who logged it (null = imported / system)
  staffName?: string;
  kind: LogKind;
  when: string; // display date, e.g. "Wed 15 Jul"
  ago: number; // days ago — drives newest-first ordering
  note?: string;
  litres?: number;
  cost?: number;
  odo?: number;
  status?: "open" | "resolved"; // issues only
  source?: "scan" | "manual"; // fuel logs: receipt-scanned vs typed
  station?: string; // fuel logs: where the fill happened
  gst?: number; // fuel logs: GST as printed on the docket
  abn?: string; // fuel logs: supplier ABN, eleven digits
  /** True when the docket photo is stored against this log — the difference
      between a figure somebody typed and one you can produce at audit. */
  hasReceipt?: boolean;
  /** True once somebody has corrected this entry. Said on the row rather than
      hidden: a figure that has been changed is a different kind of fact from
      one nobody has touched. */
  edited?: boolean;
};

export const STATUS_LABEL: Record<VehicleStatus, string> = {
  active: "In service",
  offroad: "Off road",
  sold: "Sold",
};

/** Row/hero identity: friendly name when set, else the rego plate. */
export function displayName(v: VehicleIdentity): string {
  return v.name || v.plate;
}

/** "Toyota Hiace ZR 2022" (year omitted when unknown). */
export function modelLabel(v: VehicleIdentity): string {
  return [v.make, v.model, v.year || null].filter(Boolean).join(" ");
}

/* ---- service schedule (interval-based; Log service resets the cycle) ---- */

export function serviceDueKm(v: VehicleWithFacts): number {
  return v.lastServiceOdo + v.serviceIntervalKm;
}

export function serviceKmLeft(v: VehicleWithFacts): number {
  return serviceDueKm(v) - v.odometer;
}

/* ---- status chips ---- */

export type ChipState = "ok" | "warn" | "bad";
export type StatusChip = { label: string; state: ChipState };

export const REGO_WARN_DAYS = 30;
export const INSURANCE_WARN_DAYS = 30;
export const SERVICE_WARN_KM = 1500;

/** Everything wrong (or soon-wrong) with a vehicle, worst-first. Empty = all good. */
export function vehicleChips(v: VehicleWithFacts, openIssues: number): StatusChip[] {
  if (v.status === "sold") return [];
  const chips: StatusChip[] = [];
  if (v.status === "offroad") chips.push({ label: "Off road", state: "bad" });
  // one label for both tenses now that expiryClause carries the tense itself
  if (v.regoDays <= REGO_WARN_DAYS)
    chips.push({ label: `Rego ${expiryClause(v.regoDays)}`, state: v.regoDays < 0 ? "bad" : "warn" });
  if (v.insuranceDays < 0) chips.push({ label: "Insurance expired", state: "bad" });
  else if (v.insuranceDays <= INSURANCE_WARN_DAYS)
    chips.push({ label: `Insurance ${expiryClause(v.insuranceDays)}`, state: "warn" });
  const left = serviceKmLeft(v);
  if (left < 0) chips.push({ label: `Service overdue ${fmtKm(-left)} km`, state: "bad" });
  else if (left <= SERVICE_WARN_KM) chips.push({ label: `Service in ${fmtKm(left)} km`, state: "warn" });
  if (openIssues > 0)
    chips.push({ label: openIssues === 1 ? "1 issue open" : `${openIssues} issues open`, state: "warn" });
  const order: ChipState[] = ["bad", "warn", "ok"];
  return chips.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
}

export function worstState(chips: StatusChip[]): ChipState {
  if (chips.some((c) => c.state === "bad")) return "bad";
  if (chips.some((c) => c.state === "warn")) return "warn";
  return "ok";
}

/* ---- shared fact derivation (detail modal + my-vehicle tiles) ---- */

export type VehicleFact = { key: string; label: string; text: string; state: ChipState };

export function vehicleFacts(v: VehicleWithFacts): VehicleFact[] {
  const left = serviceKmLeft(v);
  return [
    { key: "odo", label: "Odometer", text: `${fmtKm(v.odometer)} km`, state: "ok" },
    {
      key: "service",
      label: "Next service",
      text: left < 0 ? `${fmtKm(-left)} km overdue` : `in ${fmtKm(left)} km`,
      state: left < 0 ? "bad" : left <= SERVICE_WARN_KM ? "warn" : "ok",
    },
    {
      key: "rego",
      label: "Rego",
      text: v.regoDays < 0 ? `expired ${agoLabel(v.regoDays)}` : `renews ${inLabel(v.regoDays)}`,
      state: v.regoDays < 0 ? "bad" : v.regoDays <= REGO_WARN_DAYS ? "warn" : "ok",
    },
    {
      key: "insurance",
      label: "Insurance",
      text: v.insuranceDays < 0 ? "expired" : `renews ${inLabel(v.insuranceDays)}`,
      state: v.insuranceDays < 0 ? "bad" : v.insuranceDays <= INSURANCE_WARN_DAYS ? "warn" : "ok",
    },
  ];
}

/* ---- Tiff valuations (real AI — src/app/actions/fleet-ai.ts) ----
   The server action asks Claude for AU-market valuations; the validated
   results are cached on vehicles.ai_value, stamped with the odometer they were
   computed at. Manager+ only — the column is in the `assets_all` projection
   and nowhere else. */

/* A renewal on file — one insurance policy or rego period. The newest
   expires_on is current; the rest are the history, and the vehicle's expiry
   column is a cache of the newest. `premium` is null when the document didn't
   print one: never derived, for the same reason fuel GST isn't. */
export type VehiclePolicy = {
  id: string;
  kind: "insurance" | "rego";
  provider: string | null;
  premium: number | null;
  startsOn: string | null;
  expiresOn: string;
  documentId: string | null;
};

export type AiValuation = {
  point: number;
  low: number;
  high: number;
  note: string;
  atOdo: number; // odometer reading when Tiff valued it
};

export const VALUATION_STALE_KM = 2000;

/** A valuation goes stale once the vehicle has driven well past where it was valued. */
export function valuationStale(v: VehicleIdentity, val: AiValuation | undefined): boolean {
  return !!val && v.odometer - val.atOdo > VALUATION_STALE_KM;
}

/** Validate/clamp raw model output against the actual fleet. Unknown ids and
    junk entries are dropped; low/high are ordered, point clamped between them,
    everything rounded to $100 and stamped with the vehicle's current odo. */
export function parseValuations(raw: unknown, vehicles: VehicleIdentity[]): Record<string, AiValuation> {
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const out: Record<string, AiValuation> = {};
  const list = (raw as { valuations?: unknown })?.valuations;
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const v = byId.get(String(rec.id));
    if (!v) continue;
    let low = Number(rec.low);
    let high = Number(rec.high);
    let point = Number(rec.point);
    if (![low, high, point].every((n) => Number.isFinite(n) && n >= 0)) continue;
    if (low > high) [low, high] = [high, low];
    point = Math.min(high, Math.max(low, point));
    const r = (n: number) => Math.max(0, Math.round(n / 100) * 100);
    out[v.id] = {
      point: r(point),
      low: r(low),
      high: r(high),
      note: typeof rec.note === "string" ? rec.note.slice(0, 200) : "",
      atOdo: v.odometer,
    };
  }
  return out;
}

/* ---- odometer guardrail ----
   A reading can only ever go forward. The modal shows this as a hint before
   you save; the server action re-runs it, because the modal is not a control. */

export function odoRejection(current: number, reading: number | undefined): string | null {
  if (typeof reading !== "number" || !Number.isFinite(reading)) return null;
  if (reading < 0) return "An odometer reading can't be negative.";
  if (reading < current)
    return `That's below the last reading of ${fmtKm(current)} km — odometers only go forward.`;
  return null;
}

/** What a log does to its vehicle's odometer/service cycle. Returns the fields
    to patch, or null when the log leaves the vehicle alone (issues, no reading). */
export function odoEffect(
  v: Pick<Vehicle, "odometer" | "lastServiceOdo">,
  log: { kind: LogKind; odo?: number },
): { odometer: number; lastServiceOdo?: number } | null {
  if (typeof log.odo !== "number") return null;
  // a completed service resets the cycle from its own reading
  if (log.kind === "service")
    return { odometer: Math.max(v.odometer, log.odo), lastServiceOdo: log.odo };
  return log.odo > v.odometer ? { odometer: log.odo } : null;
}

/* What the vehicle's odometer should be once a log has been edited or removed.

   RECOMPUTED, never reversed. Undoing a delta ("this log added 680 km, take
   them back") needs the odometer to have been touched by nothing else since,
   which is not true the moment two people log a fill on the same day. The
   surviving readings are the whole truth, and the guardrail guarantees the
   answer: a reading below the current odometer is refused at save time, so the
   highest surviving reading is always where the vehicle actually is.

   WHEN NOTHING SURVIVES the value is left alone, because it cannot be
   recovered — a vehicle is added with an odometer already on it, and that
   number exists nowhere else. Left alone it reads high, which is the safe
   direction: the guardrail only ever refuses readings that are too LOW.

   The service cycle is left alone for the same reason and a sharper one: it is
   a field on the vehicle that a manager sets directly, and logs only push it
   forward. Wiping it because the last service log was deleted would throw away
   something nobody asked to delete. */
export function odoRecompute(
  logs: readonly { kind: LogKind; odo?: number }[],
  current: { odometer: number; lastServiceOdo: number },
): { odometer: number; lastServiceOdo: number } {
  const readings = logs.map((l) => l.odo).filter((o): o is number => typeof o === "number");
  const services = logs
    .filter((l) => l.kind === "service")
    .map((l) => l.odo)
    .filter((o): o is number => typeof o === "number");
  return {
    odometer: readings.length > 0 ? Math.max(...readings) : current.odometer,
    lastServiceOdo: services.length > 0 ? Math.max(...services) : current.lastServiceOdo,
  };
}

export function logsFor(logs: VehicleLog[], vehicleId: string): VehicleLog[] {
  return logs.filter((l) => l.vehicleId === vehicleId);
}

export function openIssueCount(logs: VehicleLog[], vehicleId: string): number {
  return logs.filter((l) => l.vehicleId === vehicleId && l.kind === "issue" && l.status === "open").length;
}

/* ---- offline receipt fallback (deterministic — no Tiff needed) ----
   When the readFuelReceipt action can't run (no API key, offline dev), derive
   a plausible AU fill from the image's file size so the scan flow still demos:
   same file, same reading. */

export const RECEIPT_STATIONS = [
  "Shell Coburg",
  "BP Ringwood",
  "Ampol Dandenong",
  "7-Eleven Preston",
  "United Braeside",
];

export function readReceiptOffline(fileSizeBytes: number): {
  litres: number;
  cost: number;
  station: string;
} {
  const size = Math.max(0, Math.floor(fileSizeBytes));
  const litres = Math.round((45 + (size % 300) / 10) * 10) / 10; // 45.0–74.9 L
  const perLitre = 1.75 + (size % 40) / 100; // $1.75–$2.14
  const cost = Math.round(litres * perLitre * 100) / 100;
  return { litres, cost, station: RECEIPT_STATIONS[size % RECEIPT_STATIONS.length] };
}

/** L/100km per fuel log, from the odo delta since the previous fill. */
export function fuelEconomy(logs: VehicleLog[]): Record<string, number> {
  const out: Record<string, number> = {};
  const fills = logs
    .filter((l) => l.kind === "fuel" && typeof l.odo === "number" && (l.litres ?? 0) > 0)
    .sort((a, b) => b.ago - a.ago); // oldest → newest
  for (let i = 1; i < fills.length; i++) {
    const dist = (fills[i].odo as number) - (fills[i - 1].odo as number);
    if (dist <= 0) continue;
    const e = ((fills[i].litres as number) / dist) * 100;
    if (e >= 2 && e <= 40) out[fills[i].id] = Math.round(e * 10) / 10;
  }
  return out;
}

/* ---- register filtering / sorting ---- */

export type FleetTab = "all" | "attention" | "pool" | "sold";
export type FleetSort = "attention" | "name" | "value";

export function filterVehicles(
  vehicles: Vehicle[],
  logs: VehicleLog[],
  tab: FleetTab,
  query: string,
  staffName: (id: string | null) => string,
): Vehicle[] {
  const q = query.trim().toLowerCase();
  return vehicles.filter((v) => {
    if (tab === "sold") {
      if (v.status !== "sold") return false;
    } else {
      if (v.status === "sold") return false;
      if (tab === "attention" && vehicleChips(v, openIssueCount(logs, v.id)).length === 0) return false;
      if (tab === "pool" && v.assignedTo !== null) return false;
    }
    if (!q) return true;
    const hay = `${v.name} ${v.make} ${v.model} ${v.plate} ${staffName(v.assignedTo)}`.toLowerCase();
    return hay.includes(q);
  });
}

export function sortVehicles(vehicles: Vehicle[], logs: VehicleLog[], sort: FleetSort): Vehicle[] {
  const rank: Record<ChipState, number> = { bad: 0, warn: 1, ok: 2 };
  return [...vehicles].sort((a, b) => {
    if (sort === "value") return b.value - a.value;
    if (sort === "attention") {
      const wa = rank[worstState(vehicleChips(a, openIssueCount(logs, a.id)))];
      const wb = rank[worstState(vehicleChips(b, openIssueCount(logs, b.id)))];
      if (wa !== wb) return wa - wb;
    }
    return displayName(a).localeCompare(displayName(b));
  });
}

/** Book + Tiff totals across the working fleet (sold excluded from both). */
export function fleetValue(vehicles: Vehicle[]): number {
  return vehicles.filter((v) => v.status !== "sold").reduce((sum, v) => sum + v.value, 0);
}

/** Sum of Tiff point estimates across valued working vehicles; null until any exist. */
export function fleetAiValue(
  vehicles: Vehicle[],
  aiValues: Record<string, AiValuation>,
): number | null {
  const points = vehicles
    .filter((v) => v.status !== "sold")
    .map((v) => aiValues[v.id]?.point)
    .filter((n): n is number => typeof n === "number");
  if (points.length === 0) return null;
  return points.reduce((a, b) => a + b, 0);
}

/* ---- small helpers ---- */

export function fmtKm(n: number): string {
  return Math.round(n).toLocaleString("en-AU");
}

export function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}

/** Money with cents — fuel dockets ($158.40). */
export function fmtCost(n: number): string {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* Whole days from today to an ISO date (negative = past). The implementation
   moved to lib/au-dates.ts, beside the `todayInAu` that has to produce its
   second argument; this re-export keeps fleet's own callers pointed here. */
export { daysUntil } from "@/lib/au-dates";

/** Stable unique id from a name/plate ("VRF 09" → "vrf-09", "vrf-09-2" if taken). */
export function slugId(label: string, taken: string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "vehicle";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
