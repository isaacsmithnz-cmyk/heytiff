import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { bookPriceOf, namesSupplier, withBookPrices, type HeldItem } from "@/lib/quotes/invoice-read";
import { askInvoiceReader, heldOf, type InvoiceMedia } from "@/lib/quotes/invoice-read-server";
import { importInvoiceRows, readSuppliers } from "@/lib/quotes/price-book-server";
import { todayInSydney, type PriceRow, type Supplier } from "@/lib/quotes/price-book";
import { MAX_INVOICE_BYTES } from "@/lib/quotes/invoice-read";
import { isInvoiceMedia } from "@/lib/quotes/invoice-read-server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { openPdf } from "@/lib/tiff/extract";
import { streetLine } from "@/lib/studio/job-link";
import { judgeLine, parseDocketRead, type BookEffect, type DocketRead, type Purchase, type PurchaseLine, type WentTo } from "./purchase";

/* PURCHASES, server side (purchase.ts says what a purchase is). Service
   role; the actions gate on who may add one, and Team's read on
   `financials`.

   ADDING ONE does three things, in this order:
   1. reads the docket (the price book's reader, a purchase's belief);
   2. asks the book what it held for each code BEFORE anything changes, so
      every line can say what it did ("Price up, $268.40 to $273.87");
   3. keeps the purchase and its lines, then puts the docket's prices into
      the book the way any invoice goes in (importInvoiceRows): only a
      supplier the book keeps, only lines with a code and the docket's own
      price. A price taken FROM the book is never put back into it. */

/** The book's supplier a docket names, when the business keeps one. */
export function supplierNamed(read: string, suppliers: Supplier[]): Supplier | null {
  if (!read) return null;
  return suppliers.find((s) => namesSupplier(read, s.name)) ?? null;
}

/** Read a docket. Nothing is saved. */
export async function readDocket(bytes: Buffer, mediaType: InvoiceMedia) {
  return askInvoiceReader<DocketRead>(bytes, mediaType, parseDocketRead);
}

type LineRow = {
  id: string;
  position: number;
  code: string;
  name: string;
  qty: number | string;
  cents: number | null;
  price_from: "docket" | "book";
  book: BookEffect;
  book_before_cents: number | null;
  book_after_cents: number | null;
  went_to: WentTo;
  sm8_job_uuid: string | null;
  job_label: string | null;
};

const LINE_COLUMNS = "id, position, code, name, qty, cents, price_from, book, book_before_cents, book_after_cents, went_to, sm8_job_uuid, job_label";

export const lineOf = (r: LineRow): PurchaseLine => ({
  id: r.id,
  position: r.position,
  code: r.code,
  name: r.name,
  qty: Number(r.qty),
  cents: r.cents,
  priceFrom: r.price_from,
  book: r.book,
  bookBefore: r.book_before_cents,
  bookAfter: r.book_after_cents,
  wentTo: r.went_to,
  jobUuid: r.sm8_job_uuid,
  jobLabel: r.job_label,
});

/** Keep a docket that's been read, and put its prices in the book. Returns
    the purchase's id. */
export async function addPurchase(
  orgId: string,
  input: { read: DocketRead; addedBy: string; boughtBy: string | null; documentId: string | null }
): Promise<string> {
  const { read } = input;
  const suppliers = await readSuppliers(orgId);
  const supplier = supplierNamed(read.supplier, suppliers);
  const codes = [...new Set(read.lines.map((l) => l.code).filter(Boolean))];
  const held: Map<string, HeldItem> = supplier && codes.length ? await heldOf(orgId, supplier.key, codes) : new Map();
  const on = read.invoiceDate ?? todayInSydney();

  /* what the book holds now, and would once the priced lines are in */
  const priced = supplier ? read.lines.filter((l) => l.code && l.cents != null) : [];
  const after = new Map(
    supplier
      ? withBookPrices(
          priced.map((l) => ({ code: l.code, name: l.name, qty: l.qty, cents: l.cents as number })),
          held,
          supplier,
          on
        ).map((l) => [l.code, l])
      : []
  );

  const { data: made, error } = await supabaseAdmin
    .from("purchases")
    .insert({
      org_id: orgId,
      supplier_name: read.supplier,
      supplier_key: supplier?.key ?? null,
      invoice_no: read.invoiceNo,
      invoice_date: read.invoiceDate,
      bought_by: input.boughtBy,
      added_by: input.addedBy,
      skipped: read.skipped,
    })
    .select("id")
    .single();
  if (error || !made) throw new Error(error?.message ?? "the purchase wasn't kept");
  const purchaseId = (made as { id: string }).id;

  const rows = read.lines.map((l, i) => {
    const prices = !supplier || !l.code ? null : l.cents != null ? (after.get(l.code) ?? null) : { now: bookPriceOf(supplier, held.get(l.code)), after: 0 };
    const judged = judgeLine(l, prices);
    return {
      org_id: orgId,
      purchase_id: purchaseId,
      position: i,
      code: l.code,
      name: l.name,
      qty: l.qty,
      cents: judged.cents,
      price_from: judged.priceFrom,
      book: judged.book,
      book_before_cents: judged.bookBefore,
      book_after_cents: judged.bookAfter,
    };
  });
  if (rows.length) {
    const { error: linesError } = await supabaseAdmin.from("purchase_lines").insert(rows);
    if (linesError) {
      await supabaseAdmin.from("purchases").delete().eq("id", purchaseId);
      throw new Error(linesError.message);
    }
  }
  if (input.documentId) {
    await supabaseAdmin.from("documents").update({ purchase_id: purchaseId }).eq("id", input.documentId).eq("org_id", orgId);
  }

  /* the docket's prices into the book, as any invoice goes in */
  if (supplier && priced.length) {
    const book = new Map<string, PriceRow>();
    for (const l of priced) book.set(l.code, { code: l.code, name: l.name, cents: l.cents as number, pricedOn: on });
    await importInvoiceRows(orgId, supplier, read.invoiceNo ? `invoice ${read.invoiceNo}` : "a purchase", [...book.values()]).catch((err) =>
      console.error("[purchases] the book wasn't updated:", err instanceof Error ? err.message : err)
    );
  }
  return purchaseId;
}

type PurchaseRow = {
  id: string;
  supplier_name: string;
  supplier_key: string | null;
  invoice_no: string;
  invoice_date: string | null;
  bought_by: string | null;
  created_at: string;
  skipped: unknown;
};

const PURCHASE_COLUMNS = "id, supplier_name, supplier_key, invoice_no, invoice_date, bought_by, created_at, skipped";

async function namesOf(orgId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await supabaseAdmin.from("staff_profiles").select("id, full_name, preferred_name").eq("org_id", orgId).in("id", ids);
  return new Map(((data ?? []) as { id: string; full_name: string | null; preferred_name: string | null }[]).map((s) => [s.id, s.full_name || s.preferred_name || "Someone"]));
}

const skippedOf = (v: unknown): Purchase["skipped"] =>
  Array.isArray(v) ? v.filter((s): s is { name: string; why: string } => !!s && typeof s.name === "string" && typeof s.why === "string") : [];

/** Purchases with their lines, newest first. */
export async function readPurchases(orgId: string, opts: { ids?: string[]; limit?: number } = {}): Promise<Purchase[]> {
  let q = supabaseAdmin.from("purchases").select(PURCHASE_COLUMNS).eq("org_id", orgId).order("created_at", { ascending: false });
  if (opts.ids) q = q.in("id", opts.ids);
  const { data, error } = await q.limit(opts.limit ?? 200);
  if (error) throw new Error(error.message);
  const heads = (data ?? []) as PurchaseRow[];
  if (!heads.length) return [];
  const ids = heads.map((h) => h.id);
  const [{ data: lineData }, { data: docData }, names] = await Promise.all([
    supabaseAdmin.from("purchase_lines").select(`purchase_id, ${LINE_COLUMNS}`).in("purchase_id", ids).order("position"),
    supabaseAdmin.from("documents").select("id, purchase_id").eq("org_id", orgId).in("purchase_id", ids),
    namesOf(orgId, [...new Set(heads.map((h) => h.bought_by).filter((v): v is string => !!v))]),
  ]);
  const lines = new Map<string, PurchaseLine[]>();
  for (const r of (lineData ?? []) as (LineRow & { purchase_id: string })[]) {
    lines.set(r.purchase_id, [...(lines.get(r.purchase_id) ?? []), lineOf(r)]);
  }
  const docs = new Map(((docData ?? []) as { id: string; purchase_id: string }[]).map((d) => [d.purchase_id, d.id]));
  return heads.map((h) => ({
    id: h.id,
    supplierName: h.supplier_name,
    supplierKey: h.supplier_key,
    invoiceNo: h.invoice_no,
    invoiceDate: h.invoice_date,
    boughtBy: h.bought_by ? { id: h.bought_by, name: names.get(h.bought_by) ?? "Someone" } : null,
    createdAt: h.created_at,
    skipped: skippedOf(h.skipped),
    documentId: docs.get(h.id) ?? null,
    lines: lines.get(h.id) ?? [],
  }));
}

export async function readPurchase(orgId: string, id: string): Promise<Purchase | null> {
  return (await readPurchases(orgId, { ids: [id], limit: 1 }))[0] ?? null;
}

/** Put lines somewhere: a job, stock, or back to open (Undo). Only lines of
    this purchase in this org move. */
export async function placeLines(
  orgId: string,
  purchaseId: string,
  lineIds: string[],
  to: { wentTo: "job"; jobUuid: string; jobLabel: string } | { wentTo: "stock" } | { wentTo: "open" },
  by: string
): Promise<void> {
  if (!lineIds.length) return;
  const patch =
    to.wentTo === "job"
      ? { went_to: "job", sm8_job_uuid: to.jobUuid, job_label: to.jobLabel.slice(0, 160), placed_by: by, placed_at: new Date().toISOString() }
      : to.wentTo === "stock"
        ? { went_to: "stock", sm8_job_uuid: null, job_label: null, placed_by: by, placed_at: new Date().toISOString() }
        : { went_to: "open", sm8_job_uuid: null, job_label: null, placed_by: null, placed_at: null };
  const { error } = await supabaseAdmin.from("purchase_lines").update(patch).eq("org_id", orgId).eq("purchase_id", purchaseId).in("id", lineIds);
  if (error) throw new Error(error.message);
  await supabaseAdmin.from("purchases").update({ updated_at: new Date().toISOString() }).eq("org_id", orgId).eq("id", purchaseId);
}

/** A price typed for a line the docket and the book had none for. A line
    with a code at a supplier the book keeps goes into the book too. */
export async function priceLine(orgId: string, purchaseId: string, lineId: string, cents: number): Promise<void> {
  const purchase = await readPurchase(orgId, purchaseId);
  const line = purchase?.lines.find((l) => l.id === lineId);
  if (!purchase || !line) throw new Error("No such line.");
  const supplier = purchase.supplierKey ? ((await readSuppliers(orgId)).find((s) => s.key === purchase.supplierKey) ?? null) : null;
  const intoBook = !!supplier && !!line.code;
  const { error } = await supabaseAdmin
    .from("purchase_lines")
    .update({ cents, price_from: "docket", book: intoBook ? "new" : "none", book_before_cents: null, book_after_cents: intoBook ? cents : null })
    .eq("org_id", orgId)
    .eq("id", lineId);
  if (error) throw new Error(error.message);
  if (intoBook && supplier) {
    await importInvoiceRows(orgId, supplier, purchase.invoiceNo ? `invoice ${purchase.invoiceNo}` : "a purchase", [
      { code: line.code, name: line.name, cents, pricedOn: purchase.invoiceDate ?? todayInSydney() },
    ]).catch((err) => console.error("[purchases] the book wasn't updated:", err instanceof Error ? err.message : err));
  }
}

/** A job's Bought: every line that went to it, newest purchase first, with
    who bought it and from whom. */
export type BoughtLine = PurchaseLine & { purchaseId: string; supplierName: string; boughtBy: string | null; on: string };
export async function boughtForJob(orgId: string, jobUuid: string): Promise<BoughtLine[]> {
  const { data, error } = await supabaseAdmin
    .from("purchase_lines")
    .select(`purchase_id, ${LINE_COLUMNS}`)
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .order("position");
  if (error || !data?.length) return [];
  const rows = data as (LineRow & { purchase_id: string })[];
  const purchases = new Map((await readPurchases(orgId, { ids: [...new Set(rows.map((r) => r.purchase_id))] })).map((p) => [p.id, p]));
  return rows
    .filter((r) => purchases.has(r.purchase_id))
    .map((r) => {
      const p = purchases.get(r.purchase_id)!;
      return { ...lineOf(r), purchaseId: p.id, supplierName: p.supplierName, boughtBy: p.boughtBy?.name ?? null, on: p.invoiceDate ?? p.createdAt.slice(0, 10) };
    })
    .sort((a, b) => (a.on === b.on ? 0 : a.on < b.on ? 1 : -1));
}

/** What the job's quote allows for materials: the cost of its material
    lines in the first option (an option prices only its difference), in
    cents; null when the job has no quote in HeyTiff. Cost against cost:
    what was bought is set against what the quote expected to pay. */
export async function materialsAllowance(orgId: string, jobUuid: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("quote_lines")
    .select("qty, cost_cents")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .eq("option_index", 0)
    .eq("kind", "material");
  if (error || !data?.length) return null;
  return Math.round((data as { qty: number | string; cost_cents: number | string }[]).reduce((s, r) => s + Number(r.qty) * Number(r.cost_cents), 0));
}

/** A job as a purchase names it, and keeps: "1352, 9/6 Holbrook Avenue", the
    phone's own way (booking-push). Null when the job isn't this org's. */
export async function jobLabelFor(orgId: string, jobUuid: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("sm8_jobs").select("generated_job_id, job_address").eq("org_id", orgId).eq("uuid", jobUuid).maybeSingle();
  if (!data) return null;
  const j = data as { generated_job_id: string | null; job_address: string | null };
  return [j.generated_job_id, streetLine(j.job_address)].filter(Boolean).join(", ") || "A job";
}

/* an invoice, not a statement: a ceiling on what one read can spend */
const MAX_PAGES = 10;

/** A docket that has landed in the bucket, read and kept as a purchase. The
    photo is adopted only by the person who uploaded it, only once, and only
    as a docket. */
export async function purchaseFromDocument(
  orgId: string,
  who: { userId: string; staffId: string },
  documentId: string
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const { data: doc } = await supabaseAdmin
    .from("documents")
    .select("id, storage_ref, mime_type, size_bytes")
    .eq("org_id", orgId)
    .eq("id", documentId)
    .eq("kind", "purchase_docket")
    .eq("uploaded_by", who.staffId)
    .not("uploaded_at", "is", null)
    .is("purchase_id", null)
    .maybeSingle();
  if (!doc) return { ok: false, reason: "That photo couldn't be found. Take it again." };
  const d = doc as { id: string; storage_ref: string; mime_type: string; size_bytes: number };
  const media = d.mime_type.toLowerCase();
  if (!isInvoiceMedia(media)) return { ok: false, reason: "Tiff reads a docket from a PDF, or a photo as JPEG, PNG or WebP." };
  if (d.size_bytes > MAX_INVOICE_BYTES) return { ok: false, reason: "That file is over 4 MB." };
  const { data: blob, error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(d.storage_ref);
  if (error || !blob) return { ok: false, reason: "The photo couldn't be opened. Try again." };
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (media === "application/pdf") {
    const pdf = await openPdf(new Uint8Array(bytes)).catch(() => null);
    if (!pdf) return { ok: false, reason: "That PDF couldn't be opened." };
    const pages = pdf.numPages;
    await pdf.destroy();
    if (pages > MAX_PAGES) return { ok: false, reason: `That's ${pages} pages. Tiff reads a docket of up to ${MAX_PAGES}.` };
  }
  const read = await readDocket(bytes, media);
  if (!read.ok) return read;
  if (!read.read.lines.length) return { ok: false, reason: "Tiff found nothing bought on it. Is it a supplier's docket?" };
  try {
    const id = await addPurchase(orgId, { read: read.read, addedBy: who.userId, boughtBy: who.staffId, documentId: d.id });
    return { ok: true, id };
  } catch (err) {
    console.error("[purchases] keeping a purchase failed:", err instanceof Error ? err.message : err);
    return { ok: false, reason: "The purchase couldn't be kept. Try again." };
  }
}

/** Who added a purchase, to say whether a person without money access may
    open it: they may open their own. */
export async function purchaseAddedBy(orgId: string, id: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("purchases").select("added_by").eq("org_id", orgId).eq("id", id).maybeSingle();
  return (data as { added_by: string } | null)?.added_by ?? null;
}

/** The jobs a person's purchases went to lately, newest first: the Which
    job? sheet's Recent. */
export async function recentPurchaseJobs(orgId: string, userId: string, limit = 6): Promise<{ jobUuid: string; label: string }[]> {
  const { data } = await supabaseAdmin
    .from("purchase_lines")
    .select("sm8_job_uuid, job_label, placed_at")
    .eq("org_id", orgId)
    .eq("placed_by", userId)
    .not("sm8_job_uuid", "is", null)
    .order("placed_at", { ascending: false })
    .limit(80);
  const out = new Map<string, string>();
  for (const r of (data ?? []) as { sm8_job_uuid: string; job_label: string | null }[]) {
    if (!out.has(r.sm8_job_uuid)) out.set(r.sm8_job_uuid, r.job_label || "A job");
    if (out.size >= limit) break;
  }
  return [...out].map(([jobUuid, label]) => ({ jobUuid, label }));
}
