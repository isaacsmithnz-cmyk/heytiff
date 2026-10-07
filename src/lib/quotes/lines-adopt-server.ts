import "server-only";
import { unsetWords } from "./build-settings";
import { adoptLines } from "./lines-adopt";
import { addLine, readLines, setEngine, type LineResult } from "./lines-server";
import { priceQuote } from "./quote-price-server";

/* A quote Tiff's builder priced, brought across to its kept lines as it's
   priced today (lines-adopt.ts), then switched, so it's changed by hand
   from here. Refused on a quote that already has kept lines: nothing is
   doubled. */

export async function adoptQuote(orgId: string, jobUuid: string, by: string): Promise<LineResult> {
  if ((await readLines(orgId, jobUuid)).length > 0) return { ok: false, reason: "This quote already has its own lines." };
  const priced = await priceQuote(orgId, jobUuid);
  if (!priced.ok) return { ok: false, reason: unsetWords(priced.unset) };
  const lines = adoptLines(priced.options, priced.dayHours, priced.hourCostCents);
  if (lines.length === 0) return { ok: false, reason: "Nothing on the quote is priced yet." };
  for (const l of lines) {
    const r = await addLine(orgId, jobUuid, l, by, "Brought across from Tiff's builder");
    if (!r.ok) return r;
  }
  return (await setEngine(orgId, jobUuid, "lines", by)) ? { ok: true, line: null } : { ok: false, reason: "The quote couldn't be switched. Try again." };
}
