/* The ServiceM8 grant lifecycle's hard cases — store.test.ts's sibling, and
   the stakes are higher here: ServiceM8 rotates the refresh token on EVERY
   refresh, so a lost race that clobbers the winner's pair doesn't degrade the
   connection, it bricks it. And a connection flagged for a blip asks an owner
   to reconnect something that works. */

type Row = Record<string, unknown>;
type DbResult = { data?: unknown; error: { code?: string; message?: string } | null; count?: number };

let row: Row | null = null;
let vendorRow: Row | null = null;
/* The refresh claim: taken unless a test says the claim is busy, or that the
   database doesn't have the column yet. */
let claimBusy = false;
let claimError: { code: string } | null = null;
/* Called when the claim is found busy — lets a test play the sibling that
   holds it. */
let onBusyClaim: (() => void) | null = null;
/* What a cancel of sm8_writes hands back, and what a head count reads. */
let cancelledRows: Row[] = [];
let headCount = 0;
let documentRows: Row[] = [];
let upsertError: { code: string } | null = null;
/** Errors for the next upserts, one each, before `upsertError` applies. */
const upsertErrorsOnce: { code: string }[] = [];
/* One-off answers for an update, by the patch it carries. */
let updateHook: ((u: Update) => DbResult | undefined) | null = null;
/* Tables whose delete the database refuses, and tables whose single-row read
   errors — a failure is not an absent row. */
const deleteFails = new Set<string>();
const readFails = new Set<string>();
const removed: string[][] = [];

/* `is` is kept apart from `filters` on purpose: `.is(col, null)` and
   `.eq(col, null)` are not the same query, and the naming repair's guard is
   the whole point of that write. */
type Update = {
  table: string;
  patch: Record<string, unknown>;
  filters: Record<string, unknown>;
  is: Record<string, unknown>;
  or: string | null;
  neq: Record<string, unknown>;
};
const updates: Update[] = [];
const upserts: Record<string, unknown>[] = [];
const deletes: { table: string; filters: Record<string, unknown> }[] = [];

/** Whether an update's filters match the connection row as it stands. */
function matchesRow(u: Update): boolean {
  if (!row) return false;
  for (const [col, v] of Object.entries(u.filters)) if (row[col] !== v) return false;
  for (const col of Object.keys(u.is)) if (row[col] != null) return false;
  return true;
}

function updateResult(u: Update): DbResult {
  const hooked = updateHook?.(u);
  if (hooked) return hooked;
  if (u.table === "sm8_writes") return { data: cancelledRows, error: null };
  if (u.table === "integration_connections" && "refresh_claimed_until" in u.patch && u.patch.refresh_claimed_until !== null) {
    if (claimError) return { data: null, error: claimError };
    if (claimBusy) {
      onBusyClaim?.();
      return { data: [], error: null };
    }
    return { data: [{ id: "c1" }], error: null };
  }
  return { data: matchesRow(u) ? [{ id: "c1" }] : [], error: null };
}

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        remove: async (refs: string[]) => {
          removed.push(refs);
          return { data: [], error: null };
        },
      }),
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let head = false;
      const c: Record<string, unknown> = {};
      c.select = (_cols?: string, opts?: { head?: boolean }) => {
        if (opts?.head) head = true;
        return c;
      };
      c.eq = (col: string, v: unknown) => {
        filters[col] = v;
        return c;
      };
      c.gte = () => c;
      c.or = () => c;
      c.order = () => c;
      c.range = () => c;
      c.maybeSingle = async () =>
        readFails.has(table)
          ? { data: null, error: { code: "08006", message: "connection failure" } }
          : {
              data: table === "sm8_vendor" ? vendorRow : table === "integration_connections" ? row : null,
              error: null,
            };
      c.then = (res: (v: DbResult) => unknown) =>
        Promise.resolve(
          head
            ? { count: headCount, error: null }
            : { data: table === "documents" ? documentRows : [], error: null }
        ).then(res);
      c.update = (patch: Record<string, unknown>) => {
        const u: Update = { table, patch, filters: { ...filters }, is: {}, or: null, neq: {} };
        const chain: Record<string, unknown> = {};
        chain.eq = (col: string, v: unknown) => {
          u.filters = { ...u.filters, [col]: v };
          return chain;
        };
        chain.in = (col: string, v: unknown) => {
          u.filters = { ...u.filters, [col]: v };
          return chain;
        };
        chain.is = (col: string, v: unknown) => {
          u.is[col] = v;
          return chain;
        };
        chain.or = (expr: string) => {
          u.or = expr;
          return chain;
        };
        chain.neq = (col: string, v: unknown) => {
          u.neq[col] = v;
          return chain;
        };
        chain.select = () => {
          updates.push(u);
          return Promise.resolve(updateResult(u));
        };
        chain.then = (res: (v: DbResult) => unknown) => {
          updates.push(u);
          return Promise.resolve({ error: updateResult(u).error }).then(res);
        };
        return chain;
      };
      c.upsert = (payload: Record<string, unknown>) => {
        upserts.push(payload);
        return Promise.resolve({ error: upsertErrorsOnce.shift() ?? upsertError });
      };
      c.delete = () => {
        const d = { table, filters: { ...filters } as Record<string, unknown> };
        const chain: Record<string, unknown> = {};
        chain.eq = (col: string, v: unknown) => {
          d.filters[col] = v;
          return chain;
        };
        chain.then = (res: (v: { error: { code: string } | null }) => unknown) => {
          if (deleteFails.has(table)) return Promise.resolve({ error: { code: "57014" } }).then(res);
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

import {
  disconnectSm8,
  markSm8NeedsReauth,
  nameSm8ConnectionIfNameless,
  readSm8AccountChange,
  readSm8Accounts,
  renewSm8Access,
  saveSm8Connection,
  sm8Access,
  sm8AccessResult,
  switchSm8Account,
  type Sm8Access,
} from "../sm8-store";
import { SM8_ACCOUNT_RESET_TABLES, SM8_WIPE_TABLES } from "../sm8-sync-plan";
import { WRITE_WORDS } from "../sm8-write-plan";

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

/** A row a sibling server has just rotated: new pair, live for an hour. */
const rotatedRow = (over: Row = {}): Row =>
  connectedRow({
    access_token_enc: "sealed:sibling-access",
    refresh_token_enc: "sealed:sibling-refresh",
    expires_at: new Date(NOW + 3_600_000).toISOString(),
    ...over,
  });

const fresh = {
  ok: true,
  tokens: { accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 3600, scope: "vendor read_jobs" },
};

const flags = () => updates.filter((u) => u.table === "integration_connections" && u.patch.status === "needs_reauth");
const rotations = () =>
  updates.filter((u) => u.table === "integration_connections" && u.patch.access_token_enc !== undefined);

/** An access handed out while the row held `sealed:old-refresh` and a live
    token — what a caller holds when ServiceM8 then refuses it. */
async function liveAccess(): Promise<Sm8Access> {
  const saved = row;
  row = connectedRow({ expires_at: new Date(NOW + 3_600_000).toISOString() });
  const r = await sm8AccessResult("org-1", NOW);
  row = saved;
  if (!r.ok) throw new Error("expected an access");
  updates.length = 0;
  return r.access;
}

beforeEach(() => {
  updates.length = 0;
  upserts.length = 0;
  deletes.length = 0;
  removed.length = 0;
  claimBusy = false;
  claimError = null;
  onBusyClaim = null;
  cancelledRows = [];
  headCount = 0;
  documentRows = [];
  upsertError = null;
  upsertErrorsOnce.length = 0;
  updateHook = null;
  deleteFails.clear();
  readFails.clear();
  vendorRow = null;
  refreshSm8Tokens.mockReset();
  refreshSm8Tokens.mockResolvedValue(fresh);
  row = connectedRow();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("a dead or absent grant is left alone", () => {
  it("needs_reauth answers reauth without spending a round trip", async () => {
    row = connectedRow({ status: "needs_reauth" });
    expect(await sm8AccessResult("org-1", NOW)).toEqual({ ok: false, reason: "reauth" });
    expect(await sm8Access("org-1", NOW)).toBeNull();
    expect(refreshSm8Tokens).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("no row at all is not_connected", async () => {
    row = null;
    expect(await sm8AccessResult("org-1", NOW)).toEqual({ ok: false, reason: "not_connected" });
    expect(await sm8Access("org-1", NOW)).toBeNull();
    expect(refreshSm8Tokens).not.toHaveBeenCalled();
  });
});

describe("refresh is single-flight with a rotation guard", () => {
  it("two concurrent reads redeem the refresh token once and share the answer", async () => {
    const [a, b] = await Promise.all([sm8Access("org-1", NOW), sm8Access("org-1", NOW)]);
    expect(refreshSm8Tokens).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ accessToken: "new-access", tenantId: "v-1", grant: expect.any(String), meter: "v-1" });
    expect(b).toEqual(a);
  });

  it("counts a token's calls against its ServiceM8 account, or the workspace while the connection is nameless", async () => {
    row = connectedRow({ expires_at: new Date(NOW + 3_600_000).toISOString() });
    const named = await sm8AccessResult("org-1", NOW);
    expect(named).toEqual({ ok: true, access: expect.objectContaining({ meter: "v-1" }) });
    row = connectedRow({ tenant_id: null, expires_at: new Date(NOW + 3_600_000).toISOString() });
    const nameless = await sm8AccessResult("org-1", NOW);
    expect(nameless).toEqual({ ok: true, access: expect.objectContaining({ meter: "org:org-1" }) });
  });

  it("the stored rotation is guarded by the token it spent", async () => {
    await sm8Access("org-1", NOW);
    const write = rotations()[0];
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

  it("a refused refresh marks THAT grant broken, in our words", async () => {
    refreshSm8Tokens.mockResolvedValue({ ok: false, failure: "revoked", status: 400 });
    expect(await sm8AccessResult("org-1", NOW)).toEqual({ ok: false, reason: "reauth" });
    const flag = flags()[0];
    expect(flag.patch).toMatchObject({ status: "needs_reauth" });
    expect(String(flag.patch.last_error)).toContain("Reconnect ServiceM8");
    // conditional on the grant it judged: a reconnect since isn't flagged
    expect(flag.filters).toMatchObject({ refresh_token_enc: "sealed:old-refresh" });
  });

  it("a refresh that timed out flags nothing and says ServiceM8 couldn't be reached", async () => {
    refreshSm8Tokens.mockResolvedValue({ ok: false, failure: "unavailable", status: null });
    expect(await sm8AccessResult("org-1", NOW)).toEqual({ ok: false, reason: "unreachable" });
    expect(flags()).toHaveLength(0);
  });

  it("the loser of a race takes the winner's token and flags nothing", async () => {
    /* Two servers read the same refresh token; the other one redeemed it
       first, so ServiceM8 refuses ours — but the row already holds the
       winner's pair, and that is the answer. */
    refreshSm8Tokens.mockImplementation(async () => {
      row = rotatedRow();
      return { ok: false, failure: "revoked", status: 400 };
    });
    const r = await sm8AccessResult("org-1", NOW);
    expect(r).toEqual({ ok: true, access: expect.objectContaining({ accessToken: "sibling-access" }) });
    expect(flags()).toHaveLength(0);
  });
});

describe("the refresh claim", () => {
  it("is taken before the refresh token is spent, and released in the rotation", async () => {
    await sm8AccessResult("org-1", NOW);
    const claim = updates[0];
    expect(claim.patch.refresh_claimed_until).toBe(new Date(NOW + 15_000).toISOString());
    expect(claim.filters).toMatchObject({ refresh_token_enc: "sealed:old-refresh" });
    expect(claim.or).toBe(`refresh_claimed_until.is.null,refresh_claimed_until.lt.${new Date(NOW).toISOString()}`);
    expect(rotations()[0].patch).toHaveProperty("refresh_claimed_until", null);
  });

  it("a busy claim waits for the sibling's rotation instead of redeeming the same token", async () => {
    jest.useFakeTimers();
    claimBusy = true;
    onBusyClaim = () => {
      row = rotatedRow();
    };
    const pending = sm8AccessResult("org-1", NOW);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await pending).toEqual({ ok: true, access: expect.objectContaining({ accessToken: "sibling-access" }) });
    expect(refreshSm8Tokens).not.toHaveBeenCalled();
  });

  it("a busy claim that never resolves waits at least the token timeout, then flags nothing", async () => {
    jest.useFakeTimers();
    claimBusy = true;
    let settled = false;
    const pending = sm8AccessResult("org-1", NOW).then((r) => {
      settled = true;
      return r;
    });
    await jest.advanceTimersByTimeAsync(10_000);
    // the sibling's token request may take its whole 10 s: still waiting
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(await pending).toEqual({ ok: false, reason: "unreachable" });
    expect(refreshSm8Tokens).not.toHaveBeenCalled();
    expect(flags()).toHaveLength(0);
  });

  it("a refresh that failed gives the claim back at once, on the token it claimed", async () => {
    /* Held for its full 15 s instead, every other server would wait 12 s for
       a rotation that is never coming and then say ServiceM8 couldn't be
       reached. */
    refreshSm8Tokens.mockResolvedValue({ ok: false, failure: "unavailable", status: null });
    await sm8AccessResult("org-1", NOW);
    const release = updates.find(
      (u) => u.table === "integration_connections" && "refresh_claimed_until" in u.patch && u.patch.refresh_claimed_until === null
    );
    expect(release).toBeDefined();
    expect(release!.patch).toEqual({ refresh_claimed_until: null });
    expect(release!.filters).toMatchObject({ org_id: "org-1", provider: "servicem8", refresh_token_enc: "sealed:old-refresh" });
  });

  it("a refused refresh gives the claim back too", async () => {
    refreshSm8Tokens.mockResolvedValue({ ok: false, failure: "revoked", status: 400 });
    await sm8AccessResult("org-1", NOW);
    expect(updates.some((u) => u.patch.refresh_claimed_until === null && Object.keys(u.patch).length === 1)).toBe(true);
  });

  it("a claim that was never taken is never given back", async () => {
    claimError = { code: "PGRST204" };
    refreshSm8Tokens.mockResolvedValue({ ok: false, failure: "unavailable", status: null });
    await sm8AccessResult("org-1", NOW);
    expect(updates.some((u) => u.patch.refresh_claimed_until === null)).toBe(false);
  });

  it("a busy claim whose sibling found the grant dead says so at the next look, not after the whole wait", async () => {
    jest.useFakeTimers();
    claimBusy = true;
    onBusyClaim = () => {
      row = connectedRow({ status: "needs_reauth" });
    };
    let settled = false;
    const pending = sm8AccessResult("org-1", NOW).then((r) => {
      settled = true;
      return r;
    });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(true);
    expect(await pending).toEqual({ ok: false, reason: "reauth" });
    expect(refreshSm8Tokens).not.toHaveBeenCalled();
  });

  it("a database without the claim column refreshes as before", async () => {
    claimError = { code: "PGRST204" };
    const r = await sm8AccessResult("org-1", NOW);
    expect(r.ok).toBe(true);
    expect(refreshSm8Tokens).toHaveBeenCalledTimes(1);
    // writing the missing column would fail the rotation and lose the new token
    expect(rotations()[0].patch).not.toHaveProperty("refresh_claimed_until");
  });
});

describe("a refused token", () => {
  it("renewSm8Access refreshes even when the stored expiry still looks live", async () => {
    const rejected = await liveAccess();
    row = connectedRow({ expires_at: new Date(NOW + 3_600_000).toISOString() });
    const r = await renewSm8Access("org-1", rejected, NOW);
    expect(refreshSm8Tokens).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: true, access: expect.objectContaining({ accessToken: "new-access" }) });
  });

  it("renewSm8Access takes a token a sibling already rotated, without spending a refresh", async () => {
    const rejected = await liveAccess();
    row = rotatedRow();
    const r = await renewSm8Access("org-1", rejected, NOW);
    expect(refreshSm8Tokens).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, access: expect.objectContaining({ accessToken: "sibling-access" }) });
  });

  it("markSm8NeedsReauth flags the grant the access came from", async () => {
    const access = await liveAccess();
    expect(await markSm8NeedsReauth("org-1", "gone", access)).toBe(true);
    expect(flags()[0].filters).toMatchObject({ refresh_token_enc: "sealed:old-refresh" });
  });

  it("markSm8NeedsReauth with a grant the row no longer holds writes nothing", async () => {
    const access = await liveAccess();
    // a sibling refreshed, or the owner reconnected, since the token went out
    row = rotatedRow();
    expect(await markSm8NeedsReauth("org-1", "gone", access)).toBe(false);
    expect(flags()).toHaveLength(0);
  });
});

describe("saving a grant", () => {
  const tokens = {
    accessToken: "a",
    refreshToken: "r",
    scope: "vendor read_jobs",
    expiresIn: 3600,
  };
  const vendor = { uuid: "v-9", name: "Acme Air", email: null, timezoneName: "Australia/Brisbane", currency: "AUD" };

  it("stores the account identity in the shared tenant slots", async () => {
    await saveSm8Connection({ orgId: "org-1", userId: "auth0|me", tokens, vendor, now: NOW });
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
    // a reconnect to the same account leaves the owner's switch alone
    expect(upserts[0]).not.toHaveProperty("write_mode");
  });

  it("a failed identity read still stores the grant — nameless, not stranded", async () => {
    // ServiceM8 has no revocation endpoint: refusing to save would leave a
    // live grant nothing here could use OR clean up.
    await saveSm8Connection({ orgId: "org-1", userId: "auth0|me", tokens, vendor: null, now: NOW });
    expect(upserts[0]).toMatchObject({
      provider: "servicem8",
      tenant_id: null,
      tenant_name: null,
      tenants: [],
    });
  });

  it("a switch of account turns sending off in the same write, and forgets who paused it", async () => {
    await saveSm8Connection({ orgId: "org-1", userId: "auth0|me", tokens, vendor, switching: true, now: NOW });
    expect(upserts[0]).toMatchObject({ tenant_id: "v-9", write_mode: "off", paused_reason: null });
  });

  it("a reconnect to the same account leaves a pause as it is", async () => {
    await saveSm8Connection({ orgId: "org-1", userId: "auth0|me", tokens, vendor, now: NOW });
    expect(upserts[0]).not.toHaveProperty("paused_reason");
  });

  it("a database without the pause column still saves a switch", async () => {
    upsertErrorsOnce.push({ code: "PGRST204" });
    const r = await saveSm8Connection({ orgId: "org-1", userId: "auth0|me", tokens, vendor, switching: true, now: NOW });
    expect(r).toEqual({ ok: true });
    expect(upserts).toHaveLength(2);
    expect(upserts[1]).toMatchObject({ write_mode: "off" });
    expect(upserts[1]).not.toHaveProperty("paused_reason");
  });

  it("an account another workspace holds reads as elsewhere", async () => {
    upsertError = { code: "23505" };
    const r = await saveSm8Connection({ orgId: "org-1", userId: "auth0|me", tokens, vendor, now: NOW });
    expect(r).toMatchObject({ ok: false, elsewhere: true });
  });
});

describe("naming a grant that connected nameless", () => {
  const vendor = {
    uuid: "v-9",
    name: "Your Company Name",
    email: null,
    timezoneName: "Australia/Brisbane",
    currency: "AUD",
  };

  beforeEach(() => {
    row = connectedRow({ tenant_id: null, tenant_name: null, tenants: [] });
  });

  it("fills the same three slots connect would have, org- and provider-scoped", async () => {
    expect(await nameSm8ConnectionIfNameless("org-1", vendor, NOW)).toBe("named");

    const write = updates[0];
    expect(write.patch).toMatchObject({ tenant_id: "v-9", tenant_name: "Your Company Name" });
    expect(write.patch.tenants).toEqual([
      { tenantId: "v-9", tenantName: "Your Company Name", timezoneName: "Australia/Brisbane" },
    ]);
    expect(write.filters).toMatchObject({ org_id: "org-1", provider: "servicem8" });
  });

  it("only lands while the row is STILL nameless", async () => {
    row = connectedRow();
    expect(await nameSm8ConnectionIfNameless("org-1", vendor, NOW)).toBe("unchanged");
    /* The guard, not a nicety: a sync that read the vendor before a reconnect
       must not stamp its stale account over the one the reconnect stored. */
    expect(updates[0].is).toEqual({ tenant_id: null });
  });

  it("touches nothing else — tokens, status and the grant's own dates aren't its business", async () => {
    await nameSm8ConnectionIfNameless("org-1", vendor, NOW);
    expect(Object.keys(updates[0].patch).sort()).toEqual([
      "tenant_id",
      "tenant_name",
      "tenants",
      "updated_at",
    ]);
  });

  it("an account another workspace already holds answers elsewhere", async () => {
    updateHook = (u) => ("tenant_id" in u.patch ? { data: null, error: { code: "23505" } } : undefined);
    expect(await nameSm8ConnectionIfNameless("org-1", vendor, NOW)).toBe("elsewhere");
  });
});

describe("switching to a different account", () => {
  const to = { uuid: "v-2", name: "Beta Cooling", email: null, timezoneName: "Australia/Sydney", currency: "AUD" };
  const from = { uuid: "v-1", name: "Acme Air" };

  beforeEach(() => {
    // the callback has already saved the new account onto the row
    row = connectedRow({ tenant_id: "v-2", tenant_name: "Beta Cooling" });
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("switches sending off, records the old account, and clears its copy with sm8_vendor last", async () => {
    cancelledRows = [{ id: "w1", payload: { name: "quote.pdf" } }];
    const r = await switchSm8Account("org-1", { to, from, now: NOW });
    expect(r).toEqual({ ok: true, cancelled: 1, cleared: true });

    const conn = updates.find((u) => u.table === "integration_connections")!;
    expect(conn.patch).toMatchObject({
      write_mode: "off",
      account_changed_at: new Date(NOW).toISOString(),
      account_changed_from: "Acme Air",
      tenant_name: "Beta Cooling",
      // a pause the old account's writes tripped isn't the new account's
      paused_reason: null,
    });
    // only while the row still holds the new account
    expect(conn.filters).toMatchObject({ org_id: "org-1", tenant_id: "v-2" });

    const wiped = deletes.map((d) => d.table);
    for (const t of SM8_ACCOUNT_RESET_TABLES) expect(wiped).toContain(t);
    expect(wiped[wiped.length - 1]).toBe("sm8_vendor");
    expect(wiped).not.toContain("sm8_sync_runs");
    expect(wiped).not.toContain("integration_connections");
    for (const d of deletes) expect(d.filters.org_id).toBe("org-1");
  });

  it("deletes the sentinel only while it still names the old account", async () => {
    // a newer account's row, written by a sync since, is never the one that goes
    await switchSm8Account("org-1", { to, from, now: NOW });
    const sentinel = deletes.find((d) => d.table === "sm8_vendor")!;
    expect(sentinel.filters).toEqual({ org_id: "org-1", uuid: "v-1" });
  });

  it.each([...SM8_ACCOUNT_RESET_TABLES, "documents", "job_photo_readings", "job_photo_favourites"])(
    "a clear of %s that fails keeps the sentinel, so the next sync repeats the clear",
    async (table) => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      deleteFails.add(table);
      expect(await switchSm8Account("org-1", { to, from, now: NOW })).toEqual({ ok: true, cancelled: 0, cleared: false });
      expect(deletes.map((d) => d.table)).not.toContain("sm8_vendor");
    }
  );

  it("cancels only what was waiting to go to the old account", async () => {
    await switchSm8Account("org-1", { to, from, now: NOW });
    const cancel = updates.find((u) => u.table === "sm8_writes")!;
    expect(cancel.patch).toMatchObject({ status: "cancelled", last_error: WRITE_WORDS.otherAccount });
    expect(cancel.neq).toEqual({ tenant_id: "v-2" });
  });

  it("clears HeyTiff's cached copies of the old account's photos, so they can't be searched", async () => {
    documentRows = [
      { storage_ref: "org/org-1/job_file/a.jpg" },
      { storage_ref: "org/someone-else/job_file/b.jpg" },
    ];
    await switchSm8Account("org-1", { to, from, now: NOW });
    const wiped = deletes.map((d) => d.table);
    expect(wiped).toEqual(expect.arrayContaining(["job_photo_readings", "job_photo_favourites", "documents"]));
    const docs = deletes.find((d) => d.table === "documents")!;
    expect(docs.filters).toMatchObject({ org_id: "org-1", kind: "job_file", source: "servicem8" });
    // the bytes too, and never a path outside this workspace
    expect(removed).toEqual([["org/org-1/job_file/a.jpg"]]);
  });

  it("logs both accounts before anything is deleted", async () => {
    const warn = console.warn as jest.Mock;
    await switchSm8Account("org-1", { to, from, now: NOW });
    expect(String(warn.mock.calls[0][0])).toContain("v-1");
    expect(String(warn.mock.calls[0][0])).toContain("v-2");
  });

  it("never on a missing value: no old account, nothing cleared", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect(await switchSm8Account("org-1", { to, from: { uuid: null, name: null }, now: NOW })).toMatchObject({
      ok: false,
    });
    expect(deletes).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("a connection that no longer holds the new account clears nothing", async () => {
    row = connectedRow({ tenant_id: "v-3" });
    expect(await switchSm8Account("org-1", { to, from, now: NOW })).toEqual({ ok: false, reason: "moved" });
    expect(deletes).toHaveLength(0);
  });

  it("an account another workspace holds clears nothing", async () => {
    updateHook = (u) =>
      u.table === "integration_connections" && u.patch.write_mode === "off"
        ? { data: null, error: { code: "23505" } }
        : undefined;
    expect(await switchSm8Account("org-1", { to, from, now: NOW })).toEqual({ ok: false, reason: "elsewhere" });
    expect(deletes).toHaveLength(0);
  });

  it("a database without the change columns still switches", async () => {
    updateHook = (u) =>
      u.table === "integration_connections" && "account_changed_at" in u.patch
        ? { data: null, error: { code: "PGRST204" } }
        : undefined;
    const r = await switchSm8Account("org-1", { to, from, now: NOW });
    expect(r).toMatchObject({ ok: true });
    const conns = updates.filter((u) => u.table === "integration_connections");
    expect(conns[1].patch).not.toHaveProperty("account_changed_at");
    expect(conns[1].patch).toMatchObject({ write_mode: "off" });
  });
});

describe("which account this workspace holds", () => {
  it("reads the connection's account and the one its copy came from", async () => {
    vendorRow = { uuid: "v-1", name: "Acme Air" };
    expect(await readSm8Accounts("org-1")).toEqual({
      ok: true,
      connected: { tenantId: "v-1", tenantName: "Acme Air" },
      mirrored: { uuid: "v-1", name: "Acme Air" },
    });
  });

  it("no rows read as absent", async () => {
    row = null;
    expect(await readSm8Accounts("org-1")).toEqual({ ok: true, connected: null, mirrored: null });
  });

  it.each(["integration_connections", "sm8_vendor"])("a failed read of %s is a failure, not an absent row", async (table) => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    readFails.add(table);
    expect(await readSm8Accounts("org-1")).toEqual({ ok: false });
  });
});

describe("the last change of account", () => {
  it("reads the old name and when it went", async () => {
    row = connectedRow({ account_changed_at: "2026-09-24T01:00:00.000Z", account_changed_from: "Acme Air" });
    expect(await readSm8AccountChange("org-1")).toEqual({ from: "Acme Air", at: "2026-09-24T01:00:00.000Z" });
  });

  it("is null when there has been none", async () => {
    expect(await readSm8AccountChange("org-1")).toBeNull();
  });
});

describe("disconnect", () => {
  it("wipes every mirror for this org, then the connection row last", async () => {
    await disconnectSm8("org-1", NOW);

    // every wipe is org-scoped — nothing here can touch another workspace
    for (const d of deletes) expect(d.filters.org_id).toBe("org-1");

    const wiped = deletes.map((d) => d.table);
    expect(wiped).toEqual([...SM8_WIPE_TABLES, "integration_connections"]);

    // the connection row goes LAST: an interrupted wipe reads as
    // connected-with-holes (self-repairing), never disconnected-with-leftovers
    const final = deletes[deletes.length - 1];
    expect(final.filters).toMatchObject({ org_id: "org-1", provider: "servicem8" });
  });

  it("keeps the record of which account the copy came from, and the cached photos with it", async () => {
    /* The cached photos, their readings and stars outlive a disconnect; the
       sm8_vendor row is what makes a later connect of a different account a
       change of account that clears them. */
    vendorRow = { uuid: "v-1", name: "Acme Air" };
    await disconnectSm8("org-1", NOW);
    const wiped = deletes.map((d) => d.table);
    expect(wiped).not.toContain("sm8_vendor");
    expect(wiped).not.toContain("documents");
    expect(wiped).not.toContain("job_photo_readings");
    row = null; // the connection row has gone
    expect(await readSm8Accounts("org-1")).toEqual({ ok: true, connected: null, mirrored: { uuid: "v-1", name: "Acme Air" } });
  });

  it("cancels only what is waiting, never a send mid-request, and keeps the record of what went", async () => {
    await disconnectSm8("org-1", NOW);
    const cancel = updates.find((u) => u.table === "sm8_writes");
    expect(cancel?.patch).toMatchObject({ status: "cancelled", lease_until: null });
    expect(cancel?.patch.last_error).toBe(WRITE_WORDS.disconnected);
    /* queued, or a send whose claim LAPSED — a send holding a live claim may
       already be in ServiceM8, and recording it as cancelled would be a lie */
    expect(cancel?.filters).toEqual({ org_id: "org-1" });
    expect(cancel?.or).toBe(`status.eq.queued,and(status.eq.sending,lease_until.lt.${new Date(NOW).toISOString()})`);
    expect(deletes.map((d) => d.table)).not.toContain("sm8_writes");
  });

  it("says which files it cancelled, and how many were already on their way", async () => {
    cancelledRows = [
      { id: "w1", payload: { name: "Public liability.pdf" } },
      { id: "w2", payload: {} },
    ];
    headCount = 1;
    expect(await disconnectSm8("org-1", NOW)).toEqual({
      cancelled: [
        { id: "w1", name: "Public liability.pdf" },
        { id: "w2", name: null },
      ],
      inFlight: 1,
    });
  });
});
