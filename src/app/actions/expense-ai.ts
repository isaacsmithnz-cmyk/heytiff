"use server";

import Anthropic from "@anthropic-ai/sdk";
import { getDbRole } from "@/lib/permissions-server";
import {
  EXPENSE_CATEGORIES,
  RECEIPT_PDF_TYPE,
  isExpenseCategory,
  isReadableReceipt,
  type ExpenseCategory,
} from "@/lib/expenses/claim";

/* Reading a general purchase receipt, for expense claims.

   A SIBLING OF readFuelReceipt, not a replacement. That one is deliberately
   fuel-specific — it asks for litres and a servo name, and its prompt tells
   Claude to return nothing at all if the docket isn't fuel. Generalising it
   would have made both jobs worse, so this is its own action with its own
   prompt, and the fleet one is untouched.

   THE OUTPUT IS A DRAFT, NEVER A SUBMISSION. Everything read here lands in a
   form the person then corrects and confirms. That matters more than usual:
   these figures become a reimbursement someone gets paid, and a GST figure
   ends up on a BAS. Claude is doing the typing, not the deciding.

   Same validated-call pattern as fleet-ai: a JSON schema on the way out, and
   every field re-checked in TypeScript on the way back — a schema constrains
   shape, not sense. */

const MODEL = "claude-opus-4-8";

function offline(): string | null {
  return process.env.ANTHROPIC_API_KEY ? null : "no-key";
}

function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Tiff is offline — API key rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Tiff is busy — try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Tiff — check the connection.";
  if (err instanceof Anthropic.APIError) return "Tiff hit an API error — try again.";
  return "Tiff couldn't read that receipt.";
}

export type ReadExpenseResult =
  | {
      ok: true;
      total: number | null;
      gst: number | null;
      supplier: string | null;
      date: string | null;
      description: string | null;
      category: ExpenseCategory | null;
    }
  | { ok: false; reason: string };

const EXPENSE_SCHEMA = {
  type: "object",
  properties: {
    total: { anyOf: [{ type: "number" }, { type: "null" }] },
    gst: { anyOf: [{ type: "number" }, { type: "null" }] },
    supplier: { anyOf: [{ type: "string" }, { type: "null" }] },
    date: { anyOf: [{ type: "string" }, { type: "null" }] },
    description: { anyOf: [{ type: "string" }, { type: "null" }] },
    category: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["total", "gst", "supplier", "date", "description", "category"],
  additionalProperties: false,
};

/* A PDF IS NOT AN IMAGE BLOCK. It rides in a `document` block with its own
   media type — same base64 source, same position before the text, no beta
   header — so the two paths differ only in how the block is shaped.

   `isReadableReceipt` and the type list live in lib/expenses/claim.ts: this is
   a `"use server"` file, so every export here must be an async Server
   Function, and a plain predicate exported from here would fail the build. */
type ReceiptImage = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export async function readExpenseReceipt(
  fileBase64: string,
  mediaType: string
): Promise<ReadExpenseResult> {
  // Any signed-in member: spending your own money on the job and claiming it
  // back is intrinsic, not a capability.
  if (!(await getDbRole())) return { ok: false, reason: "Sign in to scan receipts." };
  if (offline()) return { ok: false, reason: "no-key" };
  if (!isReadableReceipt(mediaType)) {
    return { ok: false, reason: "Tiff can read photos and PDFs." };
  }
  if (!fileBase64 || fileBase64.length > 14_000_000) {
    // ~10MB decoded — the same ceiling the documents bucket enforces, and
    // plenty for either a phone photo or a scanned multi-page invoice
    return { ok: false, reason: "That file is too large to read." };
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: EXPENSE_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            /* The file first, the question second — a document or image block
               is read as context for the text that follows it. */
            mediaType === RECEIPT_PDF_TYPE
              ? {
                  type: "document" as const,
                  source: { type: "base64" as const, media_type: "application/pdf" as const, data: fileBase64 },
                }
              : {
                  type: "image" as const,
                  source: { type: "base64" as const, media_type: mediaType as ReceiptImage, data: fileBase64 },
                },
            {
              type: "text",
              text:
                "This is an Australian purchase receipt or tax invoice — a photo of a " +
                "docket, or a supplier's emailed PDF invoice — from a " +
                "tradesperson claiming the cost back from their employer. Extract:\n" +
                "- total: the final amount paid INCLUDING GST, in dollars\n" +
                "- gst: the GST amount if the receipt states one, else null. Do NOT calculate " +
                "it — only report a figure the receipt actually shows.\n" +
                "- supplier: the business name (e.g. \"Reece Plumbing\", \"Bunnings Preston\")\n" +
                "- date: the purchase date as yyyy-mm-dd\n" +
                "- description: a short plain description of what was bought, under 60 " +
                "characters, e.g. \"Copper fittings and flux\"\n" +
                `- category: one of ${EXPENSE_CATEGORIES.join(", ")} — materials for parts and ` +
                "consumables, tools for equipment, travel for fuel/parking/tolls, meals for " +
                "food, other for anything else\n" +
                "Use null for anything not clearly readable. Never guess an amount.",
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, reason: "Tiff declined to read this file." };
    }

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const parsed = JSON.parse(text) as Record<string, unknown>;

    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
    const str = (v: unknown, max: number): string | null =>
      typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

    const total = num(parsed.total);
    const gstRaw = num(parsed.gst);

    return {
      ok: true,
      total,
      /* GST above the total is arithmetically impossible, and a mis-read of
         some other number on the docket. Dropping it beats prefilling a figure
         that would end up on a BAS. */
      gst: gstRaw !== null && total !== null && gstRaw > total ? null : gstRaw,
      supplier: str(parsed.supplier, 120),
      date:
        typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
          ? parsed.date
          : null,
      description: str(parsed.description, 200),
      // The schema can only say "a string"; this is what says "one of ours".
      category: isExpenseCategory(parsed.category) ? parsed.category : null,
    };
  } catch (err) {
    return { ok: false, reason: reasonFor(err) };
  }
}
