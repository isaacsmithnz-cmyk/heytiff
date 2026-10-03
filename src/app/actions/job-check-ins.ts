"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";

/* CHECK IN / CHECK OUT on the job card — the person pressing, on the job
   they're looking at. One open check-in a person: checking in here checks
   them out of wherever they were, at the same moment, so a forgotten
   check-out on one job never runs on while they work another. Nothing is
   sent to ServiceM8. */

export type MyCheckIn = {
  /** the job they're checked in on, and since when (ISO) */
  jobUuid: string;
  jobNumber: string | null;
  since: string;
} | null;

const job = (uuid: string) => {
  const j = uuid.trim();
  if (!j || j.length > 80) throw new Error("No job to check in on");
  return j;
};

async function openFor(orgId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("job_check_ins")
    .select("id, sm8_job_uuid, checked_in_at")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .is("checked_out_at", null)
    .maybeSingle();
  return data as { id: string; sm8_job_uuid: string; checked_in_at: string } | null;
}

async function asMine(orgId: string, open: { sm8_job_uuid: string; checked_in_at: string } | null): Promise<MyCheckIn> {
  if (!open) return null;
  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("generated_job_id")
    .eq("org_id", orgId)
    .eq("uuid", open.sm8_job_uuid)
    .maybeSingle();
  return {
    jobUuid: open.sm8_job_uuid,
    jobNumber: (data as { generated_job_id: string | null } | null)?.generated_job_id ?? null,
    since: open.checked_in_at,
  };
}

/** Where the person reading the card is checked in, if anywhere. */
export async function readMyCheckIn(): Promise<MyCheckIn> {
  const { orgId, userId } = await requireOrg("workboard");
  return asMine(orgId, await openFor(orgId, userId));
}

/** Check in on this job, checking out of any other first. */
export async function checkIn(jobUuid: string): Promise<MyCheckIn> {
  const { orgId, userId } = await requireOrg("workboard");
  const j = job(jobUuid);
  const now = new Date().toISOString();
  const open = await openFor(orgId, userId);
  if (open && open.sm8_job_uuid === j) return asMine(orgId, open);
  if (open) {
    const { error } = await supabaseAdmin.from("job_check_ins").update({ checked_out_at: now }).eq("org_id", orgId).eq("id", open.id);
    if (error) throw new Error("Could not check you out of the last job");
  }
  const { data, error } = await supabaseAdmin
    .from("job_check_ins")
    .insert({ org_id: orgId, sm8_job_uuid: j, user_id: userId, checked_in_at: now })
    .select("sm8_job_uuid, checked_in_at")
    .single();
  if (error) throw new Error("Could not check you in");
  return asMine(orgId, data as { sm8_job_uuid: string; checked_in_at: string });
}

/** Check out of this job. Checking out of a job you aren't on does nothing. */
export async function checkOut(jobUuid: string): Promise<MyCheckIn> {
  const { orgId, userId } = await requireOrg("workboard");
  const j = job(jobUuid);
  const open = await openFor(orgId, userId);
  if (!open || open.sm8_job_uuid !== j) return asMine(orgId, open);
  const { error } = await supabaseAdmin
    .from("job_check_ins")
    .update({ checked_out_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", open.id);
  if (error) throw new Error("Could not check you out");
  return null;
}
