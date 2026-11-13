import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { pushToStaff } from "./push";

/* THE WRAP-UP FOR EVERYONE ON THE JOB (the mock https://claude.ai/artifact/FoQV6u2HCBD1y3aVu72LTs, Isaac, 10 November
   2026: "Anyone else who was booked on the job should get a notification when the first person has done their
   wrap-up ... Leo has wrapped up job 2143. Want to add anything?", 11 November: "it should say view ... and also
   nothing to add", then "Build from mocks approved"). Once a job's first wrap-up says how it ended, everyone else on
   it that day (booked in ServiceM8, or checked in) whose HeyTiff card is linked to their ServiceM8 person gets
   "Isaac wrapped up 3324 / Darling Point. Anything to add?" with View and Nothing to add. Once a job a day: a change
   to the answer, or a second wrap-up, rings nobody. Best effort: a push that can't go is let go. */

/** "8c/13 Thornton St\nDarling Point NSW 2027" is Darling Point. Pure. */
export function suburbOf(address: string | null): string | null {
  const lines = (address ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines.length > 1 ? lines[lines.length - 1]! : null;
  return last ? last.replace(/,?\s+(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)?\s*\d{4}$/i, "").replace(/,\s*$/, "").trim() || null : null;
}

export async function tellOthersWrapped(orgId: string, job: string, day: string, byStaff: string | null, byName: string | null): Promise<number> {
  const either = [...new Set([job, job.toLowerCase()])];
  const [{ data: acts }, { data: facts }] = await Promise.all([
    supabaseAdmin
      .from("sm8_job_activities")
      .select("staff_uuid")
      .eq("org_id", orgId)
      .in("job_uuid", either)
      .eq("active", 1)
      .gte("start_date", `${day} 00:00:00`)
      .lte("start_date", `${day} 23:59:59`),
    supabaseAdmin.from("sm8_jobs").select("uuid, generated_job_id, job_address").eq("org_id", orgId).in("uuid", either).limit(1),
  ]);
  const sm8 = [...new Set(((acts ?? []) as { staff_uuid: string | null }[]).map((a) => a.staff_uuid).filter((u): u is string => !!u))];
  if (!sm8.length) return 0;
  const { data: links } = await supabaseAdmin.from("integration_links").select("staff_profile_id, remote_id").eq("org_id", orgId).eq("provider", "servicem8").eq("kind", "staff").in("remote_id", sm8);
  const others = [...new Set(((links ?? []) as { staff_profile_id: string | null }[]).map((l) => l.staff_profile_id).filter((s): s is string => !!s && s !== byStaff))];
  if (!others.length) return 0;
  const f = ((facts ?? []) as { uuid: string; generated_job_id: string | null; job_address: string | null }[])[0];
  const number = f?.generated_job_id ?? "the job";
  const where = suburbOf(f?.job_address ?? null);
  return pushToStaff(orgId, others, {
    title: `${byName ?? "Someone"} wrapped up ${number}`,
    body: `${where ? `${where}. ` : ""}Anything to add?`,
    path: `/wrapup?job=${encodeURIComponent(f?.uuid ?? job)}&on=${day}`,
    data: { kind: "wrapped", jobUuid: f?.uuid ?? job, day },
    categoryId: "wrapped-by",
  });
}
