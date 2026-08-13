/* What a question actually cost, printed once per model call.

   EVERY COST FIGURE ABOUT TIFF UNTIL NOW HAS BEEN ARITHMETIC ON THE
   PARAMETERS IN THESE FILES — twelve excerpts of about fourteen hundred
   characters, an effort level, a price per million. The one term that cannot
   be read off the source is how long the model thinks, and on the answer call
   that is the majority of the bill. This is the instrument that replaces the
   estimate with a measurement.

   THINKING IS NOT SEPARABLE. `output_tokens` covers the thinking and the
   visible answer together, because both are billed as output. A long silence
   followed by two sentences and a short pause followed by four paragraphs can
   land on the same number; only the total is knowable from here.

   THE PRICES LIVE HERE AND NOWHERE ELSE, so there is exactly one line to
   correct when they move. They are USD per million tokens, read off
   platform.claude.com/docs/en/pricing on 2026-08-12. Sonnet 5's input price is
   introductory and reverts to $3/$15 after 2026-08-31, which will move a
   prepared question from about half a cent to nearer one. */

/** USD per million tokens, [input, output]. */
const PRICES: Record<string, readonly [number, number]> = {
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5": [2, 10],
};

/** The shape both `messages.create` and a finished stream hand back.

    The three input counts are disjoint: `input_tokens` is only the part that
    was neither read from the cache nor written to it, so a cached call reports
    a small `input_tokens` and a large `cache_read_input_tokens` rather than
    counting the same tokens twice. Summing all three gives the true prompt
    size, which is worth remembering before reading a four-figure ask loop as
    having sent four hundred tokens. */
export type TokenUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/** USD for one call, or null when the model has no price on file — a model
    swapped in without a price here logs its tokens and no invented number.

    A cache READ is a tenth of the input rate; a cache WRITE is a quarter more
    than it, which is the whole reason caching is a judgement call rather than
    a free win — a prefix written and never read back costs more than not
    caching at all. Both are counted, so the number stays honest in the round
    that pays as well as the rounds that profit. */
export function costOf(model: string, usage: TokenUsage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const input = Number(usage.input_tokens) || 0;
  const output = Number(usage.output_tokens) || 0;
  const cached = Number(usage.cache_read_input_tokens) || 0;
  const written = Number(usage.cache_creation_input_tokens) || 0;
  return (
    (input * price[0]) +
    (cached * price[0] * 0.1) +
    (written * price[0] * 1.25) +
    (output * price[1])
  ) / 1_000_000;
}

/* One line per call, greppable by stage.

   NOTHING HERE IS ALLOWED TO BREAK A QUESTION. A usage object that arrives in
   a shape nobody expected is a logging problem, and a logging problem must
   never become the reason somebody's answer died — hence the try, which looks
   paranoid and costs nothing.

   Vercel's Hobby runtime logs do not survive the hour, so this is a live
   instrument rather than a record. Watch it during a working session, or move
   it into a table if the number needs a history. */
export function logUsage(stage: string, model: string, usage: TokenUsage | null | undefined): void {
  try {
    if (!usage) return;
    const input = Number(usage.input_tokens) || 0;
    const output = Number(usage.output_tokens) || 0;
    const cached = Number(usage.cache_read_input_tokens) || 0;
    const written = Number(usage.cache_creation_input_tokens) || 0;
    const usd = costOf(model, usage);
    const money = usd === null ? "unpriced" : `$${usd.toFixed(4)}`;
    /* Only when there is something to say: a call on an uncached path reads
       exactly as it always did, and `cache(...)` appearing at all is the
       signal that a prefix is being reused. `r` is what was read back at a
       tenth price, `w` what was written at a quarter over — a stage that
       shows w without ever showing r is paying the premium for nothing. */
    const cache = cached || written ? ` cache(r=${cached} w=${written})` : "";
    console.log(`[kb-usage] ${stage} ${model} in=${input} out=${output}${cache} ${money}`);
  } catch {
    /* a log line is never worth an exception */
  }
}
