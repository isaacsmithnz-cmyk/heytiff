import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { StudioJobHit } from "./job-link";

/* A JOB'S DESIGNS, FOR THE QUOTE'S DESIGN STEP (Isaac, 28 October 2026:
   "Brief, Scope, Design (skippable), Priced, with the Studio opening from
   the Design step"). The quote asks which designs a job has, and the
   Studio, opened on a job, opens the newest of them or starts the first on
   it. Both read the job link's own column, `sm8_job_uuid`, written out of
   the design document on every save so this is an index hit
   (studio_designs_sm8_job.sql). */

/** One design drawn for a job, as the quote lists it. */
export type JobDesignRow = { id: string; name: string; updatedAt: string };

/** The designs drawn for a job, newest first. */
export async function readJobDesigns(orgId: string, jobUuid: string, limit = 12): Promise<JobDesignRow[]> {
  const { data } = await supabaseAdmin
    .from("studio_designs")
    .select("id, name, updated_at")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .order("updated_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as { id: string; name: string | null; updated_at: string }[]).map((d) => ({
    id: d.id,
    /* always named (createDesign defaults it), but a blank copy would be a row nobody can read */
    name: d.name?.trim() || "Untitled design",
    updatedAt: d.updated_at,
  }));
}

/** The job a design is started on, as the Studio's own job search finds it
    (searchMirrorJobs): its number, client, address and what it is. Null
    for a job that isn't this business's. */
export async function studioJobOf(orgId: string, jobUuid: string): Promise<StudioJobHit | null> {
  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, status, company_uuid, geo_city, job_address, job_description")
    .eq("org_id", orgId)
    .eq("uuid", jobUuid)
    .maybeSingle();
  const job = data as {
    uuid: string;
    generated_job_id: string | null;
    status: string | null;
    company_uuid: string | null;
    geo_city: string | null;
    job_address: string | null;
    job_description: string | null;
  } | null;
  if (!job) return null;
  const { data: company } = job.company_uuid
    ? await supabaseAdmin.from("sm8_companies").select("name").eq("org_id", orgId).eq("uuid", job.company_uuid).maybeSingle()
    : { data: null };
  return {
    remoteId: job.uuid,
    jobNumber: job.generated_job_id,
    clientName: (company as { name: string | null } | null)?.name ?? null,
    status: job.status,
    address: job.job_address,
    suburb: job.geo_city,
    description: job.job_description,
  };
}
