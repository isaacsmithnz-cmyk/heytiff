/* Embeddings — the meaning half of search, from Voyage AI.

   REST rather than an SDK: one endpoint, one request shape, no dependency. The
   strings in here (URL, model, field names) are the verified contract — they
   are not guesses and must not be "tidied".

   THE FEATURE DEGRADES, IT DOES NOT BREAK. Until VOYAGE_API_KEY exists, this
   returns `vectors: null` and every chunk is stored with a null embedding; the
   keyword leg carries search on its own, and a later re-run backfills. That is
   why "not configured" is an ok:true outcome and not an error — the caller has
   nothing to apologise for, and nothing to retry.

   A FAILURE CARRIES A CODE, NOT A SENTENCE. `reason` is one of four machine
   values and `detail` is for the log; what a person is told is the caller's
   decision, and nothing Voyage says is ever it. The first version returned a
   single English string, which meant ingestion could not tell "the account is
   rate-limited, ask again in a minute" from "the key is wrong, this will never
   work" — and told nobody either way.

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

/* ── the rate limit, written down so nobody diagnoses it twice ─────────────

   A VOYAGE ACCOUNT WITH NO PAYMENT METHOD IS CAPPED AT 3 REQUESTS A MINUTE.
   Verified 2026-08-05 against docs.voyageai.com/docs/rate-limits and a live
   burst test against this account: the 4th concurrent request came back 429
   with "You have not yet added your payment method in the billing page and
   will have reduced rate limits of 3 RPM". Adding a payment method moves the
   account to Tier 1 — 2,000 RPM and 8M TPM — where nothing here can reach a
   limit.

   THAT IS NOT THEORY, IT IS WHERE THE MISSING VECTORS WENT. A 385-page manual
   ingested to 285 chunks and only 179 of them got embeddings: ingestion fires
   one embed call per 20-page batch back to back, so everything past the third
   429'd, `embedTexts` returned ok:false, and ingest stored nulls. The retry
   below buys back a few; it cannot buy twenty batches a minute. If vectors go
   missing again, CHECK THE BILLING PAGE before reading any of this code. */

/** Requests a minute on an account with no payment method. */
export const FREE_TIER_RPM = 3;

/** Requests a minute once one is added — Voyage's Tier 1. */
export const PAID_TIER_RPM = 2_000;

/* ── giving up cleanly ─────────────────────────────────────────────────────

   Bounded, and short. The ingest route has a 300s ceiling and a document to
   read inside it, so a batch that waits out a minute-long cool-off costs the
   whole invocation. Three attempts and a capped wait; past that the chunks go
   in with null embeddings and the backfill picks them up later, which is the
   same shape as every other degradation here. */

/** Tries per batch, first one included. */
export const MAX_ATTEMPTS = 3;

/** The wait before attempt 2, then before attempt 3, when Voyage doesn't say. */
export const RETRY_WAITS_MS = [2_000, 6_000, 15_000] as const;

/** The longest `retry-after` worth honouring inside one invocation. */
export const MAX_RETRY_WAIT_MS = 30_000;

/** Voyage embeds a document and a question differently, and asking with the
    wrong one measurably costs recall. */
export type EmbedInputType = "document" | "query";

/** Why a batch has no vectors. Codes, not prose — the caller decides what a
    person is told, and `rate-limited` in particular is the one worth acting
    on differently (ask again later, or add a payment method). */
export type EmbedFailure = "rate-limited" | "unauthorised" | "unreachable" | "bad-response";

export type EmbedResult =
  /** `vectors: null` means "no key configured" — store nulls and carry on. */
  | { ok: true; vectors: number[][] | null }
  /** `detail` is for the log, never for a screen. */
  | { ok: false; reason: EmbedFailure; detail: string };

/** True when semantic search is switched on for this deployment. */
export function isSemanticConfigured(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

const TIMEOUT_MS = 60_000;

/** Enough of a body to recognise the problem, not enough to fill a log. */
const DETAIL_CHARS = 300;

type VoyageRow = { embedding?: unknown; index?: unknown };

/* Voyage quotes the request back on a 4xx, key included, and `detail` is
   written to a log — so the key leaves here removed rather than trusted not to
   have been sent back. */
function redact(text: string): string {
  const key = process.env.VOYAGE_API_KEY;
  return key ? text.split(key).join("«key»") : text;
}

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

/** What an HTTP status means for the caller. A 5xx is a bad answer rather than
    an unreachable service — we got there, it just couldn't help. */
export function failureForStatus(status: number): EmbedFailure {
  if (status === 429) return "rate-limited";
  if (status === 401 || status === 403) return "unauthorised";
  return "bad-response";
}

/* How long Voyage asked us to wait, in milliseconds.

   The header is seconds or an HTTP date, per RFC 9110; both are read, and both
   are capped — a route with 300s to spend cannot sit out a 60s cool-off and
   still have a document to read afterwards. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  const raw = header?.trim();
  if (!raw) return null;

  const seconds = Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(raw) - now;
  if (!Number.isFinite(ms)) return null;

  return Math.min(MAX_RETRY_WAIT_MS, Math.max(0, ms));
}

export type RetryPlan = { retry: false } | { retry: true; waitMs: number };

/* Whether to ask again, and how long to wait first. Pure, because "this
   terminates" is arithmetic and must never be a thing you find out in
   production: only a 429 or a 5xx is worth repeating, only up to MAX_ATTEMPTS,
   and a `retry-after` beats our own schedule because it is the only number
   that knows when the window actually reopens.

   A network failure (status 0) is deliberately NOT retried: the request that
   threw already spent up to TIMEOUT_MS, and three of those is the invocation. */
export function planRetry(status: number, retryAfter: string | null, attempt: number): RetryPlan {
  if (attempt >= MAX_ATTEMPTS) return { retry: false };
  if (status !== 429 && status < 500) return { retry: false };

  const asked = retryAfterMs(retryAfter);
  const own = RETRY_WAITS_MS[attempt - 1] ?? RETRY_WAITS_MS[RETRY_WAITS_MS.length - 1];
  return { retry: true, waitMs: asked ?? own };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Attempt =
  | { ok: true; vectors: number[][] }
  | { ok: false; reason: EmbedFailure; detail: string; status: number; retryAfter: string | null };

async function attemptEmbed(
  texts: readonly string[],
  inputType: EmbedInputType
): Promise<Attempt> {
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
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "unknown");
    return { ok: false, reason: "unreachable", detail: redact(detail), status: 0, retryAfter: null };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      reason: failureForStatus(response.status),
      detail: redact(`${response.status} ${body.replace(/\s+/g, " ").trim()}`.trim()).slice(
        0,
        DETAIL_CHARS
      ),
      status: response.status,
      retryAfter: response.headers?.get("retry-after") ?? null,
    };
  }

  let body: { data?: unknown };
  try {
    body = (await response.json()) as { data?: unknown };
  } catch {
    return {
      ok: false,
      reason: "bad-response",
      detail: "the body wasn't JSON",
      status: response.status,
      retryAfter: null,
    };
  }

  const vectors = seat(Array.isArray(body.data) ? (body.data as VoyageRow[]) : [], texts.length);
  if (!vectors) {
    return {
      ok: false,
      reason: "bad-response",
      detail: `${texts.length} texts in, unusable vectors out`,
      status: response.status,
      retryAfter: null,
    };
  }
  return { ok: true, vectors };
}

async function embedOne(
  texts: readonly string[],
  inputType: EmbedInputType
): Promise<{ ok: true; vectors: number[][] } | { ok: false; reason: EmbedFailure; detail: string }> {
  let last: { reason: EmbedFailure; detail: string } = {
    reason: "unreachable",
    detail: "no attempt was made",
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const outcome = await attemptEmbed(texts, inputType);
    if (outcome.ok) return outcome;

    last = { reason: outcome.reason, detail: outcome.detail };
    const plan = planRetry(outcome.status, outcome.retryAfter, attempt);
    if (!plan.retry) break;
    await wait(plan.waitMs);
  }

  return { ok: false, ...last };
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
