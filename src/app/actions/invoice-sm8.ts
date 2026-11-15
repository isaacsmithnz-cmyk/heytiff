"use server";

/* THE INVOICE BUILDER'S SEND (the job page plan's build 10): the lines a
   person ticked on Price's New invoice, put on the job in ServiceM8 as its
   own lines, and nothing else. ServiceM8 makes the invoice from the job's
   lines and sends it; HeyTiff never sends an invoice, and Xero is never
   touched here. Only by a person's press of Send to ServiceM8: the press is
   the session's, and the queue refuses a browser's copy of one.

   The draft is read again here, so what goes is what the server worked out
   for the lines named, never a figure the browser sent. It goes through the
   accepted quote's one door (sm8-quote-queue), under the job's own invoice
   press: a line sent once is the same row the next time, so pressing twice
   never puts a day on the job twice. */

import { can, requireOrg } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { Capability } from "@/lib/permissions";
import { sm8QuotesAllowed } from "@/lib/integrations/sm8-kinds";
import { sm8PressFromSession } from "@/lib/integrations/sm8-press";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { sendRefusal } from "@/lib/integrations/sm8-write-plan";
import { settlePressedWrites } from "@/lib/integrations/sm8-drain";
import { syncSm8AfterSend } from "@/lib/integrations/sm8-freshness";
import { sm8AccessResult } from "@/lib/integrations/sm8-store";
import { sm8CallOf } from "@/lib/integrations/sm8-http";
import { readSm8Raw } from "@/lib/integrations/sm8-write";
import { QUOTE_WORDS } from "@/lib/integrations/sm8-quote-plan";
import { quotesOnTrial } from "@/lib/integrations/sm8-quote-trial";
import { invoicePressId, invoiceRowKey, readInvoiceDraft } from "@/lib/jobs/invoice-draft-server";
import { invoiceRows } from "@/lib/jobs/invoice-draft";
import { queueAcceptedQuote } from "./sm8-quote-queue";

const SEND_BUDGET_MS = 12_000;
/** Said once lines are on a job whose invoice went before them. */
const INVOICE_AGAIN = "The job's invoice went before these lines: send it again from ServiceM8 to bill them.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InvoiceSendAnswer =
  | { ok: true; trial: boolean; sent: number; lines: number; waiting: number; failed: string[]; said: string }
  | { ok: false; error: string };

export async function sendInvoiceToSm8(jobUuid: string, keys: string[]): Promise<InvoiceSendAnswer> {
  const startedAt = Date.now();
  if (!sm8QuotesAllowed()) return { ok: false, error: QUOTE_WORDS.card.quotesUnavailable };
  let orgId: string;
  try {
    ({ orgId } = await requireOrg("workboard_money"));
    if (!(await can("financials"))) return { ok: false, error: QUOTE_WORDS.press.noManage };
  } catch {
    return { ok: false, error: QUOTE_WORDS.press.noManage };
  }
  const chosen = new Set((Array.isArray(keys) ? keys : []).filter((k) => typeof k === "string").slice(0, 200));
  if (!UUID.test(jobUuid) || chosen.size === 0) return { ok: false, error: "Tick the lines to put on the job first." };

  const held = sendRefusal(await readSm8WriteState(orgId), "quote");
  if (held && !(held === QUOTE_WORDS.press.scope && (await quotesOnTrial(orgId)))) return { ok: false, error: held };

  const read = await readInvoiceDraft(orgId, new Set<Capability>(["workboard", "workboard_money", "financials"]), jobUuid);
  if (!read) return { ok: false, error: "That job isn't in HeyTiff's copy of ServiceM8." };
  if (!read.draft.ok) return { ok: false, error: read.draft.why };
  if (!read.taxRateUuid) return { ok: false, error: "HeyTiff doesn't know the tax rate the business's lines use in ServiceM8 yet." };
  const lines = read.draft.lines.filter((l) => chosen.has(l.key));
  if (lines.length === 0) return { ok: false, error: "Those lines are on the job already, or have no price." };

  /* ServiceM8 as it is now: the job there, and live */
  const access = await sm8AccessResult(orgId);
  if (!access.ok) return { ok: false, error: QUOTE_WORDS.press.unreadable };
  const liveJob = await readSm8Raw(sm8CallOf(access.access, "read"), "job", read.cardId);
  if (!liveJob.ok) return { ok: false, error: QUOTE_WORDS.press.unreadable };
  if (!liveJob.found || liveJob.active !== 1) return { ok: false, error: QUOTE_WORDS.row.gone };

  const press = await sm8PressFromSession();
  if (!press || press.orgId !== orgId) return { ok: false, error: QUOTE_WORDS.press.unqueued };
  const { count } = await supabaseAdmin.from("sm8_job_materials").select("uuid", { count: "exact", head: true }).eq("org_id", orgId).eq("job_uuid", read.cardId).eq("active", 1);
  const rows = invoiceRows(lines, { taxRateUuid: read.taxRateUuid, after: count ?? 0, rowKey: invoiceRowKey });
  if (rows.length === 0) return { ok: false, error: "Those lines are on the job already, or have no price." };
  const pressId = invoicePressId(orgId, read.cardId);
  const q = await queueAcceptedQuote(press, pressId, read.cardId, rows);
  if (!q.ok) return q;
  await settlePressedWrites(orgId, q.ids, { startedAt, budgetMs: SEND_BUDGET_MS });

  const { data } = await supabaseAdmin
    .from("sm8_writes")
    .select("status, last_error")
    .eq("org_id", orgId)
    .in(
      "subject",
      rows.map((r) => `quote:${pressId}:${r.key}`)
    );
  const states = (data ?? []) as { status: string; last_error: string | null }[];
  if (states.some((r) => r.status === "sent")) syncSm8AfterSend(orgId);
  const trial = states.length > 0 && states.every((r) => r.status === "trial");
  const sent = states.filter((r) => r.status === "sent").length;
  const waiting = states.filter((r) => r.status === "queued" || r.status === "sending").length;
  const on = read.draft.jobNumber ? `job ${read.draft.jobNumber}` : "the job";
  const said = trial
    ? `Trial run: ${rows.length} ${rows.length === 1 ? "line" : "lines"} for ${on} checked, and nothing went to ServiceM8.`
    : [`${sent} of ${rows.length} ${rows.length === 1 ? "line" : "lines"} on ${on} in ServiceM8.`, read.draft.invoiced && sent > 0 ? INVOICE_AGAIN : ""].filter(Boolean).join(" ");
  return {
    ok: true,
    trial,
    sent,
    lines: rows.length,
    waiting,
    failed: states.filter((r) => r.status === "failed" || r.status === "cancelled").map((r) => r.last_error ?? QUOTE_WORDS.row.refused),
    said,
  };
}
