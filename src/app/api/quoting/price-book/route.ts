import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { openPdf } from "@/lib/tiff/extract";
import {
  COLUMN_FIELDS,
  MAX_DISCOUNT_PCT,
  csvRows,
  parseAadCsv,
  parseHeadedRows,
  parseMitsubishiLines,
  parseReeceCsv,
  previewRows,
  dateInName,
  todayInSydney,
  type Columns,
  type ParseResult,
  type PricingKind,
} from "@/lib/quotes/price-book";
import { excelDate, readSheet, sheetNames } from "@/lib/quotes/xlsx";
import { bookProducts } from "@/lib/quotes/book-view-server";
import { importInvoiceRows, importPriceRows, readSuppliers, saveSupplierLayout } from "@/lib/quotes/price-book-server";

/* The price book: the whole book as products (GET), sorted, searched and
   viewed in the browser so a shelf or a search answers at once — or a
   supplier's new file taken in (POST,
   multipart: supplier, file, kind). `kind` is "list", a price list that
   replaces the last one, or "invoices", what was paid for the codes on them
   and nothing else — the same supplier either way. A route, not a server action: the Mitsubishi trade book is a 3 MB
   PDF, past a server action's body limit, and reading it takes seconds.

   `financials`, like the rest of Quoting: these are the business's buying
   prices. */

export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;

async function gate(): Promise<{ orgId: string } | Response> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("financials"))) {
    return Response.json({ ok: false, reason: "The price book needs money access." }, { status: 403 });
  }
  return { orgId };
}

export async function GET() {
  const who = await gate();
  if (who instanceof Response) return who;
  return Response.json({ ok: true, products: await bookProducts(who.orgId) });
}

/** The columns a person matched, from the form: known fields, column
    letters only, a code and a price at least. */
function matchedColumns(raw: FormDataEntryValue | null | undefined): Columns | null {
  if (typeof raw !== "string" || !raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const out: Columns = {};
  for (const { field } of COLUMN_FIELDS) {
    const letter = (v as Record<string, unknown>)[field];
    if (typeof letter === "string" && /^[A-Z]{1,2}$/.test(letter)) out[field] = letter;
  }
  return out.code && out.price ? out : null;
}

/** A CSV's one sheet, or a workbook's sheets, as rows by column letter. */
async function sheetsOf(file: File) {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") return [csvRows(await file.text())];
  const bytes = Buffer.from(await file.arrayBuffer());
  return sheetNames(bytes).map((n) => readSheet(bytes, n));
}

export async function POST(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const form = await req.formData().catch(() => null);
  const key = String(form?.get("supplier") ?? "");
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ ok: false, reason: "Choose a file first." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ ok: false, reason: "That file is over 8 MB." }, { status: 400 });

  let supplier = (await readSuppliers(who.orgId)).find((s) => s.key === key);
  if (!supplier) return Response.json({ ok: false, reason: "No such supplier." }, { status: 400 });

  let parsed: ParseResult;
  const invoices = form?.get("kind") === "invoices";
  try {
    if (invoices) {
      /* invoices are a workbook or CSV of what was paid, read by heading
         or by the columns a person matched just now; the layout isn't kept,
         because it isn't the price list's */
      const given = matchedColumns(form?.get("columns"));
      const sheets = await sheetsOf(file);
      parsed = { rows: [], conflicts: [], skipped: 0 };
      for (const rows of sheets) {
        parsed = parseHeadedRows(rows, excelDate, given);
        if (parsed.rows.length > 0) break;
      }
      if (parsed.rows.length === 0 && !given) {
        const first = sheets.find((rows) => rows.some((r) => r.size > 0));
        if (first) return Response.json({ ok: false, needsColumns: true, reason: "Which column is which?", preview: previewRows(first) });
      }
    } else if (supplier.format === "aad_csv") {
      parsed = parseAadCsv(await file.text());
    } else if (supplier.format === "reece_csv") {
      parsed = parseReeceCsv(await file.text());
    } else if (supplier.format === "headed") {
      /* the first sheet whose headings name a code and a price — or read
         by the columns a person matched, just now or for the last file */
      const given = matchedColumns(form?.get("columns"));
      const sheets = await sheetsOf(file);
      parsed = { rows: [], conflicts: [], skipped: 0 };
      for (const rows of sheets) {
        parsed = parseHeadedRows(rows, excelDate, given ?? supplier.columns);
        if (parsed.rows.length === 0 && !given && supplier.columns) parsed = parseHeadedRows(rows, excelDate);
        if (parsed.rows.length > 0) break;
      }
      if (parsed.rows.length === 0 && !given) {
        /* a layout HeyTiff doesn't know: the first rows, to match once */
        const first = sheets.find((rows) => rows.some((r) => r.size > 0));
        if (first) return Response.json({ ok: false, needsColumns: true, reason: "Which column is which?", preview: previewRows(first) });
      }
      if (given && parsed.rows.length > 0) {
        const pricing: PricingKind = form?.get("pricing") === "list_less" ? "list_less" : "net";
        const pct = Math.min(MAX_DISCOUNT_PCT, Math.max(0, Number(form?.get("discountPct")) || 0));
        await saveSupplierLayout(who.orgId, supplier, given, pricing, pricing === "list_less" ? pct : 0);
        supplier = { ...supplier, columns: given, pricing, discountPct: pricing === "list_less" ? pct : 0 };
      }
    } else {
      const pdf = await openPdf(new Uint8Array(await file.arrayBuffer()));
      try {
        const lines: string[] = [];
        for (let n = 1; n <= pdf.numPages; n++) lines.push(...(await pdf.pageLines(n)));
        parsed = parseMitsubishiLines(lines);
      } finally {
        await pdf.destroy();
      }
    }
  } catch {
    return Response.json({ ok: false, reason: "That file couldn't be read. Is it the supplier's price list?" });
  }
  if (parsed.rows.length === 0) {
    return Response.json({
      ok: false,
      reason: invoices ? "No prices found in that file. Does it have a code and a price column?" : "No prices found in that file. Is it the supplier's price list?",
    });
  }

  /* a price list's prices are from the date its name gives, else today */
  const summary = invoices
    ? await importInvoiceRows(who.orgId, supplier, file.name, parsed.rows)
    : await importPriceRows(who.orgId, supplier, file.name, parsed.rows, dateInName(file.name) ?? todayInSydney());
  return Response.json({ ok: true, summary, conflicts: parsed.conflicts, skipped: parsed.skipped });
}
