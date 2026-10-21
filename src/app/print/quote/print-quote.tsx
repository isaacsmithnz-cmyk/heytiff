"use client";

import { LinesProposalPaper } from "@/components/workboard/quote/lines-proposal-paper";
import type { OrgBrand } from "@/lib/org/brand";
import type { QuoteLine } from "@/lib/quotes/lines";
import type { LinesProposal } from "@/lib/quotes/lines-proposal";
import type { PaymentPreset, PaymentStage } from "@/lib/quotes/payment";
import type { QuotePrice } from "@/lib/quotes/quote-price-server";
import type { QuoteNote } from "@/lib/templates/settings";
import { PrintReady } from "../certificate/print-ready";

/* The quote's paper as the client sees it, read only: the same paper the
   quote screen's Preview shows, so the file and the screen are one document. */
export function PrintQuote(props: {
  proposal: LinesProposal | null;
  lines: QuoteLine[];
  price: QuotePrice;
  optionNames: string[];
  noteLibrary: QuoteNote[];
  paymentTerms: Record<PaymentPreset, { label: string; stages: PaymentStage[] }> | null;
  title: string;
  client: string | null;
  site: string | null;
  jobNumber: string | null;
  preparedBy: string | null;
  brand: OrgBrand;
}) {
  return (
    <div className="fg qpdf">
      <LinesProposalPaper {...props} busy={false} onSave={() => {}} />
      <PrintReady />
    </div>
  );
}
