"use server";

import Anthropic from "@anthropic-ai/sdk";
import { getDbRole } from "@/lib/permissions-server";

/* Fleet ← Tiff: live AU-market vehicle valuations + fuel-receipt reading.
   First real Claude integration in the app. Role rules are enforced HERE, not
   just hidden in the UI (spec: valuations are Manager+; receipts any member). */

const MODEL = "claude-opus-4-8";

function offline(): string | null {
  return process.env.ANTHROPIC_API_KEY ? null : "no-key";
}

function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Tiff is offline — API key rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Tiff is busy — try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Tiff — check the connection.";
  if (err instanceof Anthropic.APIError) return "Tiff hit an API error — try again.";
  return "Tiff couldn't complete that.";
}

/* Fleet valuation used to live here. It moved to the route handler at
   `src/app/api/fleet/value/route.ts` when it gained web search: grounding a
   valuation in live listings turned a one-shot call into a multi-minute one,
   and `maxDuration` is a route-segment option an action cannot set for itself.
   Receipt reading stays an action — it is a single short vision call. */

/* ---------------- fuel-receipt reading (any signed-in member) ---------------- */

/* A fuel docket is TWO documents at once: a fleet fact (how much fuel went in
   which van) and a tax record (what was spent, on what GST, with whom). It was
   only ever read as the first. `gst` and `abn` are what the second needs — the
   two figures the ATO asks for and the two a photo of a docket already has
   printed on it. */
export type ReadReceiptResult =
  | {
      ok: true;
      litres: number | null;
      cost: number | null;
      station: string | null;
      date: string | null;
      gst: number | null;
      abn: string | null;
    }
  | { ok: false; reason: string };

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    litres: { anyOf: [{ type: "number" }, { type: "null" }] },
    cost: { anyOf: [{ type: "number" }, { type: "null" }] },
    station: { anyOf: [{ type: "string" }, { type: "null" }] },
    date: { anyOf: [{ type: "string" }, { type: "null" }] },
    gst: { anyOf: [{ type: "number" }, { type: "null" }] },
    abn: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["litres", "cost", "station", "date", "gst", "abn"],
  additionalProperties: false,
};

/** An ABN as it will be stored: eleven digits, no spaces. Returns null for
    anything else rather than half a number — a malformed ABN on a BAS is
    worse than a blank one, because a blank one looks like what it is. */
function normaliseAbn(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

const RECEIPT_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ReceiptMedia = (typeof RECEIPT_MEDIA)[number];

export async function readFuelReceipt(
  imageBase64: string,
  mediaType: string,
): Promise<ReadReceiptResult> {
  // Any member may scan a receipt — logging fuel is intrinsic, even for
  // someone with no vehicle assigned (they may fuel a pool vehicle).
  if (!(await getDbRole())) return { ok: false, reason: "Sign in to scan receipts." };
  if (offline()) return { ok: false, reason: "no-key" };
  if (!RECEIPT_MEDIA.includes(mediaType as ReceiptMedia)) {
    return { ok: false, reason: "Unsupported image type." };
  }
  if (!imageBase64 || imageBase64.length > 14_000_000) {
    // ~10MB decoded — plenty for a phone photo of a docket
    return { ok: false, reason: "That photo is too large to read." };
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: RECEIPT_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as ReceiptMedia, data: imageBase64 },
            },
            {
              type: "text",
              text:
                "This is a photo of a fuel receipt/docket from an Australian servo. Extract:\n" +
                "- litres: litres of fuel purchased\n" +
                "- cost: the total cost in dollars, GST inclusive, with cents\n" +
                "- station: a short station name (brand + suburb if shown, e.g. \"Shell Coburg\")\n" +
                "- date: the purchase date as yyyy-mm-dd\n" +
                "- gst: the GST amount in dollars, ONLY if the docket prints one. Do not " +
                "calculate it from the total — if no GST line is shown, return null.\n" +
                "- abn: the supplier's ABN, digits only, ONLY if one is printed on the docket. " +
                "It is 11 digits and usually labelled \"ABN\". Do not confuse it with a phone " +
                "number, store number, receipt or transaction number, or an ACN (9 digits).\n\n" +
                "Use null for anything not clearly readable — a guessed tax figure is worse " +
                "than a blank one. If this is not a fuel receipt at all, return null for " +
                "every field.",
            },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return { ok: false, reason: "Tiff declined to read this image." };
    }
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const parsed = JSON.parse(text) as {
      litres: number | null;
      cost: number | null;
      station: string | null;
      date: string | null;
      gst: number | null;
      abn: string | null;
    };
    const cost = typeof parsed.cost === "number" && parsed.cost > 0 ? parsed.cost : null;
    /* GST can never exceed the total it came out of, and on a GST-inclusive
       total it can never exceed one eleventh of it. A figure that fails that
       is a misread line — the servo's loyalty points, or the litre price —
       and dropping it is right: null means "check the docket", a wrong number
       means a wrong BAS. */
    const gstRead = typeof parsed.gst === "number" && parsed.gst > 0 ? parsed.gst : null;
    const gst =
      gstRead !== null && cost !== null && gstRead <= cost / 11 + 0.01
        ? Math.round(gstRead * 100) / 100
        : null;
    return {
      ok: true,
      litres: typeof parsed.litres === "number" && parsed.litres > 0 ? parsed.litres : null,
      cost,
      station: typeof parsed.station === "string" && parsed.station.trim() ? parsed.station.trim().slice(0, 60) : null,
      date: typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
      gst,
      abn: normaliseAbn(parsed.abn),
    };
  } catch (err) {
    return { ok: false, reason: reasonFor(err) };
  }
}
