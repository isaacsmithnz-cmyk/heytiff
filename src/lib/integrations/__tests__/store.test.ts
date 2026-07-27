/* The grant lifecycle's hard cases: a dead grant is not hammered, a refresh
   happens once no matter how many reads race it, a lost rotation race can't
   clobber the winner's tokens, and a reconnect doesn't silently move the
   books to a different tenant. */

type Row = Record<string, unknown>;

let row: Row | null = null;
const updates: { patch: Record<string, unknown>; filters: Record<string, unknown> }[] = [];
const upserts: Record<string, unknown>[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const filters: Record<string, unknown> = {};
      const c: Record<string, unknown> = {};
      const self = () => c;
      c.select = self;
      c.eq = (col: string, v: unknown) => {
        filters[col] = v;
        return c;
      };
      c.maybeSingle = async () => ({ data: row });
      c.update = (patch: Record<string, unknown>) => {
        const u = { patch, filters };
        const chain: Record<string, unknown> = {};
        chain.eq = (col: string, v: unknown) => {
          u.filters = { ...u.filters, [col]: v };
          return chain;
        };
        chain.then = (res: (v: { error: null }) => unknown) => {
          updates.push(u);
          return Promise.resolve({ error: null }).then(res);
        };
        return chain;
      };
      c.upsert = (payload: Record<string, unknown>) => {
        upserts.push(payload);
        return Promise.resolve({ error: null });
      };
      c.delete = self;
      return c;
    },
  },
}));

const refreshTokens = jest.fn();
jest.mock("../xero", () => ({
  xeroConfig: () => ({ clientId: "id", clientSecret: "secret", redirectUri: "https://x/cb" }),
  refreshTokens: (...a: unknown[]) => refreshTokens(...(a as [])),
  revokeRefreshToken: jest.fn(async () => true),
}));

jest.mock("../secrets", () => ({
  tokenKey: () => Buffer.alloc(32, 1),
  // reversible fakes so assertions can talk about plaintext
  seal: (v: string) => `sealed:${v}`,
  open: (v: string) => (typeof v === "string" && v.startsWith("sealed:") ? v.slice(7) : null),
}));

import { saveXeroConnection, xeroAccess } from "../store";

const NOW = Date.parse("2026-07-28T00:00:00Z");

const connectedRow = (over: Row = {}): Row => ({
  id: "c1",
  org_id: "org-1",
  provider: "xero",
  status: "connected",
  tenant_id: "t-1",
  tenant_name: "HeyTiff",
  tenants: [{ tenantId: "t-1", tenantName: "HeyTiff" }],
  scopes: "openid offline_access",
  access_token_enc: "sealed:old-access",
  refresh_token_enc: "sealed:old-refresh",
  // spent five minutes ago — every read needs the refresh path
  expires_at: new Date(NOW - 5 * 60_000).toISOString(),
  connected_by_user_id: "auth0|me",
  connected_at: new Date(NOW - 86_400_000).toISOString(),
  updated_at: null,
  last_error: null,
  drift_count: null,
  drift_checked_at: null,
  ...over,
});

beforeEach(() => {
  updates.length = 0;
  upserts.length = 0;
  refreshTokens.mockReset();
  refreshTokens.mockResolvedValue({
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresIn: 1800,
    scope: "openid offline_access",
  });
  row = connectedRow();
});

describe("a dead grant is left dead", () => {
  it("needs_reauth returns null without spending a round trip", async () => {
    row = connectedRow({ status: "needs_reauth" });
    expect(await xeroAccess("org-1", NOW)).toBeNull();
    expect(refreshTokens).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});

describe("refresh is single-flight", () => {
  it("two concurrent reads redeem the refresh token once and share the answer", async () => {
    const [a, b] = await Promise.all([xeroAccess("org-1", NOW), xeroAccess("org-1", NOW)]);
    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ accessToken: "new-access", tenantId: "t-1" });
    expect(b).toEqual(a);
  });

  it("the stored rotation is guarded by the token it spent", async () => {
    await xeroAccess("org-1", NOW);
    const write = updates[0];
    expect(write.patch).toMatchObject({
      access_token_enc: "sealed:new-access",
      refresh_token_enc: "sealed:new-refresh",
    });
    /* The cross-instance backstop: only land if the row still holds the
       refresh token this call redeemed — a sibling's newer rotation must not
       be clobbered by our older one. */
    expect(write.filters).toMatchObject({
      org_id: "org-1",
      provider: "xero",
      refresh_token_enc: "sealed:old-refresh",
    });
  });
});

describe("reconnecting keeps the chosen tenant", () => {
  const tokens = {
    accessToken: "a",
    refreshToken: "r",
    expiresIn: 1800,
    scope: "openid",
  };

  it("keeps the prior tenant when the new grant still covers it", async () => {
    row = connectedRow({ tenant_id: "t-2", tenant_name: "Second" });
    await saveXeroConnection({
      orgId: "org-1",
      userId: "auth0|me",
      tokens,
      // Xero lists t-1 first (most recently active) — the default must lose
      // to the workspace's existing choice
      tenants: [
        { tenantId: "t-1", tenantName: "HeyTiff" },
        { tenantId: "t-2", tenantName: "Second" },
      ],
      now: NOW,
    });
    expect(upserts[0]).toMatchObject({ tenant_id: "t-2" });
    // same tenant ⇒ the drift flag survives (its window still covers the gap)
    expect(upserts[0]).not.toHaveProperty("drift_count");
  });

  it("falls back to the default and resets drift when the choice is gone", async () => {
    row = connectedRow({ tenant_id: "t-9", tenant_name: "Old" });
    await saveXeroConnection({
      orgId: "org-1",
      userId: "auth0|me",
      tokens,
      tenants: [{ tenantId: "t-1", tenantName: "HeyTiff" }],
      now: NOW,
    });
    expect(upserts[0]).toMatchObject({
      tenant_id: "t-1",
      drift_count: null,
      drift_checked_at: null,
    });
  });

  it("a first connect takes Xero's most-recent as the default", async () => {
    row = null;
    await saveXeroConnection({
      orgId: "org-1",
      userId: "auth0|me",
      tokens,
      tenants: [{ tenantId: "t-1", tenantName: "HeyTiff" }],
      now: NOW,
    });
    expect(upserts[0]).toMatchObject({ tenant_id: "t-1" });
  });
});
