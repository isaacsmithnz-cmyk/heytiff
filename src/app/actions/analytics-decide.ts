"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { isAnswer, isQuestion } from "@/lib/analytics/decisions";

/* AN ANSWER ON THE TO DECIDE TAB (Isaac, 2026-10-07: "anything unknown or
   questionable should be manually decided"). One row per job and question
   in job_analytics_decisions; a new answer replaces the old one, and Undo
   takes the row away. Money is the grant, the same as the page: every
   figure an answer moves is job money. Nothing is sent to ServiceM8 here;
   the clean-up in ServiceM8 is its own press. */

export type DecideAnswer = { ok: true } | { ok: false; error: string };

const NOT_ALLOWED = "Only someone who sees the jobs' money can answer these.";
const NO_JOB = "That job isn't in ServiceM8's copy here any more.";
const NOT_AN_ANSWER = "That isn't one of the answers.";
const NO_TABLE = "Answers can't be kept until the database is updated for them.";
const DIDNT_SAVE = "That didn't save. Try again.";

/** Keep an answer to one question about one job; `answer` null takes it back. */
export async function decideJob(jobUuid: string, question: string, answer: string | null): Promise<DecideAnswer> {
  let orgId: string;
  let userId: string;
  try {
    ({ orgId, userId } = await requireOrg("workboard_money"));
  } catch {
    return { ok: false, error: NOT_ALLOWED };
  }
  if (!isQuestion(question) || (answer !== null && !isAnswer(question, answer))) return { ok: false, error: NOT_AN_ANSWER };
  const job = typeof jobUuid === "string" ? jobUuid.trim() : "";
  if (!job || job.length > 80) return { ok: false, error: NO_JOB };

  /* the job is this workspace's: a uuid from the browser is a choice */
  const { data: row } = await supabaseAdmin.from("sm8_jobs").select("uuid").eq("org_id", orgId).eq("uuid", job).maybeSingle();
  if (!row) return { ok: false, error: NO_JOB };

  const { error } =
    answer === null
      ? await supabaseAdmin.from("job_analytics_decisions").delete().eq("org_id", orgId).eq("sm8_job_uuid", job).eq("question", question)
      : await supabaseAdmin.from("job_analytics_decisions").upsert(
          { org_id: orgId, sm8_job_uuid: job, question, answer, decided_by: userId, decided_at: new Date().toISOString() },
          { onConflict: "org_id,sm8_job_uuid,question" },
        );
  if (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "PGRST205" || code === "42P01") return { ok: false, error: NO_TABLE };
    console.error(`[analytics] couldn't ${answer === null ? "take back" : "keep"} the ${question} answer on job ${job}:`, error);
    return { ok: false, error: DIDNT_SAVE };
  }
  return { ok: true };
}
