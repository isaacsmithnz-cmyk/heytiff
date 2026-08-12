/* The page reader's contract with the engine: rows + the x-next-cursor
   header on success, and exactly four failure KINDS — because each one is a
   different engine decision (dead grant / missing scope / back off / try
   later), not a different sentence. */

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

/* readSm8StaffRows needs a grant to read through; the store is stubbed so the
   walk itself — pagination, and what each failure kind becomes — is the thing
   under test. */
// eslint-disable-next-line no-var
var sm8AccessMock: jest.Mock;
// eslint-disable-next-line no-var
var needsReauthMock: jest.Mock;
jest.mock("../sm8-store", () => {
  sm8AccessMock = jest.fn();
  needsReauthMock = jest.fn(async () => {});
  return { sm8Access: sm8AccessMock, markSm8NeedsReauth: needsReauthMock };
});

import { fetchSm8Page, readSm8StaffRows } from "../sm8-read";

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
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: (k: string) => (k === "x-next-cursor" ? init.nextCursor ?? null : null) },
    json: async () => body,
    // The failure logger reads the body as text; a served error is a string.
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
};

/* Logging is a side effect on every failure path, so it is silenced by
   default — the tests that care assert on it explicitly. */
beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

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

  it("classifies the five failures the engine decides differently on", async () => {
    for (const [status, failure] of [
      [401, "unauthorized"],
      [403, "forbidden"],
      // Documented as "your ServiceM8 account is not in good standing" — an
      // expired trial answers with it, and it is nobody's bug to retry.
      [402, "payment_required"],
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

/* The first live connection (2026-07-30) reported "couldn't be reached" for
   every object and there was nothing to diagnose it with: the status had been
   thrown away, so a 404, a 500 and a 200-that-isn't-an-array were one
   outcome. Same hole #223 closed in the voice adapter. The RETURN stays coarse
   — four decisions, no upstream words — and the SERVER LOG carries the truth. */
describe("what an unavailable failure tells the server", () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    jest.spyOn(console, "error").mockImplementation((m: unknown) => void logged.push(String(m)));
  });

  it("records the endpoint, the status and the served body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("No route matched", { status: 404 }));
    await fetchSm8Page("t", "job.json", { cursor: "-1", filter: null });
    expect(logged.join()).toContain("job.json");
    expect(logged.join()).toContain("404");
    expect(logged.join()).toContain("No route matched");
  });

  it("names a 200 whose body is not an array as exactly that", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "object body" }));
    await fetchSm8Page("t", "staff.json", { cursor: "-1", filter: null });
    expect(logged.join()).toMatch(/not a JSON array/i);
  });

  it("distinguishes never reaching the host from being served an error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    await fetchSm8Page("t", "job.json", { cursor: "-1", filter: null });
    expect(logged.join()).toContain("request failed");
    expect(logged.join()).toContain("ENOTFOUND");
  });

  it("logs nothing on the paths the engine already words for itself", async () => {
    // 401/402/403/429 are decisions, not mysteries — the screen says what to do.
    for (const status of [401, 402, 403, 429]) {
      fetchMock.mockResolvedValueOnce(jsonResponse("nope", { status }));
      await fetchSm8Page("t", "job.json", { cursor: "-1", filter: null });
    }
    expect(logged).toHaveLength(0);
  });

  it("never puts the access token in the log", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("boom", { status: 500 }));
    await fetchSm8Page("super-secret-token", "job.json", { cursor: "-1", filter: null });
    expect(logged.join()).not.toContain("super-secret-token");
  });
});

describe("readSm8StaffRows — the import screen's live walk", () => {
  const ENV = { SM8_CLIENT_ID: "id", SM8_CLIENT_SECRET: "secret", APP_BASE_URL: "https://app.test" };
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterAll(() => {
    for (const k of Object.keys(ENV)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  beforeEach(() => {
    sm8AccessMock.mockReset().mockResolvedValue({ accessToken: "tok" });
    needsReauthMock.mockClear();
  });

  it("walks every page and hands back the concatenated raw rows", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ uuid: "u-1" }], { nextCursor: "abc" }))
      .mockResolvedValueOnce(jsonResponse([{ uuid: "u-2" }]));

    const out = await readSm8StaffRows("org-1");

    expect(out).toEqual({ ok: true, data: [{ uuid: "u-1" }, { uuid: "u-2" }] });
    const first = new URL(fetchMock.mock.calls[0][0] as string);
    const second = new URL(fetchMock.mock.calls[1][0] as string);
    expect(first.pathname.endsWith("/staff.json")).toBe(true);
    expect(first.searchParams.get("cursor")).toBe("-1");
    expect(second.searchParams.get("cursor")).toBe("abc");
  });

  it("says the one useful thing when the scope is missing — reconnect to grant Staff", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("forbidden", { status: 403 }));
    const out = await readSm8StaffRows("org-1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/reconnect/i);
    // the grant is fine — sending them round the reauth loop can't fix a scope
    expect(needsReauthMock).not.toHaveBeenCalled();
  });

  it("marks the row needs_reauth on a dead grant, like the vendor read does", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("unauthorized", { status: 401 }));
    const out = await readSm8StaffRows("org-1");
    expect(out.ok).toBe(false);
    expect(needsReauthMock).toHaveBeenCalledWith("org-1", expect.stringContaining("Reconnect"));
  });

  it("reads as not-connected when there is no grant to read through", async () => {
    sm8AccessMock.mockResolvedValue(null);
    const out = await readSm8StaffRows("org-1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/isn't connected/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
