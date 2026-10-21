import { notFound } from "next/navigation";
import "@/app/dashboard/shell.css";
import "./quote-print.css";
import { orgBrand } from "@/lib/org/query";
import { readQuoteTicket } from "@/lib/quotes/pdf-ticket";
import { readByHand } from "@/lib/quotes/lines-job-server";
import { namesBySignIn, readLines } from "@/lib/quotes/lines-server";
import { proposalTitle } from "@/lib/quotes/proposal";
import { readQuotePrice } from "@/lib/quotes/quote-price-server";
import { orgTemplates } from "@/lib/templates/query";
import { readMirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import { todayInZone } from "@/lib/workboard/dates";
import { getSm8Timezone } from "@/lib/workboard/query";
import { PrintQuote } from "./print-quote";

/* WHAT THE HEADLESS BROWSER PRINTS — /print/quote?t=<ticket>, the letter's
   and the certificate's arrangement (Isaac, 21 October 2026: "We also need to
   be able to turn this into a PDF"). Nobody opens this by hand: the quote's
   PDF route sends a headless Chrome here with a ticket (lib/quotes/pdf-ticket)
   and waits for the page to say it is ready. The ticket is the only
   authority: it names the workspace, and the job is read inside it. */

export const dynamic = "force-dynamic";

export default async function PrintQuotePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const ticket = readQuoteTicket(t);
  if (!ticket) notFound();
  const { orgId, jobUuid, by } = ticket;
  const timezone = await getSm8Timezone(orgId);
  const [detail, lines, byHand, price, templates, names, brand] = await Promise.all([
    readMirrorJobDetail(orgId, jobUuid, todayInZone(timezone), { includeMoney: false, timezone }),
    readLines(orgId, jobUuid),
    readByHand(orgId, jobUuid),
    readQuotePrice(orgId, jobUuid),
    orgTemplates(orgId).catch(() => null),
    namesBySignIn(orgId, [by]),
    orgBrand(orgId, { seconds: 600 }),
  ]);
  if (!detail || lines.length === 0) notFound();
  const address = detail.address ?? detail.geoLine;
  /* the quote's own options: a variation is its own paper */
  const variations = new Set(byHand.variations.map((v) => v.option));
  const paper = {
    proposal: byHand.proposal,
    lines: lines.filter((l) => !variations.has(l.optionIndex)),
    price,
    optionNames: byHand.names,
    noteLibrary: templates?.quoteNotes ?? [],
    paymentTerms: templates?.paymentTerms ?? null,
    title: proposalTitle(address),
    client: detail.clientName ?? null,
    site: address ?? null,
    jobNumber: detail.jobNumber ?? null,
    preparedBy: names[by] ?? null,
    brand,
  };
  return <PrintQuote {...paper} />;
}
