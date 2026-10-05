/* THE QUOTE SERVICEM8 ALREADY HOLDS, AS A BRIEF (Isaac, 2026-10-05: "if
   you then hit update service mate quote, it starts the quote builder tool
   and it pulls whatever information it can from the service mate quote to
   start it").

   What ServiceM8 keeps of a quote is its scope as written (the job's
   invoice description) and its line items. A business that hides its lines
   behind one "As Per Quote" line has nothing in them worth reading, so a
   line that only says that is left out. Prices stay out: the brief says
   what the job is; what it costs is built again. Pure. */

export type Sm8QuoteLine = { name: string; quantity: number | null };

/** Lines that only stand for the quote's total. */
const STANDS_FOR_TOTAL = /^\s*as\s+per\s+(the\s+)?quote\s*\.?\s*$/i;

/* LINES THAT BILL FOR THE JOB, NOT DESCRIBE IT (Isaac's 2905, 2026-10-05:
   "Partial invoice #2905A" reached the brief): claims, deposits, progress
   and final invoices, payments, card fees. A variation always stays: it is
   scope. Checked against every distinct line name in the business's
   ServiceM8: 550 billing lines dropped, all 67 variations kept. */
const VARIATION = /^\s*variations?\b/i;
const BILLS_FOR_IT: readonly RegExp[] = [
  /^\s*(?:ac\s+)?(?:\d{1,3}(?:\.\d+)?\s*%\s*)?(?:partial\s+invoice|deposit|progress\b|retention|final\s+(?:invoice|payment|claim)|balance\s+(?:due|owing|payment)|(?:progress\s+)?claim\s*(?:no\.?\s*|#\s*)?\d)/i,
  /^\s*\d{1,3}(?:\.\d+)?\s*%\s*of\s+(?:the\s+)?(?:original\s+)?(?:quoted?\s+(?:price|amount|total)|quote|contract|total)\b/i,
  /\b(?:progress|deposit(?:\s+invoice)?)\s*\.?\s*$/i,
  /\binv(?:oice)?\s*#?\s*\d{3,}/i,
  /^\s*(?:paid|payment\s+received|less\s+(?:deposit|payment|paid))\b/i,
  /\b(?:credit\s+card|card|eftpos)\s+(?:processing\s+|transaction\s+)?(?:fee|surcharge)\b/i,
];
export const billsForIt = (name: string) => !VARIATION.test(name) && BILLS_FOR_IT.some((r) => r.test(name));

/** How a brief built from ServiceM8's quote begins: the writer reads it as
    the scope already quoted. */
export const SM8_BRIEF_HEAD = "As quoted in ServiceM8:";

const qtyWords = (n: number | null) => (n == null || Math.abs(n) === 1 ? "" : `${Math.round(Math.abs(n) * 100) / 100} × `);

/** The brief a new version starts from, or null when ServiceM8 holds
    nothing to start it with. */
export function sm8QuoteBrief(q: { scope: string | null; lines: readonly Sm8QuoteLine[] }): string | null {
  const scope = q.scope?.trim() ?? "";
  const lines = q.lines
    .filter((l) => l.name.trim() && !STANDS_FOR_TOTAL.test(l.name) && !billsForIt(l.name))
    /* a line taken off (a negative quantity that isn't billing) says so */
    .map((l) => `- ${l.quantity != null && l.quantity < 0 ? "Taken off: " : ""}${qtyWords(l.quantity)}${l.name.trim()}`);
  const parts = [scope, lines.length ? `Its line items:\n${lines.join("\n")}` : ""].filter(Boolean);
  /* the head always leads, so the writer knows it's ServiceM8's quote */
  return parts.length ? `${SM8_BRIEF_HEAD}\n${parts.join("\n\n")}` : null;
}
