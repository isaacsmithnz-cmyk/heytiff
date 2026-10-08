import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { familyMediaSources, readJobNotes } from "@/lib/workboard/all-jobs-query";
import { readOurJobNotes } from "@/lib/workboard/job-notes-query";
import { readSm8QuoteBrief } from "../sm8-quote-brief-server";
import { jobSources, type JobSource } from "./job-sources";

/* Read the job (job-sources.ts says what's read and why nothing is judged
   for the person): the description and ServiceM8's quote from HeyTiff's
   mirror, and every note on the job, ServiceM8's (its claims' too) and
   HeyTiff's own. Reads only. Service role, by org; the route gates. */

export async function readJobSources(orgId: string, cardId: string): Promise<{ sources: JobSource[]; left: number }> {
  const [job, theirs, ours, sm8Quote] = await Promise.all([
    supabaseAdmin.from("sm8_jobs").select("job_description").eq("org_id", orgId).eq("uuid", cardId).maybeSingle(),
    familyMediaSources(orgId, cardId)
      .then((claims) => readJobNotes(orgId, cardId, claims))
      .catch(() => []),
    readOurJobNotes(orgId, cardId, 60).catch(() => []),
    readSm8QuoteBrief(orgId, cardId).catch(() => null),
  ]);
  return jobSources({
    description: (job.data as { job_description: string | null } | null)?.job_description ?? null,
    sm8Quote,
    notes: [
      ...theirs.map((n) => ({ id: `sm8-${n.remoteId}`, text: n.text, at: n.writtenAt, by: n.writtenBy })),
      ...ours.map((n) => ({ id: n.id, text: n.text, at: n.at, by: n.author })),
    ],
  });
}
