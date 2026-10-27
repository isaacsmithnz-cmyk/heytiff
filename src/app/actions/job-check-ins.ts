"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { endCheckIn, jobOf, openCheckIn, startCheckIn, type CheckIn } from "@/lib/workboard/check-in-rules";

/* CHECK IN / CHECK OUT on the job card — the person pressing, on the job
   they're looking at, on the rules every screen shares
   (lib/workboard/check-in-rules): one open check-in a person, so checking
   in here checks them out of wherever they were, at the same moment.
   Nothing is sent to ServiceM8 from here. */

export type MyCheckIn = {
  /** the job they're checked in on, and since when (ISO) */
  jobUuid: string;
  jobNumber: string | null;
  since: string;
} | null;

const job = (uuid: string) => {
  const j = jobOf(uuid);
  if (!j) throw new Error("No job to check in on");
  return j;
};

async function asMine(orgId: string, open: CheckIn | null): Promise<MyCheckIn> {
  if (!open) return null;
  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("generated_job_id")
    .eq("org_id", orgId)
    .eq("uuid", open.jobUuid)
    .maybeSingle();
  return {
    jobUuid: open.jobUuid,
    jobNumber: (data as { generated_job_id: string | null } | null)?.generated_job_id ?? null,
    since: open.inAt,
  };
}

/** Where the person reading the card is checked in, if anywhere. */
export async function readMyCheckIn(): Promise<MyCheckIn> {
  const { orgId, userId } = await requireOrg("workboard");
  return asMine(orgId, await openCheckIn(orgId, userId));
}

/** Check in on this job, checking out of any other first. */
export async function checkIn(jobUuid: string): Promise<MyCheckIn> {
  const { orgId, userId } = await requireOrg("workboard");
  const { open } = await startCheckIn(orgId, userId, job(jobUuid), new Date().toISOString());
  return asMine(orgId, open);
}

/** Check out of this job. Checking out of a job you aren't on does nothing. */
export async function checkOut(jobUuid: string): Promise<MyCheckIn> {
  const { orgId, userId } = await requireOrg("workboard");
  const j = job(jobUuid);
  const ended = await endCheckIn(orgId, userId, new Date().toISOString(), j);
  if (ended) return null;
  return asMine(orgId, await openCheckIn(orgId, userId));
}
