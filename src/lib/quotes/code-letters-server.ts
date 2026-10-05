import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { CODE_LETTERS_PROMPT, CODE_LETTERS_SCHEMA, parseLettersRead, ruleKey, rulePattern, type KeptRule, type LetterRule, type LettersRead } from "./code-letters";

/* A maker's code letters: its document read by Tiff (code-letters.ts says
   what's asked and what's believed), and the rules a person keeps.
   Reading saves nothing. Service role; the route gates on `financials`. */

/* Sonnet (Isaac, 2026-10-05: "I would use Sonnet"): finding a legend in a
   brochure and copying it out is well within it, at half Opus's price. */
const MODEL = "claude-sonnet-5-5";
/* If the model declines on policy grounds, the API re-runs the same request
   on this one inside the same call, as the proposal writer does. */
const FALLBACK_MODEL = "claude-opus-4-8";

export const LETTERS_MEDIA = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type LettersMedia = (typeof LETTERS_MEDIA)[number];
export const isLettersMedia = (t: string): t is LettersMedia => (LETTERS_MEDIA as readonly string[]).includes(t);

function reasonFor(err: unknown): string {
  if (err instanceof SyntaxError) return "Tiff's reading couldn't be used. Try again.";
  if (err instanceof Anthropic.RateLimitError) return "Tiff is busy. Try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Tiff couldn't be reached. Try again.";
  return "The document couldn't be read. Try again.";
}

/** Read a maker's document for the letters it explains in its codes. */
export async function readCodeLetters(
  bytes: Buffer,
  mediaType: LettersMedia,
  client: Anthropic = new Anthropic()
): Promise<{ ok: true; read: LettersRead } | { ok: false; reason: string }> {
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
      /* medium, set rather than left to the default: which part of a code a
         letter belongs to is reading, not copying */
      output_config: { effort: "medium", format: { type: "json_schema", schema: CODE_LETTERS_SCHEMA } },
      /* the document BEFORE the ask */
      messages: [{ role: "user", content: [file, { type: "text", text: CODE_LETTERS_PROMPT }] }],
    });
    if (response.stop_reason === "refusal") return { ok: false, reason: "Tiff declined to read this document." };
    if (response.stop_reason === "max_tokens") return { ok: false, reason: "That document is too long to read in one go." };
    /* THE LAST text block: when the fallback model takes over, the first
       model's partial answer can stand ahead of the full one */
    const block = [...response.content].reverse().find((b) => b.type === "text");
    if (!block || block.type !== "text") return { ok: false, reason: "Tiff found nothing to read. Try again." };
    return { ok: true, read: parseLettersRead(JSON.parse(block.text)) };
  } catch (err) {
    console.error("[price book] reading a code legend failed:", err instanceof Error ? err.message : err);
    return { ok: false, reason: reasonFor(err) };
  }
}

type Row = { id: string; supplier_key: string; family: string; letter: string; meaning: string; example_with: string; example_without: string; source: string | null };

/** The business's kept rules: every supplier's, or one's. */
export async function readLetterRules(orgId: string, supplierKey?: string): Promise<KeptRule[]> {
  let q = supabaseAdmin.from("quote_code_letters").select("id, supplier_key, family, letter, meaning, example_with, example_without, source").eq("org_id", orgId);
  if (supplierKey) q = q.eq("supplier_key", supplierKey);
  const { data } = await q.order("family").order("letter");
  return ((data ?? []) as Row[])
    .map((r) => ({
      id: r.id,
      supplierKey: r.supplier_key,
      source: r.source,
      family: r.family,
      letter: r.letter,
      meaning: r.meaning,
      example: { with: r.example_with, without: r.example_without },
    }))
    .filter((r) => rulePattern(r) !== null);
}

/** Keep rules a person ticked, each checked again against its example; a
    rule already kept takes the newer meaning. */
export async function keepLetterRules(orgId: string, userId: string, supplierKey: string, source: string, rules: readonly LetterRule[]): Promise<boolean> {
  const now = new Date().toISOString();
  const rows = rules
    .filter((r) => rulePattern(r) !== null)
    .map((r) => ({
      org_id: orgId,
      supplier_key: supplierKey,
      rule_key: ruleKey(r),
      family: r.family,
      letter: r.letter,
      meaning: r.meaning,
      example_with: r.example.with,
      example_without: r.example.without,
      source: source.slice(0, 200) || null,
      added_by: userId,
      added_at: now,
    }));
  if (rows.length === 0) return false;
  const { error } = await supabaseAdmin.from("quote_code_letters").upsert(rows, { onConflict: "org_id,rule_key" });
  return !error;
}

export async function removeLetterRule(orgId: string, id: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from("quote_code_letters").delete().eq("org_id", orgId).eq("id", id);
  return !error;
}
