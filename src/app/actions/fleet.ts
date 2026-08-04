"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { todayInAu } from "@/lib/au-dates";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { vehicleRow } from "@/lib/fleet/map";
import { fuelTaxColumns } from "@/lib/fleet/receipt";
import { odoEffect, odoRejection, type AiValuation, type NewLog, type Vehicle } from "@/components/fleet/logic";

/* Fleet mutations.

   Everything the UI decided is re-decided here — a Server Function is
   reachable by direct POST, so "the button was disabled" is not a control.
   Two tiers:

     REGISTER (add/edit/remove/assign/value) needs `assets_all`.
     LOGGING  (fuel/odo/issue/service) is intrinsic — a driver may log against
              any vehicle in their org, which is the whole point of the pool
              case. It is still scoped by org, and the odometer guardrail runs
              server-side whatever the modal allowed. */

export type FleetResult = { ok: true } | { ok: false; error: string };

const DENIED: FleetResult = { ok: false, error: "You don't have access to the fleet register." };
const GONE: FleetResult = { ok: false, error: "That vehicle is no longer in the register." };

type Ctx = { orgId: string; staffId: string | null };

async function context(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, staffId: await staffProfileIdFor(orgId, userId) };
}

function refresh() {
  revalidatePath("/dashboard/assets");
  revalidatePath("/dashboard/my-vehicle");
}

/** Resolve a vehicle inside the caller's org — never by id alone. */
async function vehicleIn(orgId: string, vehicleId: string) {
  const { data } = await supabaseAdmin
    .from("vehicles")
    .select("id, status, odometer, last_service_odo, assigned_to")
    .eq("org_id", orgId)
    .eq("id", vehicleId)
    .maybeSingle();
  return data ?? null;
}

/* ---------------- register (assets_all) ---------------- */

export async function saveVehicle(vehicle: Vehicle): Promise<FleetResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("assets_all"))) return DENIED;
  if (!vehicle.plate.trim()) return { ok: false, error: "A rego plate is required." };

  const row = { ...vehicleRow(vehicle, todayInAu()), org_id: ctx.orgId };

  // an assignment must land on a real member of THIS org; the composite FK
  // enforces it too, but a clear message beats a constraint violation
  if (vehicle.assignedTo) {
    const { data } = await supabaseAdmin
      .from("staff_profiles")
      .select("id")
      .eq("org_id", ctx.orgId)
      .eq("id", vehicle.assignedTo)
      .maybeSingle();
    if (!data) return { ok: false, error: "That staff member isn't in this organisation." };
  }

  const existing = vehicle.id ? await vehicleIn(ctx.orgId, vehicle.id) : null;
  const { error } = existing
    ? await supabaseAdmin
        .from("vehicles")
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq("org_id", ctx.orgId)
        .eq("id", vehicle.id)
    : await supabaseAdmin.from("vehicles").insert(row);

  if (error) {
    // the (org, state, plate) unique index is the one a user can actually trip
    if (error.code === "23505")
      return { ok: false, error: `${vehicle.plate} is already registered in this fleet.` };
    return { ok: false, error: "Couldn't save that vehicle." };
  }
  refresh();
  return { ok: true };
}

export async function removeVehicle(vehicleId: string): Promise<FleetResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("assets_all"))) return DENIED;
  // logs cascade with the vehicle (FK on delete cascade)
  const { error } = await supabaseAdmin
    .from("vehicles")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", vehicleId);
  if (error) return { ok: false, error: "Couldn't remove that vehicle." };
  refresh();
  return { ok: true };
}

/** Driver assignment is register knowledge — the directory and the profile
    card both derive from here, so this is the single place it changes. */
export async function assignVehicle(
  vehicleId: string,
  staffProfileId: string | null,
): Promise<FleetResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("assets_all"))) return DENIED;
  if (!(await vehicleIn(ctx.orgId, vehicleId))) return GONE;

  const { error } = await supabaseAdmin
    .from("vehicles")
    .update({ assigned_to: staffProfileId, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", vehicleId);
  if (error) return { ok: false, error: "Couldn't change the driver." };
  refresh();
  return { ok: true };
}

/** Cache Tiff's valuations on the rows they belong to (Manager+, like the
    valuation action itself). */
export async function saveValuations(
  values: Record<string, AiValuation>,
): Promise<FleetResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("assets_all"))) return DENIED;

  for (const [id, val] of Object.entries(values)) {
    await supabaseAdmin
      .from("vehicles")
      .update({ ai_value: val })
      .eq("org_id", ctx.orgId)
      .eq("id", id);
  }
  refresh();
  return { ok: true };
}

/* ---------------- logging (intrinsic) ---------------- */

export async function addLog(log: NewLog): Promise<FleetResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const v = await vehicleIn(ctx.orgId, log.vehicleId);
  if (!v) return GONE;
  if (v.status === "sold") return { ok: false, error: "That vehicle has been sold." };
  // off-road pauses fuel/odo but never issue reports — the same rule the
  // My-vehicle screen renders, restated where it's actually enforced
  if (v.status === "offroad" && (log.kind === "fuel" || log.kind === "odo"))
    return { ok: false, error: "That vehicle is off the road — logging is paused." };

  const rejection = odoRejection(v.odometer as number, log.odo);
  if (rejection) return { ok: false, error: rejection };

  /* The tax columns only exist on a fuel log — an odometer reading has no
     supplier and a reported fault has no GST. Anything sent alongside another
     kind is dropped here rather than refused: it can only be a stale field on
     a reused form, and it changes nothing that gets exported. */
  const today = todayInAu();
  const tax =
    log.kind === "fuel"
      ? fuelTaxColumns(
          { cost: log.cost, gst: log.gst, abn: log.abn, purchasedOn: log.purchasedOn },
          today,
        )
      : ({ ok: true, columns: { gst: null, supplier_abn: null, logged_on: today } } as const);
  if (!tax.ok) return { ok: false, error: tax.error };

  const { data: created, error } = await supabaseAdmin
    .from("vehicle_logs")
    .insert({
      org_id: ctx.orgId,
      vehicle_id: log.vehicleId,
      staff_profile_id: ctx.staffId,
      kind: log.kind,
      logged_on: tax.columns.logged_on,
      note: log.note ?? null,
      litres: log.litres ?? null,
      cost: log.cost ?? null,
      odo: log.odo ?? null,
      status: log.kind === "issue" ? "open" : null,
      source: log.kind === "fuel" ? log.source ?? "manual" : null,
      station: log.station ?? null,
      gst: tax.columns.gst,
      supplier_abn: tax.columns.supplier_abn,
    })
    .select("id")
    .maybeSingle();
  if (error || !created) return { ok: false, error: "Couldn't save that entry." };

  if (log.kind === "fuel" && log.receiptDocumentId) {
    await adoptReceipt(ctx, String(created.id), log.receiptDocumentId);
  }

  const effect = odoEffect(
    { odometer: v.odometer as number, lastServiceOdo: v.last_service_odo as number },
    log,
  );
  if (effect) {
    const patch: Record<string, unknown> = { odometer: effect.odometer };
    // only a completed service touches the cycle
    if (effect.lastServiceOdo !== undefined) patch.last_service_odo = effect.lastServiceOdo;
    await supabaseAdmin
      .from("vehicles")
      .update(patch)
      .eq("org_id", ctx.orgId)
      .eq("id", log.vehicleId);
  }
  refresh();
  return { ok: true };
}

/* Bind the uploaded docket to the log it belongs to — the same adopt-on-save
   move expense claims make, and every clause in the filter is load-bearing:
   this org, this person's own upload, the fuel-receipt kind (never an expense
   claim's receipt, which would double-count in the tax export), an upload that
   actually finished, and one not already spoken for.

   A failure here is deliberately SILENT. The fuel entry is saved and correct;
   telling the driver "couldn't attach the photo" after the fact would invite
   them to log the fill a second time, which is worse than a figure without its
   document. The Tax screen shows exactly which lines have a receipt, so a
   missing one is visible where it matters. */
async function adoptReceipt(ctx: Ctx, logId: string, documentId: string): Promise<void> {
  if (!ctx.staffId) return;
  await supabaseAdmin
    .from("documents")
    .update({ vehicle_log_id: logId })
    .eq("org_id", ctx.orgId)
    .eq("id", documentId)
    .eq("uploaded_by", ctx.staffId)
    .eq("kind", "fuel_receipt")
    .not("uploaded_at", "is", null)
    .is("vehicle_log_id", null);
}

/** Closing an issue is a register action — a driver reports, a manager clears. */
export async function resolveIssue(logId: string): Promise<FleetResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("assets_all"))) return DENIED;

  const { error } = await supabaseAdmin
    .from("vehicle_logs")
    .update({ status: "resolved" })
    .eq("org_id", ctx.orgId)
    .eq("id", logId)
    .eq("kind", "issue");
  if (error) return { ok: false, error: "Couldn't close that issue." };
  refresh();
  return { ok: true };
}
