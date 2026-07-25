/**
 * @jest-environment node
 */

/* The address proxy: the gate, the fallback, the mapping, and the promise that
   the key never comes back out.

   NOTHING HERE REACHES GOOGLE. `fetch` is replaced wholesale and the last
   assertion in the file is that the real one was never restored — a test that
   accidentally hit places.googleapis.com would spend money on every CI run and
   fail wherever there's no network. Every test also asserts on the CALL that
   was made, because "did it ask Google the right question" is half the
   contract; the other half is "what did it tell the browser". */

const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: () => getSession() } }));

import { POST } from "../route";

/** The one and only key in this file. Every response body is searched for it. */
const KEY = "AIza-TEST-KEY-do-not-leak";

const fetchMock = jest.fn();
const realFetch = global.fetch;
global.fetch = fetchMock as unknown as typeof fetch;

const req = (body: unknown) =>
  new Request("http://localhost/api/address", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

/** what Google answers :autocomplete with */
const GOOGLE_SUGGESTIONS = {
  suggestions: [
    {
      placePrediction: {
        placeId: "PLACE_1",
        text: { text: "12 Trade St, Ringwood VIC 3134, Australia" },
        structuredFormat: { mainText: { text: "12 Trade St" } },
      },
    },
    {
      placePrediction: {
        placeId: "PLACE_2",
        text: { text: "12 Trade St, Bayswater VIC 3153, Australia" },
      },
    },
  ],
};

/** what Google answers a place details GET with */
const GOOGLE_DETAILS = {
  formattedAddress: "12 Trade St, Ringwood VIC 3134, Australia",
  addressComponents: [
    { longText: "12", shortText: "12", types: ["street_number"] },
    { longText: "Trade Street", shortText: "Trade St", types: ["route"] },
    { longText: "Ringwood", shortText: "Ringwood", types: ["locality", "political"] },
    {
      longText: "Victoria",
      shortText: "VIC",
      types: ["administrative_area_level_1", "political"],
    },
    { longText: "3134", shortText: "3134", types: ["postal_code"] },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  getSession.mockResolvedValue({ user: { sub: "auth0|1" }, orgId: "org-1" });
  process.env.GOOGLE_MAPS_API_KEY = KEY;
});

afterAll(() => {
  global.fetch = realFetch;
});

/** Every response body, as text, for the leak assertions. */
const bodyText = async (res: Response) => JSON.stringify(await res.json());

describe("the gate", () => {
  it("401s with no session, before it looks at anything else", async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(req({ op: "suggest", input: "12 Trade" }));

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /* A member mid-invite has a session and no org. Autocomplete is metered per
     keystroke, so "signed in as somebody" is not enough to spend on. */
  it("401s for a session with no org", async () => {
    getSession.mockResolvedValue({ user: { sub: "auth0|1" } });
    const res = await POST(req({ op: "suggest", input: "12 Trade" }));

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never says whether a key exists to someone who isn't signed in", async () => {
    getSession.mockResolvedValue(null);
    delete process.env.GOOGLE_MAPS_API_KEY;
    const res = await POST(req({ op: "suggest", input: "12 Trade" }));

    // 401, NOT the 503 that would tell an anonymous caller how we're configured
    expect(res.status).toBe(401);
    expect(await bodyText(res)).not.toContain("enabled");
  });
});

describe("no key configured", () => {
  beforeEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it("answers 503 {enabled:false} — a state, not an error", async () => {
    const res = await POST(req({ op: "suggest", input: "12 Trade" }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ enabled: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says the same for a resolve", async () => {
    const res = await POST(req({ op: "resolve", placeId: "PLACE_1" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ enabled: false });
  });
});

describe("suggest", () => {
  it("asks Google for Australia only, with the key in a header", async () => {
    fetchMock.mockResolvedValue(ok(GOOGLE_SUGGESTIONS));
    await POST(req({ op: "suggest", input: "12 Trade St", sessionToken: "tok-1" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Goog-Api-Key"]).toBe(KEY);
    // never a query parameter: a URL is the thing that ends up in a log
    expect(String(url)).not.toContain(KEY);
    expect(JSON.parse(init.body)).toEqual({
      input: "12 Trade St",
      includedRegionCodes: ["AU"],
      sessionToken: "tok-1",
    });
  });

  it("hands back the lean list — an id and a line, nothing else", async () => {
    fetchMock.mockResolvedValue(ok(GOOGLE_SUGGESTIONS));
    const res = await POST(req({ op: "suggest", input: "12 Trade St" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: true,
      suggestions: [
        { placeId: "PLACE_1", text: "12 Trade St, Ringwood VIC 3134, Australia" },
        { placeId: "PLACE_2", text: "12 Trade St, Bayswater VIC 3153, Australia" },
      ],
    });
  });

  it("drops a prediction that couldn't be resolved later", async () => {
    fetchMock.mockResolvedValue(
      ok({
        suggestions: [
          { placePrediction: { text: { text: "no id here" } } },
          { placePrediction: { placeId: "PLACE_3" } }, // no text
          { queryPrediction: { text: { text: "a query, not a place" } } },
          GOOGLE_SUGGESTIONS.suggestions[0],
        ],
      })
    );
    const res = await POST(req({ op: "suggest", input: "12 Trade St" }));
    const body = await res.json();

    expect(body.suggestions).toEqual([
      { placeId: "PLACE_1", text: "12 Trade St, Ringwood VIC 3134, Australia" },
    ]);
  });

  it("copes with an answer that has no suggestions at all", async () => {
    fetchMock.mockResolvedValue(ok({}));
    const res = await POST(req({ op: "suggest", input: "qqqqqq" }));
    expect(await res.json()).toEqual({ enabled: true, suggestions: [] });
  });

  /* Two characters match every street in the country, so they buy nothing and
     are not worth a billable call. */
  it("short-circuits under three characters without calling Google", async () => {
    for (const input of ["", "1", "12", "  1  "]) {
      const res = await POST(req({ op: "suggest", input }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ enabled: true, suggestions: [] });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("works without a session token (it only costs more)", async () => {
    fetchMock.mockResolvedValue(ok(GOOGLE_SUGGESTIONS));
    await POST(req({ op: "suggest", input: "12 Trade St" }));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("sessionToken");
  });
});

describe("resolve", () => {
  it("asks for the two fields the forms need, and closes the billing session", async () => {
    fetchMock.mockResolvedValue(ok(GOOGLE_DETAILS));
    await POST(req({ op: "resolve", placeId: "PLACE_1", sessionToken: "tok-1" }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places/PLACE_1?sessionToken=tok-1");
    expect(init.method).toBe("GET");
    expect(init.headers["X-Goog-FieldMask"]).toBe("addressComponents,formattedAddress");
    expect(init.headers["X-Goog-Api-Key"]).toBe(KEY);
    expect(String(url)).not.toContain(KEY);
  });

  it("returns the formatted line and the mapped parts", async () => {
    fetchMock.mockResolvedValue(ok(GOOGLE_DETAILS));
    const res = await POST(req({ op: "resolve", placeId: "PLACE_1" }));

    expect(await res.json()).toEqual({
      enabled: true,
      formatted: "12 Trade St, Ringwood VIC 3134, Australia",
      parts: { address: "12 Trade St", suburb: "Ringwood", state: "VIC", postcode: "3134" },
    });
  });

  it("escapes the place id, which is the one value that goes in a path", async () => {
    fetchMock.mockResolvedValue(ok(GOOGLE_DETAILS));
    await POST(req({ op: "resolve", placeId: "../../places/EVIL?x=1" }));

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://places.googleapis.com/v1/places/..%2F..%2Fplaces%2FEVIL%3Fx%3D1"
    );
  });

  it("refuses an empty place id without calling Google", async () => {
    const res = await POST(req({ op: "resolve", placeId: "" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still answers when Google's components are missing", async () => {
    fetchMock.mockResolvedValue(ok({ formattedAddress: "Somewhere, Australia" }));
    const res = await POST(req({ op: "resolve", placeId: "PLACE_1" }));

    expect(await res.json()).toEqual({
      enabled: true,
      formatted: "Somewhere, Australia",
      parts: { address: "", suburb: "", state: "", postcode: "" },
    });
  });
});

/* The whole reason the proxy exists. Google's refusals quote the request back
   at you, and when the KEY is the problem they quote that — so nothing Google
   says is ever forwarded. */
describe("when Google refuses", () => {
  const leaky = {
    ok: false,
    status: 403,
    json: async () => ({
      error: {
        code: 403,
        message: `API key not valid. Please pass a valid API key. key=${KEY}`,
        status: "PERMISSION_DENIED",
      },
    }),
  };

  it("turns a 4xx into our own 502, with none of Google's words in it", async () => {
    fetchMock.mockResolvedValue(leaky);
    const res = await POST(req({ op: "suggest", input: "12 Trade St" }));
    const body = await bodyText(res);

    expect(res.status).toBe(502);
    expect(body).not.toContain(KEY);
    expect(body).not.toContain("PERMISSION_DENIED");
    expect(body).not.toContain("API key");
    expect(JSON.parse(body)).toEqual({ error: "Address lookup isn't available right now." });
  });

  it("does the same on a resolve", async () => {
    fetchMock.mockResolvedValue(leaky);
    const res = await POST(req({ op: "resolve", placeId: "PLACE_1" }));
    const body = await bodyText(res);

    expect(res.status).toBe(502);
    expect(body).not.toContain(KEY);
    expect(JSON.parse(body)).toEqual({ error: "Address lookup isn't available right now." });
  });

  it("says the same thing when the call throws — a timeout, a dead network", async () => {
    fetchMock.mockRejectedValue(new Error(`connect ECONNREFUSED (key ${KEY})`));
    const res = await POST(req({ op: "suggest", input: "12 Trade St" }));
    const body = await bodyText(res);

    expect(res.status).toBe(502);
    expect(body).not.toContain(KEY);
  });

  it("and when the body isn't JSON at all (an HTML error page)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });
    const res = await POST(req({ op: "suggest", input: "12 Trade St" }));
    expect(res.status).toBe(502);
  });

  it("gives up rather than hanging on to a slow upstream", async () => {
    fetchMock.mockResolvedValue(ok(GOOGLE_SUGGESTIONS));
    await POST(req({ op: "suggest", input: "12 Trade St" }));
    // an AbortSignal is passed, so a hung Google can't hold the invocation open
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("a body that makes no sense", () => {
  it.each([
    ["an unknown op", { op: "delete-everything" }],
    ["no op", { input: "12 Trade St" }],
    ["an op that isn't a string", { op: 7 }],
  ])("400s on %s, without calling Google", async (_label, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400s on a body that isn't JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/address", { method: "POST", body: "not json" })
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a non-string input as no input", async () => {
    const res = await POST(req({ op: "suggest", input: { toString: "nope" } }));
    expect(await res.json()).toEqual({ enabled: true, suggestions: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the key", () => {
  it("appears in no response body this suite produced", async () => {
    fetchMock.mockResolvedValue(ok(GOOGLE_SUGGESTIONS));
    const bodies = await Promise.all(
      [
        req({ op: "suggest", input: "12 Trade St" }),
        req({ op: "resolve", placeId: "PLACE_1" }),
        req({ op: "nonsense" }),
      ].map(async (r) => bodyText(await POST(r)))
    );
    for (const b of bodies) expect(b).not.toContain(KEY);
  });

  it("is never what the browser sends — only what the server holds", async () => {
    fetchMock.mockResolvedValue(ok(GOOGLE_SUGGESTIONS));
    // a caller trying to talk us into using THEIR key gets ours, or nothing
    await POST(req({ op: "suggest", input: "12 Trade St", key: "attacker-key" }));
    expect(fetchMock.mock.calls[0][1].headers["X-Goog-Api-Key"]).toBe(KEY);
  });

  it("is still the mock — this suite never called the real fetch", () => {
    expect(global.fetch).toBe(fetchMock);
  });
});
