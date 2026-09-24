import { supabaseAdmin } from "@/lib/supabase-server";
import { listOrgCredentialRecords, listOrgCredentials } from "@/lib/org/query";
import type { OrgCredentialRecord } from "@/lib/org/credential-records";
import { listLicenceTermsFor } from "@/lib/staff/query";
import {
  documentsForOrgCredentials,
  documentsForStaffLicences,
  type StoredDocument,
} from "@/lib/documents/query";
import { sm8StaffLinkMap } from "@/lib/integrations/links";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import { credentialPaper, licencePaper } from "./terms";
import {
  paperKey,
  paperState,
  type JobPaper,
  type JobPaperFile,
  type PaperChoice,
  type PaperChoices,
} from "./papers";

/* Reading compliance for one job — the chooser's offer, and the papers the job
   already holds.

   ORG-SCOPED EVERYWHERE, like every read here, and the caller decides who may
   see what: a side of the chooser it may not offer is never read at all, and a
   staff licence's scan is signed only for someone entitled to open it.

   TOLERANT OF ITS OWN MIGRATION: until job_compliance.sql is applied, the
   job's read fails, and that reads as a job with nothing on it rather than a
   card that won't open. */

const TABLE = "job_compliance";

type LicenceRow = { id: string; staff_profile_id: string; type_name: string; expiry_date: string | null };

async function licenceRows(orgId: string, ids?: readonly string[]): Promise<LicenceRow[]> {
  let q = supabaseAdmin
    .from("staff_licences")
    .select("id, staff_profile_id, type_name, expiry_date")
    .eq("org_id", orgId);
  if (ids) {
    if (ids.length === 0) return [];
    q = q.in("id", [...ids]);
  }
  const { data } = await q;
  return (data ?? []) as LicenceRow[];
}

/** Who is booked on this job in ServiceM8, as HeyTiff staff ids. Empty when
    nobody is linked yet — which means "we don't know", never "nobody". */
async function bookedStaff(orgId: string, jobUuid: string): Promise<Set<string>> {
  const [{ data }, links] = await Promise.all([
    supabaseAdmin
      .from("sm8_job_activities")
      .select("staff_uuid")
      .eq("org_id", orgId)
      .eq("job_uuid", jobUuid)
      .eq("active", 1)
      .eq("activity_was_scheduled", 1),
    sm8StaffLinkMap(orgId),
  ]);
  const out = new Set<string>();
  for (const r of (data ?? []) as { staff_uuid: string | null }[]) {
    const id = r.staff_uuid ? links.get(r.staff_uuid) : undefined;
    if (id) out.add(id);
  }
  return out;
}

type JobRow = {
  id: string;
  org_credential_id: string | null;
  staff_licence_id: string | null;
  credential_record_id: string | null;
  licence_record_id: string | null;
  added_by: string | null;
  created_at: string;
};

async function jobRows(orgId: string, jobUuid: string): Promise<JobRow[]> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, org_credential_id, staff_licence_id, credential_record_id, licence_record_id, added_by, created_at")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .order("created_at", { ascending: true });
  if (error) return [];
  return (data ?? []) as JobRow[];
}

/** One thing on offer, and the term a link to it would pin. The term stays on
    the server: the browser sends back a key and the pin is decided here. */
export type PaperOffer = { choice: PaperChoice; termId: string | null };

/** What "Add compliance" offers for one job. A side the viewer may not add is
    null and never read. */
export async function readPaperChoices(
  orgId: string,
  jobUuid: string,
  opts: { company: boolean; staff: boolean; today: string; warnDays: number }
): Promise<PaperChoices> {
  const offer = await readPaperOffer(orgId, jobUuid, opts);
  return {
    company: offer.company?.map((o) => o.choice) ?? null,
    staff: offer.staff?.map((o) => o.choice) ?? null,
  };
}

/** The chooser's offer with each choice's current term — what "Add to job"
    checks a key against and pins. */
export async function readPaperOffer(
  orgId: string,
  jobUuid: string,
  opts: { company: boolean; staff: boolean; today: string; warnDays: number }
): Promise<{ company: PaperOffer[] | null; staff: PaperOffer[] | null }> {
  const onJob = await jobRows(orgId, jobUuid);
  const heldCredentials = new Set(onJob.map((r) => r.org_credential_id).filter(Boolean));
  const heldLicences = new Set(onJob.map((r) => r.staff_licence_id).filter(Boolean));

  const [company, staff] = await Promise.all([
    opts.company ? companyOffer(orgId, heldCredentials, opts) : Promise.resolve(null),
    opts.staff ? staffOffer(orgId, jobUuid, heldLicences, opts) : Promise.resolve(null),
  ]);
  return { company, staff };
}

async function companyOffer(
  orgId: string,
  held: ReadonlySet<string | null>,
  opts: { today: string; warnDays: number }
): Promise<PaperOffer[]> {
  const credentials = await listOrgCredentials(orgId);
  if (credentials.length === 0) return [];
  const [records, docs] = await Promise.all([
    listOrgCredentialRecords(orgId),
    documentsForOrgCredentials(
      orgId,
      credentials.map((c) => c.id)
    ),
  ]);
  return credentials.map((c) => {
    const { term, files } = credentialPaper(records[c.id] ?? [], docs.get(c.id) ?? []);
    const expiresOn = term?.expiresOn ?? c.expiryDate;
    return {
      termId: term?.id ?? null,
      choice: {
        key: paperKey("company", c.id),
        kind: "company" as const,
        name: c.name,
        person: null,
        issuer: term?.issuer ?? c.issuer,
        expiresOn,
        state: paperState(expiresOn, opts.today, opts.warnDays),
        files: files.length,
        booked: false,
        onJob: held.has(c.id),
      },
    };
  });
}

async function staffOffer(
  orgId: string,
  jobUuid: string,
  held: ReadonlySet<string | null>,
  opts: { today: string; warnDays: number }
): Promise<PaperOffer[]> {
  const licences = await licenceRows(orgId);
  if (licences.length === 0) return [];
  const ids = licences.map((l) => l.id);
  const [terms, docs, names, booked] = await Promise.all([
    listLicenceTermsFor(orgId, ids),
    documentsForStaffLicences(orgId, ids),
    staffDisplayNames(
      orgId,
      licences.map((l) => l.staff_profile_id)
    ),
    bookedStaff(orgId, jobUuid),
  ]);
  return licences
    .filter((l) => names.has(l.staff_profile_id))
    .map((l) => {
      const { term, files } = licencePaper(terms[l.id] ?? [], docs.get(l.id) ?? []);
      const expiresOn = term?.expiresOn ?? l.expiry_date;
      return {
        termId: term?.id ?? null,
        choice: {
          key: paperKey("staff", l.id),
          kind: "staff" as const,
          name: l.type_name,
          person: names.get(l.staff_profile_id) ?? null,
          issuer: term?.issuer ?? null,
          expiresOn,
          state: paperState(expiresOn, opts.today, opts.warnDays),
          files: files.length,
          booked: booked.has(l.staff_profile_id),
          onJob: held.has(l.id),
        },
      };
    });
}

/** What a paper would give a job right now: the current term (the one a new
    link pins, or null for a paper that has never had a term), whether there
    is anything filed under it, and whether it has run out. Null when the
    credential or ticket isn't this org's. */
export async function currentPaperOf(
  orgId: string,
  kind: "company" | "staff",
  id: string,
  today: string
): Promise<{ termId: string | null; files: number; expired: boolean } | null> {
  if (kind === "company") {
    const [credentials, records, docs] = await Promise.all([
      listOrgCredentials(orgId),
      listOrgCredentialRecords(orgId),
      documentsForOrgCredentials(orgId, [id]),
    ]);
    const c = credentials.find((x) => x.id === id);
    if (!c) return null;
    const { term, files } = credentialPaper(records[id] ?? [], docs.get(id) ?? []);
    const expiresOn = term?.expiresOn ?? c.expiryDate;
    return { termId: term?.id ?? null, files: files.length, expired: !!expiresOn && expiresOn < today };
  }
  const [licence] = await licenceRows(orgId, [id]);
  if (!licence) return null;
  const [terms, docs] = await Promise.all([
    listLicenceTermsFor(orgId, [id]),
    documentsForStaffLicences(orgId, [id]),
  ]);
  const { term, files } = licencePaper(terms[id] ?? [], docs.get(id) ?? []);
  const expiresOn = term?.expiresOn ?? licence.expiry_date;
  return { termId: term?.id ?? null, files: files.length, expired: !!expiresOn && expiresOn < today };
}

/** The papers on one job, as their rows read — with each file signed only
    for a viewer who may open it. */
export async function readJobPapers(
  orgId: string,
  jobUuid: string,
  viewer: { staffId: string | null; company: boolean; team: boolean; today: string; warnDays: number }
): Promise<JobPaper[]> {
  const rows = await jobRows(orgId, jobUuid);
  if (rows.length === 0) return [];

  const credentialIds = [...new Set(rows.map((r) => r.org_credential_id).filter((x): x is string => !!x))];
  const licenceIds = [...new Set(rows.map((r) => r.staff_licence_id).filter((x): x is string => !!x))];

  const [credentials, records, credentialDocs, licences, terms, licenceDocs] = await Promise.all([
    credentialIds.length ? listOrgCredentials(orgId) : Promise.resolve([]),
    credentialIds.length ? listOrgCredentialRecords(orgId) : Promise.resolve({} as Record<string, OrgCredentialRecord[]>),
    documentsForOrgCredentials(orgId, credentialIds),
    licenceRows(orgId, licenceIds),
    listLicenceTermsFor(orgId, licenceIds),
    documentsForStaffLicences(orgId, licenceIds),
  ]);

  const names = await staffDisplayNames(orgId, [
    ...rows.map((r) => r.added_by),
    ...licences.map((l) => l.staff_profile_id),
  ]);

  const fileOf = (d: StoredDocument, open: boolean): JobPaperFile => ({
    id: d.id,
    fileName: d.fileName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    url: open ? d.url : null,
  });

  const company: JobPaper[] = [];
  const staff: JobPaper[] = [];
  for (const r of rows) {
    if (r.org_credential_id) {
      const c = credentials.find((x) => x.id === r.org_credential_id);
      if (!c) continue;
      const { term, files, renewed } = credentialPaper(
        records[c.id] ?? [],
        credentialDocs.get(c.id) ?? [],
        r.credential_record_id
      );
      const expiresOn = term?.expiresOn ?? c.expiryDate;
      company.push({
        id: r.id,
        kind: "company",
        name: c.name,
        person: null,
        issuer: term?.issuer ?? c.issuer,
        expiresOn,
        state: paperState(expiresOn, viewer.today, viewer.warnDays),
        renewed,
        files: files.map((d) => fileOf(d, true)),
        addedBy: r.added_by ? names.get(r.added_by) ?? null : null,
        addedAt: r.created_at,
        manage: viewer.company,
      });
    } else if (r.staff_licence_id) {
      const l = licences.find((x) => x.id === r.staff_licence_id);
      if (!l) continue;
      const { term, files, renewed } = licencePaper(
        terms[l.id] ?? [],
        licenceDocs.get(l.id) ?? [],
        r.licence_record_id
      );
      const expiresOn = term?.expiresOn ?? l.expiry_date;
      /* A TICKET IS A DOCUMENT ABOUT ONE PERSON — a driver licence is
         government ID. Anyone on the job sees that it is here and when it
         runs to; its scan opens for `team` and for the person it belongs to. */
      const open = viewer.team || (!!viewer.staffId && viewer.staffId === l.staff_profile_id);
      staff.push({
        id: r.id,
        kind: "staff",
        name: l.type_name,
        person: names.get(l.staff_profile_id) ?? null,
        issuer: term?.issuer ?? null,
        expiresOn,
        state: paperState(expiresOn, viewer.today, viewer.warnDays),
        renewed,
        files: files.map((d) => fileOf(d, open)),
        addedBy: r.added_by ? names.get(r.added_by) ?? null : null,
        addedAt: r.created_at,
        manage: viewer.team,
      });
    }
  }

  /* the business's own first, in the wall's order; then the team's, a type
     at a time, so two people's ARC licences sit together */
  const wall = new Map(credentials.map((c, i) => [c.id, i]));
  const credentialOf = new Map(rows.map((r) => [r.id, r.org_credential_id]));
  company.sort(
    (a, b) => (wall.get(credentialOf.get(a.id) ?? "") ?? 0) - (wall.get(credentialOf.get(b.id) ?? "") ?? 0)
  );
  staff.sort((a, b) => a.name.localeCompare(b.name) || (a.person ?? "").localeCompare(b.person ?? ""));
  return [...company, ...staff];
}

/** The rows the email and the per-row acts need to check, by id, on this job. */
export async function jobPaperRows(
  orgId: string,
  jobUuid: string | null,
  ids: readonly string[]
): Promise<JobRow[]> {
  if (ids.length === 0) return [];
  let q = supabaseAdmin
    .from(TABLE)
    .select("id, org_credential_id, staff_licence_id, credential_record_id, licence_record_id, added_by, created_at, sm8_job_uuid")
    .eq("org_id", orgId)
    .in("id", [...ids]);
  if (jobUuid) q = q.eq("sm8_job_uuid", jobUuid);
  const { data, error } = await q;
  if (error) return [];
  return (data ?? []) as JobRow[];
}
