import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { labourAdvice, workKindOf, type LabourAdvice, type WorkKind } from "./labour-history";
import { readLabourSamples } from "./labour-history-server";
import type { OrgDay } from "./org-day";
import { readOrgDay } from "./org-day-server";
import { readStoredProposal } from "./proposal-writer";

/* THE QUOTE'S LABOUR, for one job of one business (Isaac, 2026-10-04: "any
   job should not recommend labour without data… number one source is the
   brief… recommendation comes from orgs own history… whatever you build has
   to be usable universally by a completely new org").

   Every read here is this org's own: the job's words, the proposal's brief,
   its own past jobs, and its own rate and working day (org-day.ts: the
   Quoting page's, else its Rate Calculator's). There is no fallback number:
   a business that hasn't set a rate sees hours and no cost, one with no
   working day sees days and no hours, and one with no history of a kind of
   work is told nothing. Service role; the route gates. */

export type QuoteLabour = {
  kind: WorkKind | null;
  advice: LabourAdvice;
  /** this business's install rate, when the reader may see money and the
      business has one (org-day.ts) */
  rate: OrgDay["rate"];
  /** this business's working day, in hours */
  dayHours: number | null;
  /** what the business hasn't set, for the quote to say (Isaac, 2026-10-04:
      "if your hours or rates aren't set yet the quote builder can warn
      you"); the rate only to a reader who may see money */
  unset: ("rate" | "hours")[];
};

export async function readQuoteLabour(orgId: string, jobUuid: string, opts: { money: boolean }): Promise<QuoteLabour | null> {
  const { data: job } = await supabaseAdmin
    .from("sm8_jobs")
    .select("job_description, category_uuid")
    .eq("org_id", orgId)
    .eq("uuid", jobUuid)
    .maybeSingle();
  const row = job as { job_description: string | null; category_uuid: string | null } | null;
  if (!row) return null;
  const [category, proposal] = await Promise.all([
    row.category_uuid
      ? supabaseAdmin.from("sm8_categories").select("name").eq("org_id", orgId).eq("uuid", row.category_uuid).maybeSingle()
      : Promise.resolve({ data: null }),
    readStoredProposal(orgId, jobUuid).catch(() => null),
  ]);
  /* the job's own words first, then what the quote was drafted from */
  const brief = [row.job_description, proposal?.brief].filter((t): t is string => !!t?.trim()).join("\n");
  const kind = workKindOf(brief, (category.data as { name: string | null } | null)?.name ?? null);
  const day = await readOrgDay(orgId);
  const dayHours = day.hours?.hours ?? null;
  const first = labourAdvice(brief, kind, [], dayHours);
  /* history is read only when the brief says nothing */
  const advice = first.from === "brief" ? first : labourAdvice(brief, kind, await readLabourSamples(orgId, dayHours), dayHours);
  const unset: QuoteLabour["unset"] = [];
  if (opts.money && !day.rate) unset.push("rate");
  if (dayHours == null) unset.push("hours");
  return { kind, advice, rate: opts.money ? day.rate : null, dayHours, unset };
}
