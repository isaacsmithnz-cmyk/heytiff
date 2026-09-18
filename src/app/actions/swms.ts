"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getDbRole, requireOrg } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { todayInAu } from "@/lib/au-dates";
import {
  andList,
  buildSwms,
  issueProblems,
  LIBRARY_VERSION,
  methodChanges,
  stateNotCovered,
  type SwmsAnswers,
} from "@/lib/swms/library";
import { normaliseAnswers, normaliseOutsiders, signatureSvg } from "@/lib/swms/input";
import {
  hasStandingSignon,
  isLibraryApproved,
  listJobSwms,
  loadSwmsDocument,
  loadSwmsJob,
  loadSwmsTeam,
  nearbyHospital,
  ownerName,
  type SwmsJob,
  type SwmsSummary,
  type SwmsTeamMember,
} from "@/lib/swms/query";

/* WRITING A SWMS — issuing a version from the wizard, adopting the library
   the wizard writes from, and signing on.

   ONE TIER TO ISSUE: `workboard`. The person standing on the job is the one
   who walked the site, and the document records that it was them — or, for a
   correction made from the office, the walk the version it corrects stood on. ADOPTING
   THE LIBRARY is the owner's: it is the business saying these controls are
   its own. SIGNING ON needs only membership — it is your own name on your
   own briefing, the way your own staff card is yours.

   Nothing here trusts the browser: the answers are read back through
   `normaliseAnswers`, every staff id is re-resolved in this workspace, the
   rules the wizard showed are asked again (`issueProblems`), and the
   document is built HERE from the library, so what is stored is what the
   library writes and not what a request said it wrote. */

const WB = "/dashboard/workboard";

export type SwmsPrevious = {
  swmsId: string;
  version: number;
  answers: SwmsAnswers;
  staffIds: string[];
  outsiders: { name: string; company: string | null }[];
  responsibleStaffId: string;
  /** Who the last version named, by name, so a revision starts with them chosen. */
  electricianName: string | null;
  firstAiderName: string | null;
  /** Who has a sign-on standing on it — a correction carries theirs, so the
      screen after issuing one asks only everyone else. Outsiders by name, in
      lower case, the way a sign-on is carried. */
  signedStaffIds: string[];
  signedOutsideNames: string[];
};

/** The electrician a version's power step names, read back off its words. */
function electricianIn(doc: { content: { steps: { key: string; controls: { text: string }[] }[] } }): string | null {
  const power = doc.content.steps.find((st) => st.key === "power");
  for (const c of power?.controls ?? []) {
    const m =
      /licensed electrician — (.+)\. A restricted electrical licence doesn't cover it\.$/.exec(c.text) ??
      /licensed electrician — (.+)\.$/.exec(c.text);
    if (m && m[1] !== "the named electrician") return m[1];
  }
  return null;
}

export type SwmsWizardContext = {
  job: SwmsJob;
  team: SwmsTeamMember[];
  libraryVersion: string;
  libraryApproved: boolean;
  /** Only an owner can approve the template. */
  canApprove: boolean;
  /** Who approves it — named to anyone who can't. */
  ownerName: string | null;
  /** The person issuing — the one who ticks "I've walked this site". */
  viewerStaffId: string | null;
  /** The hospital the last SWMS in this postcode named, for a new one to start with. */
  hospital: { name: string; jobNumber: string | null } | null;
};

/** Everything the wizard opens on: the job, the team and the library's state. */
export async function swmsWizardContext(jobUuid: string): Promise<SwmsWizardContext | null> {
  const { orgId, userId } = await requireOrg("workboard");
  const uuid = String(jobUuid ?? "").trim().slice(0, 80);
  if (!uuid) return null;
  const job = await loadSwmsJob(orgId, uuid);
  if (!job) return null;
  const [team, libraryApproved, role, viewerStaffId, owner, hospital] = await Promise.all([
    loadSwmsTeam(orgId, uuid, todayInAu()),
    isLibraryApproved(orgId),
    getDbRole(),
    staffIdFor(orgId, userId),
    ownerName(orgId),
    nearbyHospital(orgId, job),
  ]);
  return {
    job,
    team,
    libraryVersion: LIBRARY_VERSION,
    libraryApproved,
    canApprove: hasMinRole(role, "owner"),
    ownerName: owner,
    viewerStaffId,
    hospital,
  };
}

/** The job's SWMS, for the Documents face. */
export async function listSwmsForJob(jobUuid: string): Promise<SwmsSummary[]> {
  const { orgId, userId } = await requireOrg("workboard");
  const uuid = String(jobUuid ?? "").trim().slice(0, 80);
  if (!uuid) return [];
  return listJobSwms(orgId, uuid, await staffIdFor(orgId, userId));
}

/** The latest version's answers and people, for a revision to start from. */
export async function swmsPrevious(versionId: string): Promise<SwmsPrevious | null> {
  const { orgId } = await requireOrg("workboard");
  const doc = await loadSwmsDocument(orgId, String(versionId ?? "").slice(0, 80));
  if (!doc || !doc.latest) return null;
  return {
    swmsId: doc.swmsId,
    version: doc.version,
    answers: normaliseAnswers(doc.answers),
    staffIds: doc.people.filter((p) => p.staffProfileId).map((p) => p.staffProfileId!),
    outsiders: doc.people.filter((p) => !p.team).map((p) => ({ name: p.name, company: p.role || null })),
    responsibleStaffId: doc.responsibleStaffId,
    electricianName: electricianIn(doc),
    firstAiderName: doc.content.emergency.firstAider && doc.content.emergency.firstAider !== "—" ? doc.content.emergency.firstAider : null,
    signedStaffIds: doc.people.filter((p) => p.signon && p.staffProfileId).map((p) => p.staffProfileId!),
    signedOutsideNames: doc.people.filter((p) => p.signon && !p.team).map((p) => p.name.trim().toLowerCase()),
  };
}

export type ApproveResult = { ok: true } | { ok: false; error: string };

/** The owner approves the template at its current version. */
export async function approveSwmsLibrary(): Promise<ApproveResult> {
  const { orgId, userId } = await requireOrg();
  if (!hasMinRole(await getDbRole(), "owner")) {
    return { ok: false, error: "Only the owner can approve the SWMS template." };
  }
  const staffId = await staffIdFor(orgId, userId);
  if (!staffId) return { ok: false, error: "Your account has no staff card to approve it with." };
  const { error } = await supabaseAdmin
    .from("swms_library_approvals")
    .upsert(
      { org_id: orgId, library_version: LIBRARY_VERSION, approved_by_staff_id: staffId },
      { onConflict: "org_id,library_version", ignoreDuplicates: true }
    );
  if (error) return { ok: false, error: "Couldn't record the approval. Try again." };
  revalidatePath(WB);
  revalidatePath("/dashboard/swms/template");
  return { ok: true };
}

/* ── issuing ───────────────────────────────────────────────────────────── */

/** Someone on the SWMS, as the wizard names them in a choice: a team member
    by staff id, or the n-th person from outside the business. */
export type PersonKey = `staff:${string}` | `outside:${number}`;

export type IssueSwmsInput = {
  jobUuid: string;
  /** Set for a revision: the SWMS this is the next version of. */
  swmsId?: string | null;
  /** A revision's reason — what changed and why. */
  reason?: string | null;
  /** A revision that changes how the work is done: everyone signs on again
      and the site is walked again. False is a correction, and the sign-ons
      and the site walk carry over — refused when the method did change. A
      first issue is always signed by everyone. */
  material?: boolean;
  answers: unknown;
  staffIds: unknown;
  outsiders: unknown;
  responsibleStaffId: string;
  electrician?: string | null;
  firstAider?: string | null;
  siteChecked: boolean;
};

export type IssueSwmsResult =
  | { ok: true; swmsId: string; versionId: string; version: number }
  | { ok: false; problems: string[] };

const fail = (problem: string): IssueSwmsResult => ({ ok: false, problems: [problem] });

export async function issueSwms(input: IssueSwmsInput): Promise<IssueSwmsResult> {
  const { orgId, userId } = await requireOrg("workboard");
  const issuer = await staffIdFor(orgId, userId);
  if (!issuer) return fail("Your account has no staff card, so the site check can't be recorded against you.");

  const job = await loadSwmsJob(orgId, String(input.jobUuid ?? "").trim().slice(0, 80));
  if (!job) return fail("That job isn't on this workspace's board.");
  /* a site the template doesn't cover gets no SWMS written to another state's rules */
  if (job.state && !job.jurisdiction) return fail(stateNotCovered(job.state));
  if (!(await isLibraryApproved(orgId))) return fail("The owner needs to approve the SWMS template first.");

  /* the site's rules are the address's when it names them, not a choice */
  const answers = normaliseAnswers(input.answers);
  if (job.jurisdiction) answers.jurisdiction = job.jurisdiction;
  const outsiders = normaliseOutsiders(input.outsiders);
  const wanted = Array.isArray(input.staffIds)
    ? [...new Set(input.staffIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 80))]
    : [];

  /* every team member named is a real, active card in this workspace */
  const staff = new Map<string, string>();
  if (wanted.length) {
    const team = await loadSwmsTeam(orgId, job.uuid, todayInAu());
    for (const t of team) staff.set(t.id, t.name);
    if (wanted.some((id) => !staff.has(id))) return fail("Someone chosen isn't an active member of this team.");
  }

  const nameOf = (key: string | null | undefined): string | null => {
    if (!key) return null;
    if (key.startsWith("staff:")) {
      const id = key.slice(6);
      return wanted.includes(id) ? staff.get(id) ?? null : null;
    }
    if (key.startsWith("outside:")) return outsiders[Number(key.slice(8))]?.name ?? null;
    return null;
  };
  const electricianName = answers.steps.power ? nameOf(input.electrician) : null;
  const firstAiderName = nameOf(input.firstAider);
  const responsibleChosen = wanted.includes(String(input.responsibleStaffId ?? ""));

  /* a revision: the SWMS is on this job, and says why it changed */
  let swmsId: string | null = null;
  let version = 1;
  let reason = "First issue";
  const problems: string[] = [];
  /** A correction's site walk: the one the version it corrects stands on. */
  let walked: { by: string; at: string } | null = null;
  if (input.swmsId) {
    const { data: existing } = await supabaseAdmin
      .from("swms")
      .select("id")
      .eq("org_id", orgId)
      .eq("id", String(input.swmsId).slice(0, 80))
      .eq("sm8_job_uuid", job.uuid)
      .maybeSingle();
    if (!existing) return fail("That SWMS isn't on this job.");
    swmsId = (existing as { id: string }).id;
    const { data: top } = await supabaseAdmin
      .from("swms_versions")
      .select("version, answers, site_checked_by_staff_id, site_checked_at")
      .eq("org_id", orgId)
      .eq("swms_id", swmsId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const last = top as { version: number; answers: unknown; site_checked_by_staff_id: string; site_checked_at: string } | null;
    version = (last?.version ?? 0) + 1;
    reason = String(input.reason ?? "").trim().slice(0, 300);
    if (!reason) problems.push("Say what changed and why.");
    if (input.material === false && last) {
      const changed = methodChanges(normaliseAnswers(last.answers), answers);
      if (changed.length) {
        const what = andList(changed);
        problems.push(`${what[0].toUpperCase()}${what.slice(1)} changed, so it can't be issued as a correction.`);
      } else {
        walked = { by: last.site_checked_by_staff_id, at: last.site_checked_at };
      }
    }
  }
  problems.push(
    ...issueProblems(answers, {
      people: wanted.length + outsiders.length,
      responsibleChosen,
      electricianChosen: !!electricianName,
      siteChecked: input.siteChecked === true || walked !== null,
    })
  );
  if (problems.length) return { ok: false, problems };

  const content = buildSwms(answers, {
    work: workOf(job, answers),
    electricianName,
    firstAiderName,
  });

  let createdSwms = false;
  if (!swmsId) {
    const { data, error } = await supabaseAdmin
      .from("swms")
      .insert({ org_id: orgId, sm8_job_uuid: job.uuid, created_by_staff_id: issuer })
      .select("id")
      .single();
    if (error || !data) return fail("Couldn't save the SWMS. Try again.");
    swmsId = (data as { id: string }).id;
    createdSwms = true;
  }

  const now = new Date().toISOString();
  const { data: v, error: vErr } = await supabaseAdmin
    .from("swms_versions")
    .insert({
      org_id: orgId,
      swms_id: swmsId,
      version,
      jurisdiction: answers.jurisdiction,
      answers,
      content,
      library_version: LIBRARY_VERSION,
      reason,
      material: version === 1 ? true : input.material !== false,
      responsible_staff_id: input.responsibleStaffId,
      site_checked_by_staff_id: walked?.by ?? issuer,
      site_checked_at: walked?.at ?? now,
      issued_by_staff_id: issuer,
    })
    .select("id")
    .single();
  if (vErr || !v) {
    if (createdSwms) await supabaseAdmin.from("swms").delete().eq("org_id", orgId).eq("id", swmsId);
    /* the unique (swms_id, version) is what a double-click lands on */
    return fail(vErr?.code === "23505" ? "Another version was issued at the same moment. Reopen the job and check." : "Couldn't save the SWMS. Try again.");
  }
  const versionId = (v as { id: string }).id;

  const people = [
    ...wanted.map((id) => ({ org_id: orgId, version_id: versionId, staff_profile_id: id })),
    ...outsiders.map((o) => ({ org_id: orgId, version_id: versionId, outside_name: o.name, outside_company: o.company })),
  ];
  const { error: pErr } = await supabaseAdmin.from("swms_people").insert(people);
  if (pErr) {
    /* a version nobody is on is not a SWMS — take the half-write back */
    await supabaseAdmin.from("swms_versions").delete().eq("org_id", orgId).eq("id", versionId);
    if (createdSwms) await supabaseAdmin.from("swms").delete().eq("org_id", orgId).eq("id", swmsId);
    return fail("Couldn't save who the SWMS covers. Try again.");
  }

  revalidatePath(WB);
  return { ok: true, swmsId, versionId, version };
}

/** The work, as the document names it: the job's own description, or the kind of work. */
function workOf(job: SwmsJob, a: SwmsAnswers): string {
  const d = (job.description ?? "").replace(/\s+/g, " ").trim();
  if (d) return d.length > 600 ? `${d.slice(0, 599).trimEnd()}…` : d;
  return a.kind === "install" ? "Install an air conditioning system" : "Service or repair an air conditioning system";
}

/* ── signing on ────────────────────────────────────────────────────────── */

export type SignOnInput = {
  personId: string;
  /** SVG path data from the signature pad. */
  pathData: string;
  briefed: boolean;
  issue?: string | null;
};

export type SignOnResult = { ok: true; signedAt: string } | { ok: false; error: string };

/** Sign on to a SWMS version: yourself, or someone from outside the business
    on your phone when you're on the same SWMS. */
export async function signOnSwms(input: SignOnInput): Promise<SignOnResult> {
  const { orgId, userId } = await requireOrg();
  const viewer = await staffIdFor(orgId, userId);
  if (!viewer) return { ok: false, error: "Your account has no staff card to sign on with." };

  const { data: personRow } = await supabaseAdmin
    .from("swms_people")
    .select("id, version_id, staff_profile_id")
    .eq("org_id", orgId)
    .eq("id", String(input.personId ?? "").slice(0, 80))
    .maybeSingle();
  const person = personRow as { id: string; version_id: string; staff_profile_id: string | null } | null;
  if (!person) return { ok: false, error: "That sign-on isn't on this workspace." };

  const { data: versionRow } = await supabaseAdmin
    .from("swms_versions")
    .select("id, swms_id, version, responsible_staff_id")
    .eq("org_id", orgId)
    .eq("id", person.version_id)
    .maybeSingle();
  const version = versionRow as { id: string; swms_id: string; version: number; responsible_staff_id: string } | null;
  if (!version) return { ok: false, error: "That SWMS isn't on this workspace." };

  const { data: top } = await supabaseAdmin
    .from("swms_versions")
    .select("version")
    .eq("org_id", orgId)
    .eq("swms_id", version.swms_id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if ((top as { version: number } | null)?.version !== version.version) {
    return { ok: false, error: "This version has been replaced. Sign on to the latest one." };
  }

  if (person.staff_profile_id) {
    if (person.staff_profile_id !== viewer) return { ok: false, error: "Only they can sign on for themselves." };
  } else {
    /* someone from outside the business signs on the phone of a team member
       who is on the same SWMS — the one who briefed them */
    const { data: onIt } = await supabaseAdmin
      .from("swms_people")
      .select("id")
      .eq("org_id", orgId)
      .eq("version_id", version.id)
      .eq("staff_profile_id", viewer)
      .maybeSingle();
    if (!onIt) return { ok: false, error: "Only someone on this SWMS can sign on a helper." };
  }

  if (await hasStandingSignon(orgId, version.swms_id, person.id)) {
    return { ok: false, error: "Already signed on." };
  }
  if (input.briefed !== true) return { ok: false, error: "Tick that the briefing happened first." };
  const svg = signatureSvg(input.pathData);
  if (!svg) return { ok: false, error: "Sign in the box first." };
  const issue = String(input.issue ?? "").trim().slice(0, 600) || null;

  const { data, error } = await supabaseAdmin
    .from("swms_signons")
    .insert({
      org_id: orgId,
      version_id: version.id,
      person_id: person.id,
      signed_by_user_id: userId,
      signed_by_staff_id: viewer,
      /* the person in charge gives the briefing; nobody briefs them */
      briefed_by_staff_id: person.staff_profile_id === version.responsible_staff_id ? null : version.responsible_staff_id,
      signature_svg: svg,
      issue_raised: issue,
    })
    .select("signed_at")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.code === "23505" ? "Already signed on." : "Couldn't save the sign-on. Try again." };
  }

  revalidatePath(WB);
  return { ok: true, signedAt: (data as { signed_at: string }).signed_at };
}
