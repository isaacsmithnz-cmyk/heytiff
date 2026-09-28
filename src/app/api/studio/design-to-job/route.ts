import { requireOrg } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { complianceContext, jobIsReal, trimId } from "@/lib/compliance/send";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { MAX_BYTES, storageRef } from "@/lib/documents/files";
import { pdfFileName, readPdfOptions } from "@/lib/studio/pdf-request";
import { renderDesignPdf } from "@/lib/studio/pdf-render";
import { sendJobDocumentsToServiceM8 } from "@/app/actions/job-sm8";
import type { DesignToJobResult } from "@/lib/studio/job-send";

/* POST { designId, name, options, jobUuid } — the design as a PDF, put on the
   job: on the HeyTiff job card's Documents first, then to ServiceM8 through
   the same queue and the same gates as the card's own Send to ServiceM8.

   TWO STEPS, TWO PERMISSIONS, as on the job card. Putting a file on a job is
   `workboard` (attachJobDocument's tier); sending it on to ServiceM8 is
   `workboard_manage`, because it puts the business's papers in front of
   everyone who can open the job there. Someone with the first and not the
   second gets the file on the card, and the answer says ServiceM8 was not
   theirs to send to.

   A NEW FILE EACH TIME. The PDF is made from the design as it is now, so a
   second attach is a second file — the Share dialog says when the last one
   went and calls the button "Send a new copy". */

export const runtime = "nodejs";
/* Chromium's cold start, the print, then up to 20 s waiting on ServiceM8 */
export const maxDuration = 60;

const answer = (r: DesignToJobResult, status = 200) => Response.json(r, { status });

export async function POST(request: Request): Promise<Response> {
  let orgId: string;
  try {
    ({ orgId } = await requireOrg("studio"));
  } catch {
    return answer({ ok: false, error: "Sign in to put a design on a job." }, 401);
  }
  const ctx = await complianceContext();
  if (!ctx || ctx.orgId !== orgId) return answer({ ok: false, error: "You can't add documents to jobs." }, 403);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const designId = typeof body?.designId === "string" ? body.designId.slice(0, 80) : "";
  const job = trimId(body?.jobUuid);
  if (!designId || !job) return answer({ ok: false, error: "Which design, and which job?" }, 400);
  if (!(await jobIsReal(orgId, job))) {
    return answer({ ok: false, error: "That job isn't in ServiceM8's copy any more." });
  }

  let pdf: Uint8Array;
  try {
    pdf = await renderDesignPdf(
      { orgId, designId, options: readPdfOptions(body?.options, designId) },
      new URL(request.url).origin
    );
  } catch (err) {
    console.error(`[design-to-job] render: ${String(err)}`);
    return answer({ ok: false, error: "Couldn't make the PDF. Try again." });
  }
  if (pdf.byteLength > MAX_BYTES) {
    return answer({ ok: false, error: "The PDF is too big for a job. Untick the plans or the other options." });
  }

  const fileName = pdfFileName(typeof body?.name === "string" ? body.name : "");
  const { data: row, error } = await supabaseAdmin
    .from("documents")
    .insert({
      org_id: orgId,
      kind: "job_document",
      /* a placeholder only long enough to get an id back, as every upload */
      storage_ref: `org/${orgId}/pending/${crypto.randomUUID()}`,
      file_name: fileName,
      mime_type: "application/pdf",
      size_bytes: pdf.byteLength,
      uploaded_by: ctx.staffId,
      sm8_job_uuid: job,
    })
    .select("id")
    .maybeSingle();
  if (error || !row) return answer({ ok: false, error: "Couldn't put the file on the job." });
  const documentId = String(row.id);
  const ref = storageRef(orgId, "job_document", documentId, "pdf");
  const stored = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(ref, Buffer.from(pdf), { contentType: "application/pdf", upsert: false });
  const landed =
    !stored.error &&
    !(
      await supabaseAdmin
        .from("documents")
        .update({ storage_ref: ref, uploaded_at: new Date().toISOString() })
        .eq("org_id", orgId)
        .eq("id", documentId)
    ).error;
  if (!landed) {
    /* nothing half-made is left on the job: no row without its file */
    if (!stored.error) await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove([ref]);
    await supabaseAdmin.from("documents").delete().eq("org_id", orgId).eq("id", documentId);
    return answer({ ok: false, error: "Couldn't put the file on the job." });
  }

  /* on the card now; ServiceM8 only for those who may send there */
  let sm8: Extract<DesignToJobResult, { ok: true }>["sm8"] = null;
  if (ctx.company) {
    try {
      sm8 = await sendJobDocumentsToServiceM8({ jobUuid: job, keys: [`d:${documentId}`] });
    } catch (err) {
      console.error(`[design-to-job] send: ${String(err)}`);
      sm8 = { ok: false, error: "It's on the job card, but couldn't be sent to ServiceM8. Send it from the card." };
    }
  }
  return answer({ ok: true, fileName, sm8 });
}
