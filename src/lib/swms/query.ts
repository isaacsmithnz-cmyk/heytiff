import { supabaseAdmin } from "@/lib/supabase-server";
import { sm8StaffLinkMap } from "@/lib/integrations/links";
import { displayNameOf, type NameParts } from "@/lib/staff/name";
import {
  jurisdictionFromAddress,
  LIBRARY_VERSION,
  type Jurisdiction,
  type SwmsAnswers,
  type SwmsContent,
} from "./library";

/* THE SWMS READS. Every query is scoped by org_id — an id from a browser names
   a choice, and this decides whether it's real in this workspace. */

export type SwmsJob = {
  uuid: string;
  number: string | null;
  clientName: string | null;
  address: string | null;
  description: string | null;
  jurisdiction: Jurisdiction | null;
};

export type SwmsTicket = { name: string; expires: string | null; current: boolean };
export type SwmsTeamMember = {
  id: string;
  name: string;
  role: string;
  /** Booked on this job in ServiceM8 and linked to their HeyTiff card. */
  booked: boolean;
  tickets: SwmsTicket[];
};

export async function loadSwmsJob(orgId: string, jobUuid: string): Promise<SwmsJob | null> {
  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, company_uuid, job_address, geo_state, job_description")
    .eq("org_id", orgId)
    .eq("uuid", jobUuid)
    .eq("active", 1)
    .maybeSingle();
  const job = data as {
    uuid: string;
    generated_job_id: string | null;
    company_uuid: string | null;
    job_address: string | null;
    geo_state: string | null;
    job_description: string | null;
  } | null;
  if (!job) return null;

  let clientName: string | null = null;
  if (job.company_uuid) {
    const { data: co } = await supabaseAdmin
      .from("sm8_companies")
      .select("name")
      .eq("org_id", orgId)
      .eq("uuid", job.company_uuid)
      .maybeSingle();
    clientName = (co as { name: string | null } | null)?.name?.trim() || null;
  }

  const state = (job.geo_state ?? "").toUpperCase();
  return {
    uuid: job.uuid,
    number: job.generated_job_id,
    clientName,
    address: job.job_address?.trim() || null,
    description: job.job_description?.trim() || null,
    jurisdiction: state === "NSW" || state === "QLD" ? state : jurisdictionFromAddress(job.job_address),
  };
}

type ProfileRow = NameParts & { id: string; job_title: string | null; status: string | null };
const PROFILE_COLUMNS = "id, first_name, last_name, full_name, preferred_name, job_title, status";

/** The active team, with who's booked on this job and the tickets on file. */
export async function loadSwmsTeam(orgId: string, jobUuid: string, today: string): Promise<SwmsTeamMember[]> {
  const [{ data: profiles }, links, { data: acts }, { data: licences }] = await Promise.all([
    supabaseAdmin.from("staff_profiles").select(PROFILE_COLUMNS).eq("org_id", orgId).eq("status", "Active"),
    sm8StaffLinkMap(orgId),
    supabaseAdmin
      .from("sm8_job_activities")
      .select("staff_uuid")
      .eq("org_id", orgId)
      .eq("job_uuid", jobUuid)
      .eq("active", 1)
      .eq("activity_was_scheduled", 1),
    supabaseAdmin
      .from("staff_licences")
      .select("staff_profile_id, type_name, expiry_date")
      .eq("org_id", orgId),
  ]);

  const booked = new Set(
    ((acts ?? []) as { staff_uuid: string | null }[])
      .map((a) => (a.staff_uuid ? links.get(a.staff_uuid) : undefined))
      .filter((id): id is string => !!id)
  );
  const tickets = new Map<string, SwmsTicket[]>();
  for (const l of (licences ?? []) as { staff_profile_id: string; type_name: string | null; expiry_date: string | null }[]) {
    if (!l.type_name) continue;
    const list = tickets.get(l.staff_profile_id) ?? [];
    list.push({ name: l.type_name, expires: l.expiry_date, current: !l.expiry_date || l.expiry_date >= today });
    tickets.set(l.staff_profile_id, list);
  }

  return ((profiles ?? []) as ProfileRow[])
    .map((p) => ({
      id: p.id,
      name: displayNameOf(p),
      role: p.job_title?.trim() || "",
      booked: booked.has(p.id),
      tickets: tickets.get(p.id) ?? [],
    }))
    .sort((a, b) => Number(b.booked) - Number(a.booked) || a.name.localeCompare(b.name));
}

export async function isLibraryApproved(orgId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("swms_library_approvals")
    .select("id")
    .eq("org_id", orgId)
    .eq("library_version", LIBRARY_VERSION)
    .maybeSingle();
  return !!data;
}

/** Names and job titles for a handful of staff ids, in one read. */
async function profilesOf(orgId: string, ids: (string | null)[]): Promise<Map<string, { name: string; role: string }>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const { data } = await supabaseAdmin.from("staff_profiles").select(PROFILE_COLUMNS).eq("org_id", orgId).in("id", want);
  return new Map(((data ?? []) as ProfileRow[]).map((p) => [p.id, { name: displayNameOf(p), role: p.job_title?.trim() || "" }]));
}
const nameIn = (m: Map<string, { name: string }>, id: string | null): string => (id ? m.get(id)?.name ?? "—" : "—");

/* ── one version, as the document and the sign-on screen read it ────────── */

export type SwmsSignon = {
  at: string;
  /** For someone outside the business: whose phone they signed on. */
  onPhoneOf: string | null;
  briefedBy: string | null;
  issue: string | null;
  svg: string;
};
export type SwmsPerson = {
  id: string;
  staffProfileId: string | null;
  name: string;
  role: string;
  team: boolean;
  signon: SwmsSignon | null;
};
export type SwmsVersionRow = { version: number; issuedAt: string; reason: string; material: boolean; issuedBy: string };
export type SwmsDocument = {
  swmsId: string;
  versionId: string;
  version: number;
  latest: boolean;
  issuedAt: string;
  jurisdiction: Jurisdiction;
  answers: SwmsAnswers;
  content: SwmsContent;
  libraryVersion: string;
  job: SwmsJob | null;
  responsibleStaffId: string;
  responsible: string;
  siteCheckedBy: string;
  siteCheckedAt: string;
  people: SwmsPerson[];
  versions: SwmsVersionRow[];
};

type VersionRow = {
  id: string;
  swms_id: string;
  version: number;
  jurisdiction: Jurisdiction;
  answers: SwmsAnswers;
  content: SwmsContent;
  library_version: string;
  reason: string;
  material: boolean;
  responsible_staff_id: string;
  site_checked_by_staff_id: string;
  site_checked_at: string;
  issued_by_staff_id: string;
  issued_at: string;
};
const VERSION_COLUMNS =
  "id, swms_id, version, jurisdiction, answers, content, library_version, reason, material, responsible_staff_id, site_checked_by_staff_id, site_checked_at, issued_by_staff_id, issued_at";

export async function loadSwmsDocument(orgId: string, versionId: string): Promise<SwmsDocument | null> {
  const { data } = await supabaseAdmin
    .from("swms_versions")
    .select(VERSION_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", versionId)
    .maybeSingle();
  const v = data as VersionRow | null;
  if (!v) return null;

  const [{ data: swms }, { data: all }, { data: peopleRows }, { data: signonRows }] = await Promise.all([
    supabaseAdmin.from("swms").select("sm8_job_uuid").eq("org_id", orgId).eq("id", v.swms_id).maybeSingle(),
    supabaseAdmin
      .from("swms_versions")
      .select("version, issued_at, reason, material, issued_by_staff_id")
      .eq("org_id", orgId)
      .eq("swms_id", v.swms_id)
      .order("version", { ascending: true }),
    supabaseAdmin
      .from("swms_people")
      .select("id, staff_profile_id, outside_name, outside_company, created_at")
      .eq("org_id", orgId)
      .eq("version_id", v.id)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("swms_signons")
      .select("person_id, signed_by_staff_id, briefed_by_staff_id, signature_svg, issue_raised, signed_at")
      .eq("org_id", orgId)
      .eq("version_id", v.id),
  ]);

  const versions = (all ?? []) as { version: number; issued_at: string; reason: string; material: boolean; issued_by_staff_id: string }[];
  const people = (peopleRows ?? []) as { id: string; staff_profile_id: string | null; outside_name: string | null; outside_company: string | null }[];
  const signons = (signonRows ?? []) as { person_id: string; signed_by_staff_id: string | null; briefed_by_staff_id: string | null; signature_svg: string; issue_raised: string | null; signed_at: string }[];
  const bySigned = new Map(signons.map((s) => [s.person_id, s]));

  const names = await profilesOf(orgId, [
    v.responsible_staff_id,
    v.site_checked_by_staff_id,
    ...versions.map((x) => x.issued_by_staff_id),
    ...people.map((p) => p.staff_profile_id),
    ...signons.flatMap((s) => [s.signed_by_staff_id, s.briefed_by_staff_id]),
  ]);
  const job = swms ? await loadSwmsJob(orgId, (swms as { sm8_job_uuid: string }).sm8_job_uuid) : null;
  const latest = versions.length ? versions[versions.length - 1].version === v.version : true;

  return {
    swmsId: v.swms_id,
    versionId: v.id,
    version: v.version,
    latest,
    issuedAt: v.issued_at,
    jurisdiction: v.jurisdiction,
    answers: v.answers,
    content: v.content,
    libraryVersion: v.library_version,
    job,
    responsibleStaffId: v.responsible_staff_id,
    responsible: nameIn(names, v.responsible_staff_id),
    siteCheckedBy: nameIn(names, v.site_checked_by_staff_id),
    siteCheckedAt: v.site_checked_at,
    people: people.map((p) => {
      const s = bySigned.get(p.id);
      const team = !!p.staff_profile_id;
      return {
        id: p.id,
        staffProfileId: p.staff_profile_id,
        name: team ? nameIn(names, p.staff_profile_id) : p.outside_name ?? "—",
        role: team ? names.get(p.staff_profile_id!)?.role ?? "" : p.outside_company ?? "",
        team,
        signon: s
          ? {
              at: s.signed_at,
              onPhoneOf: !team && s.signed_by_staff_id ? nameIn(names, s.signed_by_staff_id) : null,
              briefedBy: s.briefed_by_staff_id ? nameIn(names, s.briefed_by_staff_id) : null,
              issue: s.issue_raised,
              svg: s.signature_svg,
            }
          : null,
      };
    }),
    versions: versions.map((x) => ({
      version: x.version,
      issuedAt: x.issued_at,
      reason: x.reason,
      material: x.material,
      issuedBy: nameIn(names, x.issued_by_staff_id),
    })),
  };
}

/* ── the job card's Compliance group ───────────────────────────────────── */

export type SwmsSummary = {
  swmsId: string;
  versionId: string;
  version: number;
  issuedAt: string;
  responsible: string;
  signed: number;
  total: number;
  waitingOn: string[];
};

/** The job's SWMS, at its latest version, with who's still to sign. */
export async function listJobSwms(orgId: string, jobUuid: string): Promise<SwmsSummary[]> {
  const { data: swmsRows } = await supabaseAdmin
    .from("swms")
    .select("id")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .order("created_at", { ascending: true });
  const ids = ((swmsRows ?? []) as { id: string }[]).map((r) => r.id);
  if (!ids.length) return [];

  const { data: versionRows } = await supabaseAdmin
    .from("swms_versions")
    .select("id, swms_id, version, issued_at, responsible_staff_id")
    .eq("org_id", orgId)
    .in("swms_id", ids)
    .order("version", { ascending: false });
  const latest = new Map<string, { id: string; swms_id: string; version: number; issued_at: string; responsible_staff_id: string }>();
  for (const v of (versionRows ?? []) as { id: string; swms_id: string; version: number; issued_at: string; responsible_staff_id: string }[]) {
    if (!latest.has(v.swms_id)) latest.set(v.swms_id, v);
  }
  const versionIds = [...latest.values()].map((v) => v.id);
  if (!versionIds.length) return [];

  const [{ data: peopleRows }, { data: signonRows }] = await Promise.all([
    supabaseAdmin.from("swms_people").select("id, version_id, staff_profile_id, outside_name").eq("org_id", orgId).in("version_id", versionIds),
    supabaseAdmin.from("swms_signons").select("person_id").eq("org_id", orgId).in("version_id", versionIds),
  ]);
  const people = (peopleRows ?? []) as { id: string; version_id: string; staff_profile_id: string | null; outside_name: string | null }[];
  const signed = new Set(((signonRows ?? []) as { person_id: string }[]).map((s) => s.person_id));
  const names = await profilesOf(orgId, [...people.map((p) => p.staff_profile_id), ...[...latest.values()].map((v) => v.responsible_staff_id)]);

  return ids
    .map((id) => latest.get(id))
    .filter((v): v is NonNullable<typeof v> => !!v)
    .map((v) => {
      const mine = people.filter((p) => p.version_id === v.id);
      const waiting = mine.filter((p) => !signed.has(p.id));
      return {
        swmsId: v.swms_id,
        versionId: v.id,
        version: v.version,
        issuedAt: v.issued_at,
        responsible: nameIn(names, v.responsible_staff_id),
        signed: mine.length - waiting.length,
        total: mine.length,
        waitingOn: waiting.map((p) => (p.staff_profile_id ? nameIn(names, p.staff_profile_id) : p.outside_name ?? "—")),
      };
    });
}

/* ── the bell ──────────────────────────────────────────────────────────── */

export type PendingSignon = {
  versionId: string;
  version: number;
  jobNumber: string | null;
  site: string | null;
  issuedAt: string;
};

/** Latest versions this team member is on and hasn't signed. A superseded
    version is never asked for — the next one is. */
export async function pendingSignons(orgId: string, staffProfileId: string): Promise<PendingSignon[]> {
  const { data: mine } = await supabaseAdmin
    .from("swms_people")
    .select("id, version_id")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffProfileId);
  const rows = (mine ?? []) as { id: string; version_id: string }[];
  if (!rows.length) return [];

  const [{ data: signonRows }, { data: versionRows }] = await Promise.all([
    supabaseAdmin.from("swms_signons").select("person_id").eq("org_id", orgId).in("person_id", rows.map((r) => r.id)),
    supabaseAdmin.from("swms_versions").select("id, swms_id, version, issued_at").eq("org_id", orgId).in("id", rows.map((r) => r.version_id)),
  ]);
  const signed = new Set(((signonRows ?? []) as { person_id: string }[]).map((s) => s.person_id));
  const versions = (versionRows ?? []) as { id: string; swms_id: string; version: number; issued_at: string }[];
  const swmsIds = [...new Set(versions.map((v) => v.swms_id))];
  if (!swmsIds.length) return [];

  const [{ data: newest }, { data: swmsRows }] = await Promise.all([
    supabaseAdmin.from("swms_versions").select("swms_id, version").eq("org_id", orgId).in("swms_id", swmsIds),
    supabaseAdmin.from("swms").select("id, sm8_job_uuid").eq("org_id", orgId).in("id", swmsIds),
  ]);
  const top = new Map<string, number>();
  for (const n of (newest ?? []) as { swms_id: string; version: number }[]) top.set(n.swms_id, Math.max(top.get(n.swms_id) ?? 0, n.version));
  const jobOf = new Map(((swmsRows ?? []) as { id: string; sm8_job_uuid: string }[]).map((s) => [s.id, s.sm8_job_uuid]));

  const pending = rows
    .filter((r) => !signed.has(r.id))
    .map((r) => versions.find((v) => v.id === r.version_id))
    .filter((v): v is NonNullable<typeof v> => !!v && top.get(v.swms_id) === v.version);

  const jobs = await Promise.all(pending.map((v) => loadSwmsJob(orgId, jobOf.get(v.swms_id) ?? "")));
  return pending.map((v, i) => ({
    versionId: v.id,
    version: v.version,
    jobNumber: jobs[i]?.number ?? null,
    site: jobs[i]?.address ?? null,
    issuedAt: v.issued_at,
  }));
}
