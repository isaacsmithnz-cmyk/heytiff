/**
 * @jest-environment node
 *
 * The ServiceM8 callback's account rules. The state check is the real one
 * (oauth-state); everything past the code exchange is a fake, so what is
 * under test is the decision: which account this is, whether it may be saved
 * here, and whether it replaces the one that was.
 */

import { NextRequest } from "next/server";

const order: string[] = [];

const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: (...a: unknown[]) => getSession(...a) } }));
jest.mock("@/lib/permissions-server", () => ({ getDbRole: jest.fn(async () => "owner") }));

const afterFn = jest.fn((cb: () => unknown) => {
  order.push("after");
  void cb;
});
jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: (cb: () => unknown) => afterFn(cb),
}));

const exchangeSm8Code = jest.fn();
const fetchSm8Vendor = jest.fn();
jest.mock("@/lib/integrations/sm8", () => ({
  sm8Config: () => ({ clientId: "id", clientSecret: "secret", redirectUri: "https://app.test/cb" }),
  exchangeSm8Code: (...a: unknown[]) => exchangeSm8Code(...a),
  fetchSm8Vendor: (...a: unknown[]) => fetchSm8Vendor(...a),
}));

const readSm8Accounts = jest.fn();
const saveSm8Connection = jest.fn();
jest.mock("@/lib/integrations/sm8-store", () => ({
  readSm8Accounts: (...a: unknown[]) => readSm8Accounts(...a),
  saveSm8Connection: (...a: unknown[]) => saveSm8Connection(...a),
}));

const countConnectionsElsewhere = jest.fn();
jest.mock("@/lib/integrations/store", () => ({
  countConnectionsElsewhere: (...a: unknown[]) => countConnectionsElsewhere(...a),
}));

/* The clear goes through the sync's lease; what the lease does is the sync
   suite's to prove. */
const switchSm8Account = jest.fn();
jest.mock("@/lib/integrations/sm8-sync", () => ({
  runSm8SyncWhenFree: jest.fn(async () => ({})),
  switchSm8AccountUnderLease: (...a: unknown[]) => switchSm8Account(...a),
}));

/* Live updates (two-way phase 4): loaded only with SM8_WEBHOOKS on, so
   its factory running is itself the proof that off leaves it alone. */
let hooksLoaded = false;
const markSm8RotationOwed = jest.fn(async (_org: string, _account: string | null) => void order.push("owe"));
const ensureSm8Webhooks = jest.fn(async (_org: string, _opts: { rotate?: boolean; budgetMs: number }) => {
  order.push("ensure");
  return { ran: true };
});
jest.mock("@/lib/integrations/sm8-hooks", () => {
  hooksLoaded = true;
  return {
    markSm8RotationOwed: (...a: unknown[]) => markSm8RotationOwed(...(a as [string, string | null])),
    ensureSm8Webhooks: (...a: unknown[]) => ensureSm8Webhooks(...(a as [string, { budgetMs: number }])),
  };
});

import { GET, maxDuration } from "../callback/route";
import { runSm8SyncWhenFree } from "@/lib/integrations/sm8-sync";

const TOKENS = { accessToken: "at", refreshToken: "rt", scope: "vendor", expiresIn: 3600 };
const acme = { uuid: "v-1", name: "Acme Air", email: null, timezoneName: "Australia/Brisbane", currency: "AUD" };
const beta = { uuid: "v-2", name: "Beta Cooling", email: null, timezoneName: "Australia/Sydney", currency: "AUD" };

function callback(): NextRequest {
  return new NextRequest("https://app.test/api/integrations/servicem8/callback?code=c-1&state=s-1", {
    headers: { cookie: "servicem8_oauth_state=s-1:org-1" },
  });
}

const where = (res: Response) => {
  const url = new URL(res.headers.get("location")!);
  return `${url.pathname}${url.search}`;
};
const SCREEN = "/dashboard/admin/integrations/servicem8";

beforeEach(() => {
  order.length = 0;
  afterFn.mockClear();
  getSession.mockReset().mockResolvedValue({ orgId: "org-1", user: { sub: "auth0|me" } });
  exchangeSm8Code.mockReset().mockResolvedValue({ ok: true, tokens: TOKENS });
  fetchSm8Vendor.mockReset().mockResolvedValue({ ok: true, vendor: acme });
  readSm8Accounts.mockReset().mockResolvedValue({
    ok: true,
    connected: { tenantId: "v-1", tenantName: "Acme Air" },
    mirrored: { uuid: "v-1", name: "Acme Air" },
  });
  saveSm8Connection.mockReset().mockImplementation(async () => {
    order.push("save");
    return { ok: true };
  });
  switchSm8Account.mockReset().mockImplementation(async () => {
    order.push("switch");
    return { ok: true, cancelled: 0, cleared: true };
  });
  countConnectionsElsewhere.mockReset().mockResolvedValue(0);
});

describe("the connect-time read of which account this is", () => {
  it("goes uncounted: whose call counter it belongs to is what it is asking", async () => {
    await GET(callback());
    expect(fetchSm8Vendor).toHaveBeenCalled();
    for (const c of fetchSm8Vendor.mock.calls) expect(c[0]).toMatchObject({ meter: null, lane: "read" });
  });
});

describe("one ServiceM8 account, one workspace", () => {
  it("an account another workspace holds is refused, and nothing is saved", async () => {
    countConnectionsElsewhere.mockResolvedValue(1);
    const res = await GET(callback());
    expect(where(res)).toBe(`${SCREEN}?error=elsewhere`);
    expect(countConnectionsElsewhere).toHaveBeenCalledWith("org-1", "servicem8", "v-1");
    expect(saveSm8Connection).not.toHaveBeenCalled();
  });

  it("a race the check missed is refused by the index, in the same words", async () => {
    saveSm8Connection.mockResolvedValue({ ok: false, error: "x", elsewhere: true });
    const res = await GET(callback());
    expect(where(res)).toBe(`${SCREEN}?error=elsewhere`);
    expect(afterFn).not.toHaveBeenCalled();
  });
});

describe("a different account replaces the old one", () => {
  it("saves with sending off, clears the old copy BEFORE the first sync, and says it switched", async () => {
    fetchSm8Vendor.mockResolvedValue({ ok: true, vendor: beta });
    const res = await GET(callback());

    expect(saveSm8Connection).toHaveBeenCalledWith(expect.objectContaining({ vendor: beta, switching: true }));
    expect(switchSm8Account).toHaveBeenCalledWith("org-1", {
      to: beta,
      from: { uuid: "v-1", name: "Acme Air" },
      now: expect.any(Number),
    });
    // the first sync of the new account starts from nothing
    expect(order).toEqual(["save", "switch", "after"]);
    expect(where(res)).toBe(`${SCREEN}?connected=1&switched=1`);
  });

  it("a nameless connection is compared through the mirror's account", async () => {
    readSm8Accounts.mockResolvedValue({
      ok: true,
      connected: { tenantId: null, tenantName: null },
      mirrored: { uuid: "v-1", name: "Acme Air" },
    });
    fetchSm8Vendor.mockResolvedValue({ ok: true, vendor: beta });
    await GET(callback());
    expect(switchSm8Account).toHaveBeenCalledWith("org-1", expect.objectContaining({ from: { uuid: "v-1", name: "Acme Air" } }));
  });

  it("the same account is an ordinary reconnect: nothing cleared, sending left alone", async () => {
    const res = await GET(callback());
    expect(saveSm8Connection).toHaveBeenCalledWith(expect.objectContaining({ vendor: acme, switching: false }));
    expect(switchSm8Account).not.toHaveBeenCalled();
    expect(where(res)).toBe(`${SCREEN}?connected=1`);
  });

  it("Disconnect then Connect of another account is a change of account too", async () => {
    // Disconnect deleted the connection row and kept the record of the old account
    readSm8Accounts.mockResolvedValue({ ok: true, connected: null, mirrored: { uuid: "v-1", name: "Acme Air" } });
    fetchSm8Vendor.mockResolvedValue({ ok: true, vendor: beta });
    const res = await GET(callback());
    expect(saveSm8Connection).toHaveBeenCalledWith(expect.objectContaining({ vendor: beta, switching: true }));
    expect(switchSm8Account).toHaveBeenCalledWith("org-1", {
      to: beta,
      from: { uuid: "v-1", name: "Acme Air" },
      now: expect.any(Number),
    });
    expect(where(res)).toBe(`${SCREEN}?connected=1&switched=1`);
  });

  it("Disconnect then Connect of the same account clears nothing", async () => {
    readSm8Accounts.mockResolvedValue({ ok: true, connected: null, mirrored: { uuid: "v-1", name: "Acme Air" } });
    await GET(callback());
    expect(saveSm8Connection).toHaveBeenCalledWith(expect.objectContaining({ vendor: acme, switching: false }));
    expect(switchSm8Account).not.toHaveBeenCalled();
  });

  it("a sync still walking the old account holds the clear off: saved, no switch claimed, the first sync finishes it", async () => {
    const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
    fetchSm8Vendor.mockResolvedValue({ ok: true, vendor: beta });
    switchSm8Account.mockResolvedValue({ ok: false, reason: "busy" });
    const res = await GET(callback());
    expect(saveSm8Connection).toHaveBeenCalledWith(expect.objectContaining({ switching: true }));
    expect(afterFn).toHaveBeenCalledTimes(1);
    expect(where(res)).toBe(`${SCREEN}?connected=1`);
    quiet.mockRestore();
  });

  it("a first connect has nothing to replace", async () => {
    readSm8Accounts.mockResolvedValue({ ok: true, connected: null, mirrored: null });
    await GET(callback());
    expect(saveSm8Connection).toHaveBeenCalledWith(expect.objectContaining({ switching: false }));
    expect(switchSm8Account).not.toHaveBeenCalled();
  });
});

describe("which account this workspace had must be read, not assumed", () => {
  it("a failed read saves nothing, and says it couldn't be saved", async () => {
    /* Read as "no connection", a reconnect whose account couldn't be named
       would be saved nameless over the named row, and a different account
       would be saved without sending going off. */
    readSm8Accounts.mockResolvedValue({ ok: false });
    fetchSm8Vendor.mockResolvedValue({ ok: false, unauthorized: false });
    const res = await GET(callback());
    expect(where(res)).toBe(`${SCREEN}?error=save`);
    expect(saveSm8Connection).not.toHaveBeenCalled();
    expect(afterFn).not.toHaveBeenCalled();
  });

  it("a failed read with a readable account saves nothing either", async () => {
    readSm8Accounts.mockResolvedValue({ ok: false });
    fetchSm8Vendor.mockResolvedValue({ ok: true, vendor: beta });
    const res = await GET(callback());
    expect(where(res)).toBe(`${SCREEN}?error=save`);
    expect(saveSm8Connection).not.toHaveBeenCalled();
    expect(switchSm8Account).not.toHaveBeenCalled();
  });
});

describe("an account ServiceM8 wouldn't name", () => {
  it("a reconnect whose account can't be read, after two tries, keeps the working grant and saves nothing", async () => {
    fetchSm8Vendor.mockResolvedValue({ ok: false, unauthorized: false });
    const res = await GET(callback());
    expect(fetchSm8Vendor).toHaveBeenCalledTimes(2);
    expect(where(res)).toBe(`${SCREEN}?error=account`);
    expect(saveSm8Connection).not.toHaveBeenCalled();
  });

  it("a blip on the first read is asked again", async () => {
    fetchSm8Vendor.mockResolvedValueOnce({ ok: false, unauthorized: false }).mockResolvedValueOnce({ ok: true, vendor: acme });
    const res = await GET(callback());
    expect(where(res)).toBe(`${SCREEN}?connected=1`);
  });

  it("a first connect with no readable account is still stored, nameless", async () => {
    readSm8Accounts.mockResolvedValue({ ok: true, connected: null, mirrored: null });
    fetchSm8Vendor.mockResolvedValue({ ok: false, unauthorized: false });
    const res = await GET(callback());
    expect(saveSm8Connection).toHaveBeenCalledWith(expect.objectContaining({ vendor: null }));
    expect(where(res)).toBe(`${SCREEN}?connected=1`);
  });

  it("an account that isn't paid up says so, and isn't asked twice", async () => {
    fetchSm8Vendor.mockResolvedValue({ ok: false, unauthorized: false, paymentRequired: true });
    const res = await GET(callback());
    expect(fetchSm8Vendor).toHaveBeenCalledTimes(1);
    expect(where(res)).toBe(`${SCREEN}?error=billing`);
    expect(saveSm8Connection).not.toHaveBeenCalled();
  });
});

describe("live updates (two-way phase 4)", () => {
  const env = { ...process.env };
  const slice = runSm8SyncWhenFree as jest.Mock;
  let clock = 0;
  const behind = async () => {
    expect(afterFn).toHaveBeenCalledTimes(1);
    await (afterFn.mock.calls[0][0] as () => Promise<unknown>)();
  };
  beforeEach(() => {
    clock = Date.parse("2026-09-28T00:00:00.000Z");
    jest.spyOn(Date, "now").mockImplementation(() => clock);
    markSm8RotationOwed.mockClear();
    ensureSm8Webhooks.mockClear();
    slice.mockReset().mockImplementation(async () => void order.push("slice"));
  });
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });
  const on = () => {
    process.env.VERCEL_ENV = "production";
    process.env.SM8_WEBHOOKS = "1";
  };

  it("has the platform's whole 300 s", () => {
    expect(maxDuration).toBe(300);
  });

  /* first: the module registry keeps a module once any test loads it */
  it("off or gone: nothing is marked or loaded, and behind the response is today's slice alone", async () => {
    for (const hooks of [undefined, "gone"]) {
      process.env.VERCEL_ENV = "production";
      if (hooks === undefined) delete process.env.SM8_WEBHOOKS;
      else process.env.SM8_WEBHOOKS = hooks;
      afterFn.mockClear();
      order.length = 0;
      fetchSm8Vendor.mockResolvedValue({ ok: true, vendor: beta });
      await GET(callback());
      expect(order).toEqual(["save", "switch", "after"]);
      await behind();
      expect(order).toEqual(["save", "switch", "after", "slice"]);
    }
    expect(slice).toHaveBeenCalledWith("org-1", "connect");
    expect(hooksLoaded).toBe(false);
  });

  it("on: a saved connect owes a rotation BEFORE the redirect; behind it, the slice, then the reconcile with a rotation", async () => {
    on();
    const res = await GET(callback());
    expect(where(res)).toBe(`${SCREEN}?connected=1`);
    expect(order).toEqual(["save", "owe", "after"]);
    expect(markSm8RotationOwed).toHaveBeenCalledWith("org-1", "v-1");
    expect(ensureSm8Webhooks).not.toHaveBeenCalled();
    clock += 100_000; // the slice took 100 s
    await behind();
    expect(order).toEqual(["save", "owe", "after", "slice", "ensure"]);
    // what is left of 300 s, less the 20 s margin
    expect(ensureSm8Webhooks).toHaveBeenCalledWith("org-1", { rotate: true, budgetMs: 180_000 });
  });

  it("on: a change of account owes it for the new account, before the old copy is cleared", async () => {
    on();
    fetchSm8Vendor.mockResolvedValue({ ok: true, vendor: beta });
    await GET(callback());
    expect(order).toEqual(["save", "owe", "switch", "after"]);
    expect(markSm8RotationOwed).toHaveBeenCalledWith("org-1", "v-2");
  });

  it("on: a nameless first connect marks what it can, and still reconciles behind the slice", async () => {
    on();
    readSm8Accounts.mockResolvedValue({ ok: true, connected: null, mirrored: null });
    fetchSm8Vendor.mockResolvedValue({ ok: false, unauthorized: false });
    await GET(callback());
    expect(markSm8RotationOwed).toHaveBeenCalledWith("org-1", null);
    await behind();
    expect(ensureSm8Webhooks).toHaveBeenCalledWith("org-1", expect.objectContaining({ rotate: true }));
  });

  it("on: under a minute left after the slice, no reconcile — the mark waits for a page load or the night", async () => {
    on();
    const quiet = jest.spyOn(console, "warn").mockImplementation(() => {});
    await GET(callback());
    clock += 221_000; // 280 - 221 = 59 s left
    await behind();
    expect(order).toEqual(["save", "owe", "after", "slice"]);
    expect(ensureSm8Webhooks).not.toHaveBeenCalled();
    quiet.mockRestore();
  });

  it("on: a connect that saved nothing owes nothing", async () => {
    on();
    saveSm8Connection.mockResolvedValue({ ok: false, error: "x", elsewhere: true });
    await GET(callback());
    countConnectionsElsewhere.mockResolvedValue(1);
    await GET(callback());
    expect(markSm8RotationOwed).not.toHaveBeenCalled();
    expect(afterFn).not.toHaveBeenCalled();
  });
});
