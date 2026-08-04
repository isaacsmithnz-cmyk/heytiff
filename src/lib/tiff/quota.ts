/* What a month of ingestion costs an org, and whether it may have another one.

   THE UNIT IS PAGES INGESTED PER ORG PER MONTH. It is legible to a customer
   ("1,240 of 2,000 pages this month"), and ingestion is where the money is —
   300 uploaded manuals is thousands of pages of keyword tagging and embedding,
   while asking questions is cents. Questions are COUNTED from day one so a
   ceiling later is a constant and a check rather than a migration, but nothing
   caps them yet.

   THE GATE LIVES IN THE INGEST LOOP, nowhere else. Over the line, the document
   parks at `paused` on its bookmark and resumes exactly there when the month
   rolls or the plan changes — never mid-batch, never lossy.

   MONTHS ARE AUSTRALIAN. Every AU state is ahead of UTC, so a UTC month
   boundary rolls the allowance over up to 11 hours early — on the last day of
   the month, for the whole working evening. `auMonthStart` derives the bucket
   from the same anchor everything else in the app counts days on. */

import { todayInAu } from "@/lib/au-dates";
import { supabaseAdmin } from "@/lib/supabase-server";

export type Plan = "trial" | "standard" | "pro" | "unlimited";

export const PLANS: readonly Plan[] = ["trial", "standard", "pro", "unlimited"];

/** Anything unrecognised (or a row from before the column existed) reads as
    the default tier rather than as no allowance at all — a bad enum should not
    look like a suspended account. */
export function asPlan(value: unknown): Plan {
  return PLANS.includes(value as Plan) ? (value as Plan) : "standard";
}

/* PLACEHOLDER NUMBERS — Isaac tunes these once real usage exists. They are
   deliberately round: the point of v1 is that a runaway upload can't quietly
   spend hundreds of dollars, not that the tiers are priced correctly. */
export const PAGE_QUOTAS: Record<Plan, number> = {
  trial: 200,
  standard: 2000,
  pro: 10000,
  unlimited: Infinity,
};

/** The first of the current month on the AU calendar, ISO yyyy-mm-01 — the
    key every kb_usage row is bucketed under. */
export function auMonthStart(now: Date = new Date()): string {
  return `${todayInAu(now).slice(0, 7)}-01`;
}

/** The month AFTER the one given — what a paused document is waiting for, and
    the date the library shows ("resumes 1 Sep"). */
export function nextMonthStart(monthISO: string): string {
  const [y, m] = monthISO.split("-").map(Number);
  return m >= 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Pages still allowed this month. Never negative: usage can overshoot by a
    part-batch, and "minus 3 pages remaining" is not a thing to render. */
export function pagesRemaining(plan: Plan, used: number): number {
  const cap = PAGE_QUOTAS[plan];
  if (cap === Infinity) return Infinity;
  return Math.max(0, cap - Math.max(0, used));
}

export type KbQuota = {
  plan: Plan;
  /** ISO yyyy-mm-01, AU calendar. */
  month: string;
  pagesUsed: number;
  questionsAsked: number;
  /** Infinity on the unlimited tier. */
  pagesAllowed: number;
  pagesRemaining: number;
  /** ISO date the allowance next resets. */
  resetsOn: string;
};

/* The org's standing this month. Two reads, both by primary key, because the
   ingest loop asks this on every batch — and it is also what the library line
   renders from, so the two can never disagree.

   A missing usage row is zero, not an error: the first batch of the month
   writes it. */
export async function kbQuotaFor(orgId: string, now: Date = new Date()): Promise<KbQuota> {
  const month = auMonthStart(now);

  const [org, usage] = await Promise.all([
    supabaseAdmin.from("organizations").select("plan").eq("id", orgId).maybeSingle(),
    supabaseAdmin
      .from("kb_usage")
      .select("pages_processed, questions_asked")
      .eq("org_id", orgId)
      .eq("month", month)
      .maybeSingle(),
  ]);

  const plan = asPlan(org.data?.plan);
  const pagesUsed = Number(usage.data?.pages_processed) || 0;

  return {
    plan,
    month,
    pagesUsed,
    questionsAsked: Number(usage.data?.questions_asked) || 0,
    pagesAllowed: PAGE_QUOTAS[plan],
    pagesRemaining: pagesRemaining(plan, pagesUsed),
    resetsOn: nextMonthStart(month),
  };
}

/** Add to this month's counters. Atomic in the database (kb_usage_add), so two
    batches finishing together can't lose a count — which would always
    undercount, which is the direction that costs money. */
export async function addKbUsage(
  orgId: string,
  counts: { pages?: number; questions?: number },
  now: Date = new Date()
): Promise<void> {
  await supabaseAdmin.rpc("kb_usage_add", {
    p_org: orgId,
    p_month: auMonthStart(now),
    p_pages: Math.max(0, Math.trunc(counts.pages ?? 0)),
    p_questions: Math.max(0, Math.trunc(counts.questions ?? 0)),
  });
}
