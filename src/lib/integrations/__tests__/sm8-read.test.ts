/* The page reader's contract with the engine: rows + the x-next-cursor
   header on success, and exactly four failure KINDS — because each one is a
   different engine decision (dead grant / missing scope / back off / try
   later), not a different sentence. */

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { fetchSm8Page } from "../sm8-read";

/* jsdom's test globals don't reliably carry Node's fetch classes, so the
   fakes are plain objects shaped like the four things the reader touches —
   and AbortSignal.timeout gets a stub for the same reason. */
if (typeof AbortSignal.timeout !== "function") {
  (AbortSignal as unknown as { timeout: () => AbortSignal }).timeout = () =>
    new AbortController().signal;
}

const realFetch = global.fetch;
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

const jsonResponse = (body: unknown, init: { status?: number; nextCursor?: string } = {}) => {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k === "x-next-cursor" ? init.nextCursor ?? null : null) },
    json: async () => body,
  };
};

describe("fetchSm8Page", () => {
  it("asks the documented shape: cursor always, $filter only when given", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await fetchSm8Page("tok", "job.json", { cursor: "-1", filter: "edit_date gt '2026-07-01 00:00:00'" });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://api.servicem8.com/api_1.0/job.json");
    expect(url.searchParams.get("cursor")).toBe("-1");
    expect(url.searchParams.get("$filter")).toBe("edit_date gt '2026-07-01 00:00:00'");

    fetchMock.mockResolvedValue(jsonResponse([]));
    await fetchSm8Page("tok", "job.json", { cursor: "-1", filter: null });
    const bare = new URL(fetchMock.mock.calls[1][0] as string);
    expect(bare.searchParams.has("$filter")).toBe(false);
  });

  it("carries the bearer token and never anything else", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await fetchSm8Page("tok-123", "job.json", { cursor: "-1", filter: null });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-123");
  });

  it("returns rows plus the next cursor, and null when the walk is done", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ uuid: "a" }, { uuid: "b" }], { nextCursor: "cur-2" })
    );
    const first = await fetchSm8Page("t", "job.json", { cursor: "-1", filter: null });
    expect(first).toEqual({ ok: true, rows: [{ uuid: "a" }, { uuid: "b" }], nextCursor: "cur-2" });

    fetchMock.mockResolvedValueOnce(jsonResponse([{ uuid: "c" }]));
    const last = await fetchSm8Page("t", "job.json", { cursor: "cur-2", filter: null });
    expect(last).toEqual({ ok: true, rows: [{ uuid: "c" }], nextCursor: null });
  });

  it("drops non-object rows rather than passing garbage to the shaper", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ uuid: "a" }, null, "junk", 7]));
    const page = await fetchSm8Page("t", "job.json", { cursor: "-1", filter: null });
    expect(page).toEqual({ ok: true, rows: [{ uuid: "a" }], nextCursor: null });
  });

  it("classifies the four failures the engine decides differently on", async () => {
    for (const [status, failure] of [
      [401, "unauthorized"],
      [403, "forbidden"],
      [429, "rate_limited"],
      [500, "unavailable"],
    ] as const) {
      fetchMock.mockResolvedValueOnce(jsonResponse("nope", { status }));
      expect(await fetchSm8Page("t", "job.json", { cursor: "-1", filter: null })).toEqual({
        ok: false,
        failure,
      });
    }
  });

  it("a network throw and a non-array body are both 'unavailable'", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    expect(await fetchSm8Page("t", "job.json", { cursor: "-1", filter: null })).toEqual({
      ok: false,
      failure: "unavailable",
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "object body" }));
    expect(await fetchSm8Page("t", "job.json", { cursor: "-1", filter: null })).toEqual({
      ok: false,
      failure: "unavailable",
    });
  });
});
