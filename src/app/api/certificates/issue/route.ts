import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { todayInAu } from "@/lib/au-dates";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { MAX_BYTES, storageRef } from "@/lib/documents/files";
import { renderPdfAt } from "@/lib/studio/pdf-render";
import { signCertTicket } from "@/lib/certs/pdf-ticket";
import { normaliseCertAnswers } from "@/lib/certs/input";
import {
  buildCertificate,
  certFileName,
  certProblems,
  CERT_LIBRARY_VERSION,
  clausesFor,
  type CertAnswers,
} from "@/lib/certs/mechanical";
import { certApproval, loadCertJob, loadSignatory } from "@/lib/certs/query";

/* POST { jobUuid, answers, certificateId?, reason?, requirementsDocumentId? }
   — issue a certificate, or the next version of one.

   A ROUTE HANDLER, NOT A SERVER FUNCTION, because issuing prints the PDF:
   Chromium's cold start and the print need the minute `maxDuration` gives a
   route segment, as the design's Send to job does.

   NOTHING FROM THE BROWSER IS TRUSTED. The answers are read back through
   normaliseCertAnswers, the job and every id are re-resolved in this org, the
   signatory is whoever is signed in, their licences and signature are read
   here, every rule the wizard showed is asked again (certProblems), and the
   certificate is written HERE from the library.

   ALL OR NOTHING. The version is stored before printing (the print page reads
   it) and taken back out if the PDF can't be made or filed, so a failed issue
   leaves nothing half-made on the job. */

export const runtime = "nodejs";
export const maxDuration = 60;

export type IssueCertResult =
  | { ok: true; versionId: string; version: number; documentId: string; fileName: string }
  | { ok: false; error: string; problems?: string[] };

const answer = (r: IssueCertResult, status = 200) => Response.json(r, { status });
const trim = (v: unknown, max = 80) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(request: Request): Promise<Response> {
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await requireOrg("workboard"));
  } catch {
    return answer({ ok: false, error: "Sign in to issue a certificate." }, 401);
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const jobUuid = trim(body?.jobUuid);
  if (!jobUuid) return answer({ ok: false, error: "Which job?" }, 400);

  const staffId = await staffIdFor(orgId, userId);
  if (!staffId) return answer({ ok: false, error: "Your staff card is missing, so a certificate can't be signed in your name." });
  const job = await loadCertJob(orgId, jobUuid);
  if (!job) return answer({ ok: false, error: "That job isn't in ServiceM8's copy any more." });

  const answers: CertAnswers = normaliseCertAnswers(body?.answers);
  const today = todayInAu();
  const [approval, signatory] = await Promise.all([certApproval(orgId), loadSignatory(orgId, staffId, today)]);
  const problems = certProblems(answers, {
    today,
    approved: approval !== null,
    hasSignature: !!signatory.signatureSvg,
    arcCurrent: !!signatory.arc?.current,
    contractorCurrent: !!signatory.contractor?.current,
  });
  if (problems.length > 0) return answer({ ok: false, error: problems[0], problems });

  /* the certifier's list this version answers, when one was read: a file on THIS job */
  const listId = trim(body?.requirementsDocumentId);
  let requirementsDocumentId: string | null = null;
  if (listId && answers.requirements.length > 0) {
    const { data } = await supabaseAdmin
      .from("documents")
      .select("id")
      .eq("org_id", orgId)
      .eq("id", listId)
      .eq("sm8_job_uuid", jobUuid)
      .maybeSingle();
    requirementsDocumentId = (data as { id: string } | null)?.id ?? null;
  }

  /* a reissue names a certificate on this job; anything else starts one */
  const wanted = trim(body?.certificateId);
  let certificateId: string | null = null;
  let created = false;
  if (wanted) {
    const { data } = await supabaseAdmin
      .from("certificates")
      .select("id")
      .eq("org_id", orgId)
      .eq("id", wanted)
      .eq("sm8_job_uuid", jobUuid)
      .maybeSingle();
    certificateId = (data as { id: string } | null)?.id ?? null;
    if (!certificateId) return answer({ ok: false, error: "That certificate isn't on this job any more." });
  } else {
    const { data, error } = await supabaseAdmin
      .from("certificates")
      .insert({ org_id: orgId, sm8_job_uuid: jobUuid, type: "mechanical", builder_company_uuid: job.companyUuid, created_by_staff_id: staffId })
      .select("id")
      .single();
    if (error || !data) return answer({ ok: false, error: "Couldn't start the certificate." });
    certificateId = String((data as { id: string }).id);
    created = true;
  }
  const dropCertificate = async () => {
    if (created) await supabaseAdmin.from("certificates").delete().eq("org_id", orgId).eq("id", certificateId);
  };

  const { data: last } = await supabaseAdmin
    .from("certificate_versions")
    .select("version")
    .eq("org_id", orgId)
    .eq("certificate_id", certificateId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = ((last as { version: number } | null)?.version ?? 0) + 1;

  /* the certifier remembered, so their next job starts with these clauses */
  let certifierProfileId: string | null = null;
  const certifierName = answers.certifier?.name.trim() ?? "";
  if (certifierName) {
    const { data } = await supabaseAdmin
      .from("certifier_profiles")
      .upsert(
        { org_id: orgId, name: certifierName, clause_keys: clausesFor(answers), updated_at: new Date().toISOString() },
        { onConflict: "org_id,name" }
      )
      .select("id")
      .maybeSingle();
    certifierProfileId = (data as { id: string } | null)?.id ?? null;
  }

  const content = buildCertificate(answers);
  const { data: row, error: vErr } = await supabaseAdmin
    .from("certificate_versions")
    .insert({
      org_id: orgId,
      certificate_id: certificateId,
      version,
      answers,
      requirements: answers.requirements,
      requirements_document_id: requirementsDocumentId,
      certifier_profile_id: certifierProfileId,
      content,
      library_version: CERT_LIBRARY_VERSION,
      reason: version === 1 ? "First issue" : trim(body?.reason, 300) || "Reissued",
      signatory_staff_id: staffId,
      signatory_licences: { arc: signatory.arc, contractor: signatory.contractor },
      signature_svg: signatory.signatureSvg,
      issued_by_staff_id: staffId,
    })
    .select("id")
    .single();
  if (vErr || !row) {
    /* two presses racing for the same version number: the unique index kept one */
    await dropCertificate();
    return answer({ ok: false, error: "Couldn't issue the certificate. Try again." });
  }
  const versionId = String((row as { id: string }).id);
  const unissue = async () => {
    await supabaseAdmin.from("certificate_versions").delete().eq("org_id", orgId).eq("id", versionId);
    await dropCertificate();
  };

  let pdf: Uint8Array;
  try {
    pdf = await renderPdfAt("/print/certificate", signCertTicket({ orgId, versionId }), new URL(request.url).origin);
  } catch (err) {
    console.error(`[certificates/issue] render: ${String(err)}`);
    await unissue();
    return answer({ ok: false, error: "Couldn't make the PDF, so nothing was issued. Try again." });
  }
  if (pdf.byteLength > MAX_BYTES) {
    await unissue();
    return answer({ ok: false, error: "The PDF came out too big to put on the job." });
  }

  const fileName = certFileName(answers.covers, (job.address ?? "").split("\n")[0] ?? "", job.number);
  const { data: doc, error: dErr } = await supabaseAdmin
    .from("documents")
    .insert({
      org_id: orgId,
      kind: "job_document",
      /* a placeholder only long enough to get an id back, as every upload */
      storage_ref: `org/${orgId}/pending/${crypto.randomUUID()}`,
      file_name: fileName,
      mime_type: "application/pdf",
      size_bytes: pdf.byteLength,
      uploaded_by: staffId,
      sm8_job_uuid: jobUuid,
    })
    .select("id")
    .maybeSingle();
  if (dErr || !doc) {
    await unissue();
    return answer({ ok: false, error: "Couldn't put the PDF on the job, so nothing was issued." });
  }
  const documentId = String((doc as { id: string }).id);
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
    ).error &&
    !(
      await supabaseAdmin.from("certificate_versions").update({ document_id: documentId }).eq("org_id", orgId).eq("id", versionId)
    ).error;
  if (!landed) {
    if (!stored.error) await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove([ref]);
    await supabaseAdmin.from("documents").delete().eq("org_id", orgId).eq("id", documentId);
    await unissue();
    return answer({ ok: false, error: "Couldn't put the PDF on the job, so nothing was issued." });
  }

  revalidatePath("/dashboard/workboard");
  return answer({ ok: true, versionId, version, documentId, fileName });
}
