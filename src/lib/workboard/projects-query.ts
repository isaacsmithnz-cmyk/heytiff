/* Project reads — overlay truth first, mirror garnish second.

   The rule from the migration header, made executable: a project's OWN rows
   (name, checklist, equipment, typed job numbers) render whether or not any
   integration exists; where a job carries a (provider='servicem8', remote_id)
   pair AND the mirror holds that row, the mirror's live-ish facts (status,
   suburb, next booking, SM8 checklist count, contacts) are layered on top.
   A missing mirror row degrades to the typed fields — never an error, never
   a fetch to ServiceM8 from here.

   NO SESSION HERE — callers establish the right to ask and hand in orgId. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { checklistProgress } from "./stages";
import { getSm8Timezone } from "./query";
import { todayInZone } from "./dates";

export async function staffIdFor(orgId: string, userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/* ── list ── */

export type ProjectSummary = {
  id: string;
  name: string;
  clientName: string | null;
  siteLabel: string | null;
  stage: string;
  status: string;
  progress: { done: number; total: number; percent: number };
  jobNumbers: string[];
  updatedAt: string | null;
};

export async function listProjects(
  orgId: string,
  opts: { includeArchived: boolean }
): Promise<ProjectSummary[]> {
  let q = supabaseAdmin
    .from("projects")
    .select("id, name, client_name, site_label, stage, status, updated_at, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (!opts.includeArchived) q = q.neq("status", "archived");
  const { data } = await q;

  type Row = {
    id: string;
    name: string;
    client_name: string | null;
    site_label: string | null;
    stage: string;
    status: string;
    updated_at: string | null;
    created_at: string;
  };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [{ data: itemRows }, { data: jobRows }] = await Promise.all([
    supabaseAdmin
      .from("project_checklist_items")
      .select("project_id, done")
      .eq("org_id", orgId)
      .in("project_id", ids),
    supabaseAdmin
      .from("project_jobs")
      .select("project_id, job_number")
      .eq("org_id", orgId)
      .in("project_id", ids),
  ]);

  const itemsBy = new Map<string, { done: boolean }[]>();
  for (const r of (itemRows ?? []) as { project_id: string; done: boolean }[]) {
    (itemsBy.get(r.project_id) ?? itemsBy.set(r.project_id, []).get(r.project_id)!).push(r);
  }
  const jobsBy = new Map<string, string[]>();
  for (const r of (jobRows ?? []) as { project_id: string; job_number: string }[]) {
    (jobsBy.get(r.project_id) ?? jobsBy.set(r.project_id, []).get(r.project_id)!).push(
      r.job_number
    );
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    clientName: r.client_name,
    siteLabel: r.site_label,
    stage: r.stage,
    status: r.status,
    progress: checklistProgress(itemsBy.get(r.id) ?? []),
    jobNumbers: jobsBy.get(r.id) ?? [],
    updatedAt: r.updated_at ?? r.created_at,
  }));
}

/* ── detail ── */

export type ChecklistItem = {
  id: string;
  section: string;
  label: string;
  done: boolean;
  doneAt: string | null;
  sort: number;
};

export type EquipmentItem = {
  id: string;
  description: string;
  model: string | null;
  serial: string | null;
  locationNote: string | null;
  manualLeft: boolean;
  notes: string | null;
};

export type LinkedJobMirror = {
  status: string | null;
  suburb: string | null;
  address: string | null;
  nextBooking: { start: string; staffName: string | null } | null;
  checklist: { done: number; total: number } | null;
  contacts: { name: string; type: string | null; phone: string | null; email: string | null }[];
};

export type LinkedJob = {
  id: string;
  jobNumber: string;
  role: string;
  provider: string | null;
  remoteId: string | null;
  /** Present only when the mirror holds this job — absence means "typed, or
      not synced yet", and the row renders from its own fields. */
  mirror: LinkedJobMirror | null;
};

export type ProjectDetail = {
  id: string;
  name: string;
  clientName: string | null;
  siteLabel: string | null;
  siteAddress: string | null;
  stage: string;
  status: string;
  designId: string | null;
  designName: string | null;
  notes: string | null;
  checklist: ChecklistItem[];
  equipment: EquipmentItem[];
  jobs: LinkedJob[];
};

export async function getProjectDetail(
  orgId: string,
  projectId: string
): Promise<ProjectDetail | null> {
  const { data } = await supabaseAdmin
    .from("projects")
    .select(
      "id, name, client_name, site_label, site_address, stage, status, design_id, notes"
    )
    .eq("org_id", orgId)
    .eq("id", projectId)
    .maybeSingle();

  type ProjectRow = {
    id: string;
    name: string;
    client_name: string | null;
    site_label: string | null;
    site_address: string | null;
    stage: string;
    status: string;
    design_id: string | null;
    notes: string | null;
  };
  const p = data as ProjectRow | null;
  if (!p) return null;

  const [{ data: itemRows }, { data: equipRows }, { data: jobRows }, designName] =
    await Promise.all([
      supabaseAdmin
        .from("project_checklist_items")
        .select("id, section, label, done, done_at, sort")
        .eq("org_id", orgId)
        .eq("project_id", projectId)
        .order("sort", { ascending: true }),
      supabaseAdmin
        .from("project_equipment")
        .select("id, description, model, serial, location_note, manual_left, notes")
        .eq("org_id", orgId)
        .eq("project_id", projectId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("project_jobs")
        .select("id, job_number, role, provider, remote_id")
        .eq("org_id", orgId)
        .eq("project_id", projectId)
        .order("added_at", { ascending: true }),
      p.design_id ? designNameFor(orgId, p.design_id) : Promise.resolve(null),
    ]);

  type JobRow = {
    id: string;
    job_number: string;
    role: string;
    provider: string | null;
    remote_id: string | null;
  };
  const jobs = (jobRows ?? []) as JobRow[];
  const mirrors = await mirrorsFor(
    orgId,
    jobs.filter((j) => j.provider === "servicem8" && j.remote_id).map((j) => j.remote_id!)
  );

  return {
    id: p.id,
    name: p.name,
    clientName: p.client_name,
    siteLabel: p.site_label,
    siteAddress: p.site_address,
    stage: p.stage,
    status: p.status,
    designId: p.design_id,
    designName,
    notes: p.notes,
    checklist: ((itemRows ?? []) as {
      id: string;
      section: string;
      label: string;
      done: boolean;
      done_at: string | null;
      sort: number;
    }[]).map((i) => ({
      id: i.id,
      section: i.section,
      label: i.label,
      done: i.done,
      doneAt: i.done_at,
      sort: i.sort,
    })),
    equipment: ((equipRows ?? []) as {
      id: string;
      description: string;
      model: string | null;
      serial: string | null;
      location_note: string | null;
      manual_left: boolean;
      notes: string | null;
    }[]).map((e) => ({
      id: e.id,
      description: e.description,
      model: e.model,
      serial: e.serial,
      locationNote: e.location_note,
      manualLeft: e.manual_left,
      notes: e.notes,
    })),
    jobs: jobs.map((j) => ({
      id: j.id,
      jobNumber: j.job_number,
      role: j.role,
      provider: j.provider,
      remoteId: j.remote_id,
      mirror: j.remote_id ? mirrors.get(j.remote_id) ?? null : null,
    })),
  };
}

async function designNameFor(orgId: string, designId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("studio_designs")
    .select("name")
    .eq("org_id", orgId)
    .eq("id", designId)
    .maybeSingle();
  return (data as { name: string | null } | null)?.name ?? null;
}

async function mirrorsFor(
  orgId: string,
  remoteIds: string[]
): Promise<Map<string, LinkedJobMirror>> {
  const out = new Map<string, LinkedJobMirror>();
  if (remoteIds.length === 0) return out;

  const tz = await getSm8Timezone(orgId);
  const todayFloor = `${todayInZone(tz)} 00:00:00`;

  const [{ data: jobRows }, { data: actRows }, { data: checkRows }, { data: contactRows }] =
    await Promise.all([
      supabaseAdmin
        .from("sm8_jobs")
        .select("uuid, status, job_address, geo_city")
        .eq("org_id", orgId)
        .in("uuid", remoteIds),
      supabaseAdmin
        .from("sm8_job_activities")
        .select("job_uuid, staff_uuid, start_date")
        .eq("org_id", orgId)
        .eq("active", 1)
        .in("job_uuid", remoteIds)
        .gte("start_date", todayFloor)
        .order("start_date", { ascending: true }),
      supabaseAdmin
        .from("sm8_job_checklists")
        .select("job_uuid, completed_timestamp")
        .eq("org_id", orgId)
        .eq("active", 1)
        .in("job_uuid", remoteIds),
      supabaseAdmin
        .from("sm8_job_contacts")
        .select("job_uuid, first, last, type, phone, mobile, email")
        .eq("org_id", orgId)
        .eq("active", 1)
        .in("job_uuid", remoteIds),
    ]);

  const staffUuids = [
    ...new Set(
      ((actRows ?? []) as { staff_uuid: string | null }[])
        .map((a) => a.staff_uuid)
        .filter(Boolean)
    ),
  ] as string[];
  const { data: staffRows } = staffUuids.length
    ? await supabaseAdmin
        .from("sm8_staff")
        .select("uuid, first, last")
        .eq("org_id", orgId)
        .in("uuid", staffUuids)
    : { data: [] };
  const staffName = new Map(
    ((staffRows ?? []) as { uuid: string; first: string | null; last: string | null }[]).map(
      (s) => [s.uuid, [s.first, s.last].filter(Boolean).join(" ") || null]
    )
  );

  for (const j of (jobRows ?? []) as {
    uuid: string;
    status: string | null;
    job_address: string | null;
    geo_city: string | null;
  }[]) {
    out.set(j.uuid, {
      status: j.status,
      suburb: j.geo_city,
      address: j.job_address,
      nextBooking: null,
      checklist: null,
      contacts: [],
    });
  }

  // rows arrive start_date-ascending, so the first hit per job IS the next one
  for (const a of (actRows ?? []) as {
    job_uuid: string | null;
    staff_uuid: string | null;
    start_date: string;
  }[]) {
    const m = a.job_uuid ? out.get(a.job_uuid) : undefined;
    if (m && !m.nextBooking) {
      m.nextBooking = {
        start: a.start_date,
        staffName: a.staff_uuid ? staffName.get(a.staff_uuid) ?? null : null,
      };
    }
  }

  for (const c of (checkRows ?? []) as {
    job_uuid: string | null;
    completed_timestamp: string | null;
  }[]) {
    const m = c.job_uuid ? out.get(c.job_uuid) : undefined;
    if (!m) continue;
    m.checklist = m.checklist ?? { done: 0, total: 0 };
    m.checklist.total += 1;
    if (c.completed_timestamp) m.checklist.done += 1;
  }

  for (const c of (contactRows ?? []) as {
    job_uuid: string | null;
    first: string | null;
    last: string | null;
    type: string | null;
    phone: string | null;
    mobile: string | null;
    email: string | null;
  }[]) {
    const m = c.job_uuid ? out.get(c.job_uuid) : undefined;
    if (!m) continue;
    const name = [c.first, c.last].filter(Boolean).join(" ");
    if (!name) continue;
    m.contacts.push({ name, type: c.type, phone: c.mobile ?? c.phone, email: c.email });
  }

  return out;
}

/* ── the attach picker's search ── */

export type JobSearchHit = {
  remoteId: string;
  jobNumber: string | null;
  status: string | null;
  clientName: string | null;
  suburb: string | null;
  /** Names of projects already holding this job — the cross-project warning. */
  linkedTo: string[];
};

export async function searchMirrorJobs(
  orgId: string,
  query: string,
  limit = 10
): Promise<JobSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  type JobRow = {
    uuid: string;
    generated_job_id: string | null;
    status: string | null;
    company_uuid: string | null;
    geo_city: string | null;
  };

  // Two angles, merged: the number people say out loud, and the client name.
  const byNumber = supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, status, company_uuid, geo_city")
    .eq("org_id", orgId)
    .eq("active", 1)
    .ilike("generated_job_id", `${q}%`)
    .limit(limit);

  const { data: companyRows } = await supabaseAdmin
    .from("sm8_companies")
    .select("uuid, name")
    .eq("org_id", orgId)
    .eq("active", 1)
    .ilike("name", `%${q}%`)
    .limit(8);
  const companies = (companyRows ?? []) as { uuid: string; name: string | null }[];

  const byClient = companies.length
    ? supabaseAdmin
        .from("sm8_jobs")
        .select("uuid, generated_job_id, status, company_uuid, geo_city")
        .eq("org_id", orgId)
        .eq("active", 1)
        .in("company_uuid", companies.map((c) => c.uuid))
        .order("edit_date", { ascending: false })
        .limit(limit)
    : Promise.resolve({ data: [] as JobRow[] });

  const [numberRes, clientRes] = await Promise.all([byNumber, byClient]);
  const seen = new Map<string, JobRow>();
  for (const r of [
    ...((numberRes.data ?? []) as JobRow[]),
    ...((clientRes.data ?? []) as JobRow[]),
  ]) {
    if (!seen.has(r.uuid)) seen.set(r.uuid, r);
  }
  const hits = [...seen.values()].slice(0, limit);
  if (hits.length === 0) return [];

  const companyUuids = [...new Set(hits.map((h) => h.company_uuid).filter(Boolean))] as string[];
  const nameByCompany = new Map(companies.map((c) => [c.uuid, c.name]));
  const missing = companyUuids.filter((u) => !nameByCompany.has(u));
  if (missing.length) {
    const { data } = await supabaseAdmin
      .from("sm8_companies")
      .select("uuid, name")
      .eq("org_id", orgId)
      .in("uuid", missing);
    for (const c of (data ?? []) as { uuid: string; name: string | null }[]) {
      nameByCompany.set(c.uuid, c.name);
    }
  }

  const { data: linkRows } = await supabaseAdmin
    .from("project_jobs")
    .select("remote_id, project_id")
    .eq("org_id", orgId)
    .in("remote_id", hits.map((h) => h.uuid));
  const links = (linkRows ?? []) as { remote_id: string; project_id: string }[];
  const projectIds = [...new Set(links.map((l) => l.project_id))];
  const { data: projRows } = projectIds.length
    ? await supabaseAdmin
        .from("projects")
        .select("id, name")
        .eq("org_id", orgId)
        .in("id", projectIds)
    : { data: [] };
  const projName = new Map(
    ((projRows ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])
  );
  const linkedTo = new Map<string, string[]>();
  for (const l of links) {
    const list = linkedTo.get(l.remote_id) ?? [];
    const name = projName.get(l.project_id);
    if (name) list.push(name);
    linkedTo.set(l.remote_id, list);
  }

  return hits.map((h) => ({
    remoteId: h.uuid,
    jobNumber: h.generated_job_id,
    status: h.status,
    clientName: h.company_uuid ? nameByCompany.get(h.company_uuid) ?? null : null,
    suburb: h.geo_city,
    linkedTo: linkedTo.get(h.uuid) ?? [],
  }));
}

/* ── the Overview strip ── */

export type ProjectStripItem = {
  id: string;
  name: string;
  clientName: string | null;
  stage: string;
  percent: number;
};

export async function listProjectStrip(orgId: string, limit = 8): Promise<ProjectStripItem[]> {
  const { data } = await supabaseAdmin
    .from("projects")
    .select("id, name, client_name, stage")
    .eq("org_id", orgId)
    .eq("status", "active")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  type Row = { id: string; name: string; client_name: string | null; stage: string };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const { data: itemRows } = await supabaseAdmin
    .from("project_checklist_items")
    .select("project_id, done")
    .eq("org_id", orgId)
    .in("project_id", rows.map((r) => r.id));
  const by = new Map<string, { done: boolean }[]>();
  for (const r of (itemRows ?? []) as { project_id: string; done: boolean }[]) {
    (by.get(r.project_id) ?? by.set(r.project_id, []).get(r.project_id)!).push(r);
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    clientName: r.client_name,
    stage: r.stage,
    percent: checklistProgress(by.get(r.id) ?? []).percent,
  }));
}
