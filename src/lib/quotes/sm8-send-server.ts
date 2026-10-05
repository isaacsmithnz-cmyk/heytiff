import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { stillToPrice } from "./job-price";
import { readStoredProposal } from "./proposal-writer";
import { readQuotePrice } from "./quote-price-server";
import { readQuoteSettings } from "./settings-query";
import { sendPlan, usualTaxRate, type SendPlan } from "./sm8-send-plan";

/* What one press would send to ServiceM8 for a job's accepted quote
   (sm8-send-plan.ts says what and why), read for the card to show before
   anything is sent. Reads only: HeyTiff's own quote and prices, and the
   ServiceM8 mirror — the job's status, whether it's invoiced, its live
   lines, and the tax rate the business's own lines use. Service role, by
   org; the route gates on money access. */

export async function readSm8SendPlan(orgId: string, cardId: string): Promise<SendPlan> {
  const [proposal, price, settings, job, lines, rates] = await Promise.all([
    readStoredProposal(orgId, cardId),
    readQuotePrice(orgId, cardId),
    readQuoteSettings(orgId),
    supabaseAdmin.from("sm8_jobs").select("status, invoice_sent").eq("org_id", orgId).eq("uuid", cardId).maybeSingle(),
    supabaseAdmin.from("sm8_job_materials").select("uuid, name, active").eq("org_id", orgId).eq("job_uuid", cardId),
    supabaseAdmin.from("sm8_job_materials").select("tax_rate_uuid").eq("org_id", orgId).eq("active", 1).limit(2000),
  ]);
  if (!proposal) return { ok: false, why: "There's no quote on this job." };
  if (!price.ok) return { ok: false, why: "The quote can't be priced yet: set what Quoting asks for." };
  const row = job.data as { status: string | null; invoice_sent: number | boolean | null } | null;
  if (!row) return { ok: false, why: "That job isn't in HeyTiff's copy of ServiceM8." };
  const accepted = proposal.draft.accepted.length
    ? proposal.draft.accepted
    : proposal.draft.options.length === 1
      ? [0]
      : [];
  return sendPlan({
    draft: proposal.draft,
    accepted: accepted.flatMap((index) => {
      const o = price.options[index];
      return o ? [{ index, build: o.build, left: stillToPrice({ unpriced: o.unpriced, labourFrom: price.labourFrom, labourCents: o.build.labour.sellCents }).length }] : [];
    }),
    showLines: proposal.draft.showLines ?? settings.showLines,
    job: { status: row.status, invoiced: row.invoice_sent === true || row.invoice_sent === 1 },
    existing: ((lines.data ?? []) as { uuid: string; name: string | null; active: number | boolean | null }[])
      .filter((l) => l.active !== 0 && l.active !== false)
      .map((l) => ({ uuid: l.uuid, name: l.name ?? "" })),
    taxRateUuid: usualTaxRate(((rates.data ?? []) as { tax_rate_uuid: string | null }[]).map((r) => r.tax_rate_uuid)),
  });
}
