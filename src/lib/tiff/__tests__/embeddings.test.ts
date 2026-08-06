/**
 * @jest-environment node
 *
 * The Voyage call. `fetch` is replaced wholesale — a test that accidentally
 * reached api.voyageai.com would spend money on every CI run and fail wherever
 * there's no network — and the last assertion in the file is that the real one
 * was never restored.
 *
 * Every test asserts on the CALL as well as the answer, because the request
 * shape IS the contract here: a wrong `input_type` or a missing
 * `output_dimension` fails silently as worse search rather than loudly as an
 * error.
 */

import {
  EMBED_DIM,
  EMBED_MODEL,
  embedTexts,
  failureForStatus,
  FREE_TIER_RPM,
  isSemanticConfigured,
  MAX_ATTEMPTS,
  MAX_RETRY_WAIT_MS,
  PAID_TIER_RPM,
  planRetry,
  retryAfterMs,
  RETRY_WAITS_MS,
} from "../embeddings";

const KEY = "voyage-TEST-KEY-do-not-leak";

const fetchMock = jest.fn();
const realFetch = global.fetch;
global.fetch = fetchMock as unknown as typeof fetch;

const vector = (seed = 0) => Array.from({ length: EMBED_DIM }, (_, i) => (i + seed) / EMBED_DIM);

const ok = (rows: unknown[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ data: rows, usage: { total_tokens: 10 } }),
});

/** What Voyage actually said on the burst test that found this bug. */
const THEIR_PROSE =
  "You have not yet added your payment method in the billing page and will have reduced rate limits of 3 RPM and 10K TPM.";

const refuse = (status: number, detail = "", headers: Record<string, string> = {}) => ({
  ok: false,
  status,
  headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  text: async () => (detail ? JSON.stringify({ detail }) : ""),
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.VOYAGE_API_KEY = KEY;
});

afterAll(() => {
  global.fetch = realFetch;
});

describe("configuration", () => {
  it("reports on the key", () => {
    expect(isSemanticConfigured()).toBe(true);
    delete process.env.VOYAGE_API_KEY;
    expect(isSemanticConfigured()).toBe(false);
  });

  /* The day-1 state, and the one that must not look like a failure: no key
     means null vectors, stored as null embeddings, and search runs on the
     keyword leg alone until a key exists. */
  it("returns ok with null vectors when there is no key, without calling out", async () => {
    delete process.env.VOYAGE_API_KEY;
    expect(await embedTexts(["a chunk"], "document")).toEqual({ ok: true, vectors: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty list for an empty batch, without calling out", async () => {
    expect(await embedTexts([], "document")).toEqual({ ok: true, vectors: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the request", () => {
  it("posts the verified contract, with the key in a header", async () => {
    fetchMock.mockResolvedValue(ok([{ embedding: vector(), index: 0 }]));
    await embedTexts(["a chunk"], "document");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    // never a query parameter: a URL is the thing that ends up in a log
    expect(String(url)).not.toContain(KEY);
    expect(JSON.parse(init.body)).toEqual({
      model: EMBED_MODEL,
      input: ["a chunk"],
      input_type: "document",
      output_dimension: EMBED_DIM,
    });
  });

  /* Voyage embeds a document and a question differently and asking with the
     wrong one measurably costs recall — a bug that would never throw. */
  it("passes the input type through untouched", async () => {
    fetchMock.mockResolvedValue(ok([{ embedding: vector(), index: 0 }]));
    await embedTexts(["what does P8 mean"], "query");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).input_type).toBe("query");
  });

  it("gives up rather than hanging on to a slow upstream", async () => {
    fetchMock.mockResolvedValue(ok([{ embedding: vector(), index: 0 }]));
    await embedTexts(["a chunk"], "document");
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("batches past 128 inputs into more than one call", async () => {
    const texts = Array.from({ length: 300 }, (_, i) => `chunk ${i}`);
    fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
      const { input } = JSON.parse(init.body) as { input: string[] };
      return ok(input.map((_t, i) => ({ embedding: vector(i), index: i })));
    });

    const result = await embedTexts(texts, "document");
    expect(fetchMock).toHaveBeenCalledTimes(3); // 128 + 128 + 44
    expect(result).toMatchObject({ ok: true });
    expect(result.ok === true && result.vectors).toHaveLength(300);
  });
});

describe("what comes back", () => {
  it("re-seats rows by their own index rather than trusting the order", async () => {
    fetchMock.mockResolvedValue(
      ok([
        { embedding: vector(2), index: 1 },
        { embedding: vector(1), index: 0 },
      ])
    );
    const result = await embedTexts(["first", "second"], "document");

    expect(result.ok).toBe(true);
    // the vector made for "first" must be the one stored against "first"
    expect(result.ok === true && result.vectors?.[0]).toEqual(vector(1));
    expect(result.ok === true && result.vectors?.[1]).toEqual(vector(2));
  });

  /* The column is vector(1024) and would reject this at insert time — by
     which point half the batch is already written. Caught here, before
     anything is stored. */
  it("refuses a vector of the wrong length", async () => {
    fetchMock.mockResolvedValue(ok([{ embedding: [0.1, 0.2, 0.3], index: 0 }]));
    expect(await embedTexts(["a chunk"], "document")).toMatchObject({
      ok: false,
      reason: "bad-response",
    });
  });

  it("refuses a vector with something that isn't a number in it", async () => {
    const bad = vector();
    bad[7] = NaN;
    fetchMock.mockResolvedValue(ok([{ embedding: bad, index: 0 }]));
    expect(await embedTexts(["a chunk"], "document")).toMatchObject({ ok: false });
  });

  it("refuses a response with fewer vectors than texts", async () => {
    fetchMock.mockResolvedValue(ok([{ embedding: vector(), index: 0 }]));
    expect(await embedTexts(["one", "two"], "document")).toMatchObject({ ok: false });
  });

  it("refuses two rows claiming the same slot", async () => {
    fetchMock.mockResolvedValue(
      ok([
        { embedding: vector(1), index: 0 },
        { embedding: vector(2), index: 0 },
      ])
    );
    expect(await embedTexts(["one", "two"], "document")).toMatchObject({ ok: false });
  });

  it("refuses an index that isn't one of ours", async () => {
    fetchMock.mockResolvedValue(ok([{ embedding: vector(), index: 9 }]));
    expect(await embedTexts(["one"], "document")).toMatchObject({ ok: false });
  });
});

describe("when Voyage refuses", () => {
  /* A CODE, NOT A SENTENCE. The caller has to be able to tell "ask again in a
     minute" from "this key will never work" — the old single English string
     could not, which is how a whole manual lost its vectors quietly. */
  it("names a bad key as unauthorised, and forwards nothing Voyage said to a screen", async () => {
    fetchMock.mockResolvedValue(refuse(401, `Invalid API key: ${KEY}`));
    const result = await embedTexts(["a chunk"], "document");

    expect(result).toMatchObject({ ok: false, reason: "unauthorised" });
    // Voyage quotes the request back on a 4xx, key included; `detail` is a log
    // line, and the key is removed from it before it leaves this file
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("treats a forbidden key the same way as a wrong one", async () => {
    fetchMock.mockResolvedValue(refuse(403, "forbidden"));
    expect(await embedTexts(["a chunk"], "document")).toMatchObject({
      ok: false,
      reason: "unauthorised",
    });
  });

  it("says unreachable when the call throws — a timeout, a dead network", async () => {
    fetchMock.mockRejectedValue(new Error(`ECONNREFUSED (key ${KEY})`));
    const result = await embedTexts(["a chunk"], "document");

    expect(result).toMatchObject({ ok: false, reason: "unreachable" });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("copes with a body that isn't JSON at all", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });
    expect(await embedTexts(["a chunk"], "document")).toMatchObject({
      ok: false,
      reason: "bad-response",
    });
  });

  it("keeps the detail for the log, so nobody has to reproduce the failure", async () => {
    fetchMock.mockResolvedValue(refuse(429, THEIR_PROSE));
    jest.useFakeTimers();
    const promise = embedTexts(["a chunk"], "document");
    await jest.advanceTimersByTimeAsync(120_000);
    const result = await promise;
    jest.useRealTimers();

    expect(result.ok === false && result.detail).toContain("payment method");
  });

  it("stops at the first failed batch rather than half-embedding", async () => {
    fetchMock
      .mockResolvedValueOnce(
        ok(Array.from({ length: 128 }, (_, i) => ({ embedding: vector(i), index: i })))
      )
      .mockResolvedValue(refuse(401, "no"));

    const result = await embedTexts(Array.from({ length: 200 }, (_, i) => `c${i}`), "document");
    expect(result).toMatchObject({ ok: false, reason: "unauthorised" });
    // the second batch is not retried: a wrong key is wrong on every attempt
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/* ── the 3 RPM ceiling, and surviving it ─────────────────────────────────── */

describe("the retry", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** The waits between attempts are real setTimeouts. Fake timers spend the
      twenty-three seconds of backoff in about a millisecond. */
  const past = async <T,>(promise: Promise<T>): Promise<T> => {
    await jest.advanceTimersByTimeAsync(120_000);
    return promise;
  };

  it("asks again after a 429 and takes the answer the second time", async () => {
    fetchMock
      .mockResolvedValueOnce(refuse(429, THEIR_PROSE))
      .mockResolvedValueOnce(ok([{ embedding: vector(3), index: 0 }]));

    const result = await past(embedTexts(["a chunk"], "document"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok === true && result.vectors?.[0]).toEqual(vector(3));
  });

  /* Voyage's own number beats ours: it is the only one that knows when the
     window actually reopens. */
  it("waits as long as Voyage asked, not as long as it had planned to", async () => {
    fetchMock
      .mockResolvedValueOnce(refuse(429, THEIR_PROSE, { "retry-after": "5" }))
      .mockResolvedValueOnce(ok([{ embedding: vector(), index: 0 }]));

    const promise = embedTexts(["a chunk"], "document");

    await jest.advanceTimersByTimeAsync(RETRY_WAITS_MS[0]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // its own 2s came and went

    await jest.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await promise).toMatchObject({ ok: true });
  });

  it("retries a 5xx as well — that one is theirs and usually passes", async () => {
    fetchMock
      .mockResolvedValueOnce(refuse(503, "upstream"))
      .mockResolvedValueOnce(ok([{ embedding: vector(), index: 0 }]));

    expect(await past(embedTexts(["a chunk"], "document"))).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /* The 300s invocation has a document to read as well. Three tries and it
     hands back a reason — the chunks go in with null embeddings and the
     backfill picks them up, which is the same degradation as everywhere else. */
  it("gives up after three attempts, saying it was rate-limited", async () => {
    fetchMock.mockResolvedValue(refuse(429, THEIR_PROSE));

    const result = await past(embedTexts(["a chunk"], "document"));

    expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(result).toMatchObject({ ok: false, reason: "rate-limited" });
  });

  it("never retries a refusal that would be refused again", async () => {
    fetchMock.mockResolvedValue(refuse(401, "bad key"));

    await past(embedTexts(["a chunk"], "document"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /* A request that threw already spent up to the 60s timeout; three of those
     is the whole invocation. */
  it("never retries a dead network", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await past(embedTexts(["a chunk"], "document"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/* The arithmetic, on its own: "this terminates" is not something to find out
   in production. */
describe("planRetry", () => {
  it("repeats a 429 and a 5xx, and nothing else", () => {
    expect(planRetry(429, null, 1)).toEqual({ retry: true, waitMs: RETRY_WAITS_MS[0] });
    expect(planRetry(500, null, 1)).toMatchObject({ retry: true });
    expect(planRetry(503, null, 1)).toMatchObject({ retry: true });
    expect(planRetry(400, null, 1)).toEqual({ retry: false });
    expect(planRetry(401, null, 1)).toEqual({ retry: false });
    expect(planRetry(404, null, 1)).toEqual({ retry: false });
    expect(planRetry(0, null, 1)).toEqual({ retry: false }); // the throw path
  });

  it("backs off further each time, and stops at the last attempt", () => {
    expect(planRetry(429, null, 2)).toEqual({ retry: true, waitMs: RETRY_WAITS_MS[1] });
    expect(planRetry(429, null, MAX_ATTEMPTS)).toEqual({ retry: false });
  });

  it("takes Voyage's retry-after over its own schedule", () => {
    expect(planRetry(429, "7", 1)).toEqual({ retry: true, waitMs: 7_000 });
  });

  it("reads the date form of the header as well as the seconds", () => {
    const now = Date.parse("2026-08-06T02:00:00Z");
    expect(retryAfterMs("Thu, 06 Aug 2026 02:00:09 GMT", now)).toBe(9_000);
    expect(retryAfterMs("9", now)).toBe(9_000);
    expect(retryAfterMs(null, now)).toBeNull();
    expect(retryAfterMs("   ", now)).toBeNull();
    expect(retryAfterMs("later on", now)).toBeNull();
  });

  /* A cool-off longer than this is not something a 300s invocation with a
     document still to read can sit out. */
  it("caps a long retry-after rather than sleeping out the invocation", () => {
    expect(retryAfterMs("600")).toBe(MAX_RETRY_WAIT_MS);
    expect(retryAfterMs("-5")).toBe(0);
  });
});

describe("what a status means", () => {
  it("maps the four outcomes the caller acts on differently", () => {
    expect(failureForStatus(429)).toBe("rate-limited");
    expect(failureForStatus(401)).toBe("unauthorised");
    expect(failureForStatus(403)).toBe("unauthorised");
    expect(failureForStatus(500)).toBe("bad-response");
    expect(failureForStatus(422)).toBe("bad-response");
  });

  /* The whole diagnosis, kept where the next person will look: a Voyage
     account with no payment method is capped at 3 requests a minute, and
     adding one lifts it to Tier 1. */
  it("writes the rate limits down so nobody diagnoses this twice", () => {
    expect(FREE_TIER_RPM).toBe(3);
    expect(PAID_TIER_RPM).toBe(2_000);
  });
});

describe("the key", () => {
  it("is still the mock — this suite never called the real fetch", () => {
    expect(global.fetch).toBe(fetchMock);
  });
});
