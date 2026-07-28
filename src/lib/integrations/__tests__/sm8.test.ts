/* The OAuth client's pure edges: config presence, the consent URL's exact
   parameters, and token-response parsing. The strings under test were
   verified against developer.servicem8.com/docs/authentication (2026-07-28)
   — this suite is what stops them drifting back toward memory. */

import { buildSm8ConsentUrl, readSm8Tokens, sm8Config, SM8_CALLBACK_PATH } from "../sm8";
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
