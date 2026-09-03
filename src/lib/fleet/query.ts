import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase-server";
import { todayInAu } from "@/lib/au-dates";
import { displayNameOf } from "@/lib/staff/name";
import type {
  AiValuation,
  VehiclePolicy,
  FleetStaff,
  RenewalKind,
  Vehicle,
  VehicleFinance,
  VehicleIdentity,
  VehicleLog,
  VehicleWithFacts,
} from "@/components/fleet/logic";
import { RENEWAL_KINDS } from "@/components/fleet/logic";
/* The Assigned-vehicle join this module resolves. It lived in
   components/shell/profile.ts (the injected-HTML renderer) until that module
   was deleted; the staff card's own types module already carried an identical
   copy, so the type now has ONE home — the card that renders it — and this is
   the same direction as the VehicleWithFacts import above. */
import type { AssignedVehicle } from "@/components/profile/types";
import { policyDetail, toFinance, toIdentity, toLog, toValuation, toVehicle, toVehicleWithFacts } from "./map";
import type { RenewalReminder } from "./reminders";

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
  `${PICKER_COLUMNS}, rego_expiry, insurance_expiry, ctp_expiry, service_interval_km, last_service_odo` +
  `, service_interval_months, last_service_on, motorised`;

const FULL_COLUMNS =
  `${FACTS_COLUMNS}, assigned_to, value, purchase_price, purchase_date, notes, ai_value` +
  `, body_type, colour, vin, engine_number, engine_capacity_cc, seating, tare_kg, gvm_kg, atm_kg` +
  `, variant, rego_customer_no, photo_document_id` +
  `, purchase_supplier, purchase_invoice_no, purchase_ex_gst, purchase_gst, purchase_on_road, purchase_deposit, purchase_odometer`;

/** The roster the register's driver picker needs — names and nothing else.
    This is minimum-identity: assigning a vehicle doesn't entitle you to HR. */
export async function listFleetStaff(orgId: string): Promise<FleetStaff[]> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, first_name, last_name, full_name, preferred_name, status")
    .eq("org_id", orgId)
    .order("first_name")
    .order("last_name");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: displayNameOf(r),
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
    .select(
      "id, vehicle_id, staff_profile_id, kind, logged_on, note, litres, cost, odo, status, source, station, gst, supplier_abn, edited_at",
    )
    .eq("org_id", orgId)
    // a corrected-away entry is gone from every screen; the row survives so a
    // figure that once reached a tax export can still be accounted for
    .is("deleted_at", null)
    .order("logged_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 500);
  if (opts.vehicleId) q = q.eq("vehicle_id", opts.vehicleId);
  const { data } = await q;

  const staff = await listFleetStaff(orgId);
  const byId = new Map(staff.map((s) => [s.id, s.name]));
  const nameOf = (id: string | null) => (id ? byId.get(id) : undefined) ?? undefined;
  const logs = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) =>
    toLog(r, today, nameOf),
  );

  /* Which of these have the docket behind them. Ids only — the URL is not
     signed here, because the fleet screens show a CHIP, not the photo; the
     Tax screen is where a receipt gets opened, and it signs its own. */
  const withReceipt = await logsWithReceipts(
    orgId,
    logs.filter((l) => l.kind === "fuel").map((l) => l.id),
  );
  return logs.map((l) => (withReceipt.has(l.id) ? { ...l, hasReceipt: true } : l));
}

/** The subset of these logs that have a stored receipt. */
async function logsWithReceipts(orgId: string, logIds: string[]): Promise<Set<string>> {
  if (logIds.length === 0) return new Set();
  const { data } = await supabaseAdmin
    .from("documents")
    .select("vehicle_log_id")
    .eq("org_id", orgId)
    .in("vehicle_log_id", logIds)
    .not("uploaded_at", "is", null);
  return new Set(((data ?? []) as Record<string, unknown>[]).map((r) => String(r.vehicle_log_id)));
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
    attribution are keyed on now that Fleet is off demo ids.

    React-cached per request, like getMembership() in permissions-server. This
    is the most-asked question in the app: nearly every loader and every server
    action opens by resolving "who am I here", and a single page render used to
    ask it several times over — /dashboard/timepay asked twice before it read a
    single timesheet. One org+user pair is one round trip to Singapore, and the
    answer cannot change mid-request. */
export const staffProfileIdFor = cache(
  async (orgId: string, userId: string): Promise<string | null> => {
    const { data } = await supabaseAdmin
      .from("staff_profiles")
      .select("id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    return (data?.id as string) ?? null;
  }
);

/** A stored kind as the app's union. Anything unrecognised reads as insurance
    rather than throwing: a row written by a newer deploy must not take out the
    whole register's renewal panel on an older one. */
function asRenewalKind(value: unknown): RenewalKind {
  return RENEWAL_KINDS.includes(value as RenewalKind) ? (value as RenewalKind) : "insurance";
}

/* Every renewal a fleet has on file, newest first, keyed by vehicle.

   This is the record; `vehicles.insurance_expiry` is a cache of the newest
   row here. The register renders "current" as the first entry and everything
   under it as history — nothing is flagged or moved, so the two can never
   disagree. `assets_all` only, like the rest of this file's full-width reads. */
export async function listPolicies(orgId: string): Promise<Record<string, VehiclePolicy[]>> {
  const { data } = await supabaseAdmin
    .from("vehicle_policies")
    .select(
      "id, vehicle_id, kind, provider, premium, starts_on, expires_on, document_id" +
        ", policy_number, cover, excess, term_months, garaging_postcode, inspection_on, source, created_at",
    )
    .eq("org_id", orgId)
    .order("expires_on", { ascending: false });

  const out: Record<string, VehiclePolicy[]> = {};
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const key = String(r.vehicle_id);
    (out[key] ??= []).push({
      id: String(r.id),
      kind: asRenewalKind(r.kind),
      provider: (r.provider as string) ?? null,
      premium: r.premium === null || r.premium === undefined ? null : Number(r.premium),
      startsOn: (r.starts_on as string) ?? null,
      expiresOn: String(r.expires_on),
      documentId: (r.document_id as string) ?? null,
      ...policyDetail(r),
      createdAt: typeof r.created_at === "string" ? r.created_at : undefined,
    });
  }
  return out;
}

/** Finance agreements on file, per vehicle, newest schedule first. */
export async function listFinance(orgId: string): Promise<Record<string, VehicleFinance[]>> {
  const { data } = await supabaseAdmin
    .from("vehicle_finance")
    .select(
      "id, vehicle_id, lender, agreement_no, kind, starts_on, term_months, repayment, frequency" +
        ", rate_pct, balloon, amount_financed, document_id, source, created_at",
    )
    .eq("org_id", orgId)
    .order("starts_on", { ascending: false });

  const out: Record<string, VehicleFinance[]> = {};
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const f = toFinance(r);
    if (!f) continue;
    (out[String(r.vehicle_id)] ??= []).push(f);
  }
  return out;
}

/** The viewer's own open renewal reminders, per vehicle — what the REMIND ME
    chips read. Personal by construction (assigned_to is the viewer), and
    tolerant of its own migration like the bell's read: a workspace whose
    database has not taken renewal_reminders.sql gets no chips on, not a broken
    register. */
export async function listRenewalReminders(
  orgId: string,
  staffId: string | null,
): Promise<Record<string, RenewalReminder[]>> {
  if (!staffId) return {};
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select("id, vehicle_id, renewal_kind, lead_days, due_date")
    .eq("org_id", orgId)
    .eq("assigned_to", staffId)
    .eq("status", "open")
    .not("vehicle_id", "is", null);
  if (error) return {};

  const out: Record<string, RenewalReminder[]> = {};
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const kind = String(r.renewal_kind);
    if (!(RENEWAL_KINDS as readonly string[]).includes(kind)) continue;
    (out[String(r.vehicle_id)] ??= []).push({
      taskId: String(r.id),
      kind: kind as RenewalKind,
      leadDays: Math.max(0, Math.round(Number(r.lead_days)) || 0),
      dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
    });
  }
  return out;
}
