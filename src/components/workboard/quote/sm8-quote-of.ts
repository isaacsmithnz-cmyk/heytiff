import { fmtAud } from "@/lib/workboard/project-money";
import { MONEY_BASIS } from "@/lib/workboard/job-money";
import type { FamilyMoney } from "@/lib/workboard/job-family";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import type { Sm8Quote } from "../board/job-quote-face";

/* SERVICEM8'S OWN QUOTE ON A JOB, as the job card and the quote page both
   show it: the PDFs it generated, the day it went, and what it came to — the
   FAMILY's value where the job bills in claims (the row's own total is netted
   by each claim ServiceM8 raises), only to a reader who sees money. One rule,
   so the card and the page can never disagree. Pure. */
export function sm8QuoteOf(input: {
  documents: readonly JobMediaItem[] | null;
  sentOn: string | null;
  moneyVisible: boolean;
  family: Pick<FamilyMoney, "valueCents" | "basis"> | null;
  rowValueCents: number | null;
}): Sm8Quote {
  const { family } = input;
  const cents = input.moneyVisible ? (family ? family.valueCents : input.rowValueCents) : null;
  const ex = family ? family.basis === "ex" : MONEY_BASIS !== "inc GST";
  return {
    papers: (input.documents ?? []).filter((d) => d.origin === "Quote"),
    sentOn: input.sentOn,
    value: cents != null ? `${fmtAud(cents)} ${ex ? "ex GST" : "inc GST"}` : null,
    quoted: cents != null ? { cents, basis: ex ? "ex" : "inc" } : null,
  };
}
