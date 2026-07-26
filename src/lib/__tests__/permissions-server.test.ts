/* can() / getDbRole() — the server gate. Fresh module per test (React cache()
   memoizes per request; jest has no request scope, so we reset modules to get
   a clean cache each time) with the session and membership row mocked. */

type SessionShape = { user: { sub: string }; orgId?: string; orgRole?: string } | null;
type RowShape = { role: string; permissions: unknown } | null;

async function load(
  session: SessionShape,
  row: RowShape,
  dbError: string | null = null,
  primaryOwnerUserId: string | null = "auth0|owner",
  tradingName: string | null = null
) {
  jest.resetModules();
  jest.doMock("@/lib/auth0", () => ({
    auth0: { getSession: jest.fn().mockResolvedValue(session) },
  }));

  const eqCalls: Array<[string, unknown]> = [];
  const select = jest.fn();

  /* Two tables are read now, with different query shapes:
       memberships   .select().eq(user).eq(org).maybeSingle()
       organizations .select().eq(id).maybeSingle()
     so the mock has to be chainable to arbitrary depth rather than a fixed
     eq1 -> eq2 -> maybeSingle ladder. */
  const chain = (result: { data: unknown; error: unknown }) => {
    const node: Record<string, unknown> = {
      maybeSingle: jest.fn().mockResolvedValue(result),
    };
    node.eq = jest.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return node;
    });
    return node;
  };

  const from = jest.fn((table: string) => {
    select.mockImplementation(() =>
      table === "organizations"
        ? chain({
            data: primaryOwnerUserId
              ? { primary_owner_user_id: primaryOwnerUserId, trading_name: tradingName }
              : null,
            error: null,
          })
        : chain(dbError ? { data: null, error: { message: dbError } } : { data: row, error: null })
    );
    return { select };
  });

  jest.doMock("@/lib/supabase-server", () => ({
    supabaseAdmin: { from: (...a: unknown[]) => from(...(a as [string])) },
  }));
  const mod = await import("../permissions-server");
  return { ...mod, spies: { select, from, eqCalls } };
}

const session = (orgRole?: string): SessionShape => ({
  user: { sub: "auth0|u1" },
  orgId: "org-1",
  ...(orgRole ? { orgRole } : {}),
});

describe("can()", () => {
  it("fails closed with no session", async () => {
    const { can } = await load(null, null);
    expect(await can("toolbox")).toBe(false);
    expect(await can("financials")).toBe(false);
  });

  it("fails closed with a session but no membership row", async () => {
    const { can } = await load(session(), null);
    expect(await can("toolbox")).toBe(false);
  });

  it("fails closed on a database error", async () => {
    const { can } = await load(session("owner"), null, "connection refused");
    expect(await can("financials")).toBe(false);
  });

  it("staff defaults: tools yes, operations no", async () => {
    const { can } = await load(session(), { role: "staff", permissions: {} });
    expect(await can("toolbox")).toBe(true);
    expect(await can("team")).toBe(false);
    expect(await can("timepay_all")).toBe(false);
  });

  it("admin defaults: operations yes, money no", async () => {
    const { can } = await load(session(), { role: "admin", permissions: {} });
    expect(await can("timepay_all")).toBe(true);
    expect(await can("financials")).toBe(false);
  });

  it("a stored grant applies with no session change — the no-re-login property", async () => {
    // Same session object as the default-admin test; only the DB row differs.
    const { can } = await load(session(), { role: "admin", permissions: { financials: true } });
    expect(await can("financials")).toBe(true);
  });

  it("a stored revoke applies the same way", async () => {
    const { can } = await load(session(), { role: "admin", permissions: { assets_all: false } });
    expect(await can("assets_all")).toBe(false);
  });

  it("the DB role wins over a stale session role", async () => {
    // Session still says owner; the DB says they were demoted to staff.
    const { can, getDbRole } = await load(session("owner"), { role: "staff", permissions: {} });
    expect(await getDbRole()).toBe("staff");
    expect(await can("financials")).toBe(false);
    expect(await can("team")).toBe(false);
  });

  it("owner ignores a hostile stored revoke", async () => {
    const { can } = await load(session(), { role: "owner", permissions: { financials: false } });
    expect(await can("financials")).toBe(true);
  });

  it("queries the membership by user AND org", async () => {
    const { can, spies } = await load(session(), { role: "staff", permissions: {} });
    await can("toolbox");
    expect(spies.eqCalls).toEqual(
      expect.arrayContaining([
        ["user_id", "auth0|u1"],
        ["org_id", "org-1"],
      ])
    );
  });

  it("isMaster() is true only for the org's primary owner", async () => {
    const asMaster = await load(session(), { role: "owner", permissions: {} }, null, "auth0|u1");
    expect(await asMaster.isMaster()).toBe(true);

    const asCoOwner = await load(session(), { role: "owner", permissions: {} }, null, "auth0|someone-else");
    expect(await asCoOwner.isMaster()).toBe(false);
    // ...but a co-owner still holds every capability
    expect(await asCoOwner.can("financials")).toBe(true);
  });

  it("isMaster() fails closed when the org row can't be read", async () => {
    const { isMaster } = await load(session(), { role: "owner", permissions: {} }, null, null);
    expect(await isMaster()).toBe(false);
  });

  it("getOrgName() returns the trading name for any signed-in member", async () => {
    const { getOrgName } = await load(
      session(),
      { role: "staff", permissions: {} },
      null,
      "auth0|owner",
      "Smith Air Conditioning"
    );
    expect(await getOrgName()).toBe("Smith Air Conditioning");
  });

  it("getOrgName() is null while unset, on org-read failure, and signed out", async () => {
    const unset = await load(session(), { role: "staff", permissions: {} });
    expect(await unset.getOrgName()).toBeNull();

    const noOrg = await load(session(), { role: "staff", permissions: {} }, null, null, "Ghost Co");
    expect(await noOrg.getOrgName()).toBeNull();

    const signedOut = await load(null, null);
    expect(await signedOut.getOrgName()).toBeNull();
  });

  it("repeated calls agree (per-request de-dup itself is React cache(), inert in jest)", async () => {
    // In production, cache() memoizes getMembership per server request, so many
    // can() calls cost one query. Outside a React request scope cache() does
    // not memoize, so jest cannot assert the call count — only consistency.
    const { can, getCapabilities, spies } = await load(session(), {
      role: "admin",
      permissions: {},
    });
    expect(await can("team")).toBe(true);
    expect(await can("team")).toBe(true);
    expect((await getCapabilities()).has("financials")).toBe(false);
    expect(spies.select.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("requireOrg() — the server actions' shared front door", () => {
  it("rejects with no session", async () => {
    const { requireOrg } = await load(null, null);
    await expect(requireOrg()).rejects.toThrow("Not authenticated");
  });

  it("rejects a session with no active org", async () => {
    const { requireOrg } = await load({ user: { sub: "auth0|u1" } }, null);
    await expect(requireOrg()).rejects.toThrow("No active organization");
  });

  it("returns identity + org when no capability is named", async () => {
    // even with no membership row — session-only actions (your own staff
    // card) key off being signed in, not off a capability
    const { requireOrg } = await load(session(), null);
    expect(await requireOrg()).toEqual({ orgId: "org-1", userId: "auth0|u1" });
  });

  it("a named capability lets a role-default holder through", async () => {
    const { requireOrg } = await load(session(), { role: "staff", permissions: {} });
    expect(await requireOrg("studio")).toEqual({ orgId: "org-1", userId: "auth0|u1" });
  });

  it("a stored revoke shuts the same door", async () => {
    const { requireOrg } = await load(session(), {
      role: "staff",
      permissions: { studio: false },
    });
    await expect(requireOrg("studio")).rejects.toThrow("Insufficient permissions");
  });

  it("the capability check fails closed on a database error", async () => {
    const { requireOrg } = await load(session("owner"), null, "connection refused");
    await expect(requireOrg("studio")).rejects.toThrow("Insufficient permissions");
  });
});
