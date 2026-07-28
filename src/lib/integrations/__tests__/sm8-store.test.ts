/* The ServiceM8 grant lifecycle's hard cases — store.test.ts's sibling, and
   the stakes are higher here: ServiceM8 rotates the refresh token on EVERY
   refresh, so a lost race that clobbers the winner's pair doesn't degrade the
   connection, it bricks it. */

type Row = Record<string, unknown>;

let row: Row | null = null;
const updates: { patch: Record<string, unknown>; filters: Record<string, unknown> }[] = [];
const upserts: Record<string, unknown>[] = [];
const deletes: { table: string; filters: Record<string, unknown> }[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
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
      c.delete = () => {
        const d = { table, filters: { ...filters } as Record<string, unknown> };
        const chain: Record<string, unknown> = {};
        chain.eq = (col: string, v: unknown) => {
          d.filters[col] = v;
          return chain;
        };
        chain.then = (res: (v: { error: null }) => unknown) => {
          deletes.push(d);
          return Promise.resolve({ error: null }).then(res);
        };
        return chain;
      };
      return c;
    },
  },
}));

const refreshSm8Tokens = jest.fn();
jest.mock("../sm8", () => ({
  sm8Config: () => ({ clientId: "id", clientSecret: "secret", redirectUri: "https://x/cb" }),
  refreshSm8Tokens: (...a: unknown[]) => refreshSm8Tokens(...(a as [])),
}));

jest.mock("../secrets", () => ({
  tokenKey: () => Buffer.alloc(32, 1),
  // reversible fakes so assertions can talk about plaintext
  seal: (v: string) => `sealed:${v}`,
  open: (v: string) => (typeof v === "string" && v.startsWith("sealed:") ? v.slice(7) : null),
}));

import { disconnectSm8, saveSm8Connection, sm8Access } from "../sm8-store";
import { SM8_WIPE_TABLES } from "../sm8-sync-plan";

const NOW = Date.parse("2026-07-28T00:00:00Z");

const connectedRow = (over: Row = {}): Row => ({
  id: "c1",
  org_id: "org-1",
  provider: "servicem8",
  status: "connected",
  tenant_id: "v-1",
  tenant_name: "Acme Air",
  tenants: [{ tenantId: "v-1", tenantName: "Acme Air", timezoneName: "Australia/Brisbane" }],
  scopes: "vendor read_jobs",
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
  deletes.length = 0;
  refreshSm8Tokens.mockReset();
  refreshSm8Tokens.mockResolvedValue({
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresIn: 3600,
    scope: "vendor read_jobs",
  });
  row = connectedRow();
});

describe("a dead or absent grant is left alone", () => {
  it("needs_reauth returns null without spending a round trip", async () => {
    row = connectedRow({ status: "needs_reauth" });
    expect(await sm8Access("org-1", NOW)).toBeNull();
    expect(refreshSm8Tokens).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("no row at all returns null", async () => {
    row = null;
    expect(await sm8Access("org-1", NOW)).toBeNull();
    expect(refreshSm8Tokens).not.toHaveBeenCalled();
  });
});

describe("refresh is single-flight with a rotation guard", () => {
  it("two concurrent reads redeem the refresh token once and share the answer", async () => {
    const [a, b] = await Promise.all([sm8Access("org-1", NOW), sm8Access("org-1", NOW)]);
    expect(refreshSm8Tokens).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ accessToken: "new-access" });
    expect(b).toEqual(a);
  });

  it("the stored rotation is guarded by the token it spent", async () => {
    await sm8Access("org-1", NOW);
    const write = updates[0];
    expect(write.patch).toMatchObject({
      access_token_enc: "sealed:new-access",
      refresh_token_enc: "sealed:new-refresh",
    });
    /* The cross-instance backstop: only land while the row still holds the
       refresh token this call redeemed — a sibling's newer rotation must not
       be clobbered by our older one. */
    expect(write.filters).toMatchObject({
      org_id: "org-1",
      provider: "servicem8",
      refresh_token_enc: "sealed:old-refresh",
    });
  });

  it("a refused refresh marks the grant broken, in our words", async () => {
    refreshSm8Tokens.mockResolvedValue(null);
    expect(await sm8Access("org-1", NOW)).toBeNull();
    expect(updates[0].patch).toMatchObject({ status: "needs_reauth" });
    expect(String(updates[0].patch.last_error)).toContain("Reconnect ServiceM8");
  });
});

describe("saving a grant", () => {
  const tokens = {
    accessToken: "a",
    refreshToken: "r",
    scope: "vendor read_jobs",
    expiresIn: 3600,
  };

  it("stores the account identity in the shared tenant slots", async () => {
    await saveSm8Connection({
      orgId: "org-1",
      userId: "auth0|me",
      tokens,
      vendor: { uuid: "v-9", name: "Acme Air", email: null, timezoneName: "Australia/Brisbane", currency: "AUD" },
      now: NOW,
    });
    expect(upserts[0]).toMatchObject({
      provider: "servicem8",
      status: "connected",
      tenant_id: "v-9",
      tenant_name: "Acme Air",
      access_token_enc: "sealed:a",
      refresh_token_enc: "sealed:r",
    });
    expect(upserts[0].tenants).toEqual([
      { tenantId: "v-9", tenantName: "Acme Air", timezoneName: "Australia/Brisbane" },
    ]);
  });

  it("a failed identity read still stores the grant — nameless, not stranded", async () => {
    // ServiceM8 has no revocation endpoint: refusing to save would leave a
    // live grant nothing here could use OR clean up.
    await saveSm8Connection({
      orgId: "org-1",
      userId: "auth0|me",
      tokens,
      vendor: null,
      now: NOW,
    });
    expect(upserts[0]).toMatchObject({
      provider: "servicem8",
      tenant_id: null,
      tenant_name: null,
      tenants: [],
    });
  });
});

describe("disconnect", () => {
  it("wipes every mirror for this org, then the connection row last", async () => {
    await disconnectSm8("org-1");

    // every wipe is org-scoped — nothing here can touch another workspace
    for (const d of deletes) expect(d.filters.org_id).toBe("org-1");

    const wiped = deletes.map((d) => d.table);
    expect(wiped).toEqual([...SM8_WIPE_TABLES, "integration_connections"]);

    // the connection row goes LAST: an interrupted wipe reads as
    // connected-with-holes (self-repairing), never disconnected-with-leftovers
    const final = deletes[deletes.length - 1];
    expect(final.filters).toMatchObject({ org_id: "org-1", provider: "servicem8" });
  });
});
