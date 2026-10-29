import type Anthropic from "@anthropic-ai/sdk";

/* What a Sonnet 5.5 read sends so a decline on policy grounds is re-run on
   another model inside the same call (29 October 2026: the array form naming
   claude-opus-4-8 is a 400 on Sonnet 5.5, "not a valid fallback target", so
   every Sonnet 5.5 read failed before it began: the first email forwarded to
   Tiff, the invoice reader, the code letters).

   Sonnet 5.5 takes only "default": Anthropic picks the model by the kind of
   decline, under its own beta header (the array form's header with it is a
   400). The SDK here (0.112) types `fallbacks` as the array form only; the
   body carries the string as it is. */
export const SONNET_FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as unknown as Anthropic.Beta.Messages.BetaFallbackParam[],
};
