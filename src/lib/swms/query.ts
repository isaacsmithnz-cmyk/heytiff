import { supabaseAdmin } from "@/lib/supabase-server";
import { sm8StaffLinkMap } from "@/lib/integrations/links";
import { displayNameOf, type NameParts } from "@/lib/staff/name";
import {
  jurisdictionOf,
  LIBRARY_VERSION,
  stateFromAddress,
  stateFromGeo,
  type AuState,
  type Jurisdiction,
  type SwmsAnswers,
  type SwmsContent,
} from "./library";
import { effectiveSignons, type ChainPerson, type ChainVersion } from "./signons";

/* THE SWMS READS. Every query is scoped by org_id — an id from a browser names
   a choice, and this decides whether it's real in this workspace. */

export type SwmsJob = {
  uuid: string;
  number: string | null;
  clientName: string | null;
  address: string | null;
  description: string | null;
  /** The site's state, any state — named, so a site the template doesn't
      cover is said to be one instead of read as New South Wales. */
  state: AuState | null;
  /** The rules the template writes to there; null when the state is unknown
      or not one it covers. */
  jurisdiction: Jurisdiction | null;
  /** The site's postcode — the area a nearest hospital belongs to. */
  postcode: string | null;
  /** Where the job is up to in ServiceM8 — a sign-on isn't asked for once
      the work is over. */
  status: string | null;
  /** The job's ServiceM8 category — "Install", "Service" — which answers
      whether this is an install without asking. */
  categoryName: string | null;
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
    .select("uuid, generated_job_id, company_uuid, category_uuid, status, job_address, geo_state, geo_postcode, job_description")
    .eq("org_id", orgId)
    .eq("uuid", jobUuid)
    .eq("active", 1)
    .maybeSingle();
  const job = data as {
    uuid: string;
    generated_job_id: string | null;
    company_uuid: string | null;
    category_uuid: string | null;
    status?: string | null;
    job_address: string | null;
    geo_state: string | null;
    geo_postcode?: string | null;
    job_description: string | null;
  } | null;
  if (!job) return null;

  const [{ data: co }, { data: cat }] = await Promise.all([
    job.company_uuid
      ? supabaseAdmin.from("sm8_companies").select("name").eq("org_id", orgId).eq("uuid", job.company_uuid).maybeSingle()
      : Promise.resolve({ data: null }),
    job.category_uuid
      ? supabaseAdmin.from("sm8_categories").select("name").eq("org_id", orgId).eq("uuid", job.category_uuid).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const clientName = (co as { name: string | null } | null)?.name?.trim() || null;

  const state = stateFromGeo(job.geo_state) ?? stateFromAddress(job.job_address);
  return {
    uuid: job.uuid,
    number: job.generated_job_id,
    clientName,
    address: job.job_address?.trim() || null,
    description: job.job_description?.trim() || null,
    status: job.status?.trim() || null,
    state,
    jurisdiction: jurisdictionOf(state),
    postcode: postcodeOf(job.geo_postcode ?? null, job.job_address),
    categoryName: (cat as { name: string | null } | null)?.name?.trim() || null,
  };
}

/** ServiceM8's geocoded postcode, or the one that ends the address. */
function postcodeOf(geo: string | null, address: string | null): string | null {
  const g = (geo ?? "").trim();
  if (/^\d{4}$/.test(g)) return g;
  return /\b(\d{4})\s*(,\s*australia)?\s*$/i.exec(address ?? "")?.[1] ?? null;
}

/* THE NEAREST HOSPITAL BELONGS TO THE AREA, not the job. Typed once for a
   postcode, it is the same for the next job there, so a new SWMS starts with
   the hospital the last SWMS in that postcode named. Never from further
   away: a hospital an hour off, filled in and not noticed, is worse than a
   blank that asks. */
export async function nearbyHospital(
  orgId: string,
  job: SwmsJob
): Promise<{ name: string; jobNumber: string | null } | null> {
  if (!job.postcode) return null;
  const { data: versionRows } = await supabaseAdmin
    .from("swms_versions")
    .select("swms_id, answers, issued_at")
    .eq("org_id", orgId)
    .order("issued_at", { ascending: false })
    .limit(200);
  const named = ((versionRows ?? []) as { swms_id: string; answers: { hospital?: unknown } | null }[])
    .map((v) => ({ swmsId: v.swms_id, hospital: typeof v.answers?.hospital === "string" ? v.answers.hospital.trim() : "" }))
    .filter((v) => v.hospital);
  if (!named.length) return null;

  const { data: swmsRows } = await supabaseAdmin
    .from("swms")
    .select("id, sm8_job_uuid")
    .eq("org_id", orgId)
    .in("id", [...new Set(named.map((v) => v.swmsId))]);
  const jobOf = new Map(((swmsRows ?? []) as { id: string; sm8_job_uuid: string }[]).map((x) => [x.id, x.sm8_job_uuid]));
  const { data: jobRows } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, geo_postcode, job_address")
    .eq("org_id", orgId)
    .in("uuid", [...new Set(jobOf.values())]);
  const jobs = new Map(
    ((jobRows ?? []) as { uuid: string; generated_job_id: string | null; geo_postcode?: string | null; job_address: string | null }[]).map((j) => [j.uuid, j])
  );

  for (const v of named) {
    const j = jobs.get(jobOf.get(v.swmsId) ?? "");
    if (j && postcodeOf(j.geo_postcode ?? null, j.job_address) === job.postcode) {
      return { name: v.hospital, jobNumber: j.generated_job_id };
    }
  }
  return null;
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
  return (await libraryApproval(orgId)) !== null;
}

/** Who approved the template at its current version, and when; null until then. */
export async function libraryApproval(orgId: string): Promise<{ approvedBy: string; approvedAt: string } | null> {
  const { data } = await supabaseAdmin
    .from("swms_library_approvals")
    .select("approved_by_staff_id, approved_at")
    .eq("org_id", orgId)
    .eq("library_version", LIBRARY_VERSION)
    .maybeSingle();
  const row = data as { approved_by_staff_id: string; approved_at: string } | null;
  if (!row) return null;
  const names = await profilesOf(orgId, [row.approved_by_staff_id]);
  return { approvedBy: nameIn(names, row.approved_by_staff_id), approvedAt: row.approved_at };
}

/** The business's owner, by name — who a blocked crew lead needs to ask. */
export async function ownerName(orgId: string): Promise<string | null> {
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("primary_owner_user_id")
    .eq("id", orgId)
    .maybeSingle();
  const userId = (org as { primary_owner_user_id: string | null } | null)?.primary_owner_user_id;
  if (!userId) return null;
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select(PROFILE_COLUMNS)
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? displayNameOf(data as ProfileRow) : null;
}

/** Names and job titles for a handful of staff ids, in one read. */
async function profilesOf(orgId: string, ids: (string | null)[]): Promise<Map<string, { name: string; role: string }>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const { data } = await supabaseAdmin.from("staff_profiles").select(PROFILE_COLUMNS).eq("org_id", orgId).in("id", want);
  return new Map(((data ?? []) as ProfileRow[]).map((p) => [p.id, { name: displayNameOf(p), role: p.job_title?.trim() || "" }]));
}
const nameIn = (m: Map<string, { name: string }>, id: string | null): string => (id ? m.get(id)?.name ?? "—" : "—");

/* ── the chain: every version of a SWMS, who each covers, who signed ─────── */

type ChainRows = {
  versions: (ChainVersion & { swmsId: string; issuedAt: string; reason: string; issuedBy: string; responsible: string })[];
  people: (ChainPerson & { outsideCompany: string | null })[];
  signons: {
    personId: string;
    signedByStaffId: string | null;
    briefedByStaffId: string | null;
    svg: string;
    issue: string | null;
    clearedBy: string | null;
    clearedAt: string | null;
    at: string;
  }[];
};

/** Every version of these SWMS with their people and sign-ons, in three reads. */
async function loadChains(orgId: string, swmsIds: string[]): Promise<ChainRows> {
  if (!swmsIds.length) return { versions: [], people: [], signons: [] };
  const { data: versionRows } = await supabaseAdmin
    .from("swms_versions")
    .select("id, swms_id, version, material, issued_at, reason, issued_by_staff_id, responsible_staff_id")
    .eq("org_id", orgId)
    .in("swms_id", swmsIds);
  const versions = ((versionRows ?? []) as {
    id: string; swms_id: string; version: number; material: boolean; issued_at: string; reason: string; issued_by_staff_id: string; responsible_staff_id: string;
  }[]).map((v) => ({
    id: v.id,
    swmsId: v.swms_id,
    version: v.version,
    /* the first issue is always one everyone signs */
    material: v.version === 1 ? true : v.material !== false,
    issuedAt: v.issued_at,
    reason: v.reason,
    issuedBy: v.issued_by_staff_id,
    responsible: v.responsible_staff_id,
  }));
  const versionIds = versions.map((v) => v.id);
  if (!versionIds.length) return { versions, people: [], signons: [] };

  const [{ data: peopleRows }, { data: signonRows }] = await Promise.all([
    supabaseAdmin
      .from("swms_people")
      .select("id, version_id, staff_profile_id, outside_name, outside_company")
      .eq("org_id", orgId)
      .in("version_id", versionIds),
    supabaseAdmin
      .from("swms_signons")
      .select("person_id, signed_by_staff_id, briefed_by_staff_id, signature_svg, issue_raised, issue_cleared_by_staff_id, issue_cleared_at, signed_at")
      .eq("org_id", orgId)
      .in("version_id", versionIds),
  ]);
  return {
    versions,
    people: ((peopleRows ?? []) as { id: string; version_id: string; staff_profile_id: string | null; outside_name: string | null; outside_company: string | null }[]).map((p) => ({
      id: p.id,
      versionId: p.version_id,
      staffProfileId: p.staff_profile_id,
      outsideName: p.outside_name,
      outsideCompany: p.outside_company,
    })),
    signons: ((signonRows ?? []) as {
      person_id: string; signed_by_staff_id: string | null; briefed_by_staff_id: string | null; signature_svg: string;
      issue_raised: string | null; issue_cleared_by_staff_id: string | null; issue_cleared_at: string | null; signed_at: string;
    }[]).map((x) => ({
      personId: x.person_id,
      signedByStaffId: x.signed_by_staff_id,
      briefedByStaffId: x.briefed_by_staff_id,
      svg: x.signature_svg,
      issue: x.issue_raised,
      clearedBy: x.issue_cleared_by_staff_id,
      clearedAt: x.issue_cleared_at,
      at: x.signed_at,
    })),
  };
}

/** The sign-on standing for each person across one SWMS's versions. */
function standingSignons(chain: ChainRows, swmsId: string) {
  const versions = chain.versions.filter((v) => v.swmsId === swmsId);
  const ids = new Set(versions.map((v) => v.id));
  const people = chain.people.filter((p) => ids.has(p.versionId));
  const byPerson = new Map(chain.signons.map((x) => [x.personId, x]));
  return effectiveSignons(versions, people, (id) => byPerson.get(id) ?? null);
}

/** Whether a sign-on already stands for this person — their own, or one a
    correction carried from the version before. */
export async function hasStandingSignon(orgId: string, swmsId: string, personId: string): Promise<boolean> {
  const chain = await loadChains(orgId, [swmsId]);
  return !!standingSignons(chain, swmsId).get(personId);
}

/* ── one version, as the document and the sign-on screen read it ────────── */

export type SwmsSignon = {
  at: string;
  /** The version this signature was given on — earlier than the one being
      read when a correction carried it. */
  version: number;
  /** For someone outside the business: whose phone they signed on. */
  onPhoneOf: string | null;
  briefedBy: string | null;
  issue: string | null;
  /** Who said the issue was sorted on site, and when; null while it stands. */
  issueCleared: { by: string; at: string } | null;
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
export type SwmsVersionRow = { id: string; version: number; issuedAt: string; reason: string; material: boolean; issuedBy: string };
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

/* ONE ORDER FOR THE CREW, decided here. The rows of one issue are inserted in
   one statement, so they share `created_at` and the database hands them back
   in whatever order it likes: the person in charge, then the team, then
   anyone from outside the business, each by name. */
const byCrewOrder =
  (responsibleId: string) =>
  (a: { staffProfileId: string | null; team: boolean; name: string }, b: typeof a): number =>
    Number(b.staffProfileId === responsibleId) - Number(a.staffProfileId === responsibleId) ||
    Number(b.team) - Number(a.team) ||
    a.name.localeCompare(b.name);

export async function loadSwmsDocument(orgId: string, versionId: string): Promise<SwmsDocument | null> {
  const { data } = await supabaseAdmin
    .from("swms_versions")
    .select(VERSION_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", versionId)
    .maybeSingle();
  const v = data as VersionRow | null;
  if (!v) return null;

  const [{ data: swms }, chain] = await Promise.all([
    supabaseAdmin.from("swms").select("sm8_job_uuid").eq("org_id", orgId).eq("id", v.swms_id).maybeSingle(),
    loadChains(orgId, [v.swms_id]),
  ]);
  const standing = standingSignons(chain, v.swms_id);
  const versions = [...chain.versions].sort((a, b) => a.version - b.version);
  const people = chain.people.filter((p) => p.versionId === v.id);

  const names = await profilesOf(orgId, [
    v.responsible_staff_id,
    v.site_checked_by_staff_id,
    ...versions.map((x) => x.issuedBy),
    ...people.map((p) => p.staffProfileId),
    ...chain.signons.flatMap((x) => [x.signedByStaffId, x.briefedByStaffId, x.clearedBy]),
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
    people: people
      .map((p) => {
        const eff = standing.get(p.id) ?? null;
        const team = !!p.staffProfileId;
        return {
          id: p.id,
          staffProfileId: p.staffProfileId,
          name: team ? nameIn(names, p.staffProfileId) : p.outsideName ?? "—",
          role: team ? names.get(p.staffProfileId!)?.role ?? "" : p.outsideCompany ?? "",
          team,
          signon: eff
            ? {
                at: eff.signon.at,
                version: eff.version,
                /* signed on someone else's phone — a workmate's or the crew lead's */
                onPhoneOf:
                  eff.signon.signedByStaffId && eff.signon.signedByStaffId !== p.staffProfileId
                    ? nameIn(names, eff.signon.signedByStaffId)
                    : null,
                /* the person in charge gives the briefing; nobody briefs them */
                briefedBy:
                  eff.signon.briefedByStaffId && eff.signon.briefedByStaffId !== p.staffProfileId
                    ? nameIn(names, eff.signon.briefedByStaffId)
                    : null,
                issue: eff.signon.issue?.trim() || null,
                issueCleared: eff.signon.clearedAt
                  ? { by: nameIn(names, eff.signon.clearedBy), at: eff.signon.clearedAt }
                  : null,
                svg: eff.signon.svg,
              }
            : null,
        };
      })
      .sort(byCrewOrder(v.responsible_staff_id)),
    versions: versions.map((x) => ({
      id: x.id,
      version: x.version,
      issuedAt: x.issuedAt,
      reason: x.reason,
      material: x.material,
      issuedBy: nameIn(names, x.issuedBy),
    })),
  };
}

/* ── the job card's Compliance group ───────────────────────────────────── */

/** Something a worker wrote at sign-on that the person in charge has to know. */
export type SwmsIssue = { name: string; issue: string };

export type SwmsSummary = {
  swmsId: string;
  versionId: string;
  version: number;
  issuedAt: string;
  responsible: string;
  signed: number;
  total: number;
  waitingOn: string[];
  /** Raised at sign-on, by whoever raised it — the reason the SWMS might
      need changing before the work starts. */
  issues: SwmsIssue[];
  /** The reader has something to sign here — their own sign-on, or anyone
      else's on their phone. Anyone the SWMS doesn't cover has nothing behind
      a Sign on button. */
  viewerCanSign: boolean;
};

/** The job's SWMS, at its latest version, with who's still to sign. */
export async function listJobSwms(orgId: string, jobUuid: string, viewerStaffId: string | null = null): Promise<SwmsSummary[]> {
  const { data: swmsRows } = await supabaseAdmin
    .from("swms")
    .select("id")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .order("created_at", { ascending: true });
  const ids = ((swmsRows ?? []) as { id: string }[]).map((r) => r.id);
  if (!ids.length) return [];

  const chain = await loadChains(orgId, ids);
  const names = await profilesOf(orgId, [...chain.people.map((p) => p.staffProfileId), ...chain.versions.map((v) => v.responsible)]);

  return ids.flatMap((id) => {
    const versions = chain.versions.filter((v) => v.swmsId === id);
    if (!versions.length) return [];
    const v = versions.reduce((a, b) => (b.version > a.version ? b : a));
    const standing = standingSignons(chain, id);
    const mine = chain.people.filter((p) => p.versionId === v.id);
    const nameOf = (p: ChainPerson) => (p.staffProfileId ? nameIn(names, p.staffProfileId) : p.outsideName ?? "—");
    /* team first, then outsiders, each by name — see byCrewOrder */
    const waiting = mine
      .filter((p) => !standing.get(p.id))
      .sort((x, y) => Number(!!y.staffProfileId) - Number(!!x.staffProfileId) || nameOf(x).localeCompare(nameOf(y)));
    const viewerRow = viewerStaffId ? mine.find((p) => p.staffProfileId === viewerStaffId) : undefined;
    return [
      {
        swmsId: id,
        versionId: v.id,
        version: v.version,
        issuedAt: v.issuedAt,
        responsible: nameIn(names, v.responsible),
        signed: mine.length - waiting.length,
        total: mine.length,
        waitingOn: waiting.map(nameOf),
        issues: issuesOn(standing, mine, nameOf),
        viewerCanSign: !!viewerRow && waiting.length > 0,
      },
    ];
  });
}

/** What the people on a version raised when they signed on and nobody has
    sorted yet — READ THROUGH THE CARRY, so a correction, which changes
    nothing about the work, doesn't take an open issue off the card and out
    of the bell with it. Only a version everyone signs again clears one. */
function issuesOn(
  standing: ReturnType<typeof standingSignons>,
  people: readonly ChainPerson[],
  nameOf: (p: ChainPerson) => string
): SwmsIssue[] {
  return people.flatMap((p) => {
    const signon = standing.get(p.id)?.signon;
    const raised = signon?.issue?.trim();
    return raised && !signon?.clearedAt ? [{ name: nameOf(p), issue: raised }] : [];
  });
}

/* ── the bell ──────────────────────────────────────────────────────────── */

export type PendingSignon = {
  versionId: string;
  version: number;
  /** On an earlier version too, so this is the SWMS they knew, revised. Someone
      new to it never saw version 1, and isn't told there was one. */
  again: boolean;
  jobNumber: string | null;
  site: string | null;
  issuedAt: string;
};

/** Jobs ServiceM8 has closed out. A SWMS asks to be signed BEFORE work; once
    the job is over, asking is noise nobody can act on. */
const CLOSED = new Set(["Completed", "Unsuccessful"]);

/** Latest versions this team member is on with no sign-on standing for them.
    A replaced version is never asked for — the next one is — a correction
    doesn't ask again of anyone who signed the version it corrects, and a job
    that is finished, unsuccessful or gone from the board asks nobody. */
export async function pendingSignons(orgId: string, staffProfileId: string): Promise<PendingSignon[]> {
  const { data: mine } = await supabaseAdmin
    .from("swms_people")
    .select("version_id")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffProfileId);
  const versionIds = [...new Set(((mine ?? []) as { version_id: string }[]).map((r) => r.version_id))];
  if (!versionIds.length) return [];

  const { data: onVersions } = await supabaseAdmin
    .from("swms_versions")
    .select("swms_id")
    .eq("org_id", orgId)
    .in("id", versionIds);
  const swmsIds = [...new Set(((onVersions ?? []) as { swms_id: string }[]).map((v) => v.swms_id))];
  if (!swmsIds.length) return [];

  const [chain, { data: swmsRows }] = await Promise.all([
    loadChains(orgId, swmsIds),
    supabaseAdmin.from("swms").select("id, sm8_job_uuid").eq("org_id", orgId).in("id", swmsIds),
  ]);
  const jobOf = new Map(((swmsRows ?? []) as { id: string; sm8_job_uuid: string }[]).map((x) => [x.id, x.sm8_job_uuid]));

  const pending = swmsIds.flatMap((id) => {
    const versions = chain.versions.filter((v) => v.swmsId === id);
    if (!versions.length) return [];
    const latest = versions.reduce((a, b) => (b.version > a.version ? b : a));
    const me = chain.people.find((p) => p.versionId === latest.id && p.staffProfileId === staffProfileId);
    if (!me || standingSignons(chain, id).get(me.id)) return [];
    const earlier = new Set(versions.filter((v) => v.version < latest.version).map((v) => v.id));
    const again = chain.people.some((p) => earlier.has(p.versionId) && p.staffProfileId === staffProfileId);
    return [{ ...latest, again }];
  });

  const jobs = await Promise.all(pending.map((v) => loadSwmsJob(orgId, jobOf.get(v.swmsId) ?? "")));
  return pending.flatMap((v, i) => {
    const job = jobs[i];
    if (!job || CLOSED.has(job.status ?? "")) return [];
    return [
      {
        versionId: v.id,
        version: v.version,
        again: v.again,
        jobNumber: job.number,
        site: job.address,
        issuedAt: v.issuedAt,
      },
    ];
  });
}

/* ── an issue somebody raised at sign-on ───────────────────────────────── */

export type RaisedIssues = {
  versionId: string;
  jobNumber: string | null;
  site: string | null;
  issues: SwmsIssue[];
};

/** Issues raised on SWMS this person is in charge of, on the latest version
    of a live job. A worker who writes "no anchor on the rear ridge" at
    sign-on is telling the person in charge, and telling them is the point:
    it reaches their bell, not just the printed register. It clears when the
    SWMS is revised — the answer to a raised issue is a changed SWMS — or
    when the job leaves the board. */
export async function raisedIssues(orgId: string, staffProfileId: string): Promise<RaisedIssues[]> {
  const { data: mine } = await supabaseAdmin
    .from("swms_versions")
    .select("id, swms_id")
    .eq("org_id", orgId)
    .eq("responsible_staff_id", staffProfileId);
  const swmsIds = [...new Set(((mine ?? []) as { id: string; swms_id: string }[]).map((v) => v.swms_id))];
  if (!swmsIds.length) return [];

  const [chain, { data: swmsRows }] = await Promise.all([
    loadChains(orgId, swmsIds),
    supabaseAdmin.from("swms").select("id, sm8_job_uuid").eq("org_id", orgId).in("id", swmsIds),
  ]);
  const jobOf = new Map(((swmsRows ?? []) as { id: string; sm8_job_uuid: string }[]).map((x) => [x.id, x.sm8_job_uuid]));

  const latest = swmsIds.flatMap((id) => {
    const versions = chain.versions.filter((v) => v.swmsId === id);
    if (!versions.length) return [];
    const top = versions.reduce((a, b) => (b.version > a.version ? b : a));
    return top.responsible === staffProfileId ? [top] : [];
  });
  if (!latest.length) return [];

  const names = await profilesOf(orgId, chain.people.map((p) => p.staffProfileId));
  const nameOf = (p: ChainPerson) => (p.staffProfileId ? nameIn(names, p.staffProfileId) : p.outsideName ?? "—");
  const jobs = await Promise.all(latest.map((v) => loadSwmsJob(orgId, jobOf.get(v.swmsId) ?? "")));

  return latest.flatMap((v, i) => {
    const job = jobs[i];
    if (!job || CLOSED.has(job.status ?? "")) return [];
    const issues = issuesOn(standingSignons(chain, v.swmsId), chain.people.filter((p) => p.versionId === v.id), nameOf);
    return issues.length ? [{ versionId: v.id, jobNumber: job.number, site: job.address, issues }] : [];
  });
}
