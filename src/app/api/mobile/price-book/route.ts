import { ok, requireMobile } from "@/lib/mobile/auth";
import { matchingItems } from "@/lib/quotes/price-book-server";
import { searchWords } from "@/lib/quotes/price-book";

/* THE PRICE BOOK AS YOU TYPE, for what was used on a job (Isaac, 8 November
   2026: "you can just start typing in and your price book will start
   suggesting items ... like a search book for the thing, and you can just add
   line items one by one"; https://claude.ai/artifact/Y536R2SCNGzEnyExgL2jmq,
   built 12 November: "Don't wait for my answers. Just build"). The items
   whose code or name holds every word typed, the most bought first, eight at
   most: their names and codes, never their prices. The crew's tier,
   `workboard`, as what was used is. */

const LIMIT = 8;

export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  const words = searchWords(q);
  if (words.length === 0 || q.length < 2) return ok({ items: [] });
  const found = await matchingItems(ctx.orgId, words, [], 200).catch(() => []);
  const items = [...found]
    .sort((a, b) => (b.timesBought ?? 0) - (a.timesBought ?? 0) || a.name.localeCompare(b.name))
    .slice(0, LIMIT)
    .map((i) => ({ supplierKey: i.supplierKey, code: i.code, name: i.name, uom: i.uom }));
  return ok({ items });
}
