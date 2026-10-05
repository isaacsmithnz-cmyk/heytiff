import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { labourFromBrief, type BriefLabour } from "./brief-labour";
import type { TypicalLabour } from "./labour-history";
import { readOrgDay } from "./org-day-server";
import { readStoredProposal } from "./proposal-writer";

/* THE JOB'S LABOUR, for one job of one business (Isaac, 2026-10-04: "any
   job should not recommend labour without data… number one source is the
   brief… whatever you build has to be usable universally by a completely
   new org").

   The brief first: the job's own words and what the quote was drafted
   from, read in the business's own working day (org-day.ts), with nothing
   made up. Beside it, what this business's jobs of the kind typically take
   — which comes ONLY from its post-job reviews (Isaac, 2026-10-05: "Only in
   the review section"), so it is null until those reviews exist; old
   briefs and finished quotes are never read for it. Tiff's suggestion,
   when the brief gives none, rides on each option of the draft
   (proposal.ts). Service role; the route gates. */

export type QuoteLabour = {
  /** The labour the job's words give, for every option; null when none. */
  brief: BriefLabour | null;
  /** What the business's reviewed jobs of this kind typically take. */
  typical: TypicalLabour | null;
  /** The business's working day, in hours; null when it hasn't set one. */
  dayHours: number | null;
};

export async function readQuoteLabour(orgId: string, jobUuid: string): Promise<QuoteLabour | null> {
  const [{ data: job }, proposal, day] = await Promise.all([
    supabaseAdmin.from("sm8_jobs").select("job_description").eq("org_id", orgId).eq("uuid", jobUuid).maybeSingle(),
    readStoredProposal(orgId, jobUuid).catch(() => null),
    readOrgDay(orgId),
  ]);
  const row = job as { job_description: string | null } | null;
  if (!row) return null;
  /* the job's own words first, then what the quote was drafted from */
  const words = [row.job_description, proposal?.brief].filter((t): t is string => !!t?.trim()).join("\n");
  const dayHours = day.hours?.hours ?? null;
  return { brief: labourFromBrief(words, dayHours), typical: null, dayHours };
}
