"use server";

import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { refIsOrgs } from "@/lib/documents/files";

/* PAPER ON A SERVICEM8 JOB — the upload on the job card's Documents face.

   The bytes take the shared slot flow (lib/documents/upload-client): a signed
   slot, a PUT straight to storage, a confirmation. That leaves a landed
   `job_document` row that belongs to nobody; this is the last step, and it
   points the row at the job — the shape `attachDocumentToProject` proved.

   THE FILE LIVES HERE. ServiceM8's mirror is read-only by charter, so nothing
   is pushed back onto their job; the card lists our files beside theirs, and
   only ours can be taken back off.

   ONE TIER: `workboard`, the card's own — the same as writing on the job's
   diary, and the same as taking one of our notes back off it. Neither action
   throws: the face says what went wrong in words, and a throw is a bare 503
   it could not read. */

export type JobDocumentResult = { ok: true } | { ok: false; error: string };

async function context(): Promise<{ orgId: string; staffId: string | null } | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  if (!(await can("workboard"))) return null;
  return { orgId, staffId: await staffProfileIdFor(orgId, userId) };
}

/** Put an uploaded file on a job. Accepts only a LANDED `job_document` that
    the caller uploaded and that no job holds yet — never someone else's row,
    and never a file already filed somewhere else. The job is re-resolved in
    this org's mirror, because the id is a choice the browser handed in. */
export async function attachJobDocument(documentId: string, jobUuid: string): Promise<JobDocumentResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "You can't add documents to jobs." };
  const id = String(documentId ?? "").trim().slice(0, 80);
  const job = String(jobUuid ?? "").trim().slice(0, 80);
  if (!id || !job) return { ok: false, error: "That upload didn't land." };

  const { data } = await supabaseAdmin
    .from("documents")
    .select("id, kind, uploaded_at, uploaded_by, sm8_job_uuid, storage_ref")
    .eq("org_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle();
  const doc = data as {
    id: string;
    kind: string;
    uploaded_at: string | null;
    uploaded_by: string | null;
    sm8_job_uuid: string | null;
    storage_ref: string;
  } | null;
  if (!doc || doc.kind !== "job_document" || !doc.uploaded_at) {
    return { ok: false, error: "That upload didn't land." };
  }
  if (!ctx.staffId || doc.uploaded_by !== ctx.staffId) {
    return { ok: false, error: "That isn't your upload." };
  }
  if (doc.sm8_job_uuid === job) return { ok: true };
  if (doc.sm8_job_uuid) return { ok: false, error: "That file is already on another job." };

  const { data: jobRow } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid")
    .eq("org_id", ctx.orgId)
    .eq("uuid", job)
    .maybeSingle();
  if (!jobRow) {
    /* THE CALLER'S OWN FILE, landed and on no job — the one thing it can
       never be, because nothing reads a job document that no job holds. It
       goes now rather than sitting in the bucket, invisible and billed. */
    await dropOrphan(ctx.orgId, doc.id, doc.storage_ref);
    return { ok: false, error: "That job isn't in ServiceM8's copy any more." };
  }

  /* `is null` in the write as well as the read: two presses racing can't
     both claim the one row. */
  const { data: moved, error } = await supabaseAdmin
    .from("documents")
    .update({ sm8_job_uuid: job })
    .eq("org_id", ctx.orgId)
    .eq("id", id)
    .is("sm8_job_uuid", null)
    .select("id");
  if (error || !moved || moved.length === 0) return { ok: false, error: "Couldn't add the file to the job." };
  return { ok: true };
}

async function dropOrphan(orgId: string, id: string, ref: string): Promise<void> {
  if (refIsOrgs(ref, orgId)) await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove([ref]);
  await supabaseAdmin.from("documents").delete().eq("org_id", orgId).eq("id", id).is("sm8_job_uuid", null);
}

/** Take one of OUR files back off a job — the object with the row, since an
    orphaned object is invisible and still billed. Only a `job_document`
    that a job holds: ServiceM8's cached copies are theirs, and never ours to
    delete from here. */
export async function removeJobDocument(documentId: string): Promise<JobDocumentResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "You can't remove documents from jobs." };
  const id = String(documentId ?? "").trim().slice(0, 80);
  if (!id) return { ok: false, error: "That file is already gone." };

  const { data } = await supabaseAdmin
    .from("documents")
    .select("id, kind, storage_ref, sm8_job_uuid")
    .eq("org_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle();
  const doc = data as { id: string; kind: string; storage_ref: string; sm8_job_uuid: string | null } | null;
  if (!doc) return { ok: false, error: "That file is already gone." };
  if (doc.kind !== "job_document" || !doc.sm8_job_uuid) {
    return { ok: false, error: "That file can't be removed from here." };
  }
  const ref = String(doc.storage_ref);
  if (!refIsOrgs(ref, ctx.orgId)) return { ok: false, error: "That file doesn't belong to this organisation." };

  await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove([ref]);
  const { error } = await supabaseAdmin.from("documents").delete().eq("org_id", ctx.orgId).eq("id", id);
  if (error) return { ok: false, error: "Couldn't remove that file." };
  return { ok: true };
}
