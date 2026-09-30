import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { openPdf } from "@/lib/tiff/extract";
import { parseAadCsv, parseInvoicedRows, parseMitsubishiLines, parseReeceCsv, type ParseResult } from "@/lib/quotes/price-book";
import { excelDate, readSheet, sheetNames } from "@/lib/quotes/xlsx";
import { findOffers, importPriceRows, readSuppliers } from "@/lib/quotes/price-book-server";

/* The price book in Admin → Quoting: look a model up at every supplier
   (GET ?q=), or take in a supplier's new file (POST, multipart: supplier,
   file). A route, not a server action: the Mitsubishi trade book is a 3 MB
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

export async function GET(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 60);
  const suppliers = await readSuppliers(who.orgId);
  return Response.json({ ok: true, models: await findOffers(who.orgId, q, suppliers) });
}

export async function POST(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const form = await req.formData().catch(() => null);
  const key = String(form?.get("supplier") ?? "");
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ ok: false, reason: "Choose a file first." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ ok: false, reason: "That file is over 8 MB." }, { status: 400 });

  const supplier = (await readSuppliers(who.orgId)).find((s) => s.key === key);
  if (!supplier) return Response.json({ ok: false, reason: "No such supplier." }, { status: 400 });

  let parsed: ParseResult;
  try {
    if (supplier.format === "aad_csv") {
      parsed = parseAadCsv(await file.text());
    } else if (supplier.format === "reece_csv") {
      parsed = parseReeceCsv(await file.text());
    } else if (supplier.format === "me_invoice_xlsx") {
      /* the first sheet whose headings name a code and a price */
      const bytes = Buffer.from(await file.arrayBuffer());
      parsed = { rows: [], conflicts: [], skipped: 0 };
      for (const name of sheetNames(bytes)) {
        parsed = parseInvoicedRows(readSheet(bytes, name), excelDate);
        if (parsed.rows.length > 0) break;
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
    return Response.json({ ok: false, reason: "No prices found in that file. Is it the supplier's price list?" });
  }

  const summary = await importPriceRows(who.orgId, supplier, file.name, parsed.rows);
  return Response.json({ ok: true, summary, conflicts: parsed.conflicts, skipped: parsed.skipped });
}
