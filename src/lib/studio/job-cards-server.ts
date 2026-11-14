import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { jobHue } from "@/lib/workboard/job-hue";
import type { StudioJobHit } from "./job-link";

/* THE JOBS NEW DESIGN OFFERS, AS JOB CARDS (Isaac, 14 November 2026: "Job
   picker should look more like job cards", "Recent jobs at top", and "Both"
   to the jobs last opened and the newest). Each is read with what the
   Schedule's card draws: the number, the client, the street, the kind of job
   and its colour (jobHue), and whether Tiff has read plans on it, since a
   design started on such a job opens on them.

   Its own lean read, not the Jobs list's: that one carries bookings, money
   and check-ins, and a picker wants eight columns. Names are joined here, as
   everywhere on the mirror, which has no foreign keys. */

const COLS = "uuid, generated_job_id, status, company_uuid, category_uuid, geo_city, job_address, job_description";

/** A job number that ends in a claim's letter (2845A): part of its parent's
    card, never a row of its own. */
const CLAIM_NUMBER = "[A-Z]$";

type Row = {
  uuid: string;
  generated_job_id: string | null;
  status: string | null;
  company_uuid: string | null;
  category_uuid: string | null;
  geo_city: string | null;
  job_address: string | null;
  job_description: string | null;
};

const low = (id: string) => id.toLowerCase();
const uniq = (ids: (string | null)[]) => [...new Set(ids.filter((id): id is string => !!id))];

async function cardsOf(orgId: string, rows: Row[]): Promise<StudioJobHit[]> {
  if (rows.length === 0) return [];
  const companies = uniq(rows.map((r) => r.company_uuid));
  const categories = uniq(rows.map((r) => r.category_uuid));
  const [names, kinds, read] = await Promise.all([
    companies.length ? supabaseAdmin.from("sm8_companies").select("uuid, name").eq("org_id", orgId).in("uuid", companies) : { data: [] },
    categories.length ? supabaseAdmin.from("sm8_categories").select("uuid, name, colour").eq("org_id", orgId).in("uuid", categories) : { data: [] },
    supabaseAdmin.from("job_plans").select("job_uuid").eq("org_id", orgId).eq("state", "read").in("job_uuid", rows.map((r) => r.uuid)),
  ]);
  const nameOf = new Map(((names.data ?? []) as { uuid: string; name: string | null }[]).map((c) => [c.uuid, c.name]));
  const kindOf = new Map(((kinds.data ?? []) as { uuid: string; name: string | null; colour: string | null }[]).map((c) => [c.uuid, c]));
  const withPlans = new Set(((read.data ?? []) as { job_uuid: string }[]).map((p) => low(p.job_uuid)));
  return rows.map((r) => {
    const kind = r.category_uuid ? kindOf.get(r.category_uuid) : undefined;
    return {
      remoteId: r.uuid,
      jobNumber: r.generated_job_id,
      clientName: r.company_uuid ? (nameOf.get(r.company_uuid) ?? null) : null,
      status: r.status,
      address: r.job_address,
      suburb: r.geo_city,
      description: r.job_description ? r.job_description.slice(0, 120) : null,
      kind: kind?.name?.trim() || null,
      hue: jobHue(kind?.colour, r.status),
      plansRead: withPlans.has(low(r.uuid)),
    };
  });
}

/** How many jobs one ask for All jobs may bring. */
export const STUDIO_JOBS_MOST = 24;

/** The business's jobs, newest number first: a page of them from `from`. */
export async function studioJobsByNumber(orgId: string, from: number, limit: number): Promise<StudioJobHit[]> {
  const start = Math.max(Math.floor(from) || 0, 0);
  const many = Math.min(Math.max(Math.floor(limit) || 0, 1), STUDIO_JOBS_MOST);
  const { data, error } = await supabaseAdmin
    .from("sm8_jobs")
    .select(COLS)
    .eq("org_id", orgId)
    .eq("active", 1)
    .not("generated_job_id", "match", CLAIM_NUMBER)
    .order("job_number", { ascending: false, nullsFirst: false })
    .order("generated_job_id", { ascending: true })
    .range(start, start + many - 1);
  if (error) {
    console.error(`[studio] couldn't list org ${orgId}'s jobs by number:`, error);
    return [];
  }
  return cardsOf(orgId, (data ?? []) as unknown as Row[]);
}

/** The jobs named, in the order named: Recent, and what a search found. A
    job gone from the mirror is left out. */
export async function studioJobsByIds(orgId: string, ids: readonly string[]): Promise<StudioJobHit[]> {
  const asked = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].slice(0, 20);
  if (asked.length === 0) return [];
  const { data, error } = await supabaseAdmin.from("sm8_jobs").select(COLS).eq("org_id", orgId).eq("active", 1).in("uuid", asked);
  if (error) {
    console.error(`[studio] couldn't read org ${orgId}'s jobs:`, error);
    return [];
  }
  const byId = new Map(((data ?? []) as unknown as Row[]).map((r) => [low(r.uuid), r]));
  return cardsOf(orgId, asked.map((id) => byId.get(low(id))).filter((r): r is Row => !!r));
}
