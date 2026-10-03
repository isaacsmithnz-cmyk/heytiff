import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { hydrateState, runEngine } from "@/components/rate-calculator/state";
import { orgDayOf, type CalcDay, type OrgDay } from "./org-day";
import { readQuoteSettings } from "./settings-query";

/* The business's day, read from its own settings: the Quoting page's rate
   and hours, else its Rate Calculator's (org-day.ts says the rule). Service
   role; callers gate on `financials` before showing a rate. */

/** What the business's Rate Calculator says; null when it has none. */
export async function readCalcDay(orgId: string): Promise<CalcDay | null> {
  const { data, error } = await supabaseAdmin.from("rate_calc_state").select("state").eq("org_id", orgId).maybeSingle();
  if (error || !data) return null;
  const s = hydrateState((data as { state: unknown }).state);
  const charged = s.currentRates.install;
  const run = runEngine(s);
  const rec = run.ready ? run.calc.recInst : null;
  const hours = s.settings.working_hours;
  return {
    chargedCents: typeof charged === "number" && charged > 0 ? Math.round(charged * 100) : null,
    recommendedCents: typeof rec === "number" && rec > 0 ? Math.round(rec * 100) : null,
    workingHours: typeof hours === "number" && hours > 0 ? hours : null,
  };
}

export async function readOrgDay(orgId: string): Promise<OrgDay> {
  const [settings, calc] = await Promise.all([readQuoteSettings(orgId), readCalcDay(orgId)]);
  return orgDayOf(settings, calc);
}
