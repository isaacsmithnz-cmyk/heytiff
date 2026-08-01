/* Everything the redesigned maintenance board needs, loaded once.

   The board is five tabs and a sheet over ONE dataset: open visits inside
   the horizon (plus every overdue one — they're the point), recent history
   for Completed, and the reference lists (staff to assign, tags to offer,
   tasks for the urgent rules). Flattening agreement facts onto each visit
   row keeps every consumer a pure function of this shape — no tab does its
   own fetching, so no tab can disagree with another (K2's lesson).

   NO SESSION HERE — callers establish the right to ask. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { NAME_COLUMNS } from "@/lib/dashboard/tasks-query";
import { displayNameOf, type NameParts } from "@/lib/staff/name";
import { plusDays } from "./dates";
import { BOARD_DONE_DAYS } from "./board-status";
import { readReadiness, type ReadinessKey } from "./visit-schedule";

export type BoardTech = { id: string; name: string };
export type BoardTag = { id: string; name: string; color: string };
export type BoardPackItem = { id: string; label: string };
export type BoardCategory = { id: string; name: string; accent: string };

export type BoardVisit = {
  id: string;
  agreementId: string;
  label: string;
  clientName: string;
  siteLabel: string | null;
  intervalMonths: number;
  techsNeeded: number;
  hoursEstimate: number | null;
  accessNotes: string | null;
  category: BoardCategory | null;
  tags: BoardTag[];
  packing: BoardPackItem[];
  dueDate: string;
  bookedDate: string | null;
  status: string;
  readiness: Record<ReadinessKey, boolean>;
  techs: BoardTech[];
  packedIds: string[];
  jobNumber: string | null;
  provider: string | null;
  remoteId: string | null;
  bookedStart: string | null;
  mirrorStatus: string | null;
  /** Linked job went Unsuccessful or vanished in ServiceM8 — warn, never
      auto-skip. */
  warn: boolean;
  notes: string | null;
  completedAt: string | null;
  completedSource: string | null;
  actualHours: number | null;
  completionNote: string | null;
};

export type BoardTask = {
  id: string;
  title: string;
  dueDate: string | null;
  assigneeName: string | null;
};

export type BoardAgreementSummary = {
  id: string;
  label: string;
  clientName: string;
  siteLabel: string | null;
  intervalMonths: number;
  category: BoardCategory | null;
  tags: BoardTag[];
  /** Soonest OPEN due date — honest even past the display window. */
  nextDue: string | null;
  overdueCount: number;
};

export type MaintenanceBoardData = {
  visits: BoardVisit[];
  agreements: BoardAgreementSummary[];
  /** Everyone assignable — minimum identity, names only. */
  staff: BoardTech[];
  /** The org's tag pool, for the sheet's suggestions. */
  tagPool: BoardTag[];
  /** Delegated open tasks with a due date — the urgent rules read these. */
  tasks: BoardTask[];
};

type AgreementRow = {
  id: string;
  label: string;
  client_name: string;
  site_label: string | null;
  interval_months: number;
  techs_needed: number;
  hours_estimate: number | null;
  access_notes: string | null;
  category_id: string | null;
};

type VisitRow = {
  id: string;
  agreement_id: string;
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
};

export async function loadMaintenanceBoard(
  orgId: string,
  today: string
): Promise<MaintenanceBoardData> {
  const { data: agreementRows } = await supabaseAdmin
    .from("maintenance_agreements")
    .select(
      "id, label, client_name, site_label, interval_months, techs_needed, " +
        "hours_estimate, access_notes, category_id"
    )
    .eq("org_id", orgId)
    .eq("status", "active");
  const agreements = (agreementRows ?? []) as unknown as AgreementRow[];

  if (agreements.length === 0) {
    const staff = await staffOptions(orgId);
    return { visits: [], agreements: [], staff, tagPool: [], tasks: await openTasks(orgId, staff) };
  }

  const agreementIds = agreements.map((a) => a.id);
  const VISIT_COLUMNS =
    "id, agreement_id, due_date, booked_date, status, readiness, job_number, " +
    "provider, remote_id, booked_start_cached, notes, completed_at, " +
    "completed_source, actual_hours, completion_note";

  const [
    { data: openRows },
    { data: doneRows },
    { data: categoryRows },
    { data: tagRows },
    { data: linkRows },
    { data: packRows },
    staff,
  ] = await Promise.all([
    supabaseAdmin
      .from("maintenance_visits")
      .select(VISIT_COLUMNS)
      .eq("org_id", orgId)
      .in("agreement_id", agreementIds)
      .in("status", ["upcoming", "booked"])
      .order("due_date", { ascending: true }),
    supabaseAdmin
      .from("maintenance_visits")
      .select(VISIT_COLUMNS)
      .eq("org_id", orgId)
      .in("agreement_id", agreementIds)
      .in("status", ["done", "skipped"])
      .gte("completed_at", plusDays(today, -BOARD_DONE_DAYS))
      .order("completed_at", { ascending: false }),
    supabaseAdmin.from("agreement_categories").select("id, name, accent").eq("org_id", orgId),
    supabaseAdmin.from("agreement_tags").select("id, name, color").eq("org_id", orgId),
    supabaseAdmin
      .from("agreement_tag_links")
      .select("agreement_id, tag_id")
      .eq("org_id", orgId)
      .in("agreement_id", agreementIds),
    supabaseAdmin
      .from("agreement_packing_items")
      .select("id, agreement_id, label, position")
      .eq("org_id", orgId)
      .in("agreement_id", agreementIds)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    staffOptions(orgId),
  ]);

  const visits = [
    ...((openRows ?? []) as unknown as VisitRow[]),
    ...((doneRows ?? []) as unknown as VisitRow[]),
  ];
  const visitIds = visits.map((v) => v.id);

  const [{ data: techRows }, { data: packedRows }] = await Promise.all([
    visitIds.length
      ? supabaseAdmin
          .from("maintenance_visit_techs")
          .select("visit_id, staff_profile_id")
          .eq("org_id", orgId)
          .in("visit_id", visitIds)
      : Promise.resolve({ data: [] as { visit_id: string; staff_profile_id: string }[] }),
    visitIds.length
      ? supabaseAdmin
          .from("maintenance_visit_packed")
          .select("visit_id, item_id")
          .eq("org_id", orgId)
          .in("visit_id", visitIds)
      : Promise.resolve({ data: [] as { visit_id: string; item_id: string }[] }),
  ]);

  // mirror garnish for linked jobs — status feeds the quote tone and the warn
  const remoteIds = [
    ...new Set(
      visits.filter((v) => v.provider === "servicem8" && v.remote_id).map((v) => v.remote_id!)
    ),
  ];
  const mirror = new Map<string, { status: string | null; active: number | null }>();
  if (remoteIds.length) {
    const { data: jobRows } = await supabaseAdmin
      .from("sm8_jobs")
      .select("uuid, status, active")
      .eq("org_id", orgId)
      .in("uuid", remoteIds);
    for (const j of (jobRows ?? []) as { uuid: string; status: string | null; active: number | null }[]) {
      mirror.set(j.uuid, { status: j.status, active: j.active });
    }
  }

  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const techsBy = new Map<string, BoardTech[]>();
  for (const t of (techRows ?? []) as { visit_id: string; staff_profile_id: string }[]) {
    const list = techsBy.get(t.visit_id) ?? [];
    list.push({ id: t.staff_profile_id, name: staffName.get(t.staff_profile_id) ?? "Unnamed" });
    techsBy.set(t.visit_id, list);
  }
  const packedBy = new Map<string, string[]>();
  for (const p of (packedRows ?? []) as { visit_id: string; item_id: string }[]) {
    const list = packedBy.get(p.visit_id) ?? [];
    list.push(p.item_id);
    packedBy.set(p.visit_id, list);
  }

  const categories = new Map(
    ((categoryRows ?? []) as BoardCategory[]).map((c) => [c.id, c])
  );
  const tagPool = ((tagRows ?? []) as BoardTag[]).slice().sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const tagById = new Map(tagPool.map((t) => [t.id, t]));
  const tagsBy = new Map<string, BoardTag[]>();
  for (const l of (linkRows ?? []) as { agreement_id: string; tag_id: string }[]) {
    const tag = tagById.get(l.tag_id);
    if (!tag) continue;
    const list = tagsBy.get(l.agreement_id) ?? [];
    list.push(tag);
    tagsBy.set(l.agreement_id, list);
  }
  const packingBy = new Map<string, BoardPackItem[]>();
  for (const p of (packRows ?? []) as { id: string; agreement_id: string; label: string }[]) {
    const list = packingBy.get(p.agreement_id) ?? [];
    list.push({ id: p.id, label: p.label });
    packingBy.set(p.agreement_id, list);
  }

  const agreementBy = new Map(agreements.map((a) => [a.id, a]));
  const out: BoardVisit[] = [];
  for (const v of visits) {
    const a = agreementBy.get(v.agreement_id);
    if (!a) continue;
    const m = v.remote_id ? mirror.get(v.remote_id) : undefined;
    const open = v.status === "upcoming" || v.status === "booked";
    out.push({
      id: v.id,
      agreementId: v.agreement_id,
      label: a.label,
      clientName: a.client_name,
      siteLabel: a.site_label,
      intervalMonths: a.interval_months,
      techsNeeded: a.techs_needed,
      hoursEstimate: a.hours_estimate,
      accessNotes: a.access_notes,
      category: a.category_id ? categories.get(a.category_id) ?? null : null,
      tags: tagsBy.get(v.agreement_id) ?? [],
      packing: packingBy.get(v.agreement_id) ?? [],
      dueDate: v.due_date,
      bookedDate: v.booked_date,
      status: v.status,
      readiness: readReadiness(v.readiness),
      techs: techsBy.get(v.id) ?? [],
      packedIds: packedBy.get(v.id) ?? [],
      jobNumber: v.job_number,
      provider: v.provider,
      remoteId: v.remote_id,
      bookedStart: v.booked_start_cached,
      mirrorStatus: m?.status ?? null,
      warn: !!m && open && (m.status === "Unsuccessful" || m.active === 0),
      notes: v.notes,
      completedAt: v.completed_at,
      completedSource: v.completed_source,
      actualHours: v.actual_hours,
      completionNote: v.completion_note,
    });
  }

  const nextDueBy = new Map<string, string>();
  const overdueBy = new Map<string, number>();
  for (const v of out) {
    if (v.status !== "upcoming" && v.status !== "booked") continue;
    const seen = nextDueBy.get(v.agreementId);
    if (!seen || v.dueDate < seen) nextDueBy.set(v.agreementId, v.dueDate);
    if (v.dueDate < today) overdueBy.set(v.agreementId, (overdueBy.get(v.agreementId) ?? 0) + 1);
  }
  const summaries: BoardAgreementSummary[] = agreements
    .map((a) => ({
      id: a.id,
      label: a.label,
      clientName: a.client_name,
      siteLabel: a.site_label,
      intervalMonths: a.interval_months,
      category: a.category_id ? categories.get(a.category_id) ?? null : null,
      tags: tagsBy.get(a.id) ?? [],
      nextDue: nextDueBy.get(a.id) ?? null,
      overdueCount: overdueBy.get(a.id) ?? 0,
    }))
    .sort((x, y) => x.label.localeCompare(y.label));

  return { visits: out, agreements: summaries, staff, tagPool, tasks: await openTasks(orgId, staff) };
}

async function staffOptions(orgId: string): Promise<BoardTech[]> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select(NAME_COLUMNS)
    .eq("org_id", orgId)
    .limit(200);
  return ((data ?? []) as (NameParts & { id: string })[])
    .map((s) => ({ id: String(s.id), name: displayNameOf(s) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Delegated open tasks only (createdBy ≠ assignee) — the board is a shared
    screen, and someone's self-assigned reminder list is not the crew's
    urgency. Same discipline as the dashboard's teamTasks. */
async function openTasks(orgId: string, staff: BoardTech[]): Promise<BoardTask[]> {
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("id, title, due_date, assigned_to, created_by")
    .eq("org_id", orgId)
    .eq("status", "open")
    .not("due_date", "is", null)
    .order("due_date", { ascending: true })
    .limit(60);
  const names = new Map(staff.map((s) => [s.id, s.name]));
  return ((data ?? []) as {
    id: string;
    title: string;
    due_date: string | null;
    assigned_to: string;
    created_by: string | null;
  }[])
    .filter((t) => t.created_by !== null && t.created_by !== t.assigned_to)
    .map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.due_date,
      assigneeName: names.get(t.assigned_to) ?? null,
    }));
}
