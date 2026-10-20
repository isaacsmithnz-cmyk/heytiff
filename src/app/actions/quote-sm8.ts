"use server";

/* THE JOB CARD'S QUOTE SECTION — sending the accepted quote to ServiceM8
   (Isaac, 2026-10-05: "if a quote is accepted, then it can turn that into
   the work order for service mate… copy the scope and line items").

   Everything here answers before any session or database read where the
   deployment doesn't send quotes (sm8QuotesAllowed), and asks
   workboard_manage and financials of whoever presses: every line is a price.

   WHAT GOES IS WORKED OUT HERE, from HeyTiff's own quote and the mirror —
   never from the browser's copy. And only when ServiceM8 still holds the job
   as it was when the quote was reviewed: the mirror's edit date the card saw
   must be the mirror's now, and ServiceM8's live one. Then one row per
   record goes through the quote queue's one door, sent in the foreground for
   a few seconds. */

import { can, requireOrg } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sm8QuotesAllowed } from "@/lib/integrations/sm8-kinds";
import { sm8PressFromSession } from "@/lib/integrations/sm8-press";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { offersSend, sendRefusal } from "@/lib/integrations/sm8-write-plan";
import { settlePressedWrites } from "@/lib/integrations/sm8-drain";
import { syncSm8AfterSend } from "@/lib/integrations/sm8-freshness";
import { sm8AccessResult } from "@/lib/integrations/sm8-store";
import { sm8CallOf } from "@/lib/integrations/sm8-http";
import { readSm8Raw } from "@/lib/integrations/sm8-write";
import { sameEditDate } from "@/lib/integrations/sm8-note-plan";
import { QUOTE_WORDS, quoteRows } from "@/lib/integrations/sm8-quote-plan";
import { readSm8SendView, readVariationSendView, type SendAs } from "@/lib/quotes/sm8-send-server";
import { markSent, markVariationSent } from "@/lib/quotes/lines-job-server";
import { planKey } from "@/lib/quotes/sm8-send-plan";
import { INVOICE_AGAIN, variationRows, variationSentLine } from "@/lib/quotes/sm8-variation-plan";
import type { Variation } from "@/lib/quotes/lines-job";
import { queueAcceptedQuote } from "./sm8-quote-queue";
import { quotesOnTrial } from "@/lib/integrations/sm8-quote-trial";
import { createHash } from "node:crypto";

const SEND_BUDGET_MS = 12_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function gate(): Promise<{ orgId: string } | { error: string }> {
  if (!sm8QuotesAllowed()) return { error: QUOTE_WORDS.card.quotesUnavailable };
  try {
    const { orgId } = await requireOrg("workboard_manage");
    if (!(await can("financials"))) return { error: QUOTE_WORDS.press.noManage };
    return { orgId };
  } catch {
    return { error: QUOTE_WORDS.press.noManage };
  }
}

/** Why a quote can't go now, said before anything is queued: the owner's
    switch, a pause, a reconnect, or ServiceM8's permission to change a
    job's lines (3414, 21 October: a grant without manage_job_materials
    queued "0 sent, 2 still going" for good). A quote on its own trial run
    goes nowhere, so it needs no permission. */
async function quoteHeld(orgId: string): Promise<string | null> {
  const held = sendRefusal(await readSm8WriteState(orgId), "quote");
  if (held === QUOTE_WORDS.press.scope && (await quotesOnTrial(orgId))) return null;
  return held;
}

/** Whether the card offers the send, and whether a press would only be a
    trial run. */
export async function quoteSendOffered(): Promise<{ offered: boolean; trial: boolean }> {
  const g = await gate();
  if ("error" in g) return { offered: false, trial: false };
  const state = await readSm8WriteState(g.orgId);
  /* quotes on their own trial run say so, however the connection is set */
  return { offered: offersSend(state, "quote"), trial: state.mode === "trial" || (await quotesOnTrial(g.orgId)) };
}

export type QuoteSendAnswer =
  | { ok: true; trial: boolean; sent: number; waiting: number; failed: string[] }
  | { ok: false; error: string };

export async function sendQuoteToSm8(
  jobUuid: string,
  pressId: string,
  seenEditDate: string | null,
  seenPlan: string | null,
  /** the accepted quote as a work order, or the approved one as a quote (7.3) */
  as: SendAs = "accepted"
): Promise<QuoteSendAnswer> {
  const startedAt = Date.now();
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  if (!UUID.test(jobUuid) || !UUID.test(pressId)) return { ok: false, error: QUOTE_WORDS.press.unqueued };

  const held = await quoteHeld(g.orgId);
  if (held) return { ok: false, error: held };

  const sendAs: SendAs = as === "quote" ? "quote" : "accepted";
  const view = await readSm8SendView(g.orgId, jobUuid, sendAs);
  if (!view.plan.ok) return { ok: false, error: view.plan.why };
  /* the plan as it was on screen: never lines the person wasn't shown */
  if (typeof seenPlan !== "string" || seenPlan !== planKey(view.plan)) return { ok: false, error: QUOTE_WORDS.press.quoteChanged };
  /* the mirror as the card saw it, and ServiceM8 as the mirror has it */
  if (!seenEditDate || !sameEditDate(view.editDate, seenEditDate)) return { ok: false, error: QUOTE_WORDS.press.changed };
  const access = await sm8AccessResult(g.orgId);
  if (!access.ok) return { ok: false, error: QUOTE_WORDS.press.unreadable };
  const liveJob = await readSm8Raw(sm8CallOf(access.access, "read"), "job", jobUuid);
  if (!liveJob.ok) return { ok: false, error: QUOTE_WORDS.press.unreadable };
  if (!liveJob.found || liveJob.active !== 1) return { ok: false, error: QUOTE_WORDS.row.gone };
  if (!sameEditDate(String(liveJob.row.edit_date ?? ""), view.editDate)) {
    syncSm8AfterSend(g.orgId);
    return { ok: false, error: QUOTE_WORDS.press.changed };
  }

  const press = await sm8PressFromSession();
  if (!press || press.orgId !== g.orgId) return { ok: false, error: QUOTE_WORDS.press.unqueued };
  const q = await queueAcceptedQuote(press, pressId, jobUuid, quoteRows(jobUuid, view.plan));
  if (!q.ok) return q;
  await settlePressedWrites(g.orgId, q.ids, { startedAt, budgetMs: SEND_BUDGET_MS });
  const { data } = await supabaseAdmin.from("sm8_writes").select("id, status, last_error").eq("org_id", g.orgId).in("id", q.ids);
  const rows = (data ?? []) as { id: string; status: string; last_error: string | null }[];
  /* job lines get no live updates: read what landed back now */
  if (rows.some((r) => r.status === "sent")) syncSm8AfterSend(g.orgId);
  const trial = rows.length > 0 && rows.every((r) => r.status === "trial");
  /* the quote marked sent, on its progress line: a trial run says so */
  if (sendAs === "quote" && (trial || rows.some((r) => r.status === "sent"))) await markSent(g.orgId, jobUuid, press.userId, trial).catch(() => null);
  return {
    ok: true,
    trial,
    sent: rows.filter((r) => r.status === "sent").length,
    waiting: rows.filter((r) => r.status === "queued" || r.status === "sending").length,
    failed: rows.filter((r) => r.status === "failed" || r.status === "cancelled").map((r) => r.last_error ?? QUOTE_WORDS.row.refused),
  };
}

/* AN ACCEPTED VARIATION, ADDED TO THE JOB IN SERVICEM8 (Isaac, 2026-10-18,
   decision 21: extra lines on the original job). The quote page presses it
   the moment a variation is marked accepted, and its rail offers it again
   while it hasn't all gone. The accepted quote's own door, gates and queue
   (`queueAcceptedQuote`, kind "quote"), with only lines added: the job
   record is never written and no line comes off (sm8-variation-plan.ts).

   ONCE. The press id is the variation's own, the same on every press (the
   job, the option, when it was started), so each line is one queue row
   for good: a line that went is "already" to every later press, and only
   a line that failed or was a trial run goes again. A variation whose
   lines all went for real queues nothing (variationInSm8). What went, on
   which job and under which uuids, is kept on the variation. */

export type VariationSendAnswer =
  | { ok: true; trial: boolean; sent: number; lines: number; waiting: number; failed: string[]; invoiced: boolean; said: string }
  | { ok: false; error: string };

/** The variation's own press id: a uuid's shape, the same for every press
    of this variation, and new for a variation started again in its place. */
function variationPressId(orgId: string, jobUuid: string, v: Pick<Variation, "option" | "n" | "startedAt">): string {
  const h = createHash("sha256").update(`variation:${orgId}:${jobUuid.toLowerCase()}:${v.option}:${v.n}:${v.startedAt}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function sendVariationToSm8(jobUuid: string, option: number): Promise<VariationSendAnswer> {
  const startedAt = Date.now();
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  if (!UUID.test(jobUuid) || !Number.isInteger(option) || option < 1 || option > 19) return { ok: false, error: QUOTE_WORDS.press.unqueued };
  const held = await quoteHeld(g.orgId);
  if (held) return { ok: false, error: held };

  const view = await readVariationSendView(g.orgId, jobUuid, option);
  if (!view.plan.ok || !view.variation) return { ok: false, error: view.plan.ok ? "That option isn't a variation." : view.plan.why };
  const plan = view.plan;
  const v = view.variation;

  /* ServiceM8 as it is now: the job there, and live */
  const access = await sm8AccessResult(g.orgId);
  if (!access.ok) return { ok: false, error: QUOTE_WORDS.press.unreadable };
  const liveJob = await readSm8Raw(sm8CallOf(access.access, "read"), "job", jobUuid);
  if (!liveJob.ok) return { ok: false, error: QUOTE_WORDS.press.unreadable };
  if (!liveJob.found || liveJob.active !== 1) return { ok: false, error: QUOTE_WORDS.row.gone };

  const press = await sm8PressFromSession();
  if (!press || press.orgId !== g.orgId) return { ok: false, error: QUOTE_WORDS.press.unqueued };
  const q = await queueAcceptedQuote(press, variationPressId(g.orgId, jobUuid, v), jobUuid, variationRows(plan));
  if (!q.ok) return q;
  await settlePressedWrites(g.orgId, q.ids, { startedAt, budgetMs: SEND_BUDGET_MS });

  /* every row of this variation, the ones an earlier press sent too */
  const subjects = variationRows(plan).map((r) => `quote:${variationPressId(g.orgId, jobUuid, v)}:${r.key}`);
  const { data } = await supabaseAdmin.from("sm8_writes").select("id, status, last_error, remote_uuid").eq("org_id", g.orgId).in("subject", subjects);
  const rows = (data ?? []) as { id: string; status: string; last_error: string | null; remote_uuid: string | null }[];
  if (rows.some((r) => r.status === "sent")) syncSm8AfterSend(g.orgId);
  const trial = rows.length > 0 && rows.every((r) => r.status === "trial");
  const sent = rows.filter((r) => r.status === "sent");
  const waiting = rows.filter((r) => r.status === "queued" || r.status === "sending").length;
  const record = {
    at: new Date().toISOString(),
    by: press.userId,
    trial,
    jobNumber: plan.jobNumber,
    lines: plan.lines.length,
    sent: sent.length,
    /* the uuid each line went under: what a take-back names */
    lineUuids: rows.flatMap((r) => (r.remote_uuid && r.status !== "cancelled" && r.status !== "failed" && r.status !== "trial" ? [r.remote_uuid] : [])),
  };
  await markVariationSent(g.orgId, jobUuid, option, record, press.userId).catch(() => null);
  return {
    ok: true,
    trial,
    sent: sent.length,
    lines: plan.lines.length,
    waiting,
    failed: rows.filter((r) => r.status === "failed" || r.status === "cancelled").map((r) => r.last_error ?? QUOTE_WORDS.row.refused),
    invoiced: plan.invoiced,
    said: [variationSentLine({ sm8: record }) ?? "", plan.invoiced && !trial && sent.length > 0 ? INVOICE_AGAIN : ""].filter(Boolean).join(" "),
  };
}
