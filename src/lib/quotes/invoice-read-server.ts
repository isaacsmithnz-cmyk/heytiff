import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { INVOICE_LINES_PROMPT, INVOICE_LINES_SCHEMA, parseInvoiceRead, withBookPrices, type HeldItem, type InvoiceRead, type ReadInvoice } from "./invoice-read";
import { todayInSydney, type Supplier } from "./price-book";

/* A supplier's invoice read by Tiff (invoice-read.ts says what's asked and
   what's believed), each line beside what a quote pays for that code now
   and would once it's in. Reads only: the lines are saved when the person
   adds them. Service role; the route gates on `financials`. */

/* Sonnet, not Opus (Isaac, 2026-10-05: "yes switch the invoice reader to
   sonnet"): copying an invoice's lines off a page is well within it, at
   half the price a read. */
const MODEL = "claude-sonnet-5-5";
/* If the model declines on policy grounds, the API re-runs the same request
   on this one inside the same call, as the proposal writer does. */
const FALLBACK_MODEL = "claude-opus-4-8";

/** What Tiff reads an invoice from: a PDF, or a photo of one. */
export const INVOICE_MEDIA = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type InvoiceMedia = (typeof INVOICE_MEDIA)[number];
export const isInvoiceMedia = (t: string): t is InvoiceMedia => (INVOICE_MEDIA as readonly string[]).includes(t);

function reasonFor(err: unknown): string {
  if (err instanceof SyntaxError) return "Tiff's reading couldn't be used. Try again.";
  if (err instanceof Anthropic.RateLimitError) return "Tiff is busy. Try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Tiff couldn't be reached. Try again.";
  return "The invoice couldn't be read. Try again.";
}

/** What Tiff makes of the file, believed only as far as it holds up. */
async function askTiff(bytes: Buffer, mediaType: InvoiceMedia, client: Anthropic): Promise<{ ok: true; read: InvoiceRead } | { ok: false; reason: string }> {
  const data = bytes.toString("base64");
  const file: Anthropic.Beta.Messages.BetaContentBlockParam =
    mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data } };
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: FALLBACK_MODEL }],
      /* medium, set rather than left to the default: which column is the
         price after the line's discount, and which quantity was supplied,
         is reading, not copying */
      output_config: { effort: "medium", format: { type: "json_schema", schema: INVOICE_LINES_SCHEMA } },
      /* the file BEFORE the ask: the invoice is read, then what to take off it */
      messages: [{ role: "user", content: [file, { type: "text", text: INVOICE_LINES_PROMPT }] }],
    });
    if (response.stop_reason === "refusal") return { ok: false, reason: "Tiff declined to read this invoice." };
    if (response.stop_reason === "max_tokens") return { ok: false, reason: "That invoice is too long to read in one go." };
    /* THE LAST text block: when the fallback model takes over, the first
       model's partial answer can stand ahead of the full one */
    const block = [...response.content].reverse().find((b) => b.type === "text");
    if (!block || block.type !== "text") return { ok: false, reason: "Tiff found nothing to read. Try again." };
    return { ok: true, read: parseInvoiceRead(JSON.parse(block.text), todayInSydney()) };
  } catch (err) {
    console.error("[price book] reading an invoice failed:", err instanceof Error ? err.message : err);
    return { ok: false, reason: reasonFor(err) };
  }
}

/** What the book holds at the supplier for these codes. */
async function heldOf(orgId: string, supplierKey: string, codes: string[]): Promise<Map<string, HeldItem>> {
  const out = new Map<string, HeldItem>();
  for (let i = 0; i < codes.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from("quote_price_items")
      .select(
        "code, name, cents, previous_cents, price_changed_at, first_seen_at, last_import_at, current, on_list, paid_cents, paid_on, times_bought, qty_bought, listed_on, priced_on"
      )
      .eq("org_id", orgId)
      .eq("supplier_key", supplierKey)
      .in("code", codes.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as HeldItem[]) out.set(r.code, r);
  }
  return out;
}

/** Read one invoice for a supplier: every product line on it, and what a
    quote pays for each now and would once it's in. */
export async function readInvoice(
  orgId: string,
  supplier: Supplier,
  bytes: Buffer,
  mediaType: InvoiceMedia,
  client: Anthropic = new Anthropic()
): Promise<{ ok: true; read: ReadInvoice } | { ok: false; reason: string }> {
  const asked = await askTiff(bytes, mediaType, client);
  if (!asked.ok) return asked;
  const { read } = asked;
  const held = await heldOf(orgId, supplier.key, read.lines.map((l) => l.code)).catch(() => null);
  if (!held) return { ok: false, reason: "The price book couldn't be read. Try again." };
  return { ok: true, read: { ...read, lines: withBookPrices(read.lines, held, supplier, read.invoiceDate ?? todayInSydney()) } };
}
