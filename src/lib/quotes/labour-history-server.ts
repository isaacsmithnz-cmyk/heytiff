import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { splitJobNumber } from "@/lib/workboard/job-family";
import { sampleOf, type LabourSample } from "./labour-history";

/* The business's own labour history, read off its jobs' briefs in the
   ServiceM8 mirror (labour-history.ts says what a sample is). Only briefs
   that can hold a labour figure are read — a time word somewhere in them —
   and a job ServiceM8 cloned to bill in claims (#279, #279A…) is one job,
   not six. Service role; callers gate. */

const SINCE_YEARS = 3;

/** `dayHours`: the business's working day, which turns a brief's days into
    hours; without it only briefs in hours count. */
export async function readLabourSamples(orgId: string, dayHours: number | null, now: Date = new Date()): Promise<LabourSample[]> {
  const since = `${now.getUTCFullYear() - SINCE_YEARS}-01-01`;
  const [{ data: jobs, error }, { data: cats }] = await Promise.all([
    supabaseAdmin
      .from("sm8_jobs")
      .select("generated_job_id, job_description, category_uuid")
      .eq("org_id", orgId)
      .eq("active", 1)
      .gte("date", since)
      .or("job_description.ilike.%hr%,job_description.ilike.%hour%,job_description.ilike.%day%")
      .limit(5000),
    supabaseAdmin.from("sm8_categories").select("uuid, name").eq("org_id", orgId),
  ]);
  if (error) {
    console.error(`[quotes] couldn't read org ${orgId}'s labour history:`, error);
    return [];
  }
  const category = new Map(((cats ?? []) as { uuid: string; name: string | null }[]).map((c) => [c.uuid, c.name]));
  const seen = new Set<string>();
  const out: LabourSample[] = [];
  for (const j of (jobs ?? []) as { generated_job_id: string | null; job_description: string | null; category_uuid: string | null }[]) {
    const base = splitJobNumber(j.generated_job_id)?.base ?? j.generated_job_id;
    if (!base || seen.has(base)) continue;
    const s = sampleOf(base, j.job_description, j.category_uuid ? category.get(j.category_uuid) ?? null : null, dayHours);
    if (!s) continue;
    seen.add(base);
    out.push(s);
  }
  return out;
}
