import { supabaseAdmin } from "@/lib/supabase-server";
import { staffDisplayNames as namesOf } from "@/lib/workboard/job-notes-query";
import { familyNumbersFor, splitJobNumber } from "@/lib/workboard/job-family";
import { CERT_LIBRARY_VERSION, CERT_TITLE, type ApprovedWording, type CertContent } from "./mechanical";

/* THE CERTIFICATE READS. Every query is scoped by org_id: an id from a
   browser names a choice, and this decides whether it's real in this
   workspace. */

/* ── the job ───────────────────────────────────────────────────────────── */

export type CertJob = {
  uuid: string;
  number: string | null;
  address: string | null;
  description: string | null;
  companyUuid: string | null;
  clientName: string | null;
  /** yyyy-mm-dd, the latest completion across the card and its claims. */
  completedOn: string | null;
};

/* A CLAIM IS NOT THE JOB. Progress claims are clones with a letter on the
   number (279A … 279E), and the card itself can sit at Work Order while its
   last claim is complete. The certificate belongs to the card; the date the
   works finished is the latest of the card's and its claims'. */
export async function loadCertJob(orgId: string, jobUuid: string): Promise<CertJob | null> {
  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, job_address, work_done_description, job_description, company_uuid, completion_date")
    .eq("org_id", orgId)
    .eq("uuid", jobUuid)
    .eq("active", 1)
    .maybeSingle();
  const job = data as {
    uuid: string;
    generated_job_id: string | null;
    job_address: string | null;
    work_done_description: string | null;
    job_description: string | null;
    company_uuid: string | null;
    completion_date: string | null;
  } | null;
  if (!job) return null;
  const number = job.generated_job_id?.trim() || null;
  /* the card's claims BY NAME (279A … 279Z), as job-family reads them: a
     prefix match would also ask for #2790–#2799, and a deleted claim's date
     isn't the works' */
  const parts = splitJobNumber(number);

  const [company, claims] = await Promise.all([
    job.company_uuid
      ? supabaseAdmin.from("sm8_companies").select("name").eq("org_id", orgId).eq("uuid", job.company_uuid).maybeSingle()
      : Promise.resolve({ data: null }),
    parts && parts.suffix === null
      ? supabaseAdmin
          .from("sm8_jobs")
          .select("completion_date")
          .eq("org_id", orgId)
          .eq("active", 1)
          .in("generated_job_id", familyNumbersFor(parts.base).slice(1))
      : Promise.resolve({ data: [] }),
  ]);

  const dates = [
    job.completion_date,
    ...((claims.data ?? []) as { completion_date: string | null }[]).map((c) => c.completion_date),
  ]
    .map((d) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) && !d.startsWith("0000") ? d.slice(0, 10) : null))
    .filter((d): d is string => !!d)
    .sort();

  return {
    uuid: job.uuid,
    number,
    address: job.job_address,
    description: job.work_done_description?.trim() ? job.work_done_description : job.job_description,
    companyUuid: job.company_uuid,
    clientName: ((company.data as { name?: string | null } | null)?.name ?? "").trim() || null,
    completedOn: dates[dates.length - 1] ?? null,
  };
}

/* ── the signatory ─────────────────────────────────────────────────────── */

export type HeldLicence = { name: string; number: string | null; expires: string | null; current: boolean };
export type Signatory = {
  staffId: string;
  name: string;
  arc: HeldLicence | null;
  contractor: HeldLicence | null;
  signatureSvg: string | null;
};

const isArc = (name: string) => /\barc\b|refrigerant handling/i.test(name);
const isContractor = (name: string) => /contractor/i.test(name);

/* CURRENT MEANS AN EXPIRY ON FILE THAT HASN'T PASSED. A ticket with no expiry
   date is "check it" here, not "never lapses": a certificate prints the
   licence as held on the day, and an ARC licence and a contractor licence
   both lapse. */
export async function loadSignatory(orgId: string, staffId: string, today: string): Promise<Signatory> {
  const [names, licences, signature] = await Promise.all([
    namesOf(orgId, [staffId]),
    supabaseAdmin.from("staff_licences").select("type_name, licence_number, expiry_date").eq("org_id", orgId).eq("staff_profile_id", staffId),
    supabaseAdmin.from("staff_signatures").select("signature_svg").eq("org_id", orgId).eq("staff_profile_id", staffId).maybeSingle(),
  ]);
  const held = ((licences.data ?? []) as { type_name: string | null; licence_number: string | null; expiry_date: string | null }[])
    .filter((l) => l.type_name)
    .map((l) => ({
      name: l.type_name as string,
      number: l.licence_number?.trim() || null,
      expires: l.expiry_date,
      current: !!l.expiry_date && l.expiry_date >= today,
    }));
  /* the current one when there are several, else the latest to lapse */
  const best = (test: (n: string) => boolean): HeldLicence | null =>
    held
      .filter((l) => test(l.name))
      .sort((a, b) => Number(b.current) - Number(a.current) || (b.expires ?? "").localeCompare(a.expires ?? ""))[0] ?? null;
  return {
    staffId,
    name: names.get(staffId) ?? "Unnamed",
    arc: best(isArc),
    contractor: best(isContractor),
    signatureSvg: (signature.data as { signature_svg?: string } | null)?.signature_svg ?? null,
  };
}

/* ── the business's papers, for the masthead ───────────────────────────── */

export type BusinessPapers = {
  /** "ARC authorisation AU12345", "Contractor licence 123456C" — when on file. */
  licences: string[];
};

export async function loadBusinessPapers(orgId: string): Promise<BusinessPapers> {
  const { data } = await supabaseAdmin.from("org_credentials").select("name, number").eq("org_id", orgId).eq("kind", "licence");
  const licences: string[] = [];
  for (const r of (data ?? []) as { name: string | null; number: string | null }[]) {
    const name = (r.name ?? "").trim();
    const number = (r.number ?? "").trim();
    if (!name || !number) continue;
    if (/arc|refrigerant/i.test(name)) licences.push(`ARC authorisation ${number}`);
    else if (/contractor/i.test(name)) licences.push(`Contractor licence ${number}`);
  }
  return { licences };
}

/* ── the wording's approval ────────────────────────────────────────────── */

/** This library version's approval, or null until the owner gives it. */
export async function certApproval(orgId: string): Promise<{ approvedById: string; approvedAt: string } | null> {
  const { data } = await supabaseAdmin
    .from("cert_template_approvals")
    .select("approved_by_staff_id, approved_at")
    .eq("org_id", orgId)
    .eq("type", "mechanical")
    .eq("library_version", CERT_LIBRARY_VERSION)
    .maybeSingle();
  const row = data as { approved_by_staff_id: string; approved_at: string } | null;
  return row ? { approvedById: row.approved_by_staff_id, approvedAt: row.approved_at } : null;
}

/** Every approval of the wording, newest first, each with the statements
    as the owner read them (null before approvals kept them). */
export type CertWordingApproval = { version: string; approvedById: string; approvedAt: string; wording: ApprovedWording | null };

export async function certApprovals(orgId: string): Promise<CertWordingApproval[]> {
  const { data } = await supabaseAdmin
    .from("cert_template_approvals")
    .select("library_version, approved_by_staff_id, approved_at, wording")
    .eq("org_id", orgId)
    .eq("type", "mechanical")
    .order("approved_at", { ascending: false });
  return ((data ?? []) as { library_version: string; approved_by_staff_id: string; approved_at: string; wording: ApprovedWording | null }[]).map((r) => ({
    version: r.library_version,
    approvedById: r.approved_by_staff_id,
    approvedAt: r.approved_at,
    wording: r.wording,
  }));
}

/* ── the fan list ─────────────────────────────────────────────────────── */

export type FanModel = { id: string; model: string; ratedLps: number };

export async function listFanModels(orgId: string): Promise<FanModel[]> {
  const { data } = await supabaseAdmin.from("fan_models").select("id, model, rated_lps").eq("org_id", orgId).order("model");
  return ((data ?? []) as { id: string; model: string; rated_lps: number | string }[]).map((f) => ({
    id: f.id,
    model: f.model,
    ratedLps: Number(f.rated_lps),
  }));
}

/* ── certificates on a job, and one version ────────────────────────────── */

export type CertSummary = {
  certificateId: string;
  versionId: string;
  version: number;
  title: string;
  issuedAt: string;
  issuedBy: string;
  documentId: string | null;
};

/** The job's certificates at their latest versions, newest first. */
export async function listJobCerts(orgId: string, jobUuid: string): Promise<CertSummary[]> {
  const { data: certs } = await supabaseAdmin
    .from("certificates")
    .select("id")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid);
  const ids = ((certs ?? []) as { id: string }[]).map((c) => c.id);
  if (!ids.length) return [];
  const { data } = await supabaseAdmin
    .from("certificate_versions")
    .select("id, certificate_id, version, title:content->>title, issued_at, issued_by_staff_id, document_id")
    .eq("org_id", orgId)
    .in("certificate_id", ids)
    .order("version", { ascending: false });
  const rows = (data ?? []) as {
    id: string;
    certificate_id: string;
    version: number;
    title: string | null;
    issued_at: string;
    issued_by_staff_id: string;
    document_id: string | null;
  }[];
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.certificate_id)) latest.set(r.certificate_id, r);
  const names = await namesOf(orgId, [...latest.values()].map((r) => r.issued_by_staff_id));
  return [...latest.values()]
    .sort((a, b) => b.issued_at.localeCompare(a.issued_at))
    .map((r) => ({
      certificateId: r.certificate_id,
      versionId: r.id,
      version: r.version,
      title: r.title || CERT_TITLE,
      issuedAt: r.issued_at,
      issuedBy: names.get(r.issued_by_staff_id) ?? "Unnamed",
      documentId: r.document_id,
    }));
}

/** One issued version, as its paper prints it. */
export type CertVersion = {
  version: number;
  content: CertContent;
  issuedAt: string;
  signatoryName: string;
  signatoryLicences: { arc: HeldLicence | null; contractor: HeldLicence | null };
  signatureSvg: string;
  job: CertJob | null;
};

export async function loadCertVersion(orgId: string, versionId: string): Promise<CertVersion | null> {
  const { data } = await supabaseAdmin
    .from("certificate_versions")
    .select("certificate_id, version, content, issued_at, signatory_staff_id, signatory_licences, signature_svg")
    .eq("org_id", orgId)
    .eq("id", versionId)
    .maybeSingle();
  const v = data as {
    certificate_id: string;
    version: number;
    content: CertContent;
    issued_at: string;
    signatory_staff_id: string;
    signatory_licences: { arc: HeldLicence | null; contractor: HeldLicence | null };
    signature_svg: string;
  } | null;
  if (!v) return null;
  const { data: cert } = await supabaseAdmin
    .from("certificates")
    .select("sm8_job_uuid")
    .eq("org_id", orgId)
    .eq("id", v.certificate_id)
    .maybeSingle();
  const jobUuid = (cert as { sm8_job_uuid: string } | null)?.sm8_job_uuid;
  if (!jobUuid) return null;
  const [names, job] = await Promise.all([namesOf(orgId, [v.signatory_staff_id]), loadCertJob(orgId, jobUuid)]);
  return {
    version: v.version,
    content: v.content,
    issuedAt: v.issued_at,
    signatoryName: names.get(v.signatory_staff_id) ?? "Unnamed",
    signatoryLicences: v.signatory_licences ?? { arc: null, contractor: null },
    signatureSvg: v.signature_svg,
    job,
  };
}

/** Whether this person has drawn their signature yet: the profile's
    Still to add asks for it until they have. */
export async function hasSignature(orgId: string, staffId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("staff_signatures")
    .select("staff_profile_id")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .maybeSingle();
  return !!data;
}
