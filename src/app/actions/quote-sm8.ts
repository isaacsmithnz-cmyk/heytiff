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
import { offersSend } from "@/lib/integrations/sm8-write-plan";
import { settlePressedWrites } from "@/lib/integrations/sm8-drain";
import { syncSm8AfterSend } from "@/lib/integrations/sm8-freshness";
import { sm8AccessResult } from "@/lib/integrations/sm8-store";
import { sm8CallOf } from "@/lib/integrations/sm8-http";
import { readSm8Raw } from "@/lib/integrations/sm8-write";
import { sameEditDate } from "@/lib/integrations/sm8-note-plan";
import { QUOTE_WORDS, quoteRows } from "@/lib/integrations/sm8-quote-plan";
import { readSm8SendView } from "@/lib/quotes/sm8-send-server";
import { queueAcceptedQuote } from "./sm8-quote-queue";

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

/** Whether the card offers the send, and whether a press would only be a
    trial run. */
export async function quoteSendOffered(): Promise<{ offered: boolean; trial: boolean }> {
  const g = await gate();
  if ("error" in g) return { offered: false, trial: false };
  const state = await readSm8WriteState(g.orgId);
  return { offered: offersSend(state, "quote"), trial: state.mode === "trial" };
}

export type QuoteSendAnswer =
  | { ok: true; trial: boolean; sent: number; waiting: number; failed: string[] }
  | { ok: false; error: string };

export async function sendQuoteToSm8(jobUuid: string, pressId: string, seenEditDate: string | null): Promise<QuoteSendAnswer> {
  const startedAt = Date.now();
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  if (!UUID.test(jobUuid) || !UUID.test(pressId)) return { ok: false, error: QUOTE_WORDS.press.unqueued };

  const view = await readSm8SendView(g.orgId, jobUuid);
  if (!view.plan.ok) return { ok: false, error: view.plan.why };
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
  return {
    ok: true,
    trial: rows.length > 0 && rows.every((r) => r.status === "trial"),
    sent: rows.filter((r) => r.status === "sent").length,
    waiting: rows.filter((r) => r.status === "queued" || r.status === "sending").length,
    failed: rows.filter((r) => r.status === "failed" || r.status === "cancelled").map((r) => r.last_error ?? QUOTE_WORDS.row.refused),
  };
}
