/**
 * @jest-environment node
 */

/* First login with no invite — the path every new BUSINESS takes exactly once.

   organizations.primary_owner_user_id is NOT NULL and its composite FK onto
   memberships is DEFERRABLE INITIALLY DEFERRED, so the org row and the owner
   membership can only be written together, in one transaction, with the owner
   named at insert time — the create_org_for_owner RPC. The old two-insert
   version failed the NOT NULL at the org insert, the error branch returned the
   session untouched, and the new owner landed on a dashboard with no org, no
   membership and no staff card.

   The real beforeSessionSaved hook runs here; only the Auth0 SDK class and the
   Supabase client are stubbed (same recipe as invite/__tests__/accept.test.ts). */

type Row = Record<string, unknown>;

const calls: { table: string; op: string; payload?: unknown }[] = [];

/* Rows the LIST-style reads return (awaited builders): the hook looks for a
   membership and then a pending invite this way. Empty = the fresh-signup case. */
let listRows: Record<string, Row[]> = {};
let existingStaffCard: Row | null = null;
let rpcResult: { data: unknown; error: { message: string } | null };

const table = (name: string) => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.eq = self;
  chain.is = self;
  chain.gt = self;
  chain.limit = self;
  chain.select = self;
  chain.maybeSingle = async () => ({
    data: name === "staff_profiles" ? existingStaffCard : null,
    error: null,
  });
  chain.upsert = async (payload: unknown) => {
    calls.push({ table: name, op: "upsert", payload });
    return { error: null };
  };
  chain.insert = (payload: unknown) => {
    calls.push({ table: name, op: "insert", payload });
    const result = { data: { id: `${name}-new-id` }, error: null };
    return {
      select: () => ({ single: async () => result, maybeSingle: async () => result }),
      then: (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res),
    };
  };
  chain.then = (res: (v: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({ data: listRows[name] ?? [], error: null }).then(res);
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (n: string) => table(n),
    rpc: async (fn: string, args: unknown) => {
      calls.push({ table: `rpc:${fn}`, op: "call", payload: args });
      return rpcResult;
    },
  },
}));

/* `var` with no initializer: jest hoists the mock factory and the import below
   above this declaration, and lib/auth0.ts constructs the client at import
   time — a `const` would still be in its temporal dead zone by then, and an
   initializer would overwrite what the constructor already captured. */
// eslint-disable-next-line no-var
var capturedOptions: Record<string, unknown>;

jest.mock("@auth0/nextjs-auth0/server", () => ({
  Auth0Client: class {
    constructor(opts: Record<string, unknown>) {
      capturedOptions = opts;
    }
  },
}));

import "../auth0";

const ORG = "22222222-2222-2222-2222-222222222222";
const USER = "auth0|first-founder";
const EMAIL = "founder@example.com";

const hook = () => capturedOptions.beforeSessionSaved as (s: Row) => Promise<Row>;

const session = (user: Row = { sub: USER, email: EMAIL, name: "Frankie Founder" }): Row => ({
  user,
});

const rpcCalls = () => calls.filter((c) => c.table === "rpc:create_org_for_owner");
const staffInserts = () =>
  calls.filter((c) => c.table === "staff_profiles" && c.op === "insert");

beforeEach(() => {
  calls.length = 0;
  listRows = {};
  existingStaffCard = null;
  rpcResult = { data: ORG, error: null };
});

describe("first login with no invite mints the org through one transaction", () => {
  it("creates the org via the RPC, with the founder named as primary owner", async () => {
    const out = await hook()(session());

    expect(rpcCalls()).toHaveLength(1);
    expect(rpcCalls()[0].payload).toEqual({ p_user_id: USER, p_name: EMAIL });
    expect(out.orgId).toBe(ORG);
    expect(out.orgRole).toBe("owner");

    // the whole point of the fix: no separate inserts that the deferred
    // composite FK + NOT NULL primary_owner_user_id can ever reject
    expect(calls.filter((c) => c.table === "organizations")).toHaveLength(0);
    expect(calls.filter((c) => c.table === "memberships" && c.op === "insert")).toHaveLength(0);
  });

  it("seats the founder's staff card in the same request", async () => {
    await hook()(session());

    expect(staffInserts()).toHaveLength(1);
    const row = staffInserts()[0].payload as Row;
    expect(row.org_id).toBe(ORG);
    expect(row.user_id).toBe(USER);
    expect(row.first_name).toBe("Frankie");
    expect(row.last_name).toBe("Founder");
  });

  it("names the org after the user id when Auth0 sends no email", async () => {
    const out = await hook()(session({ sub: USER }));

    expect(rpcCalls()[0].payload).toEqual({ p_user_id: USER, p_name: USER });
    expect(out.orgId).toBe(ORG);
  });
});

describe("the failure posture holds", () => {
  it("returns the session untouched when the RPC fails — login is never blocked", async () => {
    // best-effort by design: an org-creation failure logs and lets the person
    // in; silenced here so an expected error doesn't read as a broken run.
    const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
    rpcResult = { data: null, error: { message: "boom" } };

    const out = await hook()(session());

    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
    expect(out.orgId).toBeUndefined();
    expect(staffInserts()).toHaveLength(0);
  });
});

describe("the existing paths still short-circuit ahead of org creation", () => {
  it("a member with an org keeps it — no second org is ever minted", async () => {
    listRows = { memberships: [{ org_id: ORG, role: "staff" }] };

    const out = await hook()(session());

    expect(rpcCalls()).toHaveLength(0);
    expect(out.orgId).toBe(ORG);
    expect(out.orgRole).toBe("staff");
    expect(staffInserts()).toHaveLength(1);
  });

  it("a pending invite still defers to the accept flow — no org, no card", async () => {
    listRows = { memberships: [], invitations: [{ id: "inv-1" }] };

    const out = await hook()(session());

    expect(rpcCalls()).toHaveLength(0);
    expect(out.orgId).toBeUndefined();
    expect(staffInserts()).toHaveLength(0);
  });
});
