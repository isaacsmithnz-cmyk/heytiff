/* The OAuth client's pure edges: config presence, the consent URL's exact
   parameters, and token-response parsing. The strings under test were
   verified against developer.servicem8.com/docs/authentication (2026-07-28)
   — this suite is what stops them drifting back toward memory. */

import {
  buildSm8ConsentUrl,
  classifySm8TokenFailure,
  readSm8Tokens,
  refreshSm8Tokens,
  sm8Config,
  SM8_CALLBACK_PATH,
} from "../sm8";
import { SM8_SCOPE_LIST } from "../providers";

const CFG = {
  clientId: "app-123",
  clientSecret: "shh",
  redirectUri: "https://heytiff.example/api/integrations/servicem8/callback",
};

describe("sm8Config", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env.SM8_CLIENT_ID = saved.SM8_CLIENT_ID;
    process.env.SM8_CLIENT_SECRET = saved.SM8_CLIENT_SECRET;
    process.env.APP_BASE_URL = saved.APP_BASE_URL;
  });

  it("is null unless all three variables are present", () => {
    delete process.env.SM8_CLIENT_ID;
    delete process.env.SM8_CLIENT_SECRET;
    delete process.env.APP_BASE_URL;
    expect(sm8Config()).toBeNull();

    process.env.SM8_CLIENT_ID = "id";
    process.env.SM8_CLIENT_SECRET = "secret";
    expect(sm8Config()).toBeNull(); // still no base URL
  });

  it("derives the redirect URI from APP_BASE_URL in one place", () => {
    process.env.SM8_CLIENT_ID = "id";
    process.env.SM8_CLIENT_SECRET = "secret";
    process.env.APP_BASE_URL = "https://heytiff.example";
    expect(sm8Config()).toEqual({
      clientId: "id",
      clientSecret: "secret",
      redirectUri: `https://heytiff.example${SM8_CALLBACK_PATH}`,
    });
  });
});

describe("the consent URL", () => {
  const url = new URL(buildSm8ConsentUrl(CFG, "s-abc"));

  it("points at ServiceM8's documented authorize endpoint", () => {
    expect(url.origin + url.pathname).toBe("https://go.servicem8.com/oauth/authorize");
  });

  it("carries the documented parameters", () => {
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("app-123");
    expect(url.searchParams.get("redirect_uri")).toBe(CFG.redirectUri);
    expect(url.searchParams.get("state")).toBe("s-abc");
  });

  it("asks for exactly the pinned scope list, space-separated", () => {
    expect(url.searchParams.get("scope")).toBe(SM8_SCOPE_LIST.join(" "));
  });

  it("never carries the client secret", () => {
    expect(buildSm8ConsentUrl(CFG, "s")).not.toContain("shh");
  });
});

describe("readSm8Tokens", () => {
  const full = {
    access_token: "at",
    expires_in: 3600,
    token_type: "bearer",
    scope: "read_jobs vendor",
    refresh_token: "rt",
  };

  it("keeps the four fields we store from the documented response", () => {
    expect(readSm8Tokens(full)).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      scope: "read_jobs vendor",
      expiresIn: 3600,
    });
  });

  it("rejects a pair missing either token — an hour of life is not a grant", () => {
    expect(readSm8Tokens({ ...full, refresh_token: undefined })).toBeNull();
    expect(readSm8Tokens({ ...full, access_token: "" })).toBeNull();
  });

  it("degrades the optional fields instead of failing on them", () => {
    expect(readSm8Tokens({ access_token: "a", refresh_token: "r" })).toEqual({
      accessToken: "a",
      refreshToken: "r",
      scope: "",
      expiresIn: null,
    });
    expect(readSm8Tokens({ ...full, expires_in: "3600" })?.expiresIn).toBeNull();
  });

  it("rejects non-objects", () => {
    expect(readSm8Tokens(null)).toBeNull();
    expect(readSm8Tokens("token")).toBeNull();
    expect(readSm8Tokens([])).toBeNull();
  });
});

/* ── a refused refresh, sorted ──

   Before this, every non-2xx, every throw and every timeout came back as the
   same null, and the store flagged the connection needs_reauth for all of
   them: a network blip asked the owner to reconnect a connection that worked.
   The rule (the lead's decision, 2026-09-25): a 400 or 401 is a dead grant
   unless the body names OUR configuration; invalid_grant always is; 408, 429,
   5xx, timeouts and network errors never are. */
describe("classifySm8TokenFailure", () => {
  it("invalid_grant is a dead grant, whatever the status", () => {
    expect(classifySm8TokenFailure(400, JSON.stringify({ error: "invalid_grant" }))).toBe("revoked");
    expect(classifySm8TokenFailure(500, JSON.stringify({ error: "invalid_grant" }))).toBe("revoked");
  });

  it("a 400 or 401 with no named configuration error is a dead grant", () => {
    expect(classifySm8TokenFailure(400, "<html>Bad Request</html>")).toBe("revoked");
    expect(classifySm8TokenFailure(401, "")).toBe("revoked");
    expect(classifySm8TokenFailure(400, JSON.stringify({ error: "invalid_request" }))).toBe("revoked");
  });

  it("our own configuration is never the owner's grant", () => {
    for (const error of ["invalid_client", "unauthorized_client", "unsupported_grant_type"]) {
      expect(classifySm8TokenFailure(400, JSON.stringify({ error }))).toBe("unavailable");
      expect(classifySm8TokenFailure(401, JSON.stringify({ error }))).toBe("unavailable");
    }
  });

  it("a busy, slow or broken ServiceM8 is never a dead grant", () => {
    for (const status of [403, 404, 408, 429, 500, 502, 503]) {
      expect(classifySm8TokenFailure(status, "")).toBe("unavailable");
    }
  });
});

describe("refreshSm8Tokens", () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn();
  let logged: string[];

  if (typeof AbortSignal.timeout !== "function") {
    (AbortSignal as unknown as { timeout: () => AbortSignal }).timeout = () => new AbortController().signal;
  }

  const answer = (status: number, body: string) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  });

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    logged = [];
    jest.spyOn(console, "error").mockImplementation((...m: unknown[]) => void logged.push(m.map(String).join(" ")));
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it("answers a timeout or a network throw with unavailable, never a dead grant", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    expect(await refreshSm8Tokens(CFG, "rt-1")).toEqual({ ok: false, failure: "unavailable", status: null });
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await refreshSm8Tokens(CFG, "rt-1")).toEqual({ ok: false, failure: "unavailable", status: null });
  });

  it("answers invalid_grant with revoked", async () => {
    fetchMock.mockResolvedValueOnce(answer(400, JSON.stringify({ error: "invalid_grant" })));
    expect(await refreshSm8Tokens(CFG, "rt-1")).toEqual({ ok: false, failure: "revoked", status: 400 });
  });

  it("answers a 503 with unavailable", async () => {
    fetchMock.mockResolvedValueOnce(answer(503, "Service Unavailable"));
    expect(await refreshSm8Tokens(CFG, "rt-1")).toEqual({ ok: false, failure: "unavailable", status: 503 });
  });

  it("hands back the rotated pair", async () => {
    fetchMock.mockResolvedValueOnce(
      answer(200, JSON.stringify({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600, scope: "vendor" }))
    );
    expect(await refreshSm8Tokens(CFG, "rt-1")).toEqual({
      ok: true,
      tokens: { accessToken: "at-2", refreshToken: "rt-2", scope: "vendor", expiresIn: 3600 },
    });
  });

  it("logs the status and the body of a refusal, and never the refresh token or the secret", async () => {
    fetchMock.mockResolvedValueOnce(
      answer(400, JSON.stringify({ error: "invalid_grant", echoed: "refresh-token-abc and shh-secret" }))
    );
    await refreshSm8Tokens({ ...CFG, clientSecret: "shh-secret" }, "refresh-token-abc");
    const line = logged.join("\n");
    expect(line).toContain("[sm8] token refresh_token 400");
    expect(line).toContain("invalid_grant");
    expect(line).not.toContain("refresh-token-abc");
    expect(line).not.toContain("shh-secret");
  });

  it("says loudly when the refusal is our own configuration", async () => {
    fetchMock.mockResolvedValueOnce(answer(401, JSON.stringify({ error: "invalid_client" })));
    expect(await refreshSm8Tokens(CFG, "rt-1")).toEqual({ ok: false, failure: "unavailable", status: 401 });
    expect(logged.join("\n")).toMatch(/configuration/);
  });
});
