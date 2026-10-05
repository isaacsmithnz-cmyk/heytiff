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

const qtyWords = (n: number | null) => (n == null || n === 1 ? "" : `${Math.round(n * 100) / 100} × `);

/** The brief a new version starts from, or null when ServiceM8 holds
    nothing to start it with. */
export function sm8QuoteBrief(q: { scope: string | null; lines: readonly Sm8QuoteLine[] }): string | null {
  const scope = q.scope?.trim() ?? "";
  const lines = q.lines.filter((l) => l.name.trim() && !STANDS_FOR_TOTAL.test(l.name)).map((l) => `- ${qtyWords(l.quantity)}${l.name.trim()}`);
  const parts = [
    scope ? `As quoted in ServiceM8:\n${scope}` : "",
    lines.length ? `Its line items:\n${lines.join("\n")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("\n\n") : null;
}
