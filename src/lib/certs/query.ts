import { supabaseAdmin } from "@/lib/supabase-server";
import { displayNameOf, type NameParts } from "@/lib/staff/name";
import { CERT_LIBRARY_VERSION, type CertAnswers, type CertContent, type ClauseKey } from "./mechanical";

/* THE CERTIFICATE READS. Every query is scoped by org_id: an id from a
   browser names a choice, and this decides whether it's real in this
   workspace. */

const PROFILE_COLUMNS = "id, first_name, last_name, full_name, preferred_name";
type ProfileRow = NameParts & { id: string };

async function namesOf(orgId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const { data } = await supabaseAdmin.from("staff_profiles").select(PROFILE_COLUMNS).eq("org_id", orgId).in("id", want);
  return new Map(((data ?? []) as ProfileRow[]).map((p) => [p.id, displayNameOf(p)]));
}

/* ── the job ───────────────────────────────────────────────────────────── */

export type CertJob = {
  uuid: string;
  number: string | null;
  address: string | null;
  description: string | null;
  companyUuid: string | null;
  clientName: string | null;
  /** The job's own contact, the builder's person: "Attention Edward Reed". */
  contactName: string | null;
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

  const [company, contacts, claims] = await Promise.all([
    job.company_uuid
      ? supabaseAdmin.from("sm8_companies").select("name").eq("org_id", orgId).eq("uuid", job.company_uuid).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from("sm8_job_contacts")
      .select("first, last, type")
      .eq("org_id", orgId)
      .eq("job_uuid", jobUuid)
      .eq("active", 1),
    number && /^\d+$/.test(number)
      ? supabaseAdmin.from("sm8_jobs").select("generated_job_id, completion_date").eq("org_id", orgId).like("generated_job_id", `${number}%`)
      : Promise.resolve({ data: [] }),
  ]);

  const people = ((contacts.data ?? []) as { first: string | null; last: string | null; type: string | null }[])
    .map((c) => ({ name: [c.first, c.last].map((p) => p?.trim()).filter(Boolean).join(" "), type: (c.type ?? "").toUpperCase() }))
    .filter((c) => c.name);
  const contact = people.find((c) => c.type === "JOB") ?? people[0] ?? null;

  const dates = [
    job.completion_date,
    ...((claims.data ?? []) as { generated_job_id: string | null; completion_date: string | null }[])
      .filter((c) => number && new RegExp(`^${number}[A-Z]$`).test(c.generated_job_id ?? ""))
      .map((c) => c.completion_date),
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
    contactName: contact?.name ?? null,
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

/* ── the business's papers, for the masthead and the foot ──────────────── */

export type BusinessPapers = {
  /** "ARC authorisation AU12345", "Contractor licence 123456C" — when on file. */
  licences: string[];
  /** "Public liability: QBE 08U693177BPK" */
  insurance: string[];
};

export async function loadBusinessPapers(orgId: string): Promise<BusinessPapers> {
  const { data } = await supabaseAdmin.from("org_credentials").select("kind, name, issuer, number").eq("org_id", orgId);
  const rows = (data ?? []) as { kind: string; name: string | null; issuer: string | null; number: string | null }[];
  const licences: string[] = [];
  const insurance: string[] = [];
  for (const r of rows) {
    const name = (r.name ?? "").trim();
    const number = (r.number ?? "").trim();
    if (!name || !number) continue;
    if (r.kind === "licence" && /arc|refrigerant/i.test(name)) licences.push(`ARC authorisation ${number}`);
    else if (r.kind === "licence" && /contractor/i.test(name)) licences.push(`Contractor licence ${number}`);
    else if (r.kind === "insurance") {
      const issuer = (r.issuer ?? "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\b(Ltd|Limited|Pty|Insurance|Workers)\b\.?/gi, "").replace(/\s+/g, " ").trim();
      insurance.push(`${name}: ${issuer ? `${issuer} ` : ""}${number}`);
    }
  }
  return { licences, insurance };
}

/* ── the wording's approval ────────────────────────────────────────────── */

export async function certApproval(orgId: string): Promise<{ approvedBy: string; approvedAt: string } | null> {
  const { data } = await supabaseAdmin
    .from("cert_template_approvals")
    .select("approved_by_staff_id, approved_at")
    .eq("org_id", orgId)
    .eq("type", "mechanical")
    .eq("library_version", CERT_LIBRARY_VERSION)
    .maybeSingle();
  const row = data as { approved_by_staff_id: string; approved_at: string } | null;
  if (!row) return null;
  const names = await namesOf(orgId, [row.approved_by_staff_id]);
  return { approvedBy: names.get(row.approved_by_staff_id) ?? "Unnamed", approvedAt: row.approved_at };
}

/* ── the fan list, and what certifiers usually ask ─────────────────────── */

export type FanModel = { id: string; model: string; ratedLps: number };

export async function listFanModels(orgId: string): Promise<FanModel[]> {
  const { data } = await supabaseAdmin.from("fan_models").select("id, model, rated_lps").eq("org_id", orgId).order("model");
  return ((data ?? []) as { id: string; model: string; rated_lps: number | string }[]).map((f) => ({
    id: f.id,
    model: f.model,
    ratedLps: Number(f.rated_lps),
  }));
}

export type CertifierProfile = { id: string; name: string; clauses: ClauseKey[] };

export async function listCertifiers(orgId: string): Promise<CertifierProfile[]> {
  const { data } = await supabaseAdmin.from("certifier_profiles").select("id, name, clause_keys").eq("org_id", orgId).order("name");
  return ((data ?? []) as { id: string; name: string; clause_keys: string[] | null }[]).map((c) => ({
    id: c.id,
    name: c.name,
    clauses: (c.clause_keys ?? []) as ClauseKey[],
  }));
}

/** The certifier on this builder's last certificate, by name. */
export async function buildersCertifier(orgId: string, companyUuid: string | null): Promise<string | null> {
  if (!companyUuid) return null;
  const { data: certs } = await supabaseAdmin
    .from("certificates")
    .select("id")
    .eq("org_id", orgId)
    .eq("builder_company_uuid", companyUuid);
  const ids = ((certs ?? []) as { id: string }[]).map((c) => c.id);
  if (!ids.length) return null;
  const { data } = await supabaseAdmin
    .from("certificate_versions")
    .select("answers, issued_at")
    .eq("org_id", orgId)
    .in("certificate_id", ids)
    .order("issued_at", { ascending: false })
    .limit(10);
  for (const v of (data ?? []) as { answers: CertAnswers }[]) {
    const name = v.answers?.certifier?.name?.trim();
    if (name) return name;
  }
  return null;
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
    .select("id, certificate_id, version, content, issued_at, issued_by_staff_id, document_id")
    .eq("org_id", orgId)
    .in("certificate_id", ids)
    .order("version", { ascending: false });
  const rows = (data ?? []) as {
    id: string;
    certificate_id: string;
    version: number;
    content: CertContent;
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
      title: r.content?.title ?? "Compliance certificate",
      issuedAt: r.issued_at,
      issuedBy: names.get(r.issued_by_staff_id) ?? "Unnamed",
      documentId: r.document_id,
    }));
}

export type CertVersion = {
  id: string;
  certificateId: string;
  version: number;
  jobUuid: string;
  answers: CertAnswers;
  content: CertContent;
  reason: string;
  issuedAt: string;
  signatoryName: string;
  signatoryLicences: { arc: HeldLicence | null; contractor: HeldLicence | null };
  signatureSvg: string;
  documentId: string | null;
  job: CertJob | null;
};

export async function loadCertVersion(orgId: string, versionId: string): Promise<CertVersion | null> {
  const { data } = await supabaseAdmin
    .from("certificate_versions")
    .select("id, certificate_id, version, answers, content, reason, issued_at, signatory_staff_id, signatory_licences, signature_svg, document_id")
    .eq("org_id", orgId)
    .eq("id", versionId)
    .maybeSingle();
  const v = data as {
    id: string;
    certificate_id: string;
    version: number;
    answers: CertAnswers;
    content: CertContent;
    reason: string;
    issued_at: string;
    signatory_staff_id: string;
    signatory_licences: { arc: HeldLicence | null; contractor: HeldLicence | null };
    signature_svg: string;
    document_id: string | null;
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
    id: v.id,
    certificateId: v.certificate_id,
    version: v.version,
    jobUuid,
    answers: v.answers,
    content: v.content,
    reason: v.reason,
    issuedAt: v.issued_at,
    signatoryName: names.get(v.signatory_staff_id) ?? "Unnamed",
    signatoryLicences: v.signatory_licences ?? { arc: null, contractor: null },
    signatureSvg: v.signature_svg,
    documentId: v.document_id,
    job,
  };
}
