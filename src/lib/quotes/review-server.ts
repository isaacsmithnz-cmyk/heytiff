import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { SONNET_FALLBACK } from "@/lib/tiff/sonnet-fallback";
import { costOf, type TokenUsage } from "@/lib/tiff/usage";
import { orgTemplates } from "@/lib/templates/query";
import { readLines } from "./lines-server";
import { changeReview, readByHand, saveProposal } from "./lines-job-server";
import { linesFit, unitSpecsOf } from "./fit-server";
import { PAYMENT_PRESETS } from "./payment";
import {
  REVIEW_SCHEMA,
  answered,
  carried,
  fixesMessage,
  fixesSent,
  parseReviewRead,
  paymentFixOf,
  quoteStamp,
  reopened,
  reviewClear,
  reviewInput,
  reviewPrompt,
  ruleFindings,
  type QuoteReview,
  type ReviewFinding,
} from "./review";

/* TIFF'S CHECK, RUN AND ANSWERED (review.ts says what it is). Service
   role, by org; the quote's route gates who may. */

/** The model she checks on: the one she reads email and plans on, and
    quotes on, at a medium effort, as a check reads rather than builds. */
const MODEL = "claude-sonnet-5-5";

type Answer<T> = ({ ok: true } & T) | { ok: false; reason: string };

async function factsOf(orgId: string, cardId: string): Promise<{ business: string; client: string | null; site: string | null }> {
  const [{ data: job }, { data: org }] = await Promise.all([
    supabaseAdmin.from("sm8_jobs").select("company_uuid, job_address").eq("org_id", orgId).eq("uuid", cardId).maybeSingle(),
    supabaseAdmin.from("organizations").select("trading_name, name").eq("id", orgId).maybeSingle(),
  ]);
  const companyUuid = (job as { company_uuid: string | null } | null)?.company_uuid ?? null;
  const { data: company } = companyUuid ? await supabaseAdmin.from("sm8_companies").select("name").eq("org_id", orgId).eq("uuid", companyUuid).maybeSingle() : { data: null };
  const business = (((org as { trading_name: string | null } | null)?.trading_name || (org as { name: string | null } | null)?.name) ?? "this business").trim();
  const site = ((job as { job_address: string | null } | null)?.job_address ?? "").replace(/\s+/g, " ").trim() || null;
  return { business, client: ((company as { name: string | null } | null)?.name ?? "").trim() || null, site };
}

/** The check, run: the counted rules, then Tiff's read, kept on the quote.
    A check that still stands is handed back as it is, and nothing is spent. */
export async function runReview(orgId: string, cardId: string, by: string, client: Anthropic = new Anthropic()): Promise<Answer<{ review: QuoteReview }>> {
  const [lines, byHand, facts] = await Promise.all([readLines(orgId, cardId), readByHand(orgId, cardId), factsOf(orgId, cardId)]);
  if (lines.length === 0) return { ok: false, reason: "There's nothing on the quote to check." };
  const proposal = byHand.proposal ?? null;
  const stamp = quoteStamp(lines, proposal);
  const prior = byHand.review ?? null;
  if (prior && prior.stamp === stamp) return { ok: true, review: prior };

  const [fits, specs] = await Promise.all([linesFit(lines, orgId).catch(() => []), unitSpecsOf(lines, orgId).catch(() => new Map())]);
  const rules = ruleFindings({ lines, proposal, client: facts.client, fits });
  const keptBefore = (prior?.findings ?? []).filter((f) => f.state === "kept");
  const fixedBefore = (prior?.findings ?? []).filter((f) => f.state === "sent");

  let read: ReviewFinding[] = [];
  let usd: number | null = null;
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      ...SONNET_FALLBACK,
      output_config: { effort: "medium", format: { type: "json_schema", schema: REVIEW_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: reviewInput(lines, proposal, byHand.names, (l) => specs.get(l.id)?.coolKw ?? null) },
            { type: "text", text: reviewPrompt({ business: facts.business, client: facts.client, site: facts.site, kept: keptBefore, fixed: fixedBefore }) },
          ],
        },
      ],
    });
    usd = costOf(response.model, response.usage as unknown as TokenUsage);
    if (response.stop_reason !== "refusal") {
      const block = [...response.content].reverse().find((b) => b.type === "text");
      if (block && block.type === "text") read = parseReviewRead(JSON.parse(block.text), lines);
    }
  } catch (err) {
    console.error("[quote-review] Tiff's check failed:", err instanceof Error ? err.message : err);
    return { ok: false, reason: err instanceof Anthropic.RateLimitError ? "Tiff was busy. Try again in a minute." : "Tiff couldn't check the quote just now. Try again." };
  }

  /* her read's ids are this check's own, so a kept one from before keeps its */
  const tag = stamp.slice(0, 5);
  const fresh = [...rules, ...read.filter((f) => !(f.block === "payment" && rules.some((r) => r.id === "rule-payment"))).map((f) => ({ ...f, id: `${tag}-${f.id}` }))];
  const review: QuoteReview = { at: new Date().toISOString(), by, stamp, findings: carried(prior, fresh), usd };
  const saved = await changeReview(orgId, cardId, by, () => review);
  return saved.ok ? { ok: true, review } : saved;
}

/** One finding answered: a fix picked, kept with its reason, or opened again. */
export async function answerReview(orgId: string, cardId: string, by: string, id: unknown, pick: unknown, reason: unknown): Promise<Answer<{ review: QuoteReview }>> {
  const fid = typeof id === "string" ? id.slice(0, 40) : "";
  const choice = pick === "keep" || pick === "open" ? pick : typeof pick === "number" && Number.isInteger(pick) ? pick : null;
  if (!fid || choice === null) return { ok: false, reason: "That answer wasn't understood." };
  const got: { review: QuoteReview | null; problem: string | null } = { review: null, problem: null };
  const saved = await changeReview(orgId, cardId, by, (r) => {
    if (!r) {
      got.problem = "The quote hasn't been checked.";
      return r;
    }
    if (choice === "open") return (got.review = reopened(r, fid));
    const next = answered(r, fid, choice, typeof reason === "string" ? reason : "");
    if ("error" in next) {
      got.problem = next.error;
      return r;
    }
    return (got.review = next);
  });
  if (!saved.ok) return saved;
  if (got.problem || !got.review) return { ok: false, reason: got.problem ?? "That answer wasn't saved." };
  return { ok: true, review: got.review };
}

/** The fixes picked, done: a payment term set here, the rest as one
    message for Tiff, which the page hands her as the person's words. */
export async function applyReviewFixes(orgId: string, cardId: string, by: string): Promise<Answer<{ message: string; review: QuoteReview }>> {
  const byHand = await readByHand(orgId, cardId);
  const r = byHand.review ?? null;
  if (!r) return { ok: false, reason: "The quote hasn't been checked." };
  const payment = r.findings.map(paymentFixOf).find((p) => p !== null) ?? null;
  if (payment) {
    const terms = (await orgTemplates(orgId).catch(() => null))?.paymentTerms ?? PAYMENT_PRESETS;
    const stages = (terms[payment] ?? PAYMENT_PRESETS[payment]).stages.map((s) => ({ ...s }));
    const set = await saveProposal(orgId, cardId, { payment: { preset: payment, stages } }, by);
    if (!set.ok) return { ok: false, reason: set.reason };
  }
  const message = fixesMessage(r);
  const sent = fixesSent(r);
  const saved = await changeReview(orgId, cardId, by, () => sent);
  return saved.ok ? { ok: true, message, review: sent } : saved;
}

/** Whether the quote may be marked ready to send: checked as it stands now,
    with nothing in the check left but what was kept. */
export async function reviewLetsApprove(orgId: string, cardId: string): Promise<boolean> {
  const [lines, byHand] = await Promise.all([readLines(orgId, cardId), readByHand(orgId, cardId)]);
  return reviewClear(byHand.review ?? null, quoteStamp(lines, byHand.proposal ?? null));
}
