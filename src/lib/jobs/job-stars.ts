import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";

/* A JOB YOU STARRED (Isaac, 24 November 2026, bugs 78 and 89, "Yes" to the
   Star a job mock): booking a job into your day to remember it made Today
   show visits that weren't, so a star keeps a job where you can find it
   (the phone's Jobs › Starred, a star on its row everywhere) and Add task
   puts what's to do on your To do. The schedule is left to real visits.

   Starred is yours alone, by workspace and sign-in (docs/migrations/
   job_stars.sql), read and written with the service role as the sidebar's
   pins are. The callers gate; a job is starred only where this workspace's
   mirror holds it. */

export type StarOwner = { orgId: string; userId: string };
export type StarResult = { ok: true; starred: boolean } | { ok: false; error: string };

/** How many starred jobs a read carries. */
export const STARS_MAX = 60;

const low = (u: string) => u.trim().toLowerCase();

/** Your starred jobs, newest first: the job's uuid and when it was starred.
    [] when there are none or the table can't be read. */
export async function readStars(o: StarOwner, limit = STARS_MAX): Promise<{ job: string; at: string }[]> {
  const { data, error } = await supabaseAdmin
    .from("job_stars")
    .select("sm8_job_uuid, created_at")
    .eq("org_id", o.orgId)
    .eq("user_id", o.userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as { sm8_job_uuid: string; created_at: string }[]).map((r) => ({ job: r.sm8_job_uuid, at: r.created_at }));
}

/** Which of these jobs you starred, by lowercase uuid. */
export async function starredAmong(o: StarOwner, jobs: readonly string[]): Promise<Set<string>> {
  const asked = [...new Set(jobs.map(low).filter(Boolean))];
  if (asked.length === 0) return new Set();
  /* your stars are few: all of them, matched here, rather than a long `in` */
  const mine = await readStars(o, 500);
  const wanted = new Set(asked);
  return new Set(mine.map((s) => low(s.job)).filter((j) => wanted.has(j)));
}

export async function isStarred(o: StarOwner, job: string): Promise<boolean> {
  return (await starredAmong(o, [job])).has(low(job));
}

/** Star a job or take its star off. Starring a job already starred keeps
    when it was first starred. */
export async function setStar(o: StarOwner, job: string, on: boolean): Promise<StarResult> {
  const id = job.trim().slice(0, 80);
  if (!id) return { ok: false, error: "Which job?" };
  if (!on) {
    const { error } = await supabaseAdmin.from("job_stars").delete().eq("org_id", o.orgId).eq("user_id", o.userId).eq("sm8_job_uuid", id);
    return error ? { ok: false, error: "That didn't unstar. Try it again." } : { ok: true, starred: false };
  }
  const { data: found } = await supabaseAdmin.from("sm8_jobs").select("uuid").eq("org_id", o.orgId).eq("uuid", id).maybeSingle();
  if (!found) return { ok: false, error: "That job isn't in HeyTiff." };
  const { error } = await supabaseAdmin
    .from("job_stars")
    .upsert({ org_id: o.orgId, user_id: o.userId, sm8_job_uuid: id }, { onConflict: "org_id,user_id,sm8_job_uuid", ignoreDuplicates: true });
  return error ? { ok: false, error: "That didn't star. Try it again." } : { ok: true, starred: true };
}

/** After a tick: the job the task was for, where you starred it and that was
    your last open task on it, so the phone can ask "Remove 3602 from
    Starred?" (screen 4). Null otherwise; ignoring the ask keeps the star. */
export async function starredLastTask(
  o: StarOwner,
  staffId: string | null,
  taskId: string,
): Promise<{ job: string; number: string | null } | null> {
  if (!staffId) return null;
  const { data: t } = await supabaseAdmin.from("tasks").select("sm8_job_uuid").eq("org_id", o.orgId).eq("id", taskId).maybeSingle();
  let job = (t as { sm8_job_uuid: string | null } | null)?.sm8_job_uuid ?? null;
  if (!job) {
    const { data: ask } = await supabaseAdmin.from("mention_asks").select("sm8_job_uuid").eq("org_id", o.orgId).eq("task_id", taskId).limit(1).maybeSingle();
    job = (ask as { sm8_job_uuid: string | null } | null)?.sm8_job_uuid ?? null;
  }
  if (!job || !(await isStarred(o, job))) return null;
  const { count } = await supabaseAdmin
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("org_id", o.orgId)
    .eq("assigned_to", staffId)
    .eq("status", "open")
    .eq("sm8_job_uuid", job);
  if ((count ?? 0) > 0) return null;
  const { data: row } = await supabaseAdmin.from("sm8_jobs").select("generated_job_id").eq("org_id", o.orgId).eq("uuid", job).maybeSingle();
  return { job, number: (row as { generated_job_id: string | null } | null)?.generated_job_id ?? null };
}
