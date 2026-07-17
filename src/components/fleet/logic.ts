/* Fleet — pure logic: vehicle status derivation, prototype-overlay merge,
   filtering, sorting & formatting. Mirrors timepay/logic.ts: everything here
   is side-effect free and jest-covered; React state lives in fleet-state.ts. */

export type Vehicle = {
  id: string;
  callsign: string; // e.g. "VRF-04" — matches DemoStaff.vehicle
  make: string;
  model: string;
  year: number;
  plate: string;
  odometer: number; // km
  assignedTo: string | null; // DemoStaff id; null = pool / unassigned
  value: number; // $ — shown to Manager+ only
  regoDays: number; // days until rego expires (negative = expired)
  insuranceDays: number; // days until insurance expires
  serviceDueKm: number; // odometer reading the next service is due at
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
};

/* ---- status chips ---- */

export type ChipState = "ok" | "warn" | "bad";
export type StatusChip = { label: string; state: ChipState };

export const REGO_WARN_DAYS = 30;
export const INSURANCE_WARN_DAYS = 30;
export const SERVICE_WARN_KM = 1500;

export function serviceKmLeft(v: Vehicle): number {
  return v.serviceDueKm - v.odometer;
}

/** Everything wrong (or soon-wrong) with a vehicle, worst-first. Empty = all good. */
export function vehicleChips(v: Vehicle, openIssues: number): StatusChip[] {
  const chips: StatusChip[] = [];
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

/* ---- prototype overlay (localStorage stands in for the backend) ---- */

export type FleetOverlay = {
  added: Vehicle[];
  edited: Record<string, Vehicle>; // full replacement records, keyed by id
  removed: string[];
  logs: VehicleLog[]; // prototype-added logs (ago 0)
  resolved: string[]; // demo issue-log ids marked resolved
};

export const EMPTY_OVERLAY: FleetOverlay = {
  added: [],
  edited: {},
  removed: [],
  logs: [],
  resolved: [],
};

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

/* ---- register filtering / sorting ---- */

export type FleetTab = "all" | "attention" | "pool";
export type FleetSort = "callsign" | "attention" | "value";

export function filterVehicles(
  vehicles: Vehicle[],
  logs: VehicleLog[],
  tab: FleetTab,
  query: string,
  staffName: (id: string | null) => string,
): Vehicle[] {
  const q = query.trim().toLowerCase();
  return vehicles.filter((v) => {
    if (tab === "attention" && vehicleChips(v, openIssueCount(logs, v.id)).length === 0) return false;
    if (tab === "pool" && v.assignedTo !== null) return false;
    if (!q) return true;
    const hay = `${v.callsign} ${v.make} ${v.model} ${v.plate} ${staffName(v.assignedTo)}`.toLowerCase();
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
    return a.callsign.localeCompare(b.callsign);
  });
}

export function fleetValue(vehicles: Vehicle[]): number {
  return vehicles.reduce((sum, v) => sum + v.value, 0);
}

/* ---- small helpers ---- */

/** "Toyota Hiace ZR 2022" (year omitted when unknown). */
export function vehicleName(v: Vehicle): string {
  return [v.make, v.model, v.year || null].filter(Boolean).join(" ");
}

export function fmtKm(n: number): string {
  return Math.round(n).toLocaleString("en-NZ");
}

export function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-NZ")}`;
}

/** Whole days from today to an ISO date (negative = past). Both args ISO yyyy-mm-dd. */
export function daysUntil(dateISO: string, todayISO: string): number {
  const d = new Date(`${dateISO}T00:00:00Z`).getTime();
  const t = new Date(`${todayISO}T00:00:00Z`).getTime();
  return Math.round((d - t) / 86400000);
}

/** Stable unique id from a callsign ("VRF 09" → "vrf-09", "vrf-09-2" if taken). */
export function slugId(callsign: string, taken: string[]): string {
  const base =
    callsign
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "vehicle";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
