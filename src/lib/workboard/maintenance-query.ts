/* Maintenance reads — agreements, their visits, and the radar the Overview
   (and the wall screen) runs on. Overlay truth first, mirror garnish second,
   like projects-query: everything renders standalone; a linked ServiceM8 job
   adds its live-ish status and warns when it went sideways over there.

   NO SESSION HERE — callers establish the right to ask. */

import { supabaseAdmin } from "@/lib/supabase-server";
import {
  bucketFor,
  readinessCount,
  readReadiness,
  type ReadinessKey,
  type VisitBucket,
} from "./visit-schedule";

/* ── list ── */

export type AgreementSummary = {
  id: string;
  label: string;
  clientName: string;
  siteLabel: string | null;
  intervalMonths: number;
  status: string;
  equipmentCount: number;
  nextDue: string | null;
  nextBucket: VisitBucket | null;
  overdueCount: number;
};

export async function listAgreements(orgId: string, today: string): Promise<AgreementSummary[]> {
  const { data } = await supabaseAdmin
    .from("maintenance_agreements")
    .select("id, label, client_name, site_label, interval_months, status")
    .eq("org_id", orgId)
    .neq("status", "ended")
    .order("label", { ascending: true });

  type Row = {
    id: string;
    label: string;
    client_name: string;
    site_label: string | null;
    interval_months: number;
    status: string;
  };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [{ data: visitRows }, { data: equipRows }] = await Promise.all([
    supabaseAdmin
      .from("maintenance_visits")
      .select("agreement_id, due_date")
      .eq("org_id", orgId)
      .in("agreement_id", ids)
      .in("status", ["upcoming", "booked"])
      .order("due_date", { ascending: true }),
    supabaseAdmin
      .from("agreement_equipment")
      .select("agreement_id")
      .eq("org_id", orgId)
      .in("agreement_id", ids),
  ]);

  const nextBy = new Map<string, string>();
  const overdueBy = new Map<string, number>();
  for (const v of (visitRows ?? []) as { agreement_id: string; due_date: string }[]) {
    if (!nextBy.has(v.agreement_id)) nextBy.set(v.agreement_id, v.due_date);
    if (v.due_date < today) overdueBy.set(v.agreement_id, (overdueBy.get(v.agreement_id) ?? 0) + 1);
  }
  const equipBy = new Map<string, number>();
  for (const e of (equipRows ?? []) as { agreement_id: string }[]) {
    equipBy.set(e.agreement_id, (equipBy.get(e.agreement_id) ?? 0) + 1);
  }

  return rows.map((r) => {
    const nextDue = nextBy.get(r.id) ?? null;
    return {
      id: r.id,
      label: r.label,
      clientName: r.client_name,
      siteLabel: r.site_label,
      intervalMonths: r.interval_months,
      status: r.status,
      equipmentCount: equipBy.get(r.id) ?? 0,
      nextDue,
      nextBucket: nextDue ? bucketFor(nextDue, today) : null,
      overdueCount: overdueBy.get(r.id) ?? 0,
    };
  });
}

/* ── detail ── */

export type VisitView = {
  id: string;
  dueDate: string;
  status: string;
  bucket: VisitBucket | null;
  readiness: Record<ReadinessKey, boolean>;
  jobNumber: string | null;
  provider: string | null;
  remoteId: string | null;
  bookedStart: string | null;
  completedAt: string | null;
  completedSource: string | null;
  notes: string | null;
  /** The linked job's mirrored status, when there is one. */
  mirrorStatus: string | null;
  /** True when the linked job went Unsuccessful or vanished over there —
      a human decision is needed, so it is a warning, never an auto-skip. */
  warn: boolean;
};

export type EquipmentView = {
  id: string;
  description: string;
  model: string | null;
  serial: string | null;
  location: string | null;
  installProjectId: string | null;
  installProjectName: string | null;
};

export type AgreementDetail = {
  id: string;
  label: string;
  clientName: string;
  siteLabel: string | null;
  siteAddress: string | null;
  intervalMonths: number;
  anchorDate: string;
  contractStart: string | null;
  contractEnd: string | null;
  status: string;
  weInstalled: boolean;
  accessNotes: string | null;
  bringList: string | null;
  siteRequirements: string | null;
  notes: string | null;
  equipment: EquipmentView[];
  /** Open visits first (due order), then recent history. */
  open: VisitView[];
  history: VisitView[];
};

export async function getAgreementDetail(
  orgId: string,
  agreementId: string,
  today: string
): Promise<AgreementDetail | null> {
  const { data } = await supabaseAdmin
    .from("maintenance_agreements")
    .select(
      "id, label, client_name, site_label, site_address, interval_months, anchor_date, " +
        "contract_start, contract_end, status, we_installed, access_notes, bring_list, " +
        "site_requirements, notes"
    )
    .eq("org_id", orgId)
    .eq("id", agreementId)
    .maybeSingle();

  type Row = {
    id: string;
    label: string;
    client_name: string;
    site_label: string | null;
    site_address: string | null;
    interval_months: number;
    anchor_date: string;
    contract_start: string | null;
    contract_end: string | null;
    status: string;
    we_installed: boolean;
    access_notes: string | null;
    bring_list: string | null;
    site_requirements: string | null;
    notes: string | null;
  };
  const a = data as Row | null;
  if (!a) return null;

  const [{ data: equipRows }, { data: visitRows }] = await Promise.all([
    supabaseAdmin
      .from("agreement_equipment")
      .select("id, description, model, serial, location, install_project_id")
      .eq("org_id", orgId)
      .eq("agreement_id", agreementId)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("maintenance_visits")
      .select(
        "id, due_date, status, readiness, job_number, provider, remote_id, " +
          "booked_start_cached, completed_at, completed_source, notes"
      )
      .eq("org_id", orgId)
      .eq("agreement_id", agreementId)
      .order("due_date", { ascending: true }),
  ]);

  type VisitRow = {
    id: string;
    due_date: string;
    status: string;
    readiness: unknown;
    job_number: string | null;
    provider: string | null;
    remote_id: string | null;
    booked_start_cached: string | null;
    completed_at: string | null;
    completed_source: string | null;
    notes: string | null;
  };
  // The concatenated select string defeats supabase-js's literal-type parser,
  // so the row shape is asserted the long way round.
  const visits = (visitRows ?? []) as unknown as VisitRow[];

  // mirror garnish for the linked jobs
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

  const toView = (v: VisitRow): VisitView => {
    const m = v.remote_id ? mirror.get(v.remote_id) : undefined;
    const open = v.status === "upcoming" || v.status === "booked";
    return {
      id: v.id,
      dueDate: v.due_date,
      status: v.status,
      bucket: open ? bucketFor(v.due_date, today) : null,
      readiness: readReadiness(v.readiness),
      jobNumber: v.job_number,
      provider: v.provider,
      remoteId: v.remote_id,
      bookedStart: v.booked_start_cached,
      completedAt: v.completed_at,
      completedSource: v.completed_source,
      notes: v.notes,
      mirrorStatus: m?.status ?? null,
      warn: !!m && open && (m.status === "Unsuccessful" || m.active === 0),
    };
  };

  const open = visits.filter((v) => v.status === "upcoming" || v.status === "booked").map(toView);
  const history = visits
    .filter((v) => v.status === "done" || v.status === "skipped")
    .map(toView)
    .sort((x, y) => (x.dueDate < y.dueDate ? 1 : -1))
    .slice(0, 8);

  return {
    id: a.id,
    label: a.label,
    clientName: a.client_name,
    siteLabel: a.site_label,
    siteAddress: a.site_address,
    intervalMonths: a.interval_months,
    anchorDate: a.anchor_date,
    contractStart: a.contract_start,
    contractEnd: a.contract_end,
    status: a.status,
    weInstalled: a.we_installed,
    accessNotes: a.access_notes,
    bringList: a.bring_list,
    siteRequirements: a.site_requirements,
    notes: a.notes,
    equipment: await equipmentViews(
      orgId,
      (equipRows ?? []) as {
        id: string;
        description: string;
        model: string | null;
        serial: string | null;
        location: string | null;
        install_project_id: string | null;
      }[]
    ),
    open,
    history,
  };
}

async function equipmentViews(
  orgId: string,
  rows: {
    id: string;
    description: string;
    model: string | null;
    serial: string | null;
    location: string | null;
    install_project_id: string | null;
  }[]
): Promise<EquipmentView[]> {
  const projectIds = [...new Set(rows.map((r) => r.install_project_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (projectIds.length) {
    const { data } = await supabaseAdmin
      .from("projects")
      .select("id, name")
      .eq("org_id", orgId)
      .in("id", projectIds);
    for (const p of (data ?? []) as { id: string; name: string }[]) names.set(p.id, p.name);
  }
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    model: r.model,
    serial: r.serial,
    location: r.location,
    installProjectId: r.install_project_id,
    installProjectName: r.install_project_id ? names.get(r.install_project_id) ?? null : null,
  }));
}

/* ── the radar ── */

export type RadarItem = {
  visitId: string;
  agreementId: string;
  label: string;
  clientName: string;
  siteLabel: string | null;
  dueDate: string;
  bucket: VisitBucket;
  status: string;
  ready: number;
  readyTotal: number;
  /** WHICH checks are ticked, not just how many. The board draws a pip per
      check and names the missing ones — "3/4 ready" tells a foreman there's a
      problem, "parts not ready" tells them what to do about it. */
  readiness: Record<ReadinessKey, boolean>;
  jobNumber: string | null;
  bookedStart: string | null;
};

const RADAR_WINDOW_DAYS = 60;
const RADAR_LIMIT = 40;

/** Every open visit worth a glance: ALL overdue ones (they're the point),
    then everything due inside the window. Ordered hardest-first by date. */
export async function listRadar(orgId: string, today: string): Promise<RadarItem[]> {
  const edge = new Date(`${today}T12:00:00Z`);
  edge.setUTCDate(edge.getUTCDate() + RADAR_WINDOW_DAYS);
  const windowEnd = edge.toISOString().slice(0, 10);

  const { data: visitRows } = await supabaseAdmin
    .from("maintenance_visits")
    .select("id, agreement_id, due_date, status, readiness, job_number, booked_start_cached")
    .eq("org_id", orgId)
    .in("status", ["upcoming", "booked"])
    .lte("due_date", windowEnd)
    .order("due_date", { ascending: true })
    .limit(RADAR_LIMIT);

  type VRow = {
    id: string;
    agreement_id: string;
    due_date: string;
    status: string;
    readiness: unknown;
    job_number: string | null;
    booked_start_cached: string | null;
  };
  const visits = (visitRows ?? []) as VRow[];
  if (visits.length === 0) return [];

  const agreementIds = [...new Set(visits.map((v) => v.agreement_id))];
  const { data: aRows } = await supabaseAdmin
    .from("maintenance_agreements")
    .select("id, label, client_name, site_label, status")
    .eq("org_id", orgId)
    .in("id", agreementIds);
  const agreements = new Map(
    ((aRows ?? []) as {
      id: string;
      label: string;
      client_name: string;
      site_label: string | null;
      status: string;
    }[]).map((a) => [a.id, a])
  );

  const out: RadarItem[] = [];
  for (const v of visits) {
    const a = agreements.get(v.agreement_id);
    // paused/ended agreements keep their rows but stay off the radar
    if (!a || a.status !== "active") continue;
    const counts = readinessCount(v.readiness);
    const readiness = readReadiness(v.readiness);
    out.push({
      visitId: v.id,
      agreementId: v.agreement_id,
      label: a.label,
      clientName: a.client_name,
      siteLabel: a.site_label,
      dueDate: v.due_date,
      bucket: bucketFor(v.due_date, today),
      status: v.status,
      ready: counts.ready,
      readyTotal: counts.total,
      readiness,
      jobNumber: v.job_number,
      bookedStart: v.booked_start_cached,
    });
  }
  return out;
}
