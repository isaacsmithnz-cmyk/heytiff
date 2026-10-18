import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { stillToPrice } from "./lines-price";
import { readJobQuote } from "./lines-job-server";
import { readQuotePrice } from "./quote-price-server";
import { readQuoteSettings } from "./settings-query";
import { sendAsQuotePlan, sendPlan, usualTaxRate, type SendPlan } from "./sm8-send-plan";
import { readByHand } from "./lines-job-server";
import { approvalStands } from "./lines-proposal";
import type { Variation } from "./lines-job";
import { variationLines, variationSendPlan, type VariationSendPlan } from "./sm8-variation-plan";

/* What one press would send to ServiceM8 for a job's accepted quote
   (sm8-send-plan.ts says what and why), read for the card to show before
   anything is sent. Reads only: HeyTiff's own quote and prices, and the
   ServiceM8 mirror — the job's status, whether it's invoiced, its live
   lines, and the tax rate the business's own lines use. Service role, by
   org; the route gates on money access. */

/** The plan, and the job's edit date in the mirror it was read against: a
    send checks ServiceM8 still holds that before anything is queued. */
export type SendView = { plan: SendPlan; editDate: string | null };

/** What goes: the accepted quote as a work order, or (slice 7.3) the
    approved quote as a quote, before it's accepted. */
export type SendAs = "accepted" | "quote";

export async function readSm8SendView(orgId: string, cardId: string, as: SendAs = "accepted"): Promise<SendView> {
  const [quote, price, settings, job, lines, rates] = await Promise.all([
    readJobQuote(orgId, cardId),
    readQuotePrice(orgId, cardId),
    readQuoteSettings(orgId),
    supabaseAdmin.from("sm8_jobs").select("status, invoice_sent, edit_date").eq("org_id", orgId).eq("uuid", cardId).maybeSingle(),
    supabaseAdmin.from("sm8_job_materials").select("uuid, name, active").eq("org_id", orgId).eq("job_uuid", cardId),
    supabaseAdmin.from("sm8_job_materials").select("tax_rate_uuid").eq("org_id", orgId).eq("active", 1).limit(2000),
  ]);
  const row = job.data as { status: string | null; invoice_sent: number | boolean | null; edit_date: string | null } | null;
  const editDate = row?.edit_date ?? null;
  if (!quote) return { plan: { ok: false, why: "There's no quote on this job." }, editDate };
  if (!price.ok) return { plan: { ok: false, why: "The quote can't be priced yet: set what Quoting asks for." }, editDate };
  if (!row) return { plan: { ok: false, why: "That job isn't in HeyTiff's copy of ServiceM8." }, editDate };
  const existing = ((lines.data ?? []) as { uuid: string; name: string | null; active: number | boolean | null }[])
    .filter((l) => l.active !== 0 && l.active !== false)
    .map((l) => ({ uuid: l.uuid, name: l.name ?? "" }));
  const taxRateUuid = usualTaxRate(((rates.data ?? []) as { tax_rate_uuid: string | null }[]).map((r) => r.tax_rate_uuid));
  const jobNow = { status: row.status, invoiced: row.invoice_sent === true || row.invoice_sent === 1 };
  if (as === "quote") {
    /* a quote built on its lines: its approval, and every option but a variation */
    if (!quote.lines) return { plan: { ok: false, why: "Only a quote built on its lines is sent as a quote." }, editDate };
    const byHand = await readByHand(orgId, cardId);
    const varied = new Set(byHand.variations.map((v) => v.option));
    const approved = !!byHand.proposal && approvalStands(byHand.proposal, quote.lines.map((l) => l.updatedAt));
    const plan = sendAsQuotePlan({
      draft: quote.draft,
      options: price.options.flatMap((o, index) =>
        varied.has(index) ? [] : [{ index, build: o.build, left: stillToPrice({ unpriced: o.unpriced, labourFrom: o.labourFrom, labourCents: o.build.labour.sellCents }).length }]
      ),
      approved,
      job: jobNow,
      existing,
      taxRateUuid,
    });
    return { plan, editDate };
  }
  const accepted = quote.draft.accepted.length
    ? quote.draft.accepted
    : quote.draft.options.length === 1
      ? [0]
      : [];
  /* an accepted variation's lines were added beside the quote's, and stay
     (decision 21): the accepted quote sent again never takes them off */
  const theirs = quote.lines ? new Set((await readByHand(orgId, cardId)).variations.flatMap((v) => v.sm8?.lineUuids ?? []).map((u) => u.toLowerCase())) : new Set<string>();
  const plan = sendPlan({
    draft: quote.draft,
    accepted: accepted.flatMap((index) => {
      const o = price.options[index];
      return o ? [{ index, build: o.build, left: stillToPrice({ unpriced: o.unpriced, labourFrom: o.labourFrom, labourCents: o.build.labour.sellCents }).length }] : [];
    }),
    showLines: quote.draft.showLines ?? settings.showLines,
    job: jobNow,
    existing: existing.filter((e) => !theirs.has(e.uuid.toLowerCase())),
    taxRateUuid,
  });
  return { plan, editDate };
}

/** What one send of an accepted variation would add to the job in
    ServiceM8 (sm8-variation-plan.ts), read at the press: the variation and
    the accepted option it varies, both priced, the job as the mirror holds
    it (its status, whether its invoice went, its number), how many live
    lines it has, and the tax rate the business's own lines use. Reads only. */
export type VariationSendView = { plan: VariationSendPlan; variation: Variation | null };

export async function readVariationSendView(orgId: string, cardId: string, option: number): Promise<VariationSendView> {
  const [quote, price, settings, byHand, job, lines, rates] = await Promise.all([
    readJobQuote(orgId, cardId),
    readQuotePrice(orgId, cardId),
    readQuoteSettings(orgId),
    readByHand(orgId, cardId),
    supabaseAdmin.from("sm8_jobs").select("status, invoice_sent, generated_job_id").eq("org_id", orgId).eq("uuid", cardId).maybeSingle(),
    supabaseAdmin.from("sm8_job_materials").select("uuid, active").eq("org_id", orgId).eq("job_uuid", cardId),
    supabaseAdmin.from("sm8_job_materials").select("tax_rate_uuid").eq("org_id", orgId).eq("active", 1).limit(2000),
  ]);
  const variation = byHand.variations.find((v) => v.option === option) ?? null;
  const no = (why: string): VariationSendView => ({ plan: { ok: false, why }, variation });
  if (!quote?.lines) return no("There's no quote built on its lines on this job.");
  if (!price.ok) return no("The quote can't be priced yet: set what Quoting asks for.");
  const row = job.data as { status: string | null; invoice_sent: number | boolean | null; generated_job_id: string | null } | null;
  if (!row) return no("That job isn't in HeyTiff's copy of ServiceM8.");
  const base = variation ? price.options[variation.of] : undefined;
  const varied = variation ? price.options[variation.option] : undefined;
  if (variation && (!base || !varied)) return no(`Variation ${variation.n} can't be priced yet.`);
  const live = ((lines.data ?? []) as { uuid: string; active: number | boolean | null }[]).filter((l) => l.active !== 0 && l.active !== false).length;
  const plan = variationSendPlan({
    variation,
    lines:
      variation && base && varied
        ? variationLines({ draft: quote.draft, variation, base: base.build, varied: varied.build, showLines: quote.draft.showLines ?? settings.showLines })
        : [],
    /* as the quote page counts a variation priced: its lines, since a
       variation may add no labour */
    left: varied ? varied.unpriced.length : 0,
    job: { status: row.status, invoiced: row.invoice_sent === true || row.invoice_sent === 1, number: row.generated_job_id ?? null },
    existing: live,
    taxRateUuid: usualTaxRate(((rates.data ?? []) as { tax_rate_uuid: string | null }[]).map((r) => r.tax_rate_uuid)),
  });
  return { plan, variation };
}
