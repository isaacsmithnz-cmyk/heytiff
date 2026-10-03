"use server";

/* THE NEW JOB FORM'S ACTIONS (Isaac, 2026-10-01: "when you press new job it
   just goes straight to the form… customer name, start typing and the
   repeat customer could come up… repeat builders don't need the contact…
   start off by adding a new site as default or click previous sites").

   Everything here answers before any session or database read where the
   deployment doesn't send new jobs (sm8JobsAllowed), and asks
   workboard_manage of whoever is reading: starting a job in ServiceM8 is
   office work, and ServiceM8 may charge for it.

   The searches read the mirror only. Creating queues ONE row through the
   job queue's one door (sm8-job-queue) and sends it in the foreground for a
   few seconds, so the job is usually in ServiceM8 before the answer comes
   back; what isn't goes behind it. */

import { requireOrg } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sm8JobsAllowed } from "@/lib/integrations/sm8-kinds";
import { sm8PressFromSession } from "@/lib/integrations/sm8-press";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { offersSend, sendRefusal } from "@/lib/integrations/sm8-write-plan";
import { settlePressedWrites } from "@/lib/integrations/sm8-drain";
import { sm8JobUrl } from "@/lib/integrations/sm8-links";
import { jobLine, JOB_WORDS, validNewJob, type JobLine, type NewJobInput } from "@/lib/integrations/sm8-job-plan";
import { sm8CategoryColour } from "@/lib/workboard/all-jobs";
import { queueNewJob } from "./sm8-job-queue";

/** How long Create waits for the job to reach ServiceM8 before answering. */
const CREATE_BUDGET_MS = 15_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function gate(): Promise<{ orgId: string } | { error: string }> {
  if (!sm8JobsAllowed()) return { error: JOB_WORDS.card.jobsUnavailable };
  try {
    const { orgId } = await requireOrg("workboard_manage");
    return { orgId };
  } catch {
    return { error: JOB_WORDS.press.noManage };
  }
}

export type ClientHit = {
  uuid: string;
  name: string;
  address: string | null;
  /** how many sites hang under it: a builder's */
  sites: number;
  contacts: { name: string; mobile: string | null; phone: string | null; email: string | null }[];
};

const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

/** Clients whose name starts or contains what was typed, a builder's sites
    counted and their first few contacts with them. */
export async function searchNewJobClients(q: string): Promise<ClientHit[]> {
  const g = await gate();
  if ("error" in g) return [];
  const text = q.trim().slice(0, 60);
  if (text.length < 2) return [];
  const { data } = await supabaseAdmin
    .from("sm8_companies")
    .select("uuid, name, address")
    .eq("org_id", g.orgId)
    .eq("active", 1)
    .is("parent_company_uuid", null)
    .ilike("name", like(text))
    .order("name")
    .limit(8);
  const hits = (data ?? []) as { uuid: string; name: string | null; address: string | null }[];
  if (hits.length === 0) return [];
  const ids = hits.map((h) => h.uuid);
  const [{ data: sites }, { data: contacts }] = await Promise.all([
    supabaseAdmin.from("sm8_companies").select("parent_company_uuid").eq("org_id", g.orgId).eq("active", 1).in("parent_company_uuid", ids),
    supabaseAdmin.from("sm8_company_contacts").select("company_uuid, first, last, mobile, phone, email").eq("org_id", g.orgId).eq("active", 1).in("company_uuid", ids).limit(40),
  ]);
  const siteCount = new Map<string, number>();
  for (const s of (sites ?? []) as { parent_company_uuid: string }[]) siteCount.set(s.parent_company_uuid, (siteCount.get(s.parent_company_uuid) ?? 0) + 1);
  const byCompany = new Map<string, ClientHit["contacts"]>();
  for (const c of (contacts ?? []) as { company_uuid: string; first: string | null; last: string | null; mobile: string | null; phone: string | null; email: string | null }[]) {
    const name = [c.first, c.last].filter(Boolean).join(" ").trim();
    if (!name) continue;
    const list = byCompany.get(c.company_uuid) ?? [];
    if (list.length < 4) list.push({ name, mobile: c.mobile, phone: c.phone, email: c.email });
    byCompany.set(c.company_uuid, list);
  }
  return hits.map((h) => ({
    uuid: h.uuid,
    name: h.name?.trim() || "Unnamed client",
    address: h.address?.trim() || null,
    sites: siteCount.get(h.uuid) ?? 0,
    contacts: byCompany.get(h.uuid) ?? [],
  }));
}

export type SiteHit = { uuid: string; name: string; address: string | null; parentName: string | null; lastJob: string | null };

/** A builder's sites, matching what was typed when anything was. */
export async function searchClientSites(parentUuid: string, q: string): Promise<SiteHit[]> {
  const g = await gate();
  if ("error" in g || !UUID.test(parentUuid)) return [];
  let query = supabaseAdmin.from("sm8_companies").select("uuid, name, address").eq("org_id", g.orgId).eq("active", 1).eq("parent_company_uuid", parentUuid);
  const text = q.trim().slice(0, 60);
  if (text) query = query.or(`name.ilike.${like(text)},address.ilike.${like(text)}`);
  const { data } = await query.order("name").limit(12);
  return withLastJobs(g.orgId, ((data ?? []) as { uuid: string; name: string | null; address: string | null }[]).map((s) => ({ ...s, parentName: null })));
}

/** A site we've been to before at the address being typed — any client's
    (Isaac, 2026-10-01: "if you did start typing in a site… it could
    suggest it or say matches previous site address"). Matched on the street
    line, the first part of the address. */
export async function matchPreviousSite(address: string): Promise<SiteHit | null> {
  const g = await gate();
  if ("error" in g) return null;
  const street = address.split(/[,\n]/)[0]!.replace(/\s+/g, " ").trim();
  /* a number and a street name, or it isn't a match worth saying */
  if (!/^\d+\S*\s+\S{3,}/.test(street)) return null;
  const { data } = await supabaseAdmin
    .from("sm8_companies")
    .select("uuid, name, address, parent_company_uuid")
    .eq("org_id", g.orgId)
    .eq("active", 1)
    .ilike("address", `${street.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
    .limit(1);
  const hit = ((data ?? []) as { uuid: string; name: string | null; address: string | null; parent_company_uuid: string | null }[])[0];
  if (!hit) return null;
  let parentName: string | null = null;
  if (hit.parent_company_uuid) {
    const { data: p } = await supabaseAdmin.from("sm8_companies").select("name").eq("org_id", g.orgId).eq("uuid", hit.parent_company_uuid).maybeSingle();
    parentName = (p as { name: string | null } | null)?.name ?? null;
  }
  const [withJob] = await withLastJobs(g.orgId, [{ uuid: hit.uuid, name: hit.name, address: hit.address, parentName }]);
  return withJob ?? null;
}

async function withLastJobs(orgId: string, sites: { uuid: string; name: string | null; address: string | null; parentName: string | null }[]): Promise<SiteHit[]> {
  if (sites.length === 0) return [];
  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("company_uuid, generated_job_id, date")
    .eq("org_id", orgId)
    .in(
      "company_uuid",
      sites.map((s) => s.uuid)
    )
    .order("date", { ascending: false })
    .limit(60);
  const last = new Map<string, string>();
  for (const j of (data ?? []) as { company_uuid: string; generated_job_id: string | null }[]) {
    if (!last.has(j.company_uuid) && j.generated_job_id) last.set(j.company_uuid, j.generated_job_id);
  }
  return sites.map((s) => ({
    uuid: s.uuid,
    name: s.name?.trim() || s.address?.trim() || "Unnamed site",
    address: s.address?.trim() || null,
    parentName: s.parentName,
    lastJob: last.get(s.uuid) ?? null,
  }));
}

export type JobCategory = { uuid: string; name: string; colour: string | null };

/** ServiceM8's own job categories, the form's choice of kind. */
export async function readNewJobCategories(): Promise<JobCategory[]> {
  const g = await gate();
  if ("error" in g) return [];
  const { data } = await supabaseAdmin.from("sm8_categories").select("uuid, name, colour").eq("org_id", g.orgId).eq("active", 1).order("name");
  return ((data ?? []) as { uuid: string; name: string | null; colour: string | null }[])
    .filter((c) => c.name?.trim())
    .map((c) => ({ uuid: c.uuid, name: c.name!.trim(), colour: sm8CategoryColour(c.colour) }));
}

export type CreateNewJob = NewJobInput & {
  /** the form's own, minted once per open: a Create pressed twice is one job */
  pressId: string;
  /** what the form calls the client, for the owner's list */
  clientName: string;
  /** how they got in touch, and what happens next — said in the job's own
      description, where the office reads them */
  via: string | null;
  next: string | null;
};

export type CreateAnswer = { ok: true; rowId: string; line: JobLine; sm8Url: string | null } | { ok: false; error: string };

/** Start the job in ServiceM8. */
export async function createNewJob(input: CreateNewJob): Promise<CreateAnswer> {
  const startedAt = Date.now();
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const press = await sm8PressFromSession();
  if (!press || press.orgId !== g.orgId) return { ok: false, error: JOB_WORDS.press.unqueued };
  const state = await readSm8WriteState(g.orgId);
  if (!offersSend(state, "job")) return { ok: false, error: sendRefusal(state, "job") ?? JOB_WORDS.press.kindOff };

  /* the office's two facts, said in the job's own words */
  const tail = [input.via ? `Came in by ${input.via}.` : null, input.next ? `Next: ${input.next}.` : null].filter(Boolean).join(" ");
  const v = validNewJob({ ...input, description: tail ? `${input.description.trim()}\n\n${tail}` : input.description });
  if (!v.ok) return { ok: false, error: v.error };

  /* the client, or a site's builder, still there */
  const check = v.job.existingUuid ?? v.job.parentUuid;
  if (check) {
    const { data } = await supabaseAdmin.from("sm8_companies").select("uuid").eq("org_id", g.orgId).eq("uuid", check).eq("active", 1).maybeSingle();
    if (!data) return { ok: false, error: v.job.existingUuid ? JOB_WORDS.press.clientGone : JOB_WORDS.press.parentGone };
  }

  const q = await queueNewJob(press, input.pressId, v.job, input.clientName.trim());
  if (!q.ok) return q;
  await settlePressedWrites(g.orgId, [q.rowId], { startedAt, budgetMs: CREATE_BUDGET_MS });
  return readLine(g.orgId, q.rowId);
}

async function readLine(orgId: string, rowId: string): Promise<CreateAnswer> {
  const { data } = await supabaseAdmin
    .from("sm8_writes")
    .select("id, status, last_error, remote_uuid, job_done, job_number")
    .eq("org_id", orgId)
    .eq("id", rowId)
    .eq("kind", "job")
    .maybeSingle();
  const row = data as { id: string; status: string; last_error: string | null; remote_uuid: string; job_done: string[] | null; job_number: string | null } | null;
  if (!row) return { ok: false, error: JOB_WORDS.press.unqueued };
  const line = jobLine(row);
  return { ok: true, rowId, line, sm8Url: (row.job_done ?? []).includes("job") ? sm8JobUrl(row.remote_uuid) : null };
}

/** Where a job the form started is up to, for the form to look again. */
export async function newJobLine(rowId: string): Promise<CreateAnswer> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  if (!UUID.test(rowId)) return { ok: false, error: JOB_WORDS.press.unqueued };
  return readLine(g.orgId, rowId);
}
