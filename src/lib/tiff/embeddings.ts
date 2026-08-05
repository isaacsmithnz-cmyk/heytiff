/* Embeddings — the meaning half of search, from Voyage AI.

   REST rather than an SDK: one endpoint, one request shape, no dependency. The
   strings in here (URL, model, field names) are the verified contract — they
   are not guesses and must not be "tidied".

   THE FEATURE DEGRADES, IT DOES NOT BREAK. Until VOYAGE_API_KEY exists, this
   returns `vectors: null` and every chunk is stored with a null embedding; the
   keyword leg carries search on its own, and a later re-run backfills. That is
   why "not configured" is an ok:true outcome and not an error — the caller has
   nothing to apologise for, and nothing to retry.

   EVERY VECTOR IS MEASURED. A 1024-dimension column will happily reject a
   short vector at insert time, but by then the batch is half written; a wrong
   length is caught here, before anything is stored, and fails the batch
   loudly. */

const ENDPOINT = "https://api.voyageai.com/v1/embeddings";

export const EMBED_MODEL = "voyage-4";

/** Matches kb_chunks.embedding — extensions.vector(1024). */
export const EMBED_DIM = 1024;

/** Texts per request. Voyage's own ceiling on inputs in one call. */
export const EMBED_BATCH = 128;

/** Voyage embeds a document and a question differently, and asking with the
    wrong one measurably costs recall. */
export type EmbedInputType = "document" | "query";

export type EmbedResult =
  /** `vectors: null` means "no key configured" — store nulls and carry on. */
  | { ok: true; vectors: number[][] | null }
  | { ok: false; reason: string };

/** True when semantic search is switched on for this deployment. */
export function isSemanticConfigured(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

const TIMEOUT_MS = 60_000;

type VoyageRow = { embedding?: unknown; index?: unknown };

/* Voyage returns rows carrying their own `index`, and nothing promises they
   arrive in order. Alignment to the input array is the entire contract — a
   vector on the wrong chunk is a citation to the wrong page — so the response
   is re-seated by index rather than trusted to be sorted. */
function seat(rows: readonly VoyageRow[], expected: number): number[][] | null {
  const out: number[][] = new Array(expected);
  let filled = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const at = typeof row?.index === "number" ? row.index : i;
    if (!Number.isInteger(at) || at < 0 || at >= expected || out[at]) return null;

    const vector = row?.embedding;
    if (!Array.isArray(vector) || vector.length !== EMBED_DIM) return null;
    for (const n of vector) if (typeof n !== "number" || !Number.isFinite(n)) return null;

    out[at] = vector as number[];
    filled += 1;
  }

  return filled === expected ? out : null;
}

async function embedOne(
  texts: readonly string[],
  inputType: EmbedInputType
): Promise<{ ok: true; vectors: number[][] } | { ok: false; reason: string }> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: [...texts],
        input_type: inputType,
        output_dimension: EMBED_DIM,
      }),
      // a hung upstream must not hold the ingest invocation open to its own
      // 300s ceiling — the batch is resumable, the invocation is not
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "Couldn't reach the embedding service." };
  }

  if (!response.ok) {
    // Voyage quotes the request back on a 4xx, key included — never forwarded.
    return { ok: false, reason: `The embedding service refused (${response.status}).` };
  }

  let body: { data?: unknown };
  try {
    body = (await response.json()) as { data?: unknown };
  } catch {
    return { ok: false, reason: "The embedding service sent something unreadable." };
  }

  const vectors = seat(Array.isArray(body.data) ? (body.data as VoyageRow[]) : [], texts.length);
  if (!vectors) return { ok: false, reason: "The embedding service sent vectors we can't use." };
  return { ok: true, vectors };
}

/** Embed a list of texts, batched. Order out matches order in. Never throws. */
export async function embedTexts(
  texts: readonly string[],
  inputType: EmbedInputType
): Promise<EmbedResult> {
  if (!isSemanticConfigured()) return { ok: true, vectors: null };
  if (texts.length === 0) return { ok: true, vectors: [] };

  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const result = await embedOne(texts.slice(i, i + EMBED_BATCH), inputType);
    if (!result.ok) return result;
    vectors.push(...result.vectors);
  }
  return { ok: true, vectors };
}
