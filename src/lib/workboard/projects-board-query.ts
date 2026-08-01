/* Everything the redesigned projects board needs, loaded once — board-query's
   discipline on the projects side.

   Four tabs and a detail route over ONE dataset: live projects with their
   money/hours/checklist rollups, every open trip plus recent history, and the
   reference lists. Flattening project facts onto each row keeps every
   consumer a pure function of this shape — no tab fetches for itself, so no
   tab can disagree with another (K2's lesson, both sides now).

   Money numbers here are ROLLUPS ONLY (the derived ProjectMoney); the full
   variation/claim ledgers belong to the detail loader. Mirror facts are
   garnish layered per linked job — absence degrades to the typed fields,
   never an error (the projects-query rule).

   NO SESSION HERE — callers establish the right to ask. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { plusDays } from "./dates";
import { BOARD_DONE_DAYS } from "./board-status";
import { readReadiness, type ReadinessKey } from "./visit-schedule";
import { staffOptions, type BoardTech } from "./board-query";
import { checklistProgress } from "./stages";
import { deriveProjectMoney, type ProjectMoney } from "./project-money";

export type BringItem = {
  id: string;
  label: string;
  packed: boolean;
};

export type ProjectBoardVisit = {
  id: string;
  projectId: string;
  projectName: string;
  clientName: string | null;
  siteLabel: string | null;
  /** The trip's own name — "Rough-in day 1", "Commissioning". */
  label: string;
  dueDate: string;
  bookedDate: string | null;
  status: string;
  readiness: Record<ReadinessKey, boolean>;
  techs: BoardTech[];
  bringList: BringItem[];
  jobNumber: string | null;
  provider: string | null;
  remoteId: string | null;
  bookedStart: string | null;
  mirrorStatus: string | null;
  /** The linked job's NEXT diary block right now — the mismatch chip's input. */
  mirrorNextStart: string | null;
  /** Linked job went Unsuccessful or vanished in ServiceM8 — warn, never auto-skip. */
  warn: boolean;
  notes: string | null;
  completedAt: string | null;
  completedSource: string | null;
  actualHours: number | null;
  completionNote: string | null;
  invoicedAt: string | null;
};

export type ProjectBoardJob = {
  id: string;
  jobNumber: string;
  role: string;
  provider: string | null;
  remoteId: string | null;
  mirrorStatus: string | null;
  mirrorNextStart: string | null;
};

export type ProjectMilestone = {
  id: string;
  label: string;
  onDate: string;
};

export type BoardProject = {
  id: string;
  name: string;
  clientName: string | null;
  siteLabel: string | null;
  siteAddress: string | null;
  stage: string;
  status: string;
  blockedReason: string | null;
  blockedOn: string | null;
  blockedAt: string | null;
  budgetCents: number | null;
  budgetSource: string | null;
  hoursBudget: number | null;
  promisedFinish: string | null;
  defectsEnd: string | null;
  designId: string | null;
  notes: string | null;
  createdAt: string;
  /** Last movement — never null: creation counts as movement. */
  updatedAt: string;
  /** Slim checklist facts — enough for progress AND stage advice. */
  checklist: { section: string; done: boolean }[];
  progress: { done: number; total: number; percent: number };
  equipmentCount: number;
  scopeCounts: { inclusions: number; exclusions: number };
  money: ProjectMoney;
  /** Sum of actual_hours across this project's DONE trips. */
  hoursLogged: number;
  milestones: ProjectMilestone[];
  jobs: ProjectBoardJob[];
};

export type ProjectsBoardData = {
  /** active + blocked + on_hold + done — archived is the only thing hidden. */
  projects: BoardProject[];
  /** Open trips (all of them) + done/skipped inside the history window. */
  visits: ProjectBoardVisit[];
  staff: BoardTech[];
};

type ProjectRow = {
  id: string;
  name: string;
  client_name: string | null;
  site_label: string | null;
  site_address: string | null;
  stage: string;
  status: string;
  blocked_reason: string | null;
  blocked_on: string | null;
  blocked_at: string | null;
  budget_cents: number | null;
  budget_source: string | null;
  hours_budget: number | null;
  promised_finish: string | null;
  defects_end: string | null;
  design_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
};

type VisitRow = {
  id: string;
  project_id: string;
  label: string | null;
  due_date: string;
  booked_date: string | null;
  status: string;
  readiness: unknown;
  job_number: string | null;
  provider: string | null;
  remote_id: string | null;
  booked_start_cached: string | null;
  notes: string | null;
  completed_at: string | null;
  completed_source: string | null;
  actual_hours: number | null;
  completion_note: string | null;
  invoiced_at: string | null;
};

export async function loadProjectsBoard(
  orgId: string,
  today: string
): Promise<ProjectsBoardData> {
  const { data: projectRows } = await supabaseAdmin
    .from("projects")
    .select(
      "id, name, client_name, site_label, site_address, stage, status, " +
        "blocked_reason, blocked_on, blocked_at, budget_cents, budget_source, " +
        "hours_budget, promised_finish, defects_end, design_id, notes, " +
        "created_at, updated_at"
    )
    .eq("org_id", orgId)
    .neq("status", "archived")
    .order("created_at", { ascending: false });
  const projects = (projectRows ?? []) as unknown as ProjectRow[];

  if (projects.length === 0) {
    return { projects: [], visits: [], staff: await staffOptions(orgId) };
  }

  const ids = projects.map((p) => p.id);
  const VISIT_COLUMNS =
    "id, project_id, label, due_date, booked_date, status, readiness, " +
    "job_number, provider, remote_id, booked_start_cached, notes, " +
    "completed_at, completed_source, actual_hours, completion_note, invoiced_at";

  const [
    { data: openRows },
    { data: doneRows },
    { data: checkRows },
    { data: equipRows },
    { data: scopeRows },
    { data: variationRows },
    { data: claimRows },
    { data: milestoneRows },
    { data: jobRows },
    staff,
  ] = await Promise.all([
    supabaseAdmin
      .from("maintenance_visits")
      .select(VISIT_COLUMNS)
      .eq("org_id", orgId)
      .in("project_id", ids)
      .in("status", ["upcoming", "booked"])
      .order("due_date", { ascending: true }),
    supabaseAdmin
      .from("maintenance_visits")
      .select(VISIT_COLUMNS)
      .eq("org_id", orgId)
      .in("project_id", ids)
      .in("status", ["done", "skipped"])
      .gte("completed_at", plusDays(today, -BOARD_DONE_DAYS))
      .order("completed_at", { ascending: false }),
    supabaseAdmin
      .from("project_checklist_items")
      .select("project_id, section, done")
      .eq("org_id", orgId)
      .in("project_id", ids)
      .order("sort", { ascending: true }),
    supabaseAdmin
      .from("project_equipment")
      .select("project_id")
      .eq("org_id", orgId)
      .in("project_id", ids),
    supabaseAdmin
      .from("project_scope_items")
      .select("project_id, kind")
      .eq("org_id", orgId)
      .in("project_id", ids),
    supabaseAdmin
      .from("project_variations")
      .select("project_id, amount_cents, status")
      .eq("org_id", orgId)
      .in("project_id", ids),
    supabaseAdmin
      .from("project_claims")
      .select("project_id, amount_cents, status")
      .eq("org_id", orgId)
      .in("project_id", ids),
    supabaseAdmin
      .from("project_milestones")
      .select("id, project_id, label, on_date")
      .eq("org_id", orgId)
      .in("project_id", ids)
      .order("on_date", { ascending: true }),
    supabaseAdmin
      .from("project_jobs")
      .select("id, project_id, job_number, role, provider, remote_id")
      .eq("org_id", orgId)
      .in("project_id", ids)
      .order("added_at", { ascending: true }),
    staffOptions(orgId),
  ]);

  const visits = [
    ...((openRows ?? []) as unknown as VisitRow[]),
    ...((doneRows ?? []) as unknown as VisitRow[]),
  ];
  const visitIds = visits.map((v) => v.id);

  const [{ data: techRows }, { data: itemRows }] = await Promise.all([
    visitIds.length
      ? supabaseAdmin
          .from("maintenance_visit_techs")
          .select("visit_id, staff_profile_id")
          .eq("org_id", orgId)
          .in("visit_id", visitIds)
      : Promise.resolve({ data: [] as { visit_id: string; staff_profile_id: string }[] }),
    visitIds.length
      ? supabaseAdmin
          .from("project_visit_items")
          .select("id, visit_id, label, packed, position")
          .eq("org_id", orgId)
          .in("visit_id", visitIds)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true })
      : Promise.resolve(
          { data: [] as { id: string; visit_id: string; label: string; packed: boolean; position: number }[] }
        ),
  ]);

  /* Mirror garnish, one pass for every linked job — visit links and
     project-level links share the same two queries. */
  type JobLinkRow = {
    id: string;
    project_id: string;
    job_number: string;
    role: string;
    provider: string | null;
    remote_id: string | null;
  };
  const jobLinks = (jobRows ?? []) as JobLinkRow[];
  const remoteIds = [
    ...new Set([
      ...visits
        .filter((v) => v.provider === "servicem8" && v.remote_id)
        .map((v) => v.remote_id!),
      ...jobLinks
        .filter((j) => j.provider === "servicem8" && j.remote_id)
        .map((j) => j.remote_id!),
    ]),
  ];

  const mirror = new Map<string, { status: string | null; active: number | null }>();
  const nextStartBy = new Map<string, string>();
  if (remoteIds.length) {
    const [{ data: mirrorJobs }, { data: actRows }] = await Promise.all([
      supabaseAdmin
        .from("sm8_jobs")
        .select("uuid, status, active")
        .eq("org_id", orgId)
        .in("uuid", remoteIds),
      supabaseAdmin
        .from("sm8_job_activities")
        .select("job_uuid, start_date")
        .eq("org_id", orgId)
        .eq("active", 1)
        .in("job_uuid", remoteIds)
        .gte("start_date", `${today} 00:00:00`)
        .order("start_date", { ascending: true }),
    ]);
    for (const j of (mirrorJobs ?? []) as {
      uuid: string;
      status: string | null;
      active: number | null;
    }[]) {
      mirror.set(j.uuid, { status: j.status, active: j.active });
    }
    // rows arrive start-ascending, so the first hit per job IS the next one
    for (const a of (actRows ?? []) as { job_uuid: string | null; start_date: string }[]) {
      if (a.job_uuid && !nextStartBy.has(a.job_uuid)) nextStartBy.set(a.job_uuid, a.start_date);
    }
  }

  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const techsBy = new Map<string, BoardTech[]>();
  for (const t of (techRows ?? []) as { visit_id: string; staff_profile_id: string }[]) {
    const list = techsBy.get(t.visit_id) ?? [];
    list.push({ id: t.staff_profile_id, name: staffName.get(t.staff_profile_id) ?? "Unnamed" });
    techsBy.set(t.visit_id, list);
  }
  const itemsBy = new Map<string, BringItem[]>();
  for (const i of (itemRows ?? []) as {
    id: string;
    visit_id: string;
    label: string;
    packed: boolean;
  }[]) {
    const list = itemsBy.get(i.visit_id) ?? [];
    list.push({ id: i.id, label: i.label, packed: i.packed });
    itemsBy.set(i.visit_id, list);
  }

  const projectBy = new Map(projects.map((p) => [p.id, p]));
  const outVisits: ProjectBoardVisit[] = [];
  const hoursBy = new Map<string, number>();
  for (const v of visits) {
    const p = projectBy.get(v.project_id);
    if (!p) continue;
    const m = v.remote_id ? mirror.get(v.remote_id) : undefined;
    const open = v.status === "upcoming" || v.status === "booked";
    if (v.status === "done" && v.actual_hours !== null) {
      hoursBy.set(v.project_id, (hoursBy.get(v.project_id) ?? 0) + v.actual_hours);
    }
    outVisits.push({
      id: v.id,
      projectId: v.project_id,
      projectName: p.name,
      clientName: p.client_name,
      siteLabel: p.site_label,
      label: v.label ?? "Site visit",
      dueDate: v.due_date,
      bookedDate: v.booked_date,
      status: v.status,
      readiness: readReadiness(v.readiness),
      techs: techsBy.get(v.id) ?? [],
      bringList: itemsBy.get(v.id) ?? [],
      jobNumber: v.job_number,
      provider: v.provider,
      remoteId: v.remote_id,
      bookedStart: v.booked_start_cached,
      mirrorStatus: m?.status ?? null,
      mirrorNextStart: v.remote_id ? nextStartBy.get(v.remote_id) ?? null : null,
      warn: !!m && open && (m.status === "Unsuccessful" || m.active === 0),
      notes: v.notes,
      completedAt: v.completed_at,
      completedSource: v.completed_source,
      actualHours: v.actual_hours,
      completionNote: v.completion_note,
      invoicedAt: v.invoiced_at,
    });
  }

  /* Done trips OUTSIDE the display window still burned hours — the budget
     comparison must never forget them. One extra slim read, open-ended. */
  const { data: oldDoneRows } = await supabaseAdmin
    .from("maintenance_visits")
    .select("project_id, actual_hours")
    .eq("org_id", orgId)
    .in("project_id", ids)
    .eq("status", "done")
    .lt("completed_at", plusDays(today, -BOARD_DONE_DAYS))
    .not("actual_hours", "is", null);
  for (const r of (oldDoneRows ?? []) as { project_id: string; actual_hours: number }[]) {
    hoursBy.set(r.project_id, (hoursBy.get(r.project_id) ?? 0) + r.actual_hours);
  }

  const checklistBy = new Map<string, { section: string; done: boolean }[]>();
  for (const r of (checkRows ?? []) as { project_id: string; section: string; done: boolean }[]) {
    const list = checklistBy.get(r.project_id) ?? [];
    list.push({ section: r.section, done: r.done });
    checklistBy.set(r.project_id, list);
  }
  const equipCountBy = new Map<string, number>();
  for (const r of (equipRows ?? []) as { project_id: string }[]) {
    equipCountBy.set(r.project_id, (equipCountBy.get(r.project_id) ?? 0) + 1);
  }
  const scopeBy = new Map<string, { inclusions: number; exclusions: number }>();
  for (const r of (scopeRows ?? []) as { project_id: string; kind: string }[]) {
    const c = scopeBy.get(r.project_id) ?? { inclusions: 0, exclusions: 0 };
    if (r.kind === "exclusion") c.exclusions += 1;
    else c.inclusions += 1;
    scopeBy.set(r.project_id, c);
  }
  const variationsBy = new Map<string, { amountCents: number; status: string }[]>();
  for (const r of (variationRows ?? []) as {
    project_id: string;
    amount_cents: number;
    status: string;
  }[]) {
    const list = variationsBy.get(r.project_id) ?? [];
    list.push({ amountCents: r.amount_cents, status: r.status });
    variationsBy.set(r.project_id, list);
  }
  const claimsBy = new Map<string, { amountCents: number; status: string }[]>();
  for (const r of (claimRows ?? []) as {
    project_id: string;
    amount_cents: number;
    status: string;
  }[]) {
    const list = claimsBy.get(r.project_id) ?? [];
    list.push({ amountCents: r.amount_cents, status: r.status });
    claimsBy.set(r.project_id, list);
  }
  const milestonesBy = new Map<string, ProjectMilestone[]>();
  for (const r of (milestoneRows ?? []) as {
    id: string;
    project_id: string;
    label: string;
    on_date: string;
  }[]) {
    const list = milestonesBy.get(r.project_id) ?? [];
    list.push({ id: r.id, label: r.label, onDate: r.on_date });
    milestonesBy.set(r.project_id, list);
  }
  const jobsBy = new Map<string, ProjectBoardJob[]>();
  for (const j of jobLinks) {
    const list = jobsBy.get(j.project_id) ?? [];
    const m = j.remote_id ? mirror.get(j.remote_id) : undefined;
    list.push({
      id: j.id,
      jobNumber: j.job_number,
      role: j.role,
      provider: j.provider,
      remoteId: j.remote_id,
      mirrorStatus: m?.status ?? null,
      mirrorNextStart: j.remote_id ? nextStartBy.get(j.remote_id) ?? null : null,
    });
    jobsBy.set(j.project_id, list);
  }

  const outProjects: BoardProject[] = projects.map((p) => {
    const checklist = checklistBy.get(p.id) ?? [];
    return {
      id: p.id,
      name: p.name,
      clientName: p.client_name,
      siteLabel: p.site_label,
      siteAddress: p.site_address,
      stage: p.stage,
      status: p.status,
      blockedReason: p.blocked_reason,
      blockedOn: p.blocked_on,
      blockedAt: p.blocked_at,
      budgetCents: p.budget_cents,
      budgetSource: p.budget_source,
      hoursBudget: p.hours_budget,
      promisedFinish: p.promised_finish,
      defectsEnd: p.defects_end,
      designId: p.design_id,
      notes: p.notes,
      createdAt: p.created_at,
      // A project nobody has edited since creation has never moved, so its
      // creation date IS its last movement — null would read as "fresh".
      updatedAt: p.updated_at ?? p.created_at,
      checklist,
      progress: checklistProgress(checklist),
      equipmentCount: equipCountBy.get(p.id) ?? 0,
      scopeCounts: scopeBy.get(p.id) ?? { inclusions: 0, exclusions: 0 },
      money: deriveProjectMoney({
        budgetCents: p.budget_cents,
        variations: (variationsBy.get(p.id) ?? []) as {
          amountCents: number;
          status: "pending" | "approved" | "declined";
        }[],
        claims: (claimsBy.get(p.id) ?? []) as {
          amountCents: number;
          status: "awaiting" | "paid";
        }[],
      }),
      hoursLogged: Math.round((hoursBy.get(p.id) ?? 0) * 10) / 10,
      milestones: milestonesBy.get(p.id) ?? [],
      jobs: jobsBy.get(p.id) ?? [],
    };
  });

  return { projects: outProjects, visits: outVisits, staff };
}
