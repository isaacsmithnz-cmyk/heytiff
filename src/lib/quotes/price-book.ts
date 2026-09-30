/* HEYTIFF'S PRICE BOOK — the business's own, built from its suppliers'
   files rather than from whatever has piled up in ServiceM8's catalogue.

   Two suppliers to start, priced two ways:
   - AAD sends a CSV of the business's NET buy prices (code, name, price) —
     the "individual" export; the "kits" export is a list-price level and
     is not used (checked 2026-09-30: the AP71 pair is $1,678.67 in the
     individual file, to the cent the supplier portal's price, and $2,315.41
     as a kit).
   - Mitsubishi Electric sends a PDF trade book of LIST prices, and the
     business's discount comes off: 30% on everything, 48% on PUMY
     (2026-09-30).

   Kits in the Mitsubishi book (…KIT) are the indoor and outdoor units' sum
   under a third code, so they are left out: HeyTiff pairs the units itself,
   and a kit is the duplicate the book exists to get rid of.

   Pure: parsing and the sums, for the import, the page and the tests. */

export type PricingKind = "net" | "list_less";

/** A discount that applies to a range instead of the supplier's own. */
export type DiscountRule = { prefix: string; discountPct: number };

/** The file a supplier's prices come in, and how it's laid out. */
export type FileKind = "csv" | "pdf" | "xlsx";
/** me_invoice_xlsx: any workbook of headed price rows, read by heading */
export type FileFormat = "aad_csv" | "reece_csv" | "me_pdf" | "me_invoice_xlsx";

export type Supplier = {
  key: string;
  name: string;
  pricing: PricingKind;
  file: FileKind;
  format: FileFormat;
  /** list_less: taken off every list price */
  discountPct: number;
  /** list_less: a range with a different discount (PUMY at 48) */
  rules: DiscountRule[];
};

/** The two the business buys from, as agreed 2026-09-30. */
export const DEFAULT_SUPPLIERS: Supplier[] = [
  { key: "aad", name: "AAD", pricing: "net", file: "csv", format: "aad_csv", discountPct: 0, rules: [] },
  /* Reece's monthly account price file: section and sub-section rows, then
     code, description, unit, list and net prices ex and incl GST
     (2026-09-30, 1055793_September_2026.csv) — the net ex GST is used. */
  { key: "reece", name: "Reece", pricing: "net", file: "csv", format: "reece_csv", discountPct: 0, rules: [] },
  {
    key: "mitsubishi",
    name: "Mitsubishi Electric",
    pricing: "list_less",
    file: "pdf",
    format: "me_pdf",
    discountPct: 30,
    rules: [{ prefix: "PUMY", discountPct: 48 }],
  },
  /* What Mitsubishi actually charged, from its tax invoices (the office's
     workbook, "Current Net Prices"): the price for the City Multi indoor
     units and older builds the trade book doesn't list, dated, with how
     often each was bought. */
  { key: "mitsubishi_invoiced", name: "Mitsubishi Electric, invoiced", pricing: "net", file: "xlsx", format: "me_invoice_xlsx", discountPct: 0, rules: [] },
  /* Ideal Air Group — ventilation: diffusers, EC fans, duct fittings —
     from the office's workbook of its invoices, orders and quotes */
  { key: "idealair", name: "Ideal Air Group", pricing: "net", file: "xlsx", format: "me_invoice_xlsx", discountPct: 0, rules: [] },
];

export type PriceRow = {
  code: string;
  name: string;
  cents: number;
  /** when this price was charged (an invoice's date), YYYY-MM-DD */
  pricedOn?: string | null;
  /** how many times it was bought, and how many in all */
  timesBought?: number | null;
  qtyBought?: number | null;
  /** the unit it's sold by, as the file says it: EA, MTR, COIL, LEN… */
  uom?: string | null;
};

export type ParseResult = {
  rows: PriceRow[];
  /** a code listed twice at different prices: the first is kept */
  conflicts: { code: string; kept: number; also: number }[];
  /** lines that looked like prices but weren't read, and kits left out */
  skipped: number;
};

const centsOf = (s: string): number | null => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

function dedupe(rows: PriceRow[], skipped: number): ParseResult {
  const byCode = new Map<string, PriceRow>();
  const conflicts: ParseResult["conflicts"] = [];
  for (const r of rows) {
    const had = byCode.get(r.code);
    if (!had) byCode.set(r.code, r);
    else if (had.cents !== r.cents) conflicts.push({ code: r.code, kept: had.cents, also: r.cents });
  }
  return { rows: [...byCode.values()], conflicts, skipped };
}

/** One CSV line's fields, quotes honoured ("a, b" stays one field). */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.replace(/ /g, " ").trim());
}

/** AAD's export: code, name, net price — no header row. */
export function parseAadCsv(text: string): ParseResult {
  const rows: PriceRow[] = [];
  let skipped = 0;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const [code, name, price] = csvFields(raw);
    const cents = price != null ? centsOf(price) : null;
    if (!code || !name || cents == null) {
      skipped++;
      continue;
    }
    rows.push({ code, name: name.replace(/\s+/g, " "), cents });
  }
  return dedupe(rows, skipped);
}

/** Reece's account price file. Rows with no code are the file's section
    and sub-section headings; an item row is: section, sub-section, code,
    description, unit, list ex GST, list incl GST, net ex GST, net incl GST,
    GST %. The net ex GST is what the business pays. */
export function parseReeceCsv(text: string): ParseResult {
  const rows: PriceRow[] = [];
  let skipped = 0;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const f = csvFields(raw);
    const code = f[2];
    if (!code) continue;
    const cents = centsOf(f[7] ?? "");
    if (!f[3] || cents == null) {
      skipped++;
      continue;
    }
    rows.push({ code, name: f[3].replace(/\s+/g, " "), cents, uom: f[4] || null });
  }
  return dedupe(rows, skipped);
}

/* A Mitsubishi row: the model code first, the list price ex GST and incl GST
   last. The code is capitals, digits and - / ( ) . — "Total" and the
   delivery paragraphs never match. */
const ME_ROW = /^([A-Z0-9][A-Z0-9\-/().#]{3,})\s+(.*?)\s*\$\s*([\d,]+\.\d{2})\s+\$\s*([\d,]+\.\d{2})\s*$/;

/** Mitsubishi's trade book, as the PDF's rows: list price ex GST. */
export function parseMitsubishiLines(lines: string[]): ParseResult {
  const rows: PriceRow[] = [];
  let skipped = 0;
  for (const raw of lines) {
    const line = raw.replace(/ /g, " ").trim();
    const m = ME_ROW.exec(line);
    if (!m) {
      /* a row with two prices on the end that still didn't read */
      if (/\$\s*[\d,]+\.\d{2}\s+\$\s*[\d,]+\.\d{2}\s*$/.test(line) && !/^Total/i.test(line)) skipped++;
      continue;
    }
    const [, code, desc, ex] = m;
    if (/KIT$/.test(code!)) {
      skipped++;
      continue;
    }
    const cents = centsOf(ex!);
    if (cents == null) continue;
    /* the capacity figures that follow a unit's words ("… 9.0 10.0") are
       columns of the table, not the name */
    const name = desc!.replace(/(\s+\d+(\.\d+)?){1,2}$/, "").replace(/\s+/g, " ").trim();
    rows.push({ code: code!, name: name || code!, cents });
  }
  return dedupe(rows, skipped);
}

/* WHICH COLUMN IS WHICH, by its heading — so an invoice workbook or a
   price list reads whatever order its columns come in (the Mitsubishi and
   Ideal Air workbooks share headings in different places, 2026-09-30). The
   first row naming a code column and a price column is the header. */
const HEADINGS: { field: "code" | "name" | "price" | "date" | "times" | "qty" | "uom"; test: RegExp }[] = [
  { field: "code", test: /^(item\s*code|model|model\s*\/\s*part\s*no\.?|part\s*(no\.?|number)|code|product\s*code|sku)$/i },
  { field: "name", test: /^(description|item|name|product)$/i },
  { field: "price", test: /^(latest\s*(unit\s*)?price|net\s*price|unit\s*price(\s*ex\s*gst)?|price(\s*ex\s*gst)?|cost)$/i },
  { field: "date", test: /^(latest\s*(invoice\s*)?date|date)$/i },
  { field: "times", test: /^times\s*(invoiced|bought)/i },
  { field: "qty", test: /^total\s*qty|^qty\s*bought/i },
  { field: "uom", test: /^(unit|uom|unit\s*of\s*measure)$/i },
];

type Row = Map<string, string | number | null>;
type Columns = Partial<Record<(typeof HEADINGS)[number]["field"], string>>;

/** A sheet's price rows, found by their headings: code, description,
    price, and — when there — the date it was charged, how often and how
    many were bought, and the unit it's sold by. */
export function parseHeadedRows(rows: Row[], excelDate: (serial: number) => string): ParseResult {
  let cols: Columns | null = null;
  const out: PriceRow[] = [];
  let skipped = 0;
  for (const r of rows) {
    if (!cols) {
      const found: Columns = {};
      for (const [col, v] of r) {
        if (typeof v !== "string") continue;
        const h = HEADINGS.find((x) => x.test.test(v.trim()) && !found[x.field]);
        if (h) found[h.field] = col;
      }
      if (found.code && found.price) cols = found;
      continue;
    }
    const code = cols.code ? r.get(cols.code) : null;
    const price = cols.price ? r.get(cols.price) : null;
    const codeText = typeof code === "number" ? String(code) : typeof code === "string" ? code.trim() : "";
    if (!codeText) continue;
    const n = typeof price === "number" ? price : typeof price === "string" ? Number(price.replace(/[$,\s]/g, "")) : NaN;
    if (!Number.isFinite(n)) {
      skipped++;
      continue;
    }
    const d = cols.date ? r.get(cols.date) : null;
    const times = cols.times ? r.get(cols.times) : null;
    const qty = cols.qty ? r.get(cols.qty) : null;
    const uom = cols.uom ? r.get(cols.uom) : null;
    out.push({
      code: codeText,
      name: String((cols.name ? r.get(cols.name) : null) ?? codeText).replace(/\s+/g, " ").trim(),
      cents: Math.round(n * 100),
      pricedOn: typeof d === "number" ? excelDate(d) : typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null,
      timesBought: typeof times === "number" ? Math.round(times) : null,
      qtyBought: typeof qty === "number" ? qty : null,
      uom: typeof uom === "string" && uom.trim() ? uom.trim() : null,
    });
  }
  return dedupe(out, skipped);
}

/** The invoice workbooks are headed sheets. */
export const parseInvoicedRows = parseHeadedRows;

/** What the business pays for an item: the net price as sent, or the list
    price less the discount that applies to its range. */
export function netCents(supplier: Supplier, code: string, cents: number): number {
  if (supplier.pricing === "net") return cents;
  const rule = supplier.rules.find((r) => code.toUpperCase().startsWith(r.prefix.toUpperCase()));
  const pct = rule ? rule.discountPct : supplier.discountPct;
  return Math.round(cents * (1 - pct / 100));
}

/** The supplier's pricing, in a few words, for the page. */
export function pricingWords(s: Supplier): string {
  if (s.file === "xlsx") return "What was charged, by invoice";
  if (s.pricing === "net") return "Net prices";
  const rules = s.rules.map((r) => `${r.prefix} less ${r.discountPct}%`).join(", ");
  return `List less ${s.discountPct}%${rules ? `, ${rules}` : ""}`;
}

export type Offer = {
  supplierKey: string;
  supplierName: string;
  code: string;
  name: string;
  netCents: number;
  /** the invoice date an invoiced price was charged on */
  pricedOn?: string | null;
};

/** One model at every supplier that has it, cheapest first, with how much
    the cheapest saves on the next. */
export function compareOffers(offers: Offer[]): { offers: Offer[]; cheapest: Offer | null; savesCents: number | null } {
  const sorted = [...offers].sort((a, b) => a.netCents - b.netCents);
  const cheapest = sorted[0] ?? null;
  const next = sorted[1];
  return { offers: sorted, cheapest, savesCents: cheapest && next ? next.netCents - cheapest.netCents : null };
}
