import {
  accessTokenUsable,
  expiryFromTokenSet,
  parseTenants,
  toView,
  type ConnectionRow,
} from "../connection";
import { XERO_SCOPE_LIST } from "../providers";

const row = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: "c1",
  org_id: "org1",
  provider: "xero",
  status: "connected",
  tenant_id: "t1",
  tenant_name: "Acme Air Pty Ltd",
  tenants: [{ tenantId: "t1", tenantName: "Acme Air Pty Ltd" }],
  scopes: XERO_SCOPE_LIST.join(" "),
  access_token_enc: "v1.sealed.access.token",
  refresh_token_enc: "v1.sealed.refresh.token",
  expires_at: "2026-07-26T02:00:00.000Z",
  connected_by_user_id: "auth0|isaac",
  connected_at: "2026-07-26T01:30:00.000Z",
  updated_at: null,
  last_error: null,
  ...over,
});

describe("toView", () => {
  /* The point of the view: it is what a client component may hold. If a token
     field ever survives the mapping, a screen prop leaks an access token. */
  it("carries no token fields at all", () => {
    const view = toView(row());
    const keys = Object.keys(view).join(" ");
    expect(keys).not.toMatch(/token/i);
    expect(JSON.stringify(view)).not.toContain("sealed");
  });

  it("splits the granted scopes and reports nothing missing", () => {
    const view = toView(row());
    expect(view.scopes).toEqual(XERO_SCOPE_LIST);
    expect(view.missing).toEqual([]);
  });

  it("flags the scopes an older grant predates", () => {
    const view = toView(row({ scopes: "openid offline_access" }));
    expect(view.missing).toContain("accounting.reports.profitandloss.read");
    expect(view.missing).not.toContain("openid");
  });

  it("fails closed on a status it doesn't recognise", () => {
    // an unknown status must read as "needs attention", never as connected
    expect(toView(row({ status: "wat" })).status).toBe("needs_reauth");
  });

  it("passes the connector's name through", () => {
    expect(toView(row(), "Isaac Smith").connectedByName).toBe("Isaac Smith");
    expect(toView(row()).connectedByName).toBeNull();
  });
});

describe("parseTenants", () => {
  it("keeps well-formed rows and names an unnamed one by its id", () => {
    expect(parseTenants([{ tenantId: "t1", tenantName: "Acme" }, { tenantId: "t2" }])).toEqual([
      { tenantId: "t1", tenantName: "Acme" },
      { tenantId: "t2", tenantName: "t2" },
    ]);
  });

  it("drops anything without an id rather than storing an unqueryable tenant", () => {
    expect(parseTenants([{ tenantName: "Nameless" }, null, "x", 4, {}])).toEqual([]);
  });

  it("degrades to no picker for a non-array", () => {
    expect(parseTenants(null)).toEqual([]);
    expect(parseTenants(undefined)).toEqual([]);
    expect(parseTenants({ tenantId: "t1" })).toEqual([]);
  });
});

describe("accessTokenUsable", () => {
  const now = Date.parse("2026-07-26T01:00:00.000Z");

  it("is true with comfortable time left", () => {
    expect(accessTokenUsable("2026-07-26T01:25:00.000Z", now)).toBe(true);
  });

  it("is false once inside the skew, so nothing expires mid-flight", () => {
    expect(accessTokenUsable("2026-07-26T01:00:30.000Z", now)).toBe(false);
  });

  it("is false when already past", () => {
    expect(accessTokenUsable("2026-07-26T00:59:00.000Z", now)).toBe(false);
  });

  it("is false for missing or unparseable expiries — refresh first", () => {
    expect(accessTokenUsable(null, now)).toBe(false);
    expect(accessTokenUsable("not a date", now)).toBe(false);
  });
});

describe("expiryFromTokenSet", () => {
  const now = Date.parse("2026-07-26T01:00:00.000Z");

  it("turns Xero's expires_in seconds into a timestamp", () => {
    expect(expiryFromTokenSet({ expires_in: 1800 }, now)).toBe("2026-07-26T01:30:00.000Z");
  });

  it("understands the absolute epoch-seconds form too", () => {
    expect(expiryFromTokenSet({ expires_at: 1_784_000_000 }, now)).toBe(
      new Date(1_784_000_000_000).toISOString()
    );
  });

  it("prefers expires_in when both are present", () => {
    expect(expiryFromTokenSet({ expires_in: 60, expires_at: 1 }, now)).toBe(
      "2026-07-26T01:01:00.000Z"
    );
  });

  it("is null for anything unreadable, which reads as 'refresh first'", () => {
    expect(expiryFromTokenSet({}, now)).toBeNull();
    expect(expiryFromTokenSet({ expires_in: "1800" }, now)).toBeNull();
    expect(expiryFromTokenSet({ expires_in: Number.NaN }, now)).toBeNull();
  });
});
