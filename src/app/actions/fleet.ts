"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { todayInAu } from "@/lib/au-dates";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { vehicleRow } from "@/lib/fleet/map";
import { fuelTaxColumns } from "@/lib/fleet/receipt";
import {
  odoEffect,
  odoRecompute,
  odoRejection,
  type AiValuation,
  type NewLog,
  type Vehicle,
} from "@/components/fleet/logic";

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

  /* PAID FROM YOUR OWN POCKET means a reimbursement has to be raisable, and
     both of these are checked BEFORE anything is written — a log that saves
     and then silently fails to raise the claim leaves someone out of pocket
     with no trace of it. */
  const ownMoney = log.kind === "fuel" && log.paidWith === "own";
  if (ownMoney && !ctx.staffId) {
    return {
      ok: false,
      error: "Your account isn't linked to a staff record, so a reimbursement can't be raised.",
    };
  }
  if (ownMoney && !(typeof log.cost === "number" && log.cost > 0)) {
    return { ok: false, error: "Enter what it cost, so the reimbursement is for the right amount." };
  }

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
      // fuel only; null on every other kind, and on fuel logged before the
      // question was asked
      paid_with: log.kind === "fuel" ? log.paidWith ?? "company" : null,
    })
    .select("id")
    .maybeSingle();
  if (error || !created) return { ok: false, error: "Couldn't save that entry." };

  if (log.kind === "fuel" && log.receiptDocumentId) {
    await adoptReceipt(ctx, String(created.id), log.receiptDocumentId);
  }

  if (ownMoney) {
    const raised = await raiseFuelReimbursement(ctx, String(created.id), log, tax.columns.logged_on);
    if (!raised) {
      /* The log is saved and correct, but the money is not coming back. Unlike
         a missing receipt photo this is NOT safe to swallow — say so, and say
         it is the claim that failed so nobody logs the fill a second time. */
      refresh();
      return {
        ok: false,
        error: "Fuel logged, but the reimbursement claim couldn't be raised — add it under My expenses.",
      };
    }
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
/* The reimbursement half of a personally-funded fill.

   It is a NORMAL expense claim — pending, visible on My expenses, approved and
   paid like any other — with one difference: `vehicle_log_id` points back at
   the log that raised it, and the tax screen skips any claim carrying one. The
   vehicle log is that purchase's tax line; counting the claim as well would
   put the same tank of diesel in the year's total twice. */
async function raiseFuelReimbursement(
  ctx: Ctx,
  logId: string,
  log: NewLog,
  spentOn: string,
): Promise<boolean> {
  const where = log.station?.trim();
  const { error } = await supabaseAdmin.from("expense_claims").insert({
    org_id: ctx.orgId,
    staff_profile_id: ctx.staffId,
    vehicle_log_id: logId,
    expense_date: spentOn,
    // reads as itself in the claims list, and names where it came from
    description: where ? `Fuel — ${where}` : "Fuel",
    category: "fuel",
    amount: log.cost,
    gst_amount: log.gst ?? null,
    supplier: where ?? null,
    status: "pending",
  });
  return !error;
}

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

/* ---------------- correcting an entry ---------------- */

/* WHO MAY FIX A LOG: whoever wrote it, or anyone holding `assets_all`.

   The first half is the same doctrine as cancelling your own expense claim —
   correcting your own mistake is not a privilege. The second is the register
   tier that already closes other people's issue reports, and it is what makes
   a wrong entry from someone who has left the company fixable at all.

   It is checked HERE and nowhere else that matters: the row is fetched by id
   AND org, and the decision is made on the row that came back, never on
   anything the caller sent. */
async function logYouMayTouch(ctx: Ctx, logId: string) {
  const { data } = await supabaseAdmin
    .from("vehicle_logs")
    .select("id, vehicle_id, kind, staff_profile_id, cost, deleted_at")
    .eq("org_id", ctx.orgId)
    .eq("id", logId)
    .maybeSingle();
  if (!data) return null;
  // already gone: not an error worth a different message, but not editable
  if (data.deleted_at) return null;
  const mine = ctx.staffId !== null && data.staff_profile_id === ctx.staffId;
  if (!mine && !(await can("assets_all"))) return null;
  return data;
}

/* Put the vehicle back where its surviving logs say it is.

   Runs after every edit and every delete, and reads the logs fresh rather than
   reasoning about what just changed — the log that moved is not necessarily
   the one holding the high-water mark, and two drivers logging the same van on
   the same day makes any delta arithmetic wrong. */
async function resyncVehicle(ctx: Ctx, vehicleId: string): Promise<void> {
  const v = await vehicleIn(ctx.orgId, vehicleId);
  if (!v) return;

  const { data } = await supabaseAdmin
    .from("vehicle_logs")
    .select("kind, odo")
    .eq("org_id", ctx.orgId)
    .eq("vehicle_id", vehicleId)
    .is("deleted_at", null);

  const logs = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    kind: String(r.kind) as NewLog["kind"],
    odo: r.odo === null || r.odo === undefined ? undefined : Number(r.odo),
  }));

  const next = odoRecompute(logs, {
    odometer: v.odometer as number,
    lastServiceOdo: v.last_service_odo as number,
  });
  if (next.odometer === v.odometer && next.lastServiceOdo === v.last_service_odo) return;

  await supabaseAdmin
    .from("vehicles")
    .update({ odometer: next.odometer, last_service_odo: next.lastServiceOdo })
    .eq("org_id", ctx.orgId)
    .eq("id", vehicleId);
}

export type LogEdit = {
  note?: string;
  litres?: number;
  cost?: number;
  odo?: number;
  station?: string;
  gst?: number;
  abn?: string;
  purchasedOn?: string;
};

/** Correct an entry in place. Same rules the original save was held to. */
export async function editLog(logId: string, patch: LogEdit): Promise<FleetResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const row = await logYouMayTouch(ctx, logId);
  if (!row) return { ok: false, error: "That entry can't be edited." };

  const kind = String(row.kind) as NewLog["kind"];

  /* The tax rules run again, in full. An edit is where a wrong GST is most
     likely to arrive — somebody squinting at a photo they have already
     mistyped once — so this is the last place it can be caught, and the
     figures are re-checked against the EDITED cost, not the stored one. */
  const cost = patch.cost ?? (row.cost === null ? undefined : Number(row.cost));
  const tax =
    kind === "fuel"
      ? fuelTaxColumns(
          { cost, gst: patch.gst, abn: patch.abn, purchasedOn: patch.purchasedOn },
          todayInAu(),
        )
      : null;
  if (tax && !tax.ok) return { ok: false, error: tax.error };

  /* The odometer guardrail can NOT be re-run against the vehicle here: the
     vehicle's current reading may well have come from this very log, so
     comparing against it would refuse every correction downward — which is the
     main reason anybody edits a reading in the first place. A negative or
     absurd number is still refused; the vehicle is resynced from the surviving
     logs immediately afterwards, which is what keeps the register honest. */
  if (patch.odo !== undefined && (!Number.isFinite(patch.odo) || patch.odo < 0)) {
    return { ok: false, error: "An odometer reading can't be negative." };
  }

  const update: Record<string, unknown> = {
    edited_at: new Date().toISOString(),
    edited_by: ctx.staffId,
  };
  if (patch.note !== undefined) update.note = patch.note || null;
  if (patch.odo !== undefined) update.odo = patch.odo;
  if (kind === "fuel") {
    if (patch.litres !== undefined) update.litres = patch.litres;
    if (patch.cost !== undefined) update.cost = patch.cost;
    if (patch.station !== undefined) update.station = patch.station || null;
    if (tax?.ok) {
      update.gst = tax.columns.gst;
      update.supplier_abn = tax.columns.supplier_abn;
      if (patch.purchasedOn !== undefined) update.logged_on = tax.columns.logged_on;
    }
  }

  const { error } = await supabaseAdmin
    .from("vehicle_logs")
    .update(update)
    .eq("org_id", ctx.orgId)
    .eq("id", logId);
  if (error) return { ok: false, error: "Couldn't save that correction." };

  await resyncVehicle(ctx, String(row.vehicle_id));
  refresh();
  return { ok: true };
}

/* Remove an entry — softly.

   These rows back a tax return. A deduction that went to an accountant in an
   export in July must not be able to vanish in September with nothing to say
   it ever existed, so the row stays and every read stops returning it. Its
   receipt stays attached too: the document is evidence about a correction as
   much as about a purchase, and a bucket object with no row pointing at it is
   the one shape this track has always refused.

   If the fill was on somebody's own card, the reimbursement claim survives
   this delete untouched — the money still left their account — and becomes the
   purchase's tax line: src/lib/tax/query.ts skips a linked claim only while
   its log is alive. */
export async function deleteLog(logId: string): Promise<FleetResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const row = await logYouMayTouch(ctx, logId);
  if (!row) return { ok: false, error: "That entry can't be removed." };

  const { error } = await supabaseAdmin
    .from("vehicle_logs")
    .update({ deleted_at: new Date().toISOString(), deleted_by: ctx.staffId })
    .eq("org_id", ctx.orgId)
    .eq("id", logId);
  if (error) return { ok: false, error: "Couldn't remove that entry." };

  await resyncVehicle(ctx, String(row.vehicle_id));
  refresh();
  return { ok: true };
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
