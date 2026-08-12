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
import { signOne } from "@/lib/documents/query";
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

export type ScopeItem = {
  id: string;
  kind: "inclusion" | "exclusion";
  label: string;
};

export type VariationRow = {
  id: string;
  title: string;
  detail: string | null;
  amountCents: number;
  status: "pending" | "approved" | "declined";
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type ClaimRow = {
  id: string;
  label: string;
  amountCents: number;
  claimedOn: string;
  status: "awaiting" | "paid";
  paidOn: string | null;
  source: string;
  remoteRef: string | null;
  variationId: string | null;
};

export type MilestoneRow = {
  id: string;
  label: string;
  onDate: string;
};

export type ProjectDocument = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  /** A signed read URL, an hour's worth — minted fresh on every load. */
  url: string | null;
};

export type ProjectDetail = {
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
  designName: string | null;
  /** The maintenance agreement this project spawned at handover, if any. */
  agreementId: string | null;
  agreementLabel: string | null;
  notes: string | null;
  createdAt: string;
  /** Never null — creation counts as movement. */
  updatedAt: string;
  checklist: ChecklistItem[];
  equipment: EquipmentItem[];
  jobs: LinkedJob[];
  scope: ScopeItem[];
  /* WHY THE MONEY IS EMPTY, said out loud. Without capability
     `workboard_money` the three money reads never run, and the result is
     indistinguishable from a project nobody has priced: budget null, no
     variations, no claims. The screen needs to tell those apart, because
     offering "Set the job total" to someone who may not see money is both a
     lie and a dead end. */
  moneyVisible: boolean;
  variations: VariationRow[];
  claims: ClaimRow[];
  milestones: MilestoneRow[];
  documents: ProjectDocument[];
  /** Sum of actual_hours across this project's DONE trips. */
  hoursLogged: number;
};

/* `includeMoney` defaults TRUE so every caller reads as it always did; the
   route gates it explicitly off capability `workboard_money`. With it false
   the budget, variations and claims are never SELECTED — a reader without
   money access is handed a project that has none, rather than one whose money
   the UI politely declines to draw. */
export async function getProjectDetail(
  orgId: string,
  projectId: string,
  opts: { includeMoney?: boolean } = {}
): Promise<ProjectDetail | null> {
  const includeMoney = opts.includeMoney ?? true;

  const { data } = await supabaseAdmin
    .from("projects")
    .select(
      "id, name, client_name, site_label, site_address, stage, status, design_id, notes, " +
        "blocked_reason, blocked_on, blocked_at, hours_budget, " +
        (includeMoney ? "budget_cents, budget_source, " : "") +
        "promised_finish, defects_end, agreement_id, created_at, updated_at"
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
    blocked_reason: string | null;
    blocked_on: string | null;
    blocked_at: string | null;
    budget_cents: number | null;
    budget_source: string | null;
    hours_budget: number | null;
    promised_finish: string | null;
    defects_end: string | null;
    agreement_id: string | null;
    created_at: string;
    updated_at: string | null;
  };
  const p = data as ProjectRow | null;
  if (!p) return null;

  let agreementLabel: string | null = null;
  if (p.agreement_id) {
    const { data: ag } = await supabaseAdmin
      .from("maintenance_agreements")
      .select("label")
      .eq("org_id", orgId)
      .eq("id", p.agreement_id)
      .maybeSingle();
    agreementLabel = (ag as { label: string } | null)?.label ?? null;
  }

  const [
    { data: itemRows },
    { data: equipRows },
    { data: jobRows },
    { data: scopeRows },
    { data: variationRows },
    { data: claimRows },
    { data: milestoneRows },
    { data: hourRows },
    { data: docRows },
    designName,
  ] = await Promise.all([
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
    supabaseAdmin
      .from("project_scope_items")
      .select("id, kind, label")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .order("kind", { ascending: true })
      .order("position", { ascending: true }),
    includeMoney
      ? supabaseAdmin
          .from("project_variations")
          .select("id, title, detail, amount_cents, status, decided_by, decided_at, created_at")
          .eq("org_id", orgId)
          .eq("project_id", projectId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    includeMoney
      ? supabaseAdmin
          .from("project_claims")
          .select(
            "id, label, amount_cents, claimed_on, status, paid_on, source, remote_ref, variation_id"
          )
          .eq("org_id", orgId)
          .eq("project_id", projectId)
          .order("claimed_on", { ascending: true })
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    supabaseAdmin
      .from("project_milestones")
      .select("id, label, on_date")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .order("on_date", { ascending: true }),
    supabaseAdmin
      .from("maintenance_visits")
      .select("actual_hours")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .eq("status", "done")
      .not("actual_hours", "is", null),
    supabaseAdmin
      .from("documents")
      .select("id, file_name, mime_type, size_bytes, storage_ref, uploaded_at")
      .eq("org_id", orgId)
      .eq("project_id", projectId)
      .not("uploaded_at", "is", null)
      .order("uploaded_at", { ascending: false }),
    p.design_id ? designNameFor(orgId, p.design_id) : Promise.resolve(null),
  ]);

  const documents: ProjectDocument[] = await Promise.all(
    ((docRows ?? []) as {
      id: string;
      file_name: string;
      mime_type: string;
      size_bytes: number;
      storage_ref: string;
      uploaded_at: string;
    }[]).map(async (d) => ({
      id: d.id,
      fileName: d.file_name,
      mimeType: d.mime_type,
      sizeBytes: d.size_bytes,
      uploadedAt: d.uploaded_at,
      url: await signOne(d.storage_ref),
    }))
  );

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
    blockedReason: p.blocked_reason,
    blockedOn: p.blocked_on,
    blockedAt: p.blocked_at,
    moneyVisible: includeMoney,
    budgetCents: includeMoney ? p.budget_cents : null,
    budgetSource: includeMoney ? p.budget_source : null,
    hoursBudget: p.hours_budget,
    promisedFinish: p.promised_finish,
    defectsEnd: p.defects_end,
    designId: p.design_id,
    designName,
    agreementId: p.agreement_id,
    agreementLabel,
    notes: p.notes,
    createdAt: p.created_at,
    updatedAt: p.updated_at ?? p.created_at,
    scope: ((scopeRows ?? []) as { id: string; kind: string; label: string }[]).map((s) => ({
      id: s.id,
      kind: s.kind as "inclusion" | "exclusion",
      label: s.label,
    })),
    variations: ((variationRows ?? []) as {
      id: string;
      title: string;
      detail: string | null;
      amount_cents: number;
      status: string;
      decided_by: string | null;
      decided_at: string | null;
      created_at: string;
    }[]).map((v) => ({
      id: v.id,
      title: v.title,
      detail: v.detail,
      amountCents: v.amount_cents,
      status: v.status as VariationRow["status"],
      decidedBy: v.decided_by,
      decidedAt: v.decided_at,
      createdAt: v.created_at,
    })),
    claims: ((claimRows ?? []) as {
      id: string;
      label: string;
      amount_cents: number;
      claimed_on: string;
      status: string;
      paid_on: string | null;
      source: string;
      remote_ref: string | null;
      variation_id: string | null;
    }[]).map((c) => ({
      id: c.id,
      label: c.label,
      amountCents: c.amount_cents,
      claimedOn: c.claimed_on,
      status: c.status as ClaimRow["status"],
      paidOn: c.paid_on,
      source: c.source,
      remoteRef: c.remote_ref,
      variationId: c.variation_id,
    })),
    milestones: ((milestoneRows ?? []) as { id: string; label: string; on_date: string }[]).map(
      (m) => ({ id: m.id, label: m.label, onDate: m.on_date })
    ),
    documents,
    hoursLogged:
      Math.round(
        ((hourRows ?? []) as { actual_hours: number }[]).reduce(
          (t, r) => t + r.actual_hours,
          0
        ) * 10
      ) / 10,
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
  /** The mirrored client record behind the name — provenance for an
      agreement born from this job (D7). */
  companyId: string | null;
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
    companyId: h.company_uuid,
    suburb: h.geo_city,
    linkedTo: linkedTo.get(h.uuid) ?? [],
  }));
}
