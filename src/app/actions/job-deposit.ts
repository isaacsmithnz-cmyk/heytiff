"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";

/* NO DEPOSIT ON THIS JOB — the tick on the card's Billing (Isaac,
   2026-10-03: "if no deposit required make that as an option so it can get
   ticked off"). Money is the grant: whoever sees the claims decides whether
   one of them is a deposit. Nothing is sent to ServiceM8. */

export type NoDepositAnswer = { ok: true; noDeposit: boolean } | { ok: false; error: string };

const NOT_ALLOWED = "Only someone who sees the job's money can change its deposit.";
const NO_JOB = "That job isn't in ServiceM8's copy here any more.";
const DIDNT_SAVE = "That didn't save. Try again.";

/** Tick the job as taking no deposit, or untick it. */
export async function setNoDeposit(jobUuid: string, noDeposit: boolean): Promise<NoDepositAnswer> {
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await requireOrg("workboard_money"));
  } catch {
    return { ok: false, error: NOT_ALLOWED };
  }
  const job = jobUuid.trim();
  if (!job || job.length > 80) return { ok: false, error: NO_JOB };

  /* the job is this workspace's: a uuid from the browser is a choice */
  const { data: row } = await supabaseAdmin.from("sm8_jobs").select("uuid").eq("org_id", orgId).eq("uuid", job).maybeSingle();
  if (!row) return { ok: false, error: NO_JOB };

  const { error } = noDeposit
    ? await supabaseAdmin
        .from("job_no_deposit")
        .upsert({ org_id: orgId, sm8_job_uuid: job, marked_by: userId }, { onConflict: "org_id,sm8_job_uuid", ignoreDuplicates: true })
    : await supabaseAdmin.from("job_no_deposit").delete().eq("org_id", orgId).eq("sm8_job_uuid", job);
  if (error) {
    console.error(`[deposit] couldn't ${noDeposit ? "tick" : "untick"} no deposit on job ${job}:`, error);
    return { ok: false, error: DIDNT_SAVE };
  }
  return { ok: true, noDeposit };
}
