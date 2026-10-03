import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { hydrateState, runEngine } from "@/components/rate-calculator/state";
import { labourAdvice, workKindOf, type LabourAdvice, type WorkKind } from "./labour-history";
import { readLabourSamples } from "./labour-history-server";
import { readStoredProposal } from "./proposal-writer";

/* THE QUOTE'S LABOUR, for one job of one business (Isaac, 2026-10-04: "any
   job should not recommend labour without data… number one source is the
   brief… recommendation comes from orgs own history… whatever you build has
   to be usable universally by a completely new org").

   Every read here is this org's own: the job's words, the proposal's brief,
   its own past jobs, and its own rate from its own Rate Calculator. There is
   no fallback number — a business that hasn't set a rate sees hours and no
   cost, and one with no history of a kind of work is told nothing about it.
   Service role; the route gates. */

export type QuoteLabour = {
  kind: WorkKind | null;
  advice: LabourAdvice;
  /** this business's install rate, $/hr, when the reader may see money and
      the business has one */
  rate: { perHourCents: number; from: "charged" | "recommended" } | null;
};

/** The install rate this business charges, else the one its Rate
    Calculator recommends once it has enough to say; null otherwise. */
export async function readInstallRate(orgId: string): Promise<QuoteLabour["rate"]> {
  const { data, error } = await supabaseAdmin.from("rate_calc_state").select("state").eq("org_id", orgId).maybeSingle();
  if (error || !data) return null;
  const s = hydrateState((data as { state: unknown }).state);
  const charged = s.currentRates.install;
  if (typeof charged === "number" && charged > 0) return { perHourCents: Math.round(charged * 100), from: "charged" };
  const run = runEngine(s);
  const rec = run.ready ? run.calc.recInst : null;
  return typeof rec === "number" && rec > 0 ? { perHourCents: Math.round(rec * 100), from: "recommended" } : null;
}

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
  const first = labourAdvice(brief, kind, []);
  /* history is read only when the brief says nothing */
  const advice = first.from === "brief" ? first : labourAdvice(brief, kind, await readLabourSamples(orgId));
  const rate = opts.money ? await readInstallRate(orgId) : null;
  return { kind, advice, rate };
}
