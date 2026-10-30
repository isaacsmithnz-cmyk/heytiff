/* A PURCHASE — a supplier's docket, photographed, read, and put where it
   went (Isaac, 29 October 2026, from job 1352: "add purchase, photo of the
   invoice… line items pulled out, added to price book… ticked individually
   or add all to job. Or just stock… until all items are clear").

   Read with the price book's own invoice reader (invoice-read.ts: the same
   schema and prompt), but believed differently. The price book keeps only
   what it can find again, so it drops a line with no code or no price. A
   purchase is what was SPENT, so it keeps every product on the docket: a
   line with no code is still on the job, it just never reaches the book;
   a line with no price takes the book's, and says so; with neither, it's
   asked for. Freight and the like are still left out, and said.

   GST IS NEVER DERIVED: every price here is the docket's before GST, or the
   book's, which is before GST too.

   Pure: tested without a key or a database. */

import { NOT_A_PRODUCT, eachOf, isoDate, tidyName } from "@/lib/quotes/invoice-read";

/** Where a line went: a job, stock, or nowhere yet. */
export const WENT_TO = ["open", "job", "stock"] as const;
export type WentTo = (typeof WENT_TO)[number];

/** What a line did to the price book when the purchase was added. */
export const BOOK_EFFECTS = ["new", "up", "down", "same", "from_book", "none"] as const;
export type BookEffect = (typeof BOOK_EFFECTS)[number];

/** A line as read off the docket, before the book has been asked. */
export type DocketLine = {
  /** the supplier's code, "" when the line has none */
  code: string;
  name: string;
  qty: number;
  /** one, before GST, from the docket; null when it prints none */
  cents: number | null;
};

export type DocketRead = {
  supplier: string;
  invoiceNo: string;
  /** yyyy-mm-dd, or null when it couldn't be read */
  invoiceDate: string | null;
  lines: DocketLine[];
  /** what was on it and isn't a line here, and why */
  skipped: { name: string; why: string }[];
};

/** A line as kept. */
export type PurchaseLine = {
  id: string;
  position: number;
  code: string;
  name: string;
  qty: number;
  cents: number | null;
  priceFrom: "docket" | "book";
  book: BookEffect;
  bookBefore: number | null;
  bookAfter: number | null;
  wentTo: WentTo;
  jobUuid: string | null;
  jobLabel: string | null;
};

export type Purchase = {
  id: string;
  supplierName: string;
  supplierKey: string | null;
  invoiceNo: string;
  invoiceDate: string | null;
  boughtBy: { id: string; name: string } | null;
  createdAt: string;
  skipped: { name: string; why: string }[];
  /** the docket's photo or PDF, when one was kept */
  documentId: string | null;
  lines: PurchaseLine[];
};

/** The most lines one docket is read for. */
export const MAX_PURCHASE_LINES = 200;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** What Tiff read off the docket, believed as far as it holds up. Lines stay
    in the docket's order and are never merged: the purchase is the docket. */
export function parseDocketRead(raw: unknown, today: string): DocketRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const lines: DocketLine[] = [];
  const skipped: DocketRead["skipped"] = [];
  for (const l of Array.isArray(r.lines) ? r.lines.slice(0, MAX_PURCHASE_LINES) : []) {
    const line = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    const code = str(line.code, 80);
    const name = tidyName(str(line.description, 200));
    const qty = num(line.qty);
    const label = name || code || "A line";
    if (NOT_A_PRODUCT.test(name) || NOT_A_PRODUCT.test(code)) {
      skipped.push({ name: label, why: "not a product" });
      continue;
    }
    if (!name && !code) continue;
    if (!(qty > 0)) {
      skipped.push({ name: label, why: "none supplied" });
      continue;
    }
    const each = Math.round(eachOf(num(line.unitPriceExGst), num(line.lineTotalExGst), qty) * 100);
    lines.push({ code, name: name || code, qty: Math.round(qty * 1000) / 1000, cents: each > 0 && each <= 100_000_000 ? each : null });
  }
  return { supplier: str(r.supplier, 120), invoiceNo: str(r.invoiceNo, 40), invoiceDate: isoDate(r.invoiceDate, today), lines, skipped };
}

/** What the book said of a code before the docket, and would after it. */
export type BookPrices = { now: number | null; after: number };

/** A docket line beside the book: the price it's kept at, where that came
    from, and what it did to the book. `prices` is null when the line can't
    reach the book (no code, or a supplier the book doesn't keep). */
export function judgeLine(
  line: DocketLine,
  prices: BookPrices | null
): Pick<PurchaseLine, "cents" | "priceFrom" | "book" | "bookBefore" | "bookAfter"> {
  if (line.cents == null) {
    /* no price on the docket: the book's, when it has one */
    if (prices?.now != null) return { cents: prices.now, priceFrom: "book", book: "from_book", bookBefore: prices.now, bookAfter: prices.now };
    return { cents: null, priceFrom: "docket", book: "none", bookBefore: null, bookAfter: null };
  }
  if (!prices) return { cents: line.cents, priceFrom: "docket", book: "none", bookBefore: null, bookAfter: null };
  const { now, after } = prices;
  const book: BookEffect = now == null ? "new" : after > now ? "up" : after < now ? "down" : "same";
  return { cents: line.cents, priceFrom: "docket", book, bookBefore: now, bookAfter: after };
}

/** A line's total before GST, in cents; null when it has no price. */
export const lineCents = (l: Pick<PurchaseLine, "qty" | "cents">): number | null => (l.cents == null ? null : Math.round(l.cents * l.qty));

/** The lines' total before GST, in cents, of those with a price. */
export const totalCents = (lines: Pick<PurchaseLine, "qty" | "cents">[]): number => lines.reduce((s, l) => s + (lineCents(l) ?? 0), 0);

/** Whether every line has gone somewhere. */
export const isClear = (lines: Pick<PurchaseLine, "wentTo">[]): boolean => lines.every((l) => l.wentTo !== "open");

/** Where the lines went, one group a job and one for stock, in the order
    they went: "1352 Holbrook Ave, four lines, $638.10". */
export type WentGroup = { key: string; wentTo: "job" | "stock"; jobUuid: string | null; label: string; lines: number; cents: number };
export function whereItWent(lines: PurchaseLine[]): WentGroup[] {
  const groups = new Map<string, WentGroup>();
  for (const l of lines) {
    if (l.wentTo === "open") continue;
    const key = l.wentTo === "job" ? `job:${l.jobUuid}` : "stock";
    const g = groups.get(key) ?? { key, wentTo: l.wentTo, jobUuid: l.jobUuid, label: l.wentTo === "job" ? l.jobLabel || "A job" : "Stock", lines: 0, cents: 0 };
    g.lines += 1;
    g.cents += lineCents(l) ?? 0;
    groups.set(key, g);
  }
  /* stock last: it's what's left */
  return [...groups.values()].sort((a, b) => (a.wentTo === b.wentTo ? 0 : a.wentTo === "stock" ? 1 : -1));
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
/** "One line", "Four lines", "12 lines". */
export function countWord(n: number, one: string, many: string): string {
  const w = n < WORDS.length ? WORDS[n] : String(n);
  return `${w} ${n === 1 ? one : many}`;
}

/** "$1,284.60" */
export function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** What a line did to the book, in words, and its state: orange for a
    price up (a look), green for a price down, grey for the rest. */
export function bookWords(l: Pick<PurchaseLine, "book" | "bookBefore" | "bookAfter" | "code">): { text: string; tone: "or" | "gr" | "q" } {
  switch (l.book) {
    case "new":
      return { text: "New in the book", tone: "q" };
    case "up":
      return { text: `Price up, ${money(l.bookBefore ?? 0)} to ${money(l.bookAfter ?? 0)}`, tone: "or" };
    case "down":
      return { text: `Price down, ${money(l.bookBefore ?? 0)} to ${money(l.bookAfter ?? 0)}`, tone: "gr" };
    case "same":
      return { text: "Same as the book", tone: "q" };
    case "from_book":
      return { text: "From the book", tone: "q" };
    default:
      return { text: l.code ? "Not in the book" : "No code, not for the book", tone: "q" };
  }
}

/** The purchase's lines, summed up for its row in Purchases: "One price
    up", "One new, one down", "Same as the book". */
export function bookSummary(lines: Pick<PurchaseLine, "book">[]): { text: string; tone: "or" | "gr" | "q" } {
  const n = (b: BookEffect) => lines.filter((l) => l.book === b).length;
  const up = n("up");
  const down = n("down");
  const added = n("new");
  const w = (k: number) => (k < WORDS.length ? WORDS[k].toLowerCase() : String(k));
  const parts: string[] = [];
  if (up) parts.push(`${w(up)} ${up === 1 ? "price" : "prices"} up`);
  if (added) parts.push(`${w(added)} new`);
  if (down) parts.push(`${w(down)} down`);
  const said = parts.join(", ");
  if (said) return { text: said[0].toUpperCase() + said.slice(1), tone: up ? "or" : down ? "gr" : "q" };
  if (lines.some((l) => l.book === "same" || l.book === "from_book")) return { text: "Same as the book", tone: "q" };
  return { text: "Not for the book", tone: "q" };
}

/** A job's materials spend against the quote's allowance: "Inside the quote"
    (green) or "Over the quote" (orange); null when there's no allowance. */
export function againstQuote(spentCents: number, allowanceCents: number | null): { text: string; tone: "gr" | "or" } | null {
  if (allowanceCents == null || !(allowanceCents > 0)) return null;
  return spentCents > allowanceCents ? { text: "Over the quote", tone: "or" } : { text: "Inside the quote", tone: "gr" };
}
