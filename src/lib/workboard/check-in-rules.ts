import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";

/* A PERSON'S CHECK-INS, ONE SET OF RULES for every screen that presses them:
   the job card's (actions/job-check-ins, behind its session) and the
   phone's Clock on and Clock off (lib/mobile/clock, behind its token).

     ON   one open check-in a person: checking in somewhere else checks them
          out of the last one at the same moment, so a forgotten check-out
          never runs on while they work another job.
     OFF  at a time they chose, never before they checked in and never
          after now. Checking out of a job you aren't on does nothing.

   Nothing here is sent to ServiceM8: the phone sends a stint's time once
   it ends (lib/mobile/clock). */

export type CheckIn = { id: string; jobUuid: string; inAt: string; outAt: string | null };

type Row = { id: string; sm8_job_uuid: string; checked_in_at: string; checked_out_at: string | null };
const COLUMNS = "id, sm8_job_uuid, checked_in_at, checked_out_at";
const asCheckIn = (r: Row): CheckIn => ({ id: r.id, jobUuid: r.sm8_job_uuid, inAt: r.checked_in_at, outAt: r.checked_out_at });

export const jobOf = (uuid: unknown): string | null => {
  const j = typeof uuid === "string" ? uuid.trim() : "";
  return j && j.length <= 80 ? j : null;
};

/** Where the person is checked in, if anywhere. */
export async function openCheckIn(orgId: string, userId: string): Promise<CheckIn | null> {
  const { data } = await supabaseAdmin
    .from("job_check_ins")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .is("checked_out_at", null)
    .maybeSingle();
  return data ? asCheckIn(data as Row) : null;
}

/** The person's last stint that ended, at or after `since`. */
export async function lastCheckOut(orgId: string, userId: string, since: string): Promise<CheckIn | null> {
  const { data } = await supabaseAdmin
    .from("job_check_ins")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .gte("checked_out_at", since)
    .order("checked_out_at", { ascending: false })
    .limit(1);
  const r = ((data ?? []) as Row[])[0];
  return r ? asCheckIn(r) : null;
}

/** Check in on this job at `at`, checking out of any other at the same
    moment: `closed` is the stint that ended, for its time to go. On the job
    already, nothing changes. */
export async function startCheckIn(
  orgId: string,
  userId: string,
  jobUuid: string,
  at: string
): Promise<{ open: CheckIn; closed: CheckIn | null }> {
  const open = await openCheckIn(orgId, userId);
  if (open && open.jobUuid === jobUuid) return { open, closed: null };
  let closed: CheckIn | null = null;
  if (open) {
    const out = Date.parse(at) < Date.parse(open.inAt) ? open.inAt : at;
    const { error } = await supabaseAdmin.from("job_check_ins").update({ checked_out_at: out }).eq("org_id", orgId).eq("id", open.id);
    if (error) throw new Error("Could not check you out of the last job");
    closed = { ...open, outAt: out };
  }
  const { data, error } = await supabaseAdmin
    .from("job_check_ins")
    .insert({ org_id: orgId, sm8_job_uuid: jobUuid, user_id: userId, checked_in_at: at })
    .select(COLUMNS)
    .single();
  if (error || !data) throw new Error("Could not check you in");
  return { open: asCheckIn(data as Row), closed };
}

/** Check out of the open stint at `at`. Null when there was none to end,
    or `jobUuid` names another job. */
export async function endCheckIn(orgId: string, userId: string, at: string, jobUuid?: string): Promise<CheckIn | null> {
  const open = await openCheckIn(orgId, userId);
  if (!open || (jobUuid !== undefined && open.jobUuid !== jobUuid)) return null;
  if (Date.parse(at) < Date.parse(open.inAt)) throw new Error("That's before you clocked on.");
  const { data, error } = await supabaseAdmin
    .from("job_check_ins")
    .update({ checked_out_at: at })
    .eq("org_id", orgId)
    .eq("id", open.id)
    .is("checked_out_at", null)
    .select(COLUMNS);
  if (error) throw new Error("Could not check you out");
  const r = ((data ?? []) as Row[])[0];
  return r ? asCheckIn(r) : null;
}
