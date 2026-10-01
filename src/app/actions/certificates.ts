"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getDbRole, requireOrg } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { todayInAu } from "@/lib/au-dates";
import { DOCUMENTS_BUCKET, signOne } from "@/lib/documents/query";
import { refIsOrgs } from "@/lib/documents/files";
import { signatureSvg } from "@/lib/swms/input";
import { ownerName } from "@/lib/swms/query";
import { CERT_LIBRARY_VERSION, type CertAnswers } from "@/lib/certs/mechanical";
import { readQuote, suggestBuilding, type BuildingGuess, type QuoteReading } from "@/lib/certs/quote";
import { CERT_LIST_PROMPT, CERT_LIST_SCHEMA, parseListReading, type ListReading } from "@/lib/certs/list-reader";
import {
  buildersCertifier,
  certApproval,
  listCertifiers,
  listFanModels,
  listJobCerts,
  loadCertJob,
  loadCertVersion,
  loadSignatory,
  type CertJob,
  type CertSummary,
  type CertifierProfile,
  type FanModel,
  type Signatory,
} from "@/lib/certs/query";

/* WRITING A CERTIFICATE — everything but the issue itself, which prints a PDF
   and so lives in a route handler with room for Chromium
   (app/api/certificates/issue).

   THE GATES (docs/certificates-plan.md, Gates):
     opening the wizard        `workboard` — anyone who can open the job card
     issuing                   `workboard` AND their own current ARC licence
                               and contractor licence (checked at issue)
     the fan list              `workboard`
     approving the wording     the owner, as for the SWMS library
     your own signature        being a signed-in member: it is your own mark

   Server Functions are reachable by direct POST, so every one re-checks for
   itself, and every id from a browser is re-resolved in this org. Nothing here
   throws: the wizard says what went wrong in words. */

const WB = "/dashboard/workboard";
const trim = (v: unknown, max = 80) => String(v ?? "").trim().slice(0, max);

export type CertWizardContext = {
  job: CertJob;
  reading: QuoteReading;
  building: BuildingGuess;
  today: string;
  viewerStaffId: string | null;
  signatory: Signatory | null;
  approved: boolean;
  canApprove: boolean;
  ownerName: string | null;
  fanModels: FanModel[];
  certifiers: CertifierProfile[];
  /** The certifier on this builder's last certificate, to suggest. */
  usualCertifier: string | null;
  /** The certificates already on this job, newest first. */
  existing: CertSummary[];
  /** The job's own files, for picking the certifier's list. */
  files: { id: string; name: string }[];
};

/** Everything the wizard opens on. Null for a job this workspace doesn't hold. */
export async function certWizardContext(jobUuid: string): Promise<CertWizardContext | null> {
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await requireOrg("workboard"));
  } catch {
    return null;
  }
  const uuid = trim(jobUuid);
  if (!uuid) return null;
  const job = await loadCertJob(orgId, uuid);
  if (!job) return null;
  const today = todayInAu();
  const [staffId, approval, role, owner, fanModels, certifiers, usual, existing, files] = await Promise.all([
    staffIdFor(orgId, userId),
    certApproval(orgId),
    getDbRole(),
    ownerName(orgId),
    listFanModels(orgId),
    listCertifiers(orgId),
    buildersCertifier(orgId, job.companyUuid),
    listJobCerts(orgId, uuid),
    supabaseAdmin
      .from("documents")
      .select("id, file_name")
      .eq("org_id", orgId)
      .eq("sm8_job_uuid", uuid)
      .eq("kind", "job_document")
      .not("uploaded_at", "is", null)
      .order("uploaded_at", { ascending: false })
      .limit(40),
  ]);
  return {
    job,
    reading: readQuote(job.description),
    building: suggestBuilding(job.address),
    today,
    viewerStaffId: staffId,
    signatory: staffId ? await loadSignatory(orgId, staffId, today) : null,
    approved: approval !== null,
    canApprove: hasMinRole(role, "owner"),
    ownerName: owner,
    fanModels,
    certifiers,
    usualCertifier: usual,
    existing,
    files: ((files.data ?? []) as { id: string; file_name: string | null }[]).map((f) => ({
      id: f.id,
      name: f.file_name?.trim() || "Untitled file",
    })),
  };
}

/** A version's answers, for a reissue to start from. */
export async function certPrevious(
  versionId: string
): Promise<{ certificateId: string; version: number; answers: CertAnswers } | null> {
  try {
    const { orgId } = await requireOrg("workboard");
    const v = await loadCertVersion(orgId, trim(versionId));
    return v ? { certificateId: v.certificateId, version: v.version, answers: v.answers } : null;
  } catch {
    return null;
  }
}

/** The job's certificates at their latest versions, for the Documents face. */
export async function listCertificatesForJob(jobUuid: string): Promise<CertSummary[] | null> {
  try {
    const { orgId } = await requireOrg("workboard");
    return await listJobCerts(orgId, trim(jobUuid));
  } catch {
    return null;
  }
}

export type CertResult = { ok: true } | { ok: false; error: string };

/** The owner adopts the wording at this library version. */
export async function approveCertWording(): Promise<CertResult> {
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await requireOrg());
  } catch {
    return { ok: false, error: "Sign in to approve the wording." };
  }
  if (!hasMinRole(await getDbRole(), "owner")) return { ok: false, error: "Only the owner approves the certificate wording." };
  const staffId = await staffIdFor(orgId, userId);
  if (!staffId) return { ok: false, error: "Your staff card is missing, so the approval can't be put in your name." };
  const { error } = await supabaseAdmin.from("cert_template_approvals").insert({
    org_id: orgId,
    type: "mechanical",
    library_version: CERT_LIBRARY_VERSION,
    approved_by_staff_id: staffId,
  });
  /* approved twice at once: the unique index kept one, and it is approved */
  if (error && (error as { code?: string }).code !== "23505") return { ok: false, error: "Couldn't save the approval." };
  revalidatePath("/dashboard/certificates/template");
  return { ok: true };
}

export type FanModelResult = { ok: true; fan: FanModel } | { ok: false; error: string };

/** A fan the business fits, with its rated airflow from the spec sheet. */
export async function addFanModel(model: string, ratedLps: number): Promise<FanModelResult> {
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await requireOrg("workboard"));
  } catch {
    return { ok: false, error: "You can't add fans." };
  }
  const name = trim(model, 80);
  const lps = typeof ratedLps === "number" && Number.isFinite(ratedLps) ? Math.round(ratedLps * 10) / 10 : NaN;
  if (!name) return { ok: false, error: "Give the fan its model." };
  if (!(lps > 0 && lps < 100000)) return { ok: false, error: "Give its rated airflow in L/s, from the spec sheet." };
  const staffId = await staffIdFor(orgId, userId);
  const { data, error } = await supabaseAdmin
    .from("fan_models")
    .upsert({ org_id: orgId, model: name, rated_lps: lps, created_by_staff_id: staffId }, { onConflict: "org_id,model" })
    .select("id, model, rated_lps")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn't save that fan." };
  const row = data as { id: string; model: string; rated_lps: number | string };
  return { ok: true, fan: { id: row.id, model: row.model, ratedLps: Number(row.rated_lps) } };
}

/* ── your own signature ────────────────────────────────────────────────── */

/** Your signature, as stored; null until you draw one. */
export async function mySignature(): Promise<string | null> {
  try {
    const { orgId, userId } = await requireOrg();
    const staffId = await staffIdFor(orgId, userId);
    if (!staffId) return null;
    const { data } = await supabaseAdmin
      .from("staff_signatures")
      .select("signature_svg")
      .eq("org_id", orgId)
      .eq("staff_profile_id", staffId)
      .maybeSingle();
    return (data as { signature_svg?: string } | null)?.signature_svg ?? null;
  } catch {
    return null;
  }
}

export type SignatureResult = { ok: true; svg: string } | { ok: false; error: string };

/** Draw or redraw your own signature. Only ever your own: a signature is the
    person's mark, so nobody can set one on somebody else's card. */
export async function saveMySignature(pathData: string): Promise<SignatureResult> {
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await requireOrg());
  } catch {
    return { ok: false, error: "Sign in to save your signature." };
  }
  const svg = signatureSvg(pathData);
  if (!svg) return { ok: false, error: "Draw your signature in the box first." };
  const staffId = await staffIdFor(orgId, userId);
  if (!staffId) return { ok: false, error: "Your staff card is missing, so there's nowhere to keep it." };
  const { error } = await supabaseAdmin
    .from("staff_signatures")
    .upsert({ staff_profile_id: staffId, org_id: orgId, signature_svg: svg, set_at: new Date().toISOString() }, { onConflict: "staff_profile_id" });
  if (error) return { ok: false, error: "Couldn't save your signature." };
  return { ok: true, svg };
}

/* ── the certifier's list, read by Tiff ────────────────────────────────── */

const MODEL = "claude-opus-5-5";
/* If the model declines on policy grounds, the API re-runs the same request
   on this one inside the same call, as the proposal writer does. */
const FALLBACK_MODEL = "claude-opus-4-8";
const IMAGE_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageMedia = (typeof IMAGE_MEDIA)[number];

export type ReadListResult = ({ ok: true } & ListReading) | { ok: false; error: string };

function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Tiff is offline — API key rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Tiff is busy — try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Tiff — check the connection.";
  if (err instanceof Anthropic.APIError) return "Tiff hit an API error — try again.";
  return "Tiff couldn't read that.";
}

/** Read a certifier's list that is already on the job's Documents. Tiff only
    reads: the person checks every line before any of it is used. */
export async function readCertifierList(jobUuid: string, documentId: string): Promise<ReadListResult> {
  let orgId: string;
  try {
    ({ orgId } = await requireOrg("workboard"));
  } catch {
    return { ok: false, error: "You can't read documents on jobs." };
  }
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "Tiff isn't set up on this deployment." };
  const { data } = await supabaseAdmin
    .from("documents")
    .select("storage_ref, mime_type, size_bytes")
    .eq("org_id", orgId)
    .eq("id", trim(documentId))
    .eq("sm8_job_uuid", trim(jobUuid))
    .not("uploaded_at", "is", null)
    .maybeSingle();
  const doc = data as { storage_ref: string; mime_type: string | null; size_bytes: number | null } | null;
  if (!doc || !refIsOrgs(doc.storage_ref, orgId)) return { ok: false, error: "That file isn't on this job any more." };
  const media = (doc.mime_type ?? "").toLowerCase();
  const isPdf = media === "application/pdf";
  if (!isPdf && !IMAGE_MEDIA.includes(media as ImageMedia)) return { ok: false, error: "Tiff reads a PDF or a photo." };
  if ((doc.size_bytes ?? 0) > 10_000_000) return { ok: false, error: "That file is too large to read." };

  const { data: blob, error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(doc.storage_ref);
  if (error || !blob) return { ok: false, error: "Couldn't open that file. Try again." };
  const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");

  try {
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: FALLBACK_MODEL }],
      /* low, set rather than left to the default: this is copying lines off a
         page, not reasoning about them; the matching is done by rule */
      output_config: { effort: "low", format: { type: "json_schema", schema: CERT_LIST_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            isPdf
              ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } }
              : { type: "image" as const, source: { type: "base64" as const, media_type: media as ImageMedia, data: base64 } },
            { type: "text", text: CERT_LIST_PROMPT },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") return { ok: false, error: "Tiff declined to read this document." };
    if (response.stop_reason === "max_tokens") return { ok: false, error: "That list is too long to read in one go." };
    /* THE LAST text block: when the fallback model takes over, the first
       model's partial answer can stand ahead of the full one */
    const block = [...response.content].reverse().find((b) => b.type === "text");
    if (!block || block.type !== "text") return { ok: false, error: "Tiff found nothing to read. Try again." };
    return { ok: true, ...parseListReading(JSON.parse(block.text)) };
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  }
}

/** The Documents face's read after an issue: the card shows it at once. */
export async function revalidateCertificates(): Promise<void> {
  revalidatePath(WB);
}

/** A short-lived link to a version's PDF, for Download and the share sheet. */
export async function certificatePdfUrl(versionId: string): Promise<string | null> {
  try {
    const { orgId } = await requireOrg("workboard");
    const v = await loadCertVersion(orgId, trim(versionId));
    if (!v?.documentId) return null;
    const { data } = await supabaseAdmin
      .from("documents")
      .select("storage_ref")
      .eq("org_id", orgId)
      .eq("id", v.documentId)
      .not("uploaded_at", "is", null)
      .maybeSingle();
    const ref = (data as { storage_ref: string } | null)?.storage_ref;
    if (!ref || !refIsOrgs(ref, orgId)) return null;
    return await signOne(ref, 600);
  } catch {
    return null;
  }
}
