import "server-only";
import type { BuildUp } from "./buildup";
import type { Profit } from "./profit";
import { readLines } from "./lines-server";
import { buildLineOf, priceLines, stillUnknown, type LabourFrom, type Unpriced } from "./lines-price";
import { buildSettingsOf, type BuildUnset } from "./build-settings";
import { readOrgDay } from "./org-day-server";
import { recordQuoteItems } from "./book-view-server";
import { readQuoteSettings } from "./settings-query";
import { byHandOf, optionNames } from "./lines-job";
import { supabaseAdmin } from "@/lib/supabase-server";

/* A JOB'S QUOTE, PRICED, OPTION BY OPTION, from its own kept lines
   (lines-price.ts), at this business's own markups and day
   (build-settings.ts what it's built on). Two options are two quotes on one
   page (Isaac, 2026-10-05). Every read is this org's. Buy prices are the
   business's money: the route gates on `financials`. Service role. */

/** `profit`: against the business's target; null when it has no target and
    no hour's cost to reckon one by (profit.ts). */
export type OptionPrice = { name: string; build: BuildUp; unpriced: Unpriced[]; rows: number; labourFrom: LabourFrom; profit?: Profit | null };

/** `chargeOutCents`: the business's rate, so the quote card can say what
    the duct contingency's hours come to (quote-sum.ts). */
export type QuotePrice =
  | { ok: false; unset: BuildUnset[] }
  | { ok: true; options: OptionPrice[]; chargeOutCents: number };

export async function readQuotePrice(orgId: string, jobUuid: string): Promise<QuotePrice> {
  const [settings, day] = await Promise.all([readQuoteSettings(orgId), readOrgDay(orgId)]);
  const built = buildSettingsOf(settings, day);
  if (!built.ok) return { ok: false, unset: built.unset };
  const [lines, raw] = await Promise.all([
    readLines(orgId, jobUuid),
    supabaseAdmin.from("quote_drafts").select("draft").eq("org_id", orgId).eq("sm8_job_uuid", jobUuid).maybeSingle(),
  ]);
  const draft = (raw.data as { draft: unknown } | null)?.draft ?? null;
  const byHand = byHandOf(draft);
  const options = priceLines(lines, optionNames(draft, byHand), built.settings, { pct: settings.profitTargetPct, labourCostCents: settings.labourCostCents }, byHand.loading);
  /* what this quote pulled from the price book, for the price book's Most used */
  const parts = lines.filter((l) => l.kind !== "labour" && !stillUnknown(l)).map(buildLineOf);
  if (parts.length > 0) await recordQuoteItems(orgId, jobUuid, parts);
  return { ok: true, options, chargeOutCents: built.settings.chargeOutCents };
}
