import { supabaseAdmin } from "@/lib/supabase-server";
import { todayInAu } from "@/lib/au-dates";
import type {
  AiValuation,
  FleetStaff,
  Vehicle,
  VehicleIdentity,
  VehicleLog,
  VehicleWithFacts,
} from "@/components/fleet/logic";
import type { AssignedVehicle } from "@/components/shell/profile";
import { toIdentity, toLog, toValuation, toVehicle, toVehicleWithFacts } from "./map";

/* Fleet queries. Every one is scoped by org_id, like lib/staff/query.ts, and
   there is no unscoped read in this file.

   THE PROJECTION RULE (lib/projections.ts): the column list is chosen by what
   the caller holds, so a staff member's payload does not merely *hide* the
   valuation — it never contains it. Three widths, narrowest first:

     PICKER  what you may know about a pool vehicle you're fuelling
     FACTS   your own vehicle: + rego / insurance / service cycle
     FULL    the register: + money, assignment, notes, Tiff's valuation

   Do not add a column to a narrower list for convenience. If a screen needs
   more, it needs a capability. */

const PICKER_COLUMNS = "id, name, plate, plate_state, make, model, year, status, odometer";

const FACTS_COLUMNS =
  `${PICKER_COLUMNS}, rego_expiry, insurance_expiry, service_interval_km, last_service_odo`;

const FULL_COLUMNS =
  `${FACTS_COLUMNS}, assigned_to, value, purchase_price, purchase_date, notes, ai_value`;

/** The roster the register's driver picker needs — names and nothing else.
    This is minimum-identity: assigning a vehicle doesn't entitle you to HR. */
export async function listFleetStaff(orgId: string): Promise<FleetStaff[]> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, full_name, preferred_name, status")
    .eq("org_id", orgId)
    .order("full_name");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: (r.preferred_name as string) || (r.full_name as string) || "Unnamed",
    status: (r.status as "Active" | "Inactive") ?? "Active",
  }));
}

/** The whole register — `assets_all` only. Callers must check first. */
export async function listVehicles(
  orgId: string,
  now = new Date(),
): Promise<{ vehicles: Vehicle[]; aiValues: Record<string, AiValuation> }> {
  const today = todayInAu(now);
  const { data } = await supabaseAdmin
    .from("vehicles")
    .select(FULL_COLUMNS)
    .eq("org_id", orgId);

  const vehicles: Vehicle[] = [];
  const aiValues: Record<string, AiValuation> = {};
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const v = toVehicle(r, today);
    vehicles.push(v);
    const val = toValuation(r);
    if (val) aiValues[v.id] = val;
  }
  return { vehicles, aiValues };
}

/** The vehicle assigned to one staff member, at own-vehicle width. Sold
    vehicles never come back — you can't log fuel on something that's gone. */
export async function getOwnVehicle(
  orgId: string,
  staffProfileId: string | null,
  now = new Date(),
): Promise<VehicleWithFacts | null> {
  if (!staffProfileId) return null;
  const { data } = await supabaseAdmin
    .from("vehicles")
    .select(FACTS_COLUMNS)
    .eq("org_id", orgId)
    .eq("assigned_to", staffProfileId)
    .neq("status", "sold")
    .limit(1)
    .maybeSingle();
  return data ? toVehicleWithFacts(data as unknown as Record<string, unknown>, todayInAu(now)) : null;
}

/** Every vehicle you may log against, at PICKER width — the pool ute you
    borrowed today included, and your own. Sold vehicles excluded.

    This is the projection that matters: someone without `assets_all` must
    still be able to act, so they get exactly enough to name a vehicle and
    drive the odometer guardrail. No value, no assignment, no expiries. */
export async function listVehiclePicker(orgId: string): Promise<VehicleIdentity[]> {
  const { data } = await supabaseAdmin
    .from("vehicles")
    .select(PICKER_COLUMNS)
    .eq("org_id", orgId)
    .neq("status", "sold")
    .order("name");
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toIdentity);
}

/** Logs for the whole org (register) or one vehicle (My vehicle). */
export async function listLogs(
  orgId: string,
  opts: { vehicleId?: string; limit?: number } = {},
  now = new Date(),
): Promise<VehicleLog[]> {
  const today = todayInAu(now);
  let q = supabaseAdmin
    .from("vehicle_logs")
    .select("id, vehicle_id, staff_profile_id, kind, logged_on, note, litres, cost, odo, status, source, station")
    .eq("org_id", orgId)
    .order("logged_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 500);
  if (opts.vehicleId) q = q.eq("vehicle_id", opts.vehicleId);
  const { data } = await q;

  const staff = await listFleetStaff(orgId);
  const byId = new Map(staff.map((s) => [s.id, s.name]));
  const nameOf = (id: string | null) => (id ? byId.get(id) : undefined) ?? undefined;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => toLog(r, today, nameOf));
}

/** The profile card's "Assigned vehicle" section, resolved for one staff
    member. Derived from the register — the assignment is stored once, on the
    vehicle, and both the directory column and this card read it from there. */
export async function assignedVehicleFor(
  orgId: string,
  staffProfileId: string,
  now = new Date(),
): Promise<AssignedVehicle | null> {
  const vehicle = await getOwnVehicle(orgId, staffProfileId, now);
  if (!vehicle) return null;
  const logs = await listLogs(orgId, { vehicleId: vehicle.id }, now);
  const fuel = logs.find((l) => l.kind === "fuel");
  return {
    vehicle,
    openIssues: logs.filter((l) => l.kind === "issue" && l.status === "open").length,
    lastFuel: fuel ? { litres: fuel.litres, when: fuel.when } : null,
  };
}

/** The signed-in user's staff record id — what `assignedTo` and log
    attribution are keyed on now that Fleet is off demo ids. */
export async function staffProfileIdFor(orgId: string, userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.id as string) ?? null;
}
