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
var renewMock: jest.Mock;
// eslint-disable-next-line no-var
var needsReauthMock: jest.Mock;
jest.mock("../sm8-store", () => {
  sm8AccessMock = jest.fn();
  renewMock = jest.fn();
  needsReauthMock = jest.fn(async () => true);
  return { sm8AccessResult: sm8AccessMock, renewSm8Access: renewMock, markSm8NeedsReauth: needsReauthMock };
});

/* The account's call counter always has a turn here, unless a test says
   otherwise: what is under test is what the reader does with the answer. */
// eslint-disable-next-line no-var
var takeTurn: jest.Mock;
jest.mock("../sm8-meter", () => {
  takeTurn = jest.fn(async () => ({ ok: true }));
  const actual = jest.requireActual("../sm8-meter");
  return { ...actual, takeSm8Call: (...a: unknown[]) => takeTurn(...a), noteSm8Throttle: jest.fn(async () => {}) };
});

import { BUSY, BUSY_DAY, fetchSm8Page, readSm8StaffRows, readSm8Vendor } from "../sm8-read";

const ACCESS = { accessToken: "tok", tenantId: "v-1", grant: "g1", meter: "v-1" };
const RENEWED = { accessToken: "tok-2", tenantId: "v-1", grant: "g2", meter: "v-1" };
/** A read on lane `read` for account v-1, with this token. */
const call = (accessToken = "t") => ({ accessToken, meter: "v-1", lane: "read" as const });

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
  takeTurn.mockReset().mockResolvedValue({ ok: true });
});

afterAll(() => {
  global.fetch = realFetch;
});

const jsonResponse = (body: unknown, init: { status?: number; nextCursor?: string } = {}): Record<string, unknown> => {
  const status = init.status ?? 200;
  return {
    // the door reads a 429's body from a copy, to tell the day from the minute
    clone: () => jsonResponse(body, init),
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
    await fetchSm8Page(call("tok"), "job.json", { cursor: "-1", filter: "edit_date gt '2026-07-01 00:00:00'" });

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://api.servicem8.com/api_1.0/job.json");
    expect(url.searchParams.get("cursor")).toBe("-1");
    expect(url.searchParams.get("$filter")).toBe("edit_date gt '2026-07-01 00:00:00'");

    fetchMock.mockResolvedValue(jsonResponse([]));
    await fetchSm8Page(call("tok"), "job.json", { cursor: "-1", filter: null });
    const bare = new URL(fetchMock.mock.calls[1][0] as string);
    expect(bare.searchParams.has("$filter")).toBe(false);
  });

  it("waits as long as a caller with a clock of its own asks, and the usual 10 s otherwise", async () => {
    /* the sender reads one attachment back under its row's claim, and that
       read's timeout is one of the clocks that must fit in the lease */
    const timeout = jest.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(jsonResponse([]));
    await fetchSm8Page(call("t"), "attachment.json", { cursor: "-1", filter: null, timeoutMs: 4_321 });
    expect(timeout).toHaveBeenLastCalledWith(4_321);
    await fetchSm8Page(call("t"), "job.json", { cursor: "-1", filter: null });
    expect(timeout).toHaveBeenLastCalledWith(10_000);
  });

  it("carries the bearer token and never anything else", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await fetchSm8Page(call("tok-123"), "job.json", { cursor: "-1", filter: null });
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-123");
  });

  it("returns rows plus the next cursor, and null when the walk is done", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ uuid: "a" }, { uuid: "b" }], { nextCursor: "cur-2" })
    );
    const first = await fetchSm8Page(call("t"), "job.json", { cursor: "-1", filter: null });
    expect(first).toEqual({ ok: true, rows: [{ uuid: "a" }, { uuid: "b" }], nextCursor: "cur-2" });

    fetchMock.mockResolvedValueOnce(jsonResponse([{ uuid: "c" }]));
    const last = await fetchSm8Page(call("t"), "job.json", { cursor: "cur-2", filter: null });
    expect(last).toEqual({ ok: true, rows: [{ uuid: "c" }], nextCursor: null });
  });

  it("drops non-object rows rather than passing garbage to the shaper", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ uuid: "a" }, null, "junk", 7]));
    const page = await fetchSm8Page(call("t"), "job.json", { cursor: "-1", filter: null });
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
      expect(await fetchSm8Page(call("t"), "job.json", { cursor: "-1", filter: null })).toMatchObject({
        ok: false,
        failure,
      });
    }
  });

  it("a turn the account's counter refuses is 'throttled', and nothing is asked of ServiceM8", async () => {
    takeTurn.mockResolvedValue({ ok: false, waitMs: 60_000, why: "cooldown_minute" });
    expect(await fetchSm8Page(call(), "job.json", { cursor: "-1", filter: null })).toEqual({
      ok: false,
      failure: "throttled",
      called: false,
      busy: { waitMs: 60_000, day: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says when the counter's refusal is a daily one — its own day cap, or a daily 429 it recorded", async () => {
    takeTurn.mockResolvedValue({ ok: false, waitMs: 3_590_000, why: "cooldown_day" });
    expect(await fetchSm8Page(call(), "job.json", { cursor: "-1", filter: null })).toMatchObject({
      failure: "throttled",
      busy: { waitMs: 3_590_000, day: true },
    });
    takeTurn.mockResolvedValue({ ok: false, waitMs: 1_800_000, why: "day" });
    expect(await fetchSm8Page(call(), "job.json", { cursor: "-1", filter: null })).toMatchObject({
      busy: { waitMs: 1_800_000, day: true },
    });
  });

  it("takes its turn on the caller's lane, from the caller's account", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await fetchSm8Page({ accessToken: "t", meter: "acct-9", lane: "sync" }, "job.json", { cursor: "-1", filter: null });
    expect(takeTurn).toHaveBeenCalledWith("acct-9", "sync");
  });

  it("ServiceM8's own 429 is still 'rate_limited' — a request was made", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("Number of allowed API requests per minute exceeded", { status: 429 }));
    const page = await fetchSm8Page(call(), "job.json", { cursor: "-1", filter: null });
    expect(page).toEqual({ ok: false, failure: "rate_limited", busy: { waitMs: 60_000, day: false } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // the daily one holds every caller for the hour's cooldown
    fetchMock.mockResolvedValueOnce(jsonResponse("Number of allowed API requests per day exceeded", { status: 429 }));
    expect(await fetchSm8Page(call(), "job.json", { cursor: "-1", filter: null })).toEqual({
      ok: false,
      failure: "rate_limited",
      busy: { waitMs: 3_600_000, day: true },
    });
  });

  it("a network throw and a non-array body are both 'unavailable'", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    expect(await fetchSm8Page(call("t"), "job.json", { cursor: "-1", filter: null })).toEqual({
      ok: false,
      failure: "unavailable",
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "object body" }));
    expect(await fetchSm8Page(call("t"), "job.json", { cursor: "-1", filter: null })).toEqual({
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
    await fetchSm8Page(call("t"), "job.json", { cursor: "-1", filter: null });
    expect(logged.join()).toContain("job.json");
    expect(logged.join()).toContain("404");
    expect(logged.join()).toContain("No route matched");
  });

  it("names a 200 whose body is not an array as exactly that", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "object body" }));
    await fetchSm8Page(call("t"), "staff.json", { cursor: "-1", filter: null });
    expect(logged.join()).toMatch(/not a JSON array/i);
  });

  it("distinguishes never reaching the host from being served an error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    await fetchSm8Page(call("t"), "job.json", { cursor: "-1", filter: null });
    expect(logged.join()).toContain("request failed");
    expect(logged.join()).toContain("ENOTFOUND");
  });

  it("logs nothing on the paths the engine already words for itself", async () => {
    // 401/402/429 are decisions, not mysteries — the screen says what to do.
    for (const status of [401, 402, 429]) {
      fetchMock.mockResolvedValueOnce(jsonResponse("nope", { status }));
      await fetchSm8Page(call("t"), "job.json", { cursor: "-1", filter: null });
    }
    expect(logged).toHaveLength(0);
  });

  it("logs the 403 body — the one refusal whose wording can be wrong", async () => {
    /* 403 left the quiet list on 2026-08-13: attachment.json refused a token
       whose token-response had named every scope, so "reconnect to grant X"
       was wrong and the vendor's body was the only witness to the privilege
       the endpoint actually wanted. */
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errorCode: 403, message: "Scope read_attachments required" }, { status: 403 })
    );
    const page = await fetchSm8Page(call("super-secret-token"), "attachment.json", {
      cursor: "-1",
      filter: null,
    });
    expect(page).toEqual({ ok: false, failure: "forbidden" });
    expect(logged.join()).toContain("read_attachments required");
    expect(logged.join()).not.toContain("super-secret-token");
  });

  it("never puts the access token in the log", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("boom", { status: 500 }));
    await fetchSm8Page(call("super-secret-token"), "job.json", { cursor: "-1", filter: null });
    expect(logged.join()).not.toContain("super-secret-token");
  });
});

describe("with a grant to read through", () => {
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
    sm8AccessMock.mockReset().mockResolvedValue({ ok: true, access: ACCESS });
    renewMock.mockReset().mockResolvedValue({ ok: true, access: RENEWED });
    needsReauthMock.mockClear();
  });

  const vendorBody = [{ uuid: "v-1", name: "Acme Air", timezone_name: "Australia/Brisbane" }];
  const bearerOf = (call: unknown[]) =>
    ((call[1] as RequestInit).headers as Record<string, string>).Authorization;

  it("readSm8Vendor renews a refused token once and reads with the new one, flagging nothing", async () => {
    /* The hourly token running out between the page's refresh check and the
       read used to flag the connection needs_reauth, so the owner's screen
       said "reconnect" about a connection that worked. */
    fetchMock
      .mockResolvedValueOnce(jsonResponse("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(jsonResponse(vendorBody));
    const out = await readSm8Vendor("org-1");
    expect(out).toMatchObject({ ok: true, data: { uuid: "v-1", name: "Acme Air" } });
    expect(bearerOf(fetchMock.mock.calls[1])).toBe("Bearer tok-2");
    expect(needsReauthMock).not.toHaveBeenCalled();
  });

  it("readSm8Vendor flags the renewed grant when it is refused too", async () => {
    fetchMock.mockResolvedValue(jsonResponse("unauthorized", { status: 401 }));
    const out = await readSm8Vendor("org-1");
    expect(out).toEqual({ ok: false, error: "The ServiceM8 connection needs reconnecting." });
    expect(needsReauthMock).toHaveBeenCalledTimes(1);
    expect(needsReauthMock).toHaveBeenCalledWith("org-1", expect.stringContaining("Reconnect"), RENEWED);
  });

  it("a refresh that couldn't reach ServiceM8 says so, not 'isn't connected'", async () => {
    sm8AccessMock.mockResolvedValue({ ok: false, reason: "unreachable" });
    const out = await readSm8Vendor("org-1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/couldn't be reached/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a grant already flagged says reconnect", async () => {
    sm8AccessMock.mockResolvedValue({ ok: false, reason: "reauth" });
    const out = await readSm8Vendor("org-1");
    expect(out).toEqual({ ok: false, error: "The ServiceM8 connection needs reconnecting." });
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

  it("marks the row needs_reauth on a grant refused after one renewal, like the vendor read does", async () => {
    fetchMock.mockResolvedValue(jsonResponse("unauthorized", { status: 401 }));
    const out = await readSm8StaffRows("org-1");
    expect(out.ok).toBe(false);
    expect(renewMock).toHaveBeenCalledTimes(1);
    expect(needsReauthMock).toHaveBeenCalledWith("org-1", expect.stringContaining("Reconnect"), RENEWED);
  });

  it("a staff page refused once is renewed and the walk goes on", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(jsonResponse([{ uuid: "u-1" }]));
    expect(await readSm8StaffRows("org-1")).toEqual({ ok: true, data: [{ uuid: "u-1" }] });
    expect(needsReauthMock).not.toHaveBeenCalled();
  });

  it("reads on lane `read`, from the connection's account", async () => {
    fetchMock.mockResolvedValue(jsonResponse(vendorBody));
    await readSm8Vendor("org-1");
    expect(takeTurn).toHaveBeenCalledWith("v-1", "read");
    takeTurn.mockClear();
    fetchMock.mockResolvedValue(jsonResponse([{ uuid: "u-1" }]));
    await readSm8StaffRows("org-1");
    expect(takeTurn).toHaveBeenCalledWith("v-1", "read");
  });

  it("says ServiceM8 is busy when the account's limit has no room, and flags nothing", async () => {
    takeTurn.mockResolvedValue({ ok: false, waitMs: 60_000, why: "cooldown_minute" });
    expect(await readSm8Vendor("org-1")).toEqual({ ok: false, error: BUSY });
    expect(await readSm8StaffRows("org-1")).toEqual({ ok: false, error: BUSY });
    expect(BUSY).toBe("ServiceM8 is busy for this account. Try again in a minute.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(needsReauthMock).not.toHaveBeenCalled();
  });

  it("says ServiceM8 is busy when ServiceM8 itself answers 429 to the staff read, and flags nothing", async () => {
    fetchMock.mockResolvedValue(jsonResponse("Number of allowed API requests per minute exceeded", { status: 429 }));
    expect(await readSm8StaffRows("org-1")).toEqual({ ok: false, error: BUSY });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(needsReauthMock).not.toHaveBeenCalled();
    expect(renewMock).not.toHaveBeenCalled();
  });

  it("says the day's limit is used up, not 'a minute', when the limit with no room is a daily one", async () => {
    // the counter's refusal under a daily 429's cooldown, with under an hour of it left
    takeTurn.mockResolvedValue({ ok: false, waitMs: 3_590_000, why: "cooldown_day" });
    expect(await readSm8Vendor("org-1")).toEqual({ ok: false, error: BUSY_DAY });
    expect(await readSm8StaffRows("org-1")).toEqual({ ok: false, error: BUSY_DAY });
    expect(fetchMock).not.toHaveBeenCalled();
    // ServiceM8's own daily 429
    takeTurn.mockResolvedValue({ ok: true });
    fetchMock.mockResolvedValue(jsonResponse("Number of allowed API requests per day exceeded", { status: 429 }));
    expect(await readSm8Vendor("org-1")).toEqual({ ok: false, error: BUSY_DAY });
    expect(await readSm8StaffRows("org-1")).toEqual({ ok: false, error: BUSY_DAY });
    expect(BUSY_DAY).toBe("ServiceM8's daily limit for this account is used up. Try again after it resets.");
    expect(needsReauthMock).not.toHaveBeenCalled();
  });

  it("reads as not-connected when there is no grant to read through", async () => {
    sm8AccessMock.mockResolvedValue({ ok: false, reason: "not_connected" });
    const out = await readSm8StaffRows("org-1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/isn't connected/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
