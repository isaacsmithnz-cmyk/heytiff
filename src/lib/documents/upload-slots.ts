import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { checkUpload, displayName, refIsOrgs, storageRef, type DocumentKind } from "@/lib/documents/files";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";

/* AN UPLOAD'S TWO SERVER STEPS, for every screen that uploads: the web's
   (actions/documents, behind its session) and the phone's (app/api/mobile,
   behind its token). Whoever calls has already decided this person may
   upload this kind; these keep the rest.

   THE ROW COMES FIRST. Creating the document row is what generates the id,
   and the id is what the object key is made of, so there is never a file in
   the bucket that no row points at. The opposite is possible — a row whose
   upload was abandoned — and that's the harmless direction: `uploaded_at`
   stays null and every read filters it out.

   THE BYTES NEVER PASS THROUGH HERE: the slot is a signed upload URL the
   client PUTs straight to storage. */

export type OpenedSlot =
  | { ok: true; documentId: string; ref: string; token: string; bucket: string; signedUrl: string }
  | { ok: false; error: string };

export type LandedSlot = { ok: true } | { ok: false; error: string };

/** A row, its object key, and a signed slot to put the bytes in. `onJob`
    files it on a ServiceM8 job from the start (a phone photo). */
export async function openSlot(
  orgId: string,
  staffId: string,
  kind: DocumentKind,
  file: { fileName: string; mimeType: string; sizeBytes: number },
  onJob?: string
): Promise<OpenedSlot> {
  const check = checkUpload({ name: file.fileName, type: file.mimeType, size: file.sizeBytes });
  if (!check.ok) return { ok: false, error: check.error };

  const { data, error } = await supabaseAdmin
    .from("documents")
    .insert({
      org_id: orgId,
      kind,
      // a placeholder only long enough to get an id back; the real key is
      // written below, and the NOT NULL keeps the column honest meanwhile
      storage_ref: `org/${orgId}/pending/${crypto.randomUUID()}`,
      file_name: displayName(file.fileName),
      mime_type: file.mimeType.toLowerCase(),
      size_bytes: file.sizeBytes,
      uploaded_by: staffId,
      ...(onJob ? { sm8_job_uuid: onJob } : {}),
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn't start that upload." };

  const documentId = String(data.id);
  const ref = storageRef(orgId, kind, documentId, check.ext);

  const { error: refErr } = await supabaseAdmin.from("documents").update({ storage_ref: ref }).eq("org_id", orgId).eq("id", documentId);
  if (refErr) return { ok: false, error: "Couldn't start that upload." };

  const { data: slot, error: slotErr } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(ref);
  if (slotErr || !slot) {
    await supabaseAdmin.from("documents").delete().eq("org_id", orgId).eq("id", documentId);
    return { ok: false, error: "Couldn't start that upload." };
  }

  return { ok: true, documentId, ref, token: slot.token, bucket: DOCUMENTS_BUCKET, signedUrl: slot.signedUrl };
}

/* The client reporting that the bytes landed. Until this runs the row is
   invisible everywhere, so a cancelled or failed upload leaves nothing on
   anyone's screen. Only the person handed the slot may close it. */
export async function landSlot(orgId: string, staffId: string, documentId: string): Promise<LandedSlot> {
  const { data } = await supabaseAdmin
    .from("documents")
    .select("uploaded_by, storage_ref")
    .eq("org_id", orgId)
    .eq("id", documentId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That upload no longer exists." };
  if (data.uploaded_by !== staffId) return { ok: false, error: "That isn't your upload." };
  if (!refIsOrgs(String(data.storage_ref), orgId)) return { ok: false, error: "That file doesn't belong to this organisation." };

  const { error } = await supabaseAdmin.from("documents").update({ uploaded_at: new Date().toISOString() }).eq("org_id", orgId).eq("id", documentId);
  if (error) return { ok: false, error: "Couldn't finish that upload." };
  return { ok: true };
}
