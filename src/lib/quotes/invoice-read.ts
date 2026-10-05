/* A SUPPLIER'S INVOICE, READ: the lines on a PDF or a photo of one, as
   prices for the price book (Isaac, 2026-10-05: "take in invoices and
   proper pricebook files").

   Tiff reads every product line: the supplier's own code for it, the words,
   how many were supplied, the price of one before GST after the line's
   discount, and the line's total before GST. Then this decides what to
   believe. A line with no code can't be found in the book again, so it's
   left out and says so; so is freight, a surcharge or a payment, which
   aren't things to quote; so is a line with no price before GST, because a
   price is never worked back from one with GST in it. Nothing here is
   saved: the person sees the lines and adds them.

   Pure: the schema, the prompt and the parse are tested without a key. */

import { effectivePrice, netCents, planInvoices, type StoredItem, type Supplier } from "./price-book";

export const INVOICE_LINES_SCHEMA = {
  type: "object",
  properties: {
    supplier: { type: "string" },
    invoiceNo: { type: "string" },
    invoiceDate: { type: "string" },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string" },
          description: { type: "string" },
          qty: { type: "number" },
          unitPriceExGst: { type: "number" },
          lineTotalExGst: { type: "number" },
        },
        required: ["code", "description", "qty", "unitPriceExGst", "lineTotalExGst"],
        additionalProperties: false,
      },
    },
  },
  required: ["supplier", "invoiceNo", "invoiceDate", "lines"],
  additionalProperties: false,
} as const;

export const INVOICE_LINES_PROMPT =
  "This is a tax invoice from a supplier to an Australian air-conditioning business. Read it into:\n" +
  "- supplier: the supplier's name as printed (who the invoice is FROM, not who it is to)\n" +
  '- invoiceNo: the invoice number as printed, or ""\n' +
  '- invoiceDate: the invoice date as yyyy-mm-dd, or "". Dates on it are Australian, day first: 03/12/2026 is 2026-12-03\n' +
  "- lines: every line that is a product supplied, in order, each with\n" +
  '  - code: the supplier\'s own product or item code for it, exactly as printed, or "" when the line has none\n' +
  "  - description: the line's description as printed\n" +
  "  - qty: the quantity supplied (a quantity on back order is not supplied)\n" +
  "  - unitPriceExGst: the price of ONE before GST, after any discount printed on that line; 0 when no such price is printed\n" +
  "  - lineTotalExGst: the line's total before GST as printed; 0 when not printed\n\n" +
  "Leave out lines that aren't a product: freight, delivery, cartage, surcharges, card fees, rounding, " +
  "deposits, payments, subtotals and totals. Never work a price before GST out from one that includes GST. " +
  "If a figure can't be read clearly, use 0 rather than a guess. If this isn't a supplier's invoice, return no lines.";

export type InvoiceLine = {
  /** the supplier's code, the key the price book keeps */
  code: string;
  name: string;
  qty: number;
  /** what one cost before GST, after the line's discount */
  cents: number;
};

export type InvoiceRead = {
  supplier: string;
  invoiceNo: string;
  /** yyyy-mm-dd, or null when it couldn't be read */
  invoiceDate: string | null;
  lines: InvoiceLine[];
  /** what was on it and isn't kept, and why */
  skipped: { name: string; why: string }[];
};

/** A line read, beside what a quote pays for that code now (null: not in
    the book) and what it would pay once the invoice is in — the book keeps
    a newer price than an old invoice's. Both net, as a quote takes them. */
export type ReadLine = InvoiceLine & { now: number | null; after: number };
export type ReadInvoice = Omit<InvoiceRead, "lines"> & { lines: ReadLine[] };

/** The most lines one invoice is read for. */
export const MAX_INVOICE_LINES = 400;

/** The largest file an invoice is read from: under the host's ceiling on
    a request (4.5 MB). A photo is made smaller before it's sent. */
export const MAX_INVOICE_BYTES = 4 * 1024 * 1024;

/* a line that is a charge, not a product, whatever the reader said */
const NOT_A_PRODUCT =
  /\b(freight|cartage|courier|postage|surcharge|card\s*fee|merchant\s*fee|rounding|deposit|payment|small\s*order\s*(fee|charge)|delivery\s*(charge|fee))\b|^delivery$/i;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A date as yyyy-mm-dd, when it's a real one and not after today: a date
    misread into the future would outrank every real invoice after it. */
function isoDate(v: unknown, today: string): string | null {
  const s = str(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return s >= "2000-01-01" && s <= today ? s : null;
}

/** The price of one, in dollars: the unit price, unless the line's total
    says otherwise. Two prices printed that don't agree are a unit price
    before the line's discount came off, and what was charged for what was
    supplied is the line's total — unless the total is the unit price with
    GST on it, which is never what's kept. */
export function eachOf(unit: number, total: number, qty: number): number {
  const fromTotal = total > 0 && qty > 0 ? total / qty : 0;
  if (!(fromTotal > 0)) return unit > 0 ? unit : 0;
  if (!(unit > 0)) return fromTotal;
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, b * 0.01);
  return near(unit, fromTotal) || near(unit * 1.1, fromTotal) ? unit : fromTotal;
}

/** What Tiff read, believed only as far as it holds up. The same code on
    two lines is one line: how many in all, at what they cost each on
    average. `today` is yyyy-mm-dd where the business is. */
export function parseInvoiceRead(raw: unknown, today: string): InvoiceRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const byCode = new Map<string, { name: string; qty: number; paid: number }>();
  const skipped: InvoiceRead["skipped"] = [];
  for (const l of Array.isArray(r.lines) ? r.lines.slice(0, MAX_INVOICE_LINES) : []) {
    const line = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    const code = str(line.code, 80);
    const name = str(line.description, 200);
    const qty = num(line.qty);
    const label = name || code || "A line";
    if (NOT_A_PRODUCT.test(name) || NOT_A_PRODUCT.test(code)) {
      skipped.push({ name: label, why: "not a product" });
      continue;
    }
    if (!code) {
      skipped.push({ name: label, why: "no code on the line" });
      continue;
    }
    if (!(qty > 0)) {
      skipped.push({ name: label, why: "none supplied" });
      continue;
    }
    const cents = Math.round(eachOf(num(line.unitPriceExGst), num(line.lineTotalExGst), qty) * 100);
    if (!(cents > 0) || cents > 100_000_000) {
      skipped.push({ name: label, why: "no price before GST" });
      continue;
    }
    const had = byCode.get(code);
    if (had) {
      had.qty += qty;
      had.paid += cents * qty;
    } else byCode.set(code, { name: name || code, qty, paid: cents * qty });
  }
  const lines = [...byCode].map(([code, l]) => ({ code, name: l.name, qty: l.qty, cents: Math.round(l.paid / l.qty) }));
  return { supplier: str(r.supplier, 120), invoiceNo: str(r.invoiceNo, 40), invoiceDate: isoDate(r.invoiceDate, today), lines, skipped };
}

/* the words of a business's name that say nothing about which one it is */
const PLAIN_WORDS = new Set(["pty", "ltd", "limited", "the", "and", "co", "australia", "aust", "group", "trading", "services", "supplies", "inc"]);
const nameWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !PLAIN_WORDS.has(w));

/** Whether the name read off an invoice is this supplier's: every word of
    its name is there ("Mitsubishi Electric" in "Mitsubishi Electric
    Australia Pty Ltd"). */
export function namesSupplier(read: string, name: string): boolean {
  const words = nameWords(name);
  const have = new Set(nameWords(read));
  return words.length > 0 && words.every((w) => have.has(w));
}

/** Another of the business's suppliers the invoice names, when it doesn't
    name the one it's being added to: a Reece invoice opened under AAD. */
export function otherSupplierNamed(read: string, chosen: string, others: string[]): string | null {
  if (!read || namesSupplier(read, chosen)) return null;
  return others.find((o) => o !== chosen && namesSupplier(read, o)) ?? null;
}

/** An item as the book holds it, with the dates its list price is from. */
export type HeldItem = StoredItem & { listed_on: string | null; priced_on: string | null };

type Prices = Pick<HeldItem, "cents" | "on_list" | "listed_on" | "last_import_at" | "priced_on" | "paid_cents" | "paid_on">;

/** What a quote pays for a code with these prices: the newer of the list's
    (less the business's discount) and the latest invoice's. */
function quoted(supplier: Supplier, code: string, p: Prices): number {
  const { price } = effectivePrice({
    cents: p.cents,
    onList: p.on_list !== false,
    listedOn: p.listed_on,
    importedAt: p.last_import_at,
    pricedOn: p.priced_on,
    paidCents: p.paid_cents,
    paidOn: p.paid_on,
  });
  return netCents(supplier, code, price.cents, price.net);
}

/** Each line beside what a quote pays for its code now and once the
    invoice is in, worked out the way adding it will (planInvoices): an
    invoice older than the price held changes nothing. */
export function withBookPrices(lines: InvoiceLine[], held: Map<string, HeldItem>, supplier: Supplier, on: string): ReadLine[] {
  const { upserts } = planInvoices(
    held,
    lines.map((l) => ({ code: l.code, name: l.name, cents: l.cents, pricedOn: on })),
    { orgId: "", supplierKey: supplier.key, now: "", today: on }
  );
  return lines.map((l, i) => {
    const had = held.get(l.code);
    const after = { listed_on: null, priced_on: null, ...had, ...(upserts[i] as Partial<HeldItem>) } as Prices;
    return { ...l, now: had?.current ? quoted(supplier, l.code, had) : null, after: quoted(supplier, l.code, after) };
  });
}
