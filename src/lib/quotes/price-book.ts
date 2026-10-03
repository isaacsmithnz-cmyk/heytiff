/* HEYTIFF'S PRICE BOOK — the business's own, built from its suppliers'
   files rather than from whatever has piled up in ServiceM8's catalogue.

   Every business brings its own (Isaac, 2026-10-04: "price books etc have
   to be injected by its own org"). HeyTiff knows how to READ three
   suppliers' files out of the box, and any other supplier's CSV or workbook
   by its headings; what a business pays, and any discount it gets, is its
   own and is never a default:
   - AAD sends a CSV of the business's NET buy prices (code, name, price) —
     the "individual" export; the "kits" export is a list-price level and
     is not used (checked 2026-09-30).
   - Reece sends a monthly account price file with the net ex GST in it.
   - Mitsubishi Electric sends a PDF trade book of LIST prices; the
     business's own discount comes off, set on the Quoting page (one for
     everything, and any range by its codes, e.g. PUMY).

   Kits in the Mitsubishi book (…KIT) are the indoor and outdoor units' sum
   under a third code, so they are left out: HeyTiff pairs the units itself,
   and a kit is the duplicate the book exists to get rid of.

   Pure: parsing and the sums, for the import, the page and the tests. */

export type PricingKind = "net" | "list_less";

/** A discount that applies to a range instead of the supplier's own. */
export type DiscountRule = { prefix: string; discountPct: number };

/** The file a supplier's prices come in, and how it's laid out. */
export type FileKind = "csv" | "pdf" | "xlsx";
/** headed: a supplier the business added, any CSV or workbook, read by
    heading or by the columns a person matched once */
export type FileFormat = "aad_csv" | "reece_csv" | "me_pdf" | "headed";

export type Supplier = {
  key: string;
  name: string;
  pricing: PricingKind;
  file: FileKind;
  format: FileFormat;
  /** list_less: taken off every list price */
  discountPct: number;
  /** list_less: a range with a different discount (e.g. PUMY) */
  rules: DiscountRule[];
  /** the columns a person matched for a layout HeyTiff didn't know */
  columns?: Columns | null;
};

/** The suppliers whose files HeyTiff reads out of the box, for every
    business: no discount, no prices — those come from the business. */
export const BUILT_IN_SUPPLIERS: Supplier[] = [
  { key: "aad", name: "AAD", pricing: "net", file: "csv", format: "aad_csv", discountPct: 0, rules: [] },
  /* Reece's monthly account price file: section and sub-section rows, then
     code, description, unit, list and net prices ex and incl GST
     (2026-09-30) — the net ex GST is used. */
  { key: "reece", name: "Reece", pricing: "net", file: "csv", format: "reece_csv", discountPct: 0, rules: [] },
  { key: "mitsubishi", name: "Mitsubishi Electric", pricing: "list_less", file: "pdf", format: "me_pdf", discountPct: 0, rules: [] },
];

export const MAX_DISCOUNT_PCT = 90;

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
  const t = s.replace(/[$,\s]/g, "");
  /* an empty field is no price, not $0.00 */
  if (!t) return null;
  const n = Number(t);
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

/** One CSV line's fields, quotes honoured ("a, b" stays one field). A
    quote opens a field only at its start: mid-field it is an inch mark
    (Reece's `R410A 1/2" 12X0.81X18M`), and reading it as a quote ran the
    rest of the line into the name and priced 193 items at $0.00. */
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
    } else if (ch === '"' && cur === "") quoted = true;
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
export type ColumnField = (typeof HEADINGS)[number]["field"];
/** which column letter holds each field */
export type Columns = Partial<Record<ColumnField, string>>;

/** The fields a person matches, for a layout HeyTiff doesn't know. */
export const COLUMN_FIELDS: { field: ColumnField; label: string; required: boolean }[] = [
  { field: "code", label: "Code", required: true },
  { field: "name", label: "Description", required: false },
  { field: "price", label: "Price ex GST", required: true },
  { field: "uom", label: "Sold by (EA, MTR…)", required: false },
];

/** A column's letter, as a spreadsheet names it: 0 → A, 26 → AA. */
export function columnLetter(i: number): string {
  let n = i + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** A CSV's lines as a sheet's rows: each a map of column letter to value. */
export function csvRows(text: string): Row[] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => new Map(csvFields(l).map((v, i) => [columnLetter(i), v === "" ? null : v] as const)));
}

/** The first rows of a sheet, for a person to match its columns by. */
export function previewRows(rows: Row[], count = 8): { letters: string[]; rows: (string | number | null)[][] } {
  const head = rows.filter((r) => [...r.values()].some((v) => v != null && v !== "")).slice(0, count);
  const letters = [...new Set(head.flatMap((r) => [...r.keys()]))].sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, 26);
  return { letters, rows: head.map((r) => letters.map((l) => r.get(l) ?? null)) };
}

/** A sheet's price rows, found by their headings: code, description,
    price, and — when there — the date it was charged, how often and how
    many were bought, and the unit it's sold by. */
export function parseHeadedRows(rows: Row[], excelDate: (serial: number) => string, given?: Columns | null): ParseResult {
  /* columns a person matched are used as given: every row with a code and
     a number where the price is */
  let cols: Columns | null = given?.code && given.price ? given : null;
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
    if (!Number.isFinite(n) || (typeof price === "string" && !price.trim())) {
      /* before the first price, a heading or a title isn't a missed row */
      if (out.length > 0 || !given) skipped++;
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
  if (!s.discountPct && s.rules.length === 0) return "List prices, no discount set";
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
