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

import { EMBED_DIM, EMBED_MODEL, embedTexts, isSemanticConfigured } from "../embeddings";

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
    expect(await embedTexts(["a chunk"], "document")).toEqual({
      ok: false,
      reason: "The embedding service sent vectors we can't use.",
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
  /* Voyage quotes the request back on a 4xx, key included. Nothing it says is
     ever forwarded — the reason is ours, and carries only the status. */
  it("turns an HTTP error into our own reason, with none of theirs in it", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: `Invalid API key: ${KEY}` }),
    });
    const result = await embedTexts(["a chunk"], "document");

    expect(result).toEqual({ ok: false, reason: "The embedding service refused (401)." });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("says its own thing when the call throws — a timeout, a dead network", async () => {
    fetchMock.mockRejectedValue(new Error(`ECONNREFUSED (key ${KEY})`));
    const result = await embedTexts(["a chunk"], "document");

    expect(result).toEqual({ ok: false, reason: "Couldn't reach the embedding service." });
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
    expect(await embedTexts(["a chunk"], "document")).toMatchObject({ ok: false });
  });

  it("stops at the first failed batch rather than half-embedding", async () => {
    fetchMock
      .mockResolvedValueOnce(
        ok(Array.from({ length: 128 }, (_, i) => ({ embedding: vector(i), index: i })))
      )
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    const result = await embedTexts(Array.from({ length: 200 }, (_, i) => `c${i}`), "document");
    expect(result).toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("the key", () => {
  it("is still the mock — this suite never called the real fetch", () => {
    expect(global.fetch).toBe(fetchMock);
  });
});
