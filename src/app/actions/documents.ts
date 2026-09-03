"use server";

import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can, getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";
import { staffProfileIdFor } from "@/lib/fleet/query";
import {
  asDocumentKind,
  checkUpload,
  displayName,
  refIsOrgs,
  storageRef,
  type DocumentKind,
} from "@/lib/documents/files";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";

/* Uploading, for the whole platform.

   THE BYTES NEVER PASS THROUGH A SERVER ACTION. The client asks for a slot, we
   mint a signed upload token, the browser PUTs the file straight to storage,
   and then it tells us it landed. That's the flow the floor-plan storage
   already uses — it dodges the action body-size limit entirely and keeps a
   10 MB photo off the Node process.

   THE ROW COMES FIRST. Creating the document row is what generates the id, and
   the id is what the object key is made of, so there is never a file in the
   bucket that no row points at. The opposite is possible — a row whose upload
   was abandoned — and that's the harmless direction: `uploaded_at` stays null
   and every read filters it out.

   WHO MAY UPLOAD WHAT is decided per kind, here, on the server. */

export type UploadSlot =
  | { ok: true; documentId: string; ref: string; token: string; bucket: string }
  | { ok: false; error: string };

export type DocResult = { ok: true } | { ok: false; error: string };

type Ctx = { orgId: string; staffId: string | null };

async function context(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, staffId: await staffProfileIdFor(orgId, userId) };
}

/* Which capability a kind needs. Attaching a photo to a notice is part of
   posting one, so it needs `team`; a licence scan is evidence about YOU and is
   intrinsic. Anything not listed is management by default — a new kind must
   opt IN to being intrinsic, never inherit it by being forgotten.

   org_logo is the one kind that goes the OTHER way: it is the company's face,
   on the sidebar of everyone who signs in, so it is owner-only rather than
   `team` — the same gate the rest of the organisation profile carries
   (actions/org.ts). A delegated admin manages people, not the company's
   identity. Refusing it here means the bytes never even get a slot. */
async function mayUpload(kind: DocumentKind): Promise<boolean> {
  // Intrinsic: your own licence, your own work-rights evidence, your own face
  // — and your own receipt. Spending your own money on the job and wanting it
  // back is not a privilege, so `receipt` belongs in this list; falling
  // through to `can("team")` would have locked every staff member out of the
  // expense claim they are the whole point of.
  // `fuel_receipt` joins them for the same reason one step further out:
  // fuelling the van is the job, and a driver with no `assets_all` still has
  // to be able to keep the docket. The register is what they can't see; the
  // paper in their hand is not.
  // `medical_certificate` joins them, and is the clearest case of the lot: it
  // is a document about your own body, given to you, that you are being asked
  // to hand over. Gating the UPLOAD behind a capability would mean the person
  // it belongs to could not supply it. Who may READ it is the separate and
  // much tighter question — see `certificateFor` in lib/timepay/leave-query.ts.
  if (
    kind === "licence" ||
    kind === "work_rights" ||
    kind === "staff_photo" ||
    kind === "receipt" ||
    kind === "fuel_receipt" ||
    kind === "medical_certificate"
  )
    return true;
  if (kind === "org_logo") return hasMinRole(await getDbRole(), "owner");
  // A vehicle's purchase paperwork is register knowledge — the same tier that
  // may enter the purchase price it substantiates.
  if (
    kind === "purchase_invoice" ||
    kind === "insurance_policy" ||
    kind === "rego_notice" ||
    kind === "green_slip" ||
    kind === "vehicle_photo" ||
    kind === "finance_agreement"
  )
    return can("assets_all");
  // Site photos and job paperwork come from whoever is ON the job — the
  // board's tick tier, same doctrine as the checklists they sit beside.
  if (kind === "project_file") return can("workboard");
  return can("team");
}

/** Ask for somewhere to put a file. Returns a signed slot, or a reason. */
export async function beginUpload(input: {
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<UploadSlot> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  const kind = asDocumentKind(input.kind);
  if (!kind) return { ok: false, error: "That isn't something we store." };
  if (!(await mayUpload(kind))) return { ok: false, error: "You can't upload that." };

  const check = checkUpload({
    name: input.fileName,
    type: input.mimeType,
    size: input.sizeBytes,
  });
  if (!check.ok) return { ok: false, error: check.error };

  const { data, error } = await supabaseAdmin
    .from("documents")
    .insert({
      org_id: ctx.orgId,
      kind,
      // a placeholder only long enough to get an id back; the real key is
      // written below, and the NOT NULL keeps the column honest meanwhile
      storage_ref: `org/${ctx.orgId}/pending/${crypto.randomUUID()}`,
      file_name: displayName(input.fileName),
      mime_type: input.mimeType.toLowerCase(),
      size_bytes: input.sizeBytes,
      uploaded_by: ctx.staffId,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn't start that upload." };

  const documentId = String(data.id);
  const ref = storageRef(ctx.orgId, kind, documentId, check.ext);

  const { error: refErr } = await supabaseAdmin
    .from("documents")
    .update({ storage_ref: ref })
    .eq("org_id", ctx.orgId)
    .eq("id", documentId);
  if (refErr) return { ok: false, error: "Couldn't start that upload." };

  const { data: slot, error: slotErr } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUploadUrl(ref);
  if (slotErr || !slot) {
    await supabaseAdmin.from("documents").delete().eq("org_id", ctx.orgId).eq("id", documentId);
    return { ok: false, error: "Couldn't start that upload." };
  }

  return { ok: true, documentId, ref, token: slot.token, bucket: DOCUMENTS_BUCKET };
}

/* The browser reporting that the bytes landed. Until this runs the row is
   invisible everywhere, so a cancelled or failed upload leaves nothing on
   anyone's screen. */
export async function confirmUpload(documentId: string): Promise<DocResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  const { data } = await supabaseAdmin
    .from("documents")
    .select("uploaded_by, storage_ref")
    .eq("org_id", ctx.orgId)
    .eq("id", documentId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That upload no longer exists." };
  // only the person handed the slot may close it
  if (data.uploaded_by !== ctx.staffId) return { ok: false, error: "That isn't your upload." };
  if (!refIsOrgs(String(data.storage_ref), ctx.orgId))
    return { ok: false, error: "That file doesn't belong to this organisation." };

  const { error } = await supabaseAdmin
    .from("documents")
    .update({ uploaded_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", documentId);
  if (error) return { ok: false, error: "Couldn't finish that upload." };
  return { ok: true };
}

/** Remove a file — whoever uploaded it, or anyone with `team`. The object goes
    with the row; an orphaned object would be invisible but still billable. */
export async function deleteDocument(documentId: string): Promise<DocResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const { data } = await supabaseAdmin
    .from("documents")
    .select("uploaded_by, storage_ref, expense_claim_id, vehicle_log_id")
    .eq("org_id", ctx.orgId)
    .eq("id", documentId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That file is already gone." };

  const mine = ctx.staffId && ctx.staffId === data.uploaded_by;
  if (!mine && !(await can("team"))) return { ok: false, error: "That file isn't yours." };

  /* A receipt attached to a live claim is EVIDENCE, and nobody deletes it —
     not the claimant, not a `team` holder. Approving a reimbursement means
     someone vouched for a document; letting that document disappear afterwards
     would leave an approved payment with nothing behind it. Cancelled and
     declined claims release their receipts, since nothing was paid on them. */
  if (data.expense_claim_id) {
    const { data: claim } = await supabaseAdmin
      .from("expense_claims")
      .select("status")
      .eq("org_id", ctx.orgId)
      .eq("id", data.expense_claim_id)
      .maybeSingle();
    const status = claim?.status;
    if (status === "pending" || status === "approved" || status === "reimbursed") {
      return { ok: false, error: "That receipt belongs to an expense claim and can't be removed." };
    }
  }

  /* Same rule, other owner. A fuel docket adopted by a vehicle log is the
     substantiation behind a figure in the tax export, and the ATO expects it
     to still be there in five years. There is no "declined" escape hatch as
     there is for a claim, because a fuel log has no approval to fail.

     WITHDRAWING one is a different act, and it does NOT come through here:
     removing the fuel entry (actions/fleet.ts deleteLog) takes the figure out
     of every screen and out of the export, and the receipt stays deliberately
     attached to the hidden row. That is the point — a deduction that has
     already gone to an accountant must still be explicable afterwards, and a
     withdrawn entry with its evidence deleted explains nothing. */
  if (data.vehicle_log_id) {
    return { ok: false, error: "That receipt belongs to a fuel entry and can't be removed." };
  }

  const ref = String(data.storage_ref);
  if (!refIsOrgs(ref, ctx.orgId))
    return { ok: false, error: "That file doesn't belong to this organisation." };

  await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove([ref]);
  const { error } = await supabaseAdmin
    .from("documents")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", documentId);
  if (error) return { ok: false, error: "Couldn't remove that file." };
  return { ok: true };
}
