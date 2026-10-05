import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { openPdf } from "@/lib/tiff/extract";
import { MAX_INVOICE_BYTES } from "@/lib/quotes/invoice-read";
import { isInvoiceMedia, readInvoice } from "@/lib/quotes/invoice-read-server";
import { readSuppliers } from "@/lib/quotes/price-book-server";

/* A supplier's invoice, a PDF or a photo, read for the person to look over
   (POST multipart: supplier, file): every product line on it, and what a
   quote pays for each code now and would once it's in. Nothing is saved
   here — the lines go in through /api/quoting/invoice-lines once they've
   been seen. `financials`, like the rest of the price book. */

/* reading a few pages of invoice takes Tiff tens of seconds */
export const maxDuration = 300;

/* an invoice, not a statement: a ceiling on what one press can spend */
const MAX_PAGES = 10;

async function gate(): Promise<{ orgId: string } | Response> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("financials"))) {
    return Response.json({ ok: false, reason: "The price book needs money access." }, { status: 403 });
  }
  return { orgId };
}

/** How many pages a PDF has, or null when it can't be opened. */
async function pagesOf(bytes: Buffer): Promise<number | null> {
  const pdf = await openPdf(new Uint8Array(bytes)).catch(() => null);
  if (!pdf) return null;
  const pages = pdf.numPages;
  await pdf.destroy();
  return pages;
}

export async function POST(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ ok: false, reason: "Tiff isn't set up on this deployment." });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ ok: false, reason: "Choose a file first." }, { status: 400 });
  if (!isInvoiceMedia(file.type)) return Response.json({ ok: false, reason: "Tiff reads an invoice from a PDF, or a photo as JPEG, PNG or WebP." }, { status: 400 });
  if (file.size > MAX_INVOICE_BYTES) return Response.json({ ok: false, reason: "That file is over 4 MB." }, { status: 400 });
  const supplier = (await readSuppliers(who.orgId)).find((s) => s.key === form?.get("supplier"));
  if (!supplier) return Response.json({ ok: false, reason: "No such supplier." }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  if (file.type === "application/pdf") {
    const pages = await pagesOf(bytes);
    if (pages === null) return Response.json({ ok: false, reason: "That PDF couldn't be opened." });
    if (pages > MAX_PAGES) return Response.json({ ok: false, reason: `That's ${pages} pages. Tiff reads an invoice of up to ${MAX_PAGES}.` });
  }
  return Response.json(await readInvoice(who.orgId, supplier, bytes, file.type));
}
