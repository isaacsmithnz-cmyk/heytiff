/* Fleet — pure logic: vehicle status derivation, AI value model, prototype-
   overlay merge, filtering, sorting & formatting. Mirrors timepay/logic.ts:
   everything here is side-effect free and jest-covered; React state lives in
   fleet-state.ts. */

export type VehicleStatus = "active" | "offroad" | "sold";

export type Vehicle = {
  id: string;
  /** Optional friendly name / fleet no. (e.g. "VRF-04"); rego is the fallback identity. */
  name: string;
  make: string;
  model: string;
  year: number;
  plate: string; // rego plate — the primary identifier
  status: VehicleStatus;
  odometer: number; // km
  assignedTo: string | null; // DemoStaff id; null = pool / unassigned
  value: number; // $ book value — shown to Manager+ only
  purchasePrice: number; // $ — 0 = unknown; feeds the Tiff estimate
  purchaseDateDays: number; // days since purchase (0 = unknown/new)
  regoDays: number; // days until rego expires (negative = expired)
  insuranceDays: number; // days until insurance expires
  serviceIntervalKm: number; // service every N km
  lastServiceOdo: number; // odometer at the last completed service
  notes?: string;
};

export type LogKind = "fuel" | "odo" | "issue" | "service";

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
};

export const STATUS_LABEL: Record<VehicleStatus, string> = {
  active: "In service",
  offroad: "Off road",
  sold: "Sold",
};

/** Row/hero identity: friendly name when set, else the rego plate. */
export function displayName(v: Vehicle): string {
  return v.name || v.plate;
}

/** "Toyota Hiace ZR 2022" (year omitted when unknown). */
export function modelLabel(v: Vehicle): string {
  return [v.make, v.model, v.year || null].filter(Boolean).join(" ");
}

/* ---- service schedule (interval-based; Log service resets the cycle) ---- */

export function serviceDueKm(v: Vehicle): number {
  return v.lastServiceOdo + v.serviceIntervalKm;
}

export function serviceKmLeft(v: Vehicle): number {
  return serviceDueKm(v) - v.odometer;
}

/* ---- status chips ---- */

export type ChipState = "ok" | "warn" | "bad";
export type StatusChip = { label: string; state: ChipState };

export const REGO_WARN_DAYS = 30;
export const INSURANCE_WARN_DAYS = 30;
export const SERVICE_WARN_KM = 1500;

/** Everything wrong (or soon-wrong) with a vehicle, worst-first. Empty = all good. */
export function vehicleChips(v: Vehicle, openIssues: number): StatusChip[] {
  if (v.status === "sold") return [];
  const chips: StatusChip[] = [];
  if (v.status === "offroad") chips.push({ label: "Off road", state: "bad" });
  if (v.regoDays < 0) chips.push({ label: `Rego expired ${-v.regoDays}d ago`, state: "bad" });
  else if (v.regoDays <= REGO_WARN_DAYS) chips.push({ label: `Rego ${v.regoDays}d`, state: "warn" });
  if (v.insuranceDays < 0) chips.push({ label: "Insurance expired", state: "bad" });
  else if (v.insuranceDays <= INSURANCE_WARN_DAYS)
    chips.push({ label: `Insurance ${v.insuranceDays}d`, state: "warn" });
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

export function vehicleFacts(v: Vehicle): VehicleFact[] {
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
      text: v.regoDays < 0 ? `expired ${-v.regoDays}d ago` : `renews in ${v.regoDays}d`,
      state: v.regoDays < 0 ? "bad" : v.regoDays <= REGO_WARN_DAYS ? "warn" : "ok",
    },
    {
      key: "insurance",
      label: "Insurance",
      text: v.insuranceDays < 0 ? "expired" : `renews in ${v.insuranceDays}d`,
      state: v.insuranceDays < 0 ? "bad" : v.insuranceDays <= INSURANCE_WARN_DAYS ? "warn" : "ok",
    },
  ];
}

/* ---- Tiff valuations (real AI — src/app/actions/fleet-ai.ts) ----
   The server action asks Claude for AU-market valuations; the validated
   results live in the prototype overlay (aiValues) stamped with the odometer
   they were computed at. Manager+ only in the UI, like every valuation. */

export type AiValuation = {
  point: number;
  low: number;
  high: number;
  note: string;
  atOdo: number; // odometer reading when Tiff valued it
};

export const VALUATION_STALE_KM = 2000;

/** A valuation goes stale once the vehicle has driven well past where it was valued. */
export function valuationStale(v: Vehicle, val: AiValuation | undefined): boolean {
  return !!val && v.odometer - val.atOdo > VALUATION_STALE_KM;
}

/** Validate/clamp raw model output against the actual fleet. Unknown ids and
    junk entries are dropped; low/high are ordered, point clamped between them,
    everything rounded to $100 and stamped with the vehicle's current odo. */
export function parseValuations(raw: unknown, vehicles: Vehicle[]): Record<string, AiValuation> {
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

/* ---- prototype overlay (localStorage stands in for the backend) ---- */

export type FleetOverlay = {
  added: Vehicle[];
  edited: Record<string, Vehicle>; // full replacement records, keyed by id
  removed: string[];
  logs: VehicleLog[]; // prototype-added logs (ago 0)
  resolved: string[]; // demo issue-log ids marked resolved
  aiValues: Record<string, AiValuation>; // Tiff valuations, keyed by vehicle id
};

export const EMPTY_OVERLAY: FleetOverlay = {
  added: [],
  edited: {},
  removed: [],
  logs: [],
  resolved: [],
  aiValues: {},
};

/** Backfill v2 fields on records stored by older prototype builds (LS overlays). */
export function migrateVehicle(raw: Partial<Vehicle> & { callsign?: string; serviceDueKm?: number }): Vehicle {
  const odometer = raw.odometer ?? 0;
  const interval = raw.serviceIntervalKm ?? 10000;
  return {
    id: raw.id ?? "vehicle",
    name: raw.name ?? raw.callsign ?? "",
    make: raw.make ?? "",
    model: raw.model ?? "",
    year: raw.year ?? 0,
    plate: raw.plate ?? "",
    status: raw.status ?? "active",
    odometer,
    assignedTo: raw.assignedTo ?? null,
    value: raw.value ?? 0,
    purchasePrice: raw.purchasePrice ?? 0,
    purchaseDateDays: raw.purchaseDateDays ?? 0,
    regoDays: raw.regoDays ?? 365,
    insuranceDays: raw.insuranceDays ?? 365,
    serviceIntervalKm: interval,
    // old records stored the due odometer directly — rebuild the cycle from it
    lastServiceOdo: raw.lastServiceOdo ?? (raw.serviceDueKm ? raw.serviceDueKm - interval : odometer),
    notes: raw.notes,
  };
}

export function mergeFleet(demo: Vehicle[], o: FleetOverlay): Vehicle[] {
  const base = demo.filter((v) => !o.removed.includes(v.id)).map((v) => o.edited[v.id] ?? v);
  return [...base, ...o.added.filter((v) => !o.removed.includes(v.id))];
}

/** Newest first: prototype logs (ago 0) sit above demo history. */
export function mergeLogs(demo: VehicleLog[], o: FleetOverlay): VehicleLog[] {
  const marked = demo.map((l) =>
    l.kind === "issue" && o.resolved.includes(l.id) ? { ...l, status: "resolved" as const } : l,
  );
  return [...o.logs, ...marked].sort((a, b) => a.ago - b.ago);
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

/** Whole days from today to an ISO date (negative = past). Both args ISO yyyy-mm-dd. */
export function daysUntil(dateISO: string, todayISO: string): number {
  const d = new Date(`${dateISO}T00:00:00Z`).getTime();
  const t = new Date(`${todayISO}T00:00:00Z`).getTime();
  return Math.round((d - t) / 86400000);
}

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
