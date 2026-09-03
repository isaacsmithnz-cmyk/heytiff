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
  FINANCE_KINDS,
  INSURANCE_COVERS,
  odoEffect,
  odoRecompute,
  odoRejection,
  PAYMENT_FREQUENCIES,
  RENEWAL_DOC_KIND,
  RENEWAL_EXPIRY_COLUMN,
  type FinanceKind,
  type InsuranceCover,
  type NewLog,
  type PaymentFrequency,
  type PolicySource,
  type RenewalKind,
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
    .select(
      "id, status, odometer, last_service_odo, assigned_to, rego_expiry, insurance_expiry, ctp_expiry",
    )
    .eq("org_id", orgId)
    .eq("id", vehicleId)
    .maybeSingle();
  return data ?? null;
}

/* ---------------- register (assets_all) ---------------- */

export async function saveVehicle(
  vehicle: Vehicle,
  /** A purchase_invoice uploaded while the form was open, to adopt onto this
      vehicle once the row exists — same orphan-then-adopt shape as the fuel
      docket, because a NEW vehicle has no id until the insert. */
  purchaseInvoiceId?: string,
  /** The registration the vehicle arrived with. Adding a vehicle by scanning
      its certificate of registration reads the expiry off the same document
      as the VIN, and that expiry is a RENEWAL — a policy row with the
      certificate filed under it — not a bare date typed into a column. Only
      honoured on insert: an existing vehicle's renewals go through
      recordRenewal, where the current cache is known and never dragged back. */
  initialRenewal?: Omit<RenewalInput, "vehicleId">,
): Promise<FleetResult> {
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
  let savedId = vehicle.id;
  let error;
  if (existing) {
    ({ error } = await supabaseAdmin
      .from("vehicles")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("org_id", ctx.orgId)
      .eq("id", vehicle.id));
  } else {
    // the insert returns its id because the invoice below adopts onto it
    const res = await supabaseAdmin.from("vehicles").insert(row).select("id").single();
    error = res.error;
    savedId = (res.data?.id as string) ?? "";
  }

  if (error) {
    // the (org, state, plate) unique index is the one a user can actually trip
    if (error.code === "23505")
      return { ok: false, error: `${vehicle.plate} is already registered in this fleet.` };
    return { ok: false, error: "Couldn't save that vehicle." };
  }
  if (purchaseInvoiceId && savedId) await adoptPurchaseInvoice(ctx, savedId, purchaseInvoiceId);
  if (!existing && initialRenewal && savedId) {
    const filed = await fileRenewal(ctx, savedId, null, { ...initialRenewal, vehicleId: savedId });
    if (!filed.ok) return filed;
  }
  refresh();
  return { ok: true };
}

/* Same contract as adoptReceipt below: only the uploader's own, confirmed,
   still-orphaned purchase_invoice may land — the kind check is what keeps a
   receipt or anything else from being claimed as the van's paperwork. */
async function adoptPurchaseInvoice(ctx: Ctx, vehicleId: string, documentId: string): Promise<void> {
  if (!ctx.staffId) return;
  await supabaseAdmin
    .from("documents")
    .update({ vehicle_id: vehicleId })
    .eq("org_id", ctx.orgId)
    .eq("id", documentId)
    .eq("uploaded_by", ctx.staffId)
    .eq("kind", "purchase_invoice")
    .not("uploaded_at", "is", null)
    .is("vehicle_id", null);
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
  /* A service resets BOTH limits, so it re-anchors the date as well as the
     odometer — otherwise a serviced vehicle would stay overdue on time
     forever. It lands even when odoEffect returns nothing: a service logged
     without a reading (a trailer has none) still happened on a day. */
  const patch: Record<string, unknown> = {};
  if (effect) {
    patch.odometer = effect.odometer;
    if (effect.lastServiceOdo !== undefined) patch.last_service_odo = effect.lastServiceOdo;
  }
  if (log.kind === "service") patch.last_service_on = tax.columns.logged_on;
  if (Object.keys(patch).length > 0) {
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

/* ---------------- renewals (assets_all) ---------------- */

/* Recording a renewal (issue #509, slice 2).

   THREE WRITES, ONE MEANING. The policy row is the record; the vehicle's
   expiry column is a CACHE of the newest row, kept because every chip, filter
   and attention count reads it and none of them should learn about policies;
   the document is adopted so the paper sits with the vehicle. Nothing is
   overwritten — the previous policy is simply an older row, which is what
   makes "previous versions" free rather than a second store.

   The expiry cache is only advanced by a LATER date. Filing a policy you
   forgot from two years ago is a legitimate thing to do, and it must not drag
   the vehicle's expiry backwards and raise a false warning. */
export type RenewalInput = {
  vehicleId: string;
  kind: RenewalKind;
  expiresOn: string;
  startsOn?: string | null;
  provider?: string | null;
  premium?: number | null;
  documentId?: string;
  /* What else the certificate said — see VehiclePolicy. All optional; a
     document that doesn't print a field leaves it null rather than guessed. */
  policyNumber?: string | null;
  cover?: InsuranceCover | null;
  excess?: number | null;
  termMonths?: number | null;
  garagingPostcode?: string | null;
  inspectionOn?: string | null;
  source?: PolicySource | null;
};

export async function recordRenewal(input: RenewalInput): Promise<FleetResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("assets_all"))) return DENIED;

  const vehicle = await vehicleIn(ctx.orgId, input.vehicleId);
  if (!vehicle) return GONE;

  const column = RENEWAL_EXPIRY_COLUMN[input.kind];
  const current = ((vehicle as Record<string, unknown>)[column] as string | null | undefined) ?? null;
  const filed = await fileRenewal(ctx, input.vehicleId, current, input);
  if (!filed.ok) return filed;
  refresh();
  return { ok: true };
}

/** A stored kind of cover, or null — a Server Function is reachable by direct
    POST, so the list is checked here and not only in the select that offers it. */
const asCover = (v: unknown): InsuranceCover | null =>
  typeof v === "string" && (INSURANCE_COVERS as readonly string[]).includes(v)
    ? (v as InsuranceCover)
    : null;
const asSource = (v: unknown): PolicySource | null =>
  v === "scan" || v === "manual" ? v : null;
const moneyOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/* The three writes behind a renewal, for both doors it can arrive through —
   the Update flow on an existing vehicle, and a new vehicle whose certificate
   of registration was scanned on the way in. `current` is the vehicle's cached
   expiry for this kind (null for a vehicle that has none, or doesn't exist
   yet), so the cache is only ever advanced. */
async function fileRenewal(
  ctx: Ctx,
  vehicleId: string,
  current: string | null,
  input: RenewalInput,
): Promise<FleetResult> {
  if (!input.expiresOn) return { ok: false, error: "A renewal needs an expiry date." };

  const { data: policy, error } = await supabaseAdmin
    .from("vehicle_policies")
    .insert({
      org_id: ctx.orgId,
      vehicle_id: vehicleId,
      kind: input.kind,
      provider: input.provider?.trim() || null,
      premium: moneyOrNull(input.premium),
      starts_on: input.startsOn || null,
      expires_on: input.expiresOn,
      document_id: input.documentId ?? null,
      policy_number: input.policyNumber?.trim() || null,
      // cover is an insurance fact; a rego notice or green slip carries none
      cover: input.kind === "insurance" ? asCover(input.cover) : null,
      excess: moneyOrNull(input.excess),
      term_months:
        typeof input.termMonths === "number" && input.termMonths > 0
          ? Math.round(input.termMonths)
          : null,
      garaging_postcode: input.garagingPostcode?.trim() || null,
      inspection_on: input.inspectionOn || null,
      source: asSource(input.source),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "Couldn't record that renewal." };

  // cache the newest expiry on the vehicle — never backwards
  if (!current || input.expiresOn > current) {
    await supabaseAdmin
      .from("vehicles")
      .update({ [RENEWAL_EXPIRY_COLUMN[input.kind]]: input.expiresOn, updated_at: new Date().toISOString() })
      .eq("org_id", ctx.orgId)
      .eq("id", vehicleId);
  }

  if (input.documentId) {
    await adoptRenewalDocument(ctx, vehicleId, input.documentId, input.kind, policy.id as string);
  }
  return { ok: true };
}

/* Same contract as the other adoptions: only the uploader's own, confirmed,
   still-orphaned document of the RIGHT kind may land. The kind check is what
   keeps a fuel docket from being filed as a policy schedule. */
async function adoptRenewalDocument(
  ctx: Ctx,
  vehicleId: string,
  documentId: string,
  kind: RenewalKind,
  policyId: string,
): Promise<void> {
  if (!ctx.staffId) return;
  const { data } = await supabaseAdmin
    .from("documents")
    // vehicle_id says whose paper it is; policy_id says which renewal it sits
    // under. Both, so the vehicle's trail and the policy's file agree.
    .update({ vehicle_id: vehicleId, policy_id: policyId })
    .eq("org_id", ctx.orgId)
    .eq("id", documentId)
    .eq("uploaded_by", ctx.staffId)
    .eq("kind", RENEWAL_DOC_KIND[kind])
    .not("uploaded_at", "is", null)
    .is("vehicle_id", null)
    .select("id");
  // a document that refused adoption must not be claimed by the policy row
  if (!data || data.length === 0) {
    await supabaseAdmin
      .from("vehicle_policies")
      .update({ document_id: null })
      .eq("org_id", ctx.orgId)
      .eq("id", policyId);
  }
}

/* A second, third, fourth piece of paper for a renewal that already exists —
   the schedule behind the certificate, the receipt for the premium. Same
   adoption contract as the scanned one (the uploader's own, confirmed, still
   orphaned, of the policy's kind); the difference is that nothing was read
   from it and the policy row is left alone. */
export async function attachPolicyDocument(policyId: string, documentId: string): Promise<FleetResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("assets_all"))) return DENIED;
  if (!ctx.staffId) return { ok: false, error: "Only a staff member can file documents." };

  const { data: policy } = await supabaseAdmin
    .from("vehicle_policies")
    .select("id, vehicle_id, kind")
    .eq("org_id", ctx.orgId)
    .eq("id", policyId)
    .maybeSingle();
  if (!policy) return { ok: false, error: "That renewal is no longer on file." };
  const kind = policy.kind as RenewalKind;
  if (!(kind in RENEWAL_DOC_KIND)) return { ok: false, error: "That renewal is no longer on file." };

  const { data } = await supabaseAdmin
    .from("documents")
    .update({ vehicle_id: policy.vehicle_id as string, policy_id: policyId })
    .eq("org_id", ctx.orgId)
    .eq("id", documentId)
    .eq("uploaded_by", ctx.staffId)
    .eq("kind", RENEWAL_DOC_KIND[kind])
    .not("uploaded_at", "is", null)
    .is("vehicle_id", null)
    .select("id");
  if (!data || data.length === 0) return { ok: false, error: "That document couldn't be filed." };
  refresh();
  return { ok: true };
}

/* The photo on the card. Adopt-then-point, in that order: the document row is
   claimed by the vehicle first (same orphan contract as every other file), and
   only a document that accepted adoption becomes the pointer. A photo that
   refused — wrong kind, someone else's upload — leaves the card as it was. */
export async function setVehiclePhoto(vehicleId: string, documentId: string): Promise<FleetResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("assets_all"))) return DENIED;
  if (!ctx.staffId) return { ok: false, error: "Only a staff member can set a photo." };
  if (!(await vehicleIn(ctx.orgId, vehicleId))) return GONE;

  const { data } = await supabaseAdmin
    .from("documents")
    .update({ vehicle_id: vehicleId })
    .eq("org_id", ctx.orgId)
    .eq("id", documentId)
    .eq("uploaded_by", ctx.staffId)
    .eq("kind", "vehicle_photo")
    .not("uploaded_at", "is", null)
    .is("vehicle_id", null)
    .select("id");
  if (!data || data.length === 0) return { ok: false, error: "That photo couldn't be attached." };

  const { error } = await supabaseAdmin
    .from("vehicles")
    .update({ photo_document_id: documentId, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", vehicleId);
  if (error) return { ok: false, error: "Couldn't set that photo." };
  refresh();
  return { ok: true };
}

/* ---------------- finance (assets_all) ---------------- */

/* The agreement behind the repayments (vehicle modal v2, phase 2). Same shape
   as a renewal: a row per agreement, the newest schedule in force, the paper
   filed under it. Lender, start and term are required because without them
   there is no schedule to show; every money figure is optional and never
   invented — a contract that doesn't print a balloon has none recorded. */

export type FinanceInput = {
  vehicleId: string;
  lender: string;
  agreementNo?: string | null;
  kind?: FinanceKind | null;
  startsOn: string;
  termMonths: number;
  repayment?: number | null;
  frequency?: PaymentFrequency | null;
  ratePct?: number | null;
  balloon?: number | null;
  amountFinanced?: number | null;
  documentId?: string;
  source?: PolicySource | null;
};

const asFinanceKind = (v: unknown): FinanceKind | null =>
  typeof v === "string" && (FINANCE_KINDS as readonly string[]).includes(v) ? (v as FinanceKind) : null;
const asFrequency = (v: unknown): PaymentFrequency =>
  typeof v === "string" && (PAYMENT_FREQUENCIES as readonly string[]).includes(v)
    ? (v as PaymentFrequency)
    : "monthly";

export async function recordFinance(input: FinanceInput): Promise<FleetResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("assets_all"))) return DENIED;
  if (!(await vehicleIn(ctx.orgId, input.vehicleId))) return GONE;

  const lender = input.lender?.trim();
  if (!lender) return { ok: false, error: "A finance agreement needs a lender." };
  if (!input.startsOn || !/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn))
    return { ok: false, error: "A finance agreement needs a start date." };
  const term = Math.round(Number(input.termMonths));
  if (!Number.isFinite(term) || term <= 0 || term > 240)
    return { ok: false, error: "A finance agreement needs a term in months." };
  const rate =
    typeof input.ratePct === "number" && Number.isFinite(input.ratePct) && input.ratePct >= 0 && input.ratePct < 100
      ? Math.round(input.ratePct * 1000) / 1000
      : null;

  const { data: row, error } = await supabaseAdmin
    .from("vehicle_finance")
    .insert({
      org_id: ctx.orgId,
      vehicle_id: input.vehicleId,
      lender,
      agreement_no: input.agreementNo?.trim() || null,
      kind: asFinanceKind(input.kind),
      starts_on: input.startsOn,
      term_months: term,
      repayment: moneyOrNull(input.repayment),
      frequency: asFrequency(input.frequency),
      rate_pct: rate,
      balloon: moneyOrNull(input.balloon),
      amount_financed: moneyOrNull(input.amountFinanced),
      document_id: input.documentId ?? null,
      source: asSource(input.source),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "Couldn't record that agreement." };

  if (input.documentId) await adoptFinanceDocument(ctx, input.vehicleId, input.documentId, row.id as string);
  refresh();
  return { ok: true };
}

/* Same adoption contract as a renewal's paper: only the uploader's own,
   confirmed, still-orphaned finance_agreement may land, and a document that
   refused must not be claimed by the row. */
async function adoptFinanceDocument(ctx: Ctx, vehicleId: string, documentId: string, financeId: string): Promise<boolean> {
  if (!ctx.staffId) return false;
  const { data } = await supabaseAdmin
    .from("documents")
    .update({ vehicle_id: vehicleId, finance_id: financeId })
    .eq("org_id", ctx.orgId)
    .eq("id", documentId)
    .eq("uploaded_by", ctx.staffId)
    .eq("kind", "finance_agreement")
    .not("uploaded_at", "is", null)
    .is("vehicle_id", null)
    .select("id");
  const landed = !!data && data.length > 0;
  if (!landed) {
    await supabaseAdmin
      .from("vehicle_finance")
      .update({ document_id: null })
      .eq("org_id", ctx.orgId)
      .eq("id", financeId);
  }
  return landed;
}

/** The schedule, the payout letter, the amendment — more paper under an
    agreement that already exists. Nothing is read; the row is left alone. */
export async function attachFinanceDocument(financeId: string, documentId: string): Promise<FleetResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("assets_all"))) return DENIED;
  if (!ctx.staffId) return { ok: false, error: "Only a staff member can file documents." };

  const { data: fin } = await supabaseAdmin
    .from("vehicle_finance")
    .select("id, vehicle_id")
    .eq("org_id", ctx.orgId)
    .eq("id", financeId)
    .maybeSingle();
  if (!fin) return { ok: false, error: "That agreement is no longer on file." };

  const { data } = await supabaseAdmin
    .from("documents")
    .update({ vehicle_id: fin.vehicle_id as string, finance_id: financeId })
    .eq("org_id", ctx.orgId)
    .eq("id", documentId)
    .eq("uploaded_by", ctx.staffId)
    .eq("kind", "finance_agreement")
    .not("uploaded_at", "is", null)
    .is("vehicle_id", null)
    .select("id");
  if (!data || data.length === 0) return { ok: false, error: "That document couldn't be filed." };
  refresh();
  return { ok: true };
}

/** A purchase invoice filed against the vehicle after the fact — the dealer's
    tax invoice that turned up a week later. Same contract as the one adopted
    on save: the uploader's own, confirmed, orphaned purchase_invoice. */
export async function attachPurchaseDocument(vehicleId: string, documentId: string): Promise<FleetResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("assets_all"))) return DENIED;
  if (!ctx.staffId) return { ok: false, error: "Only a staff member can file documents." };
  if (!(await vehicleIn(ctx.orgId, vehicleId))) return GONE;

  const { data } = await supabaseAdmin
    .from("documents")
    .update({ vehicle_id: vehicleId })
    .eq("org_id", ctx.orgId)
    .eq("id", documentId)
    .eq("uploaded_by", ctx.staffId)
    .eq("kind", "purchase_invoice")
    .not("uploaded_at", "is", null)
    .is("vehicle_id", null)
    .select("id");
  if (!data || data.length === 0) return { ok: false, error: "That document couldn't be filed." };
  refresh();
  return { ok: true };
}
