import "server-only";

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import type { Capability } from "@/lib/permissions";
import type { MobileCtx } from "@/lib/mobile/auth";
import { readJobMoney } from "@/lib/mobile/job-money";
import { resolveJobCard, readJobLedger } from "@/lib/workboard/all-jobs-query";
import { isPartialInvoiceLine } from "@/lib/workboard/job-family";
import { readLines } from "@/lib/quotes/lines-server";
import { readByHand } from "@/lib/quotes/lines-job-server";
import { bookProducts } from "@/lib/quotes/book-view-server";
import { bookPrice } from "@/lib/quotes/session/tools";
import { readQuoteSettings } from "@/lib/quotes/settings-query";
import { readOrgDay } from "@/lib/quotes/org-day-server";
import { usualTaxRate } from "@/lib/quotes/sm8-send-plan";
import { invoiceDraft, usedKey, type InvoiceDraft } from "./invoice-draft";

/* THE INVOICE BUILDER'S READ (invoice-draft.ts has the rules): the hours on
   site as the phone and the Job tracker count them (job-money), what was
   said used (job_materials_used, read only), the book's costs, the
   business's charge-out rate and markup on materials, whether the job is
   priced in ServiceM8 already, and what an earlier press put on it. Money,
   so its route and its send hold `workboard_money` and `financials`. */

/** The press every send of a job's invoice lines goes under: the same for
    every press on the job, so the same line twice is the same row. A uuid's
    shape, as the queue wants. */
export function invoicePressId(orgId: string, cardId: string): string {
  const h = createHash("sha256").update(`invoice:${orgId}:${cardId.toLowerCase()}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A line's key as the queue's subject holds it: short, and only the
    characters a subject takes. */
export const invoiceRowKey = (lineKey: string) => `inv-${createHash("sha256").update(lineKey).digest("hex").slice(0, 16)}`;

export type InvoiceDraftRead = { draft: InvoiceDraft; taxRateUuid: string | null; cardId: string };

type UsedRow = { day: string; supplier_key: string | null; code: string | null; name: string; qty: number | string; unit: string | null };

export async function readInvoiceDraft(orgId: string, caps: ReadonlySet<Capability>, jobId: string): Promise<InvoiceDraftRead | null> {
  const { parentRemoteId: cardId } = await resolveJobCard(orgId, jobId.trim().slice(0, 80));
  const ctx = { userId: "", orgId, role: null, caps: new Set(caps), orgIds: [orgId] } satisfies MobileCtx;
  const pressId = invoicePressId(orgId, cardId);
  const [money, job, used, ledger, byHand, lines, products, settings, day, writes, rates] = await Promise.all([
    readJobMoney(ctx, cardId),
    supabaseAdmin.from("sm8_jobs").select("invoice_sent, generated_job_id").eq("org_id", orgId).eq("uuid", cardId).maybeSingle(),
    supabaseAdmin
      .from("job_materials_used")
      .select("day, supplier_key, code, name, qty, unit")
      .eq("org_id", orgId)
      .in("sm8_job_uuid", [...new Set([cardId, cardId.toLowerCase(), cardId.toUpperCase()])])
      .is("removed_at", null)
      .limit(1000),
    readJobLedger(orgId, cardId),
    readByHand(orgId, cardId).catch(() => null),
    readLines(orgId, cardId).catch(() => []),
    bookProducts(orgId).catch(() => []),
    readQuoteSettings(orgId),
    readOrgDay(orgId).catch(() => null),
    supabaseAdmin.from("sm8_writes").select("subject, status, remote_uuid").eq("org_id", orgId).like("subject", `quote:${pressId}:%`),
    supabaseAdmin.from("sm8_job_materials").select("tax_rate_uuid").eq("org_id", orgId).eq("active", 1).limit(2000),
  ]);
  if (!money || !job.data) return null;
  const row = job.data as { invoice_sent: number | boolean | null; generated_job_id: string | null };

  /* what an earlier press put on the job, by the row's key; a trial run,
     a cancelled or a failed row put nothing there */
  const live = ((writes.data ?? []) as { subject: string; status: string; remote_uuid: string | null }[]).filter(
    (w) => w.status !== "cancelled" && w.status !== "failed" && w.status !== "trial"
  );
  const sentRows = new Set(live.map((w) => w.subject.slice(`quote:${pressId}:`.length)));
  const ours = new Set(live.flatMap((w) => (w.remote_uuid ? [w.remote_uuid.toLowerCase()] : [])));

  /* PRICED ALREADY: a line on the job that isn't a claim's and isn't ours */
  const priced = ledger.materials.some((m) => !isPartialInvoiceLine(m) && !ours.has(m.remoteId.toLowerCase()));
  const accepted = byHand?.accepted ?? [];
  const codes = accepted.length > 0 ? lines.filter((l) => accepted.includes(l.optionIndex) && l.code).map((l) => l.code!) : [];

  const usedRows = ((used.data ?? []) as UsedRow[]).map((u) => ({ day: u.day, supplier: u.supplier_key, code: u.code, name: u.name, qty: Number(u.qty) || 0, unit: u.unit }));
  const draft = invoiceDraft({
    people: money.labour.people.map((p) => ({ name: p.name, days: p.days })),
    used: usedRows,
    costOf: (u) => {
      const p = u.code ? bookPrice(products, u.code, u.unit === "m" ? "m" : "", u.supplier) : null;
      return p ? { costCents: p.costCents, name: p.name } : null;
    },
    settings: { chargeOutCents: day?.rate?.perHourCents ?? null, materialMarkupPct: settings.materialMarkupPct },
    quote: priced || accepted.length > 0 ? { codes } : null,
    /* a line is sent when its row is, so the draft hands its own keys */
    sent: new Set(
      [...usedRows.map(usedKey), ...money.labour.people.flatMap((p) => p.days.map((d) => `labour:${d.day}`))].filter((k) => sentRows.has(invoiceRowKey(k)))
    ),
    invoiced: row.invoice_sent === true || row.invoice_sent === 1,
    jobNumber: row.generated_job_id ?? null,
  });
  return { draft, cardId, taxRateUuid: usualTaxRate(((rates.data ?? []) as { tax_rate_uuid: string | null }[]).map((r) => r.tax_rate_uuid)) };
}
