import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { MAX_INVOICE_LINES } from "@/lib/quotes/invoice-read";
import { todayInSydney, type PriceRow } from "@/lib/quotes/price-book";
import { importInvoiceRows, readSuppliers } from "@/lib/quotes/price-book-server";

/* An invoice's lines, looked over and added (POST {supplier, invoiceNo,
   invoiceDate, fileName, lines: [{code, name, cents}]}): Tiff read them off
   the PDF or photo (/api/quoting/invoice-read), the person saw them, and
   these are what was paid. Only those codes change, as any invoice does
   (planInvoices). `financials`, like the rest of the price book. */

async function gate(): Promise<{ orgId: string } | Response> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("financials"))) {
    return Response.json({ ok: false, reason: "The price book needs money access." }, { status: 403 });
  }
  return { orgId };
}

/** A line as the page sent it, only when it holds up. */
function rowOf(v: unknown, on: string): PriceRow | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const code = typeof r.code === "string" ? r.code.trim().slice(0, 80) : "";
  const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  const cents = typeof r.cents === "number" && Number.isInteger(r.cents) ? r.cents : 0;
  if (!code || !(cents > 0) || cents > 100_000_000) return null;
  return { code, name: name || code, cents, pricedOn: on };
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const supplier = (await readSuppliers(who.orgId)).find((s) => s.key === body?.supplier);
  if (!supplier) return Response.json({ ok: false, reason: "No such supplier." }, { status: 400 });
  /* the invoice's date, never one after today; else today */
  const today = todayInSydney();
  const date = text(body?.invoiceDate, 10);
  const on = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : today;
  /* the same code twice: its last price */
  const rows = new Map<string, PriceRow>();
  for (const v of Array.isArray(body?.lines) ? body.lines.slice(0, MAX_INVOICE_LINES) : []) {
    const row = rowOf(v, on);
    if (row) rows.set(row.code, row);
  }
  if (rows.size === 0) return Response.json({ ok: false, reason: "No prices to add." }, { status: 400 });
  const invoiceNo = text(body?.invoiceNo, 40);
  const fileName = text(body?.fileName, 160);
  const from = fileName || (invoiceNo ? `invoice ${invoiceNo}` : "an invoice");
  try {
    return Response.json({ ok: true, summary: await importInvoiceRows(who.orgId, supplier, from, [...rows.values()]) });
  } catch (err) {
    console.error("[price book] adding an invoice failed:", err instanceof Error ? err.message : err);
    return Response.json({ ok: false, reason: "The prices couldn't be added. Try again." });
  }
}
