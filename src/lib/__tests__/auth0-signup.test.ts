/**
 * @jest-environment node
 */

/* What signing in does, and — the point of this file — what it no longer does.

   IT USED TO FOUND A COMPANY. Anyone whose first login found no membership got
   create_org_for_owner called on their behalf: an org named after their email,
   with them as its owner, created by the act of signing in. That made the
   product's behaviour depend on the ORDER in which two people did two things.
   Sign up before your invite exists and you owned a phantom company, then the
   invite made you a member of a second one. A guard that looked for a pending
   invitation narrowed the window without closing it — an invite that has not
   been created yet cannot be found — and nothing on screen said any of it.

   Founding is `createMyOrg` now (app/actions/org-create.ts), pressed on /start.
   A session with no orgId is a supported state, and these tests exist to keep
   it that way: the mutation that would break it is re-adding an RPC call here.

   The real beforeSessionSaved hook runs here; only the Auth0 SDK class and the
   Supabase client are stubbed (same recipe as invite/__tests__/accept.test.ts). */

type Row = Record<string, unknown>;

const calls: { table: string; op: string; payload?: unknown }[] = [];
/** `.order(column, opts)` per table, so the membership pick can be pinned as
    deterministic rather than "whatever Postgres reached first". */
const orders: { table: string; column: string; opts?: unknown }[] = [];

/* Rows the LIST-style reads return (awaited builders): the hook looks for a
   membership this way. Empty = the fresh-signup case. */
let listRows: Record<string, Row[]> = {};
let existingStaffCard: Row | null = null;

const table = (name: string) => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.eq = self;
  chain.is = self;
  chain.gt = self;
  chain.limit = self;
  chain.select = self;
  chain.order = (column: string, opts?: unknown) => {
    orders.push({ table: name, column, opts });
    return chain;
  };
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
      return { data: null, error: null };
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
const OTHER_ORG = "33333333-3333-3333-3333-333333333333";
const USER = "auth0|first-founder";
const EMAIL = "founder@example.com";

const hook = () => capturedOptions.beforeSessionSaved as (s: Row) => Promise<Row>;

const session = (user: Row = { sub: USER, email: EMAIL, name: "Frankie Founder" }): Row => ({
  user,
});

const rpcCalls = () => calls.filter((c) => c.table.startsWith("rpc:"));
const staffInserts = () =>
  calls.filter((c) => c.table === "staff_profiles" && c.op === "insert");

beforeEach(() => {
  calls.length = 0;
  orders.length = 0;
  listRows = {};
  existingStaffCard = null;
});

describe("signing in never founds a company", () => {
  it("mints no org for a first login with nothing waiting", async () => {
    const out = await hook()(session());

    expect(rpcCalls()).toHaveLength(0);
    expect(calls.filter((c) => c.table === "organizations")).toHaveLength(0);
    expect(calls.filter((c) => c.table === "memberships" && c.op === "insert")).toHaveLength(0);
    expect(out.orgId).toBeUndefined();
    expect(out.orgRole).toBeUndefined();
  });

  it("seats no staff card either — a card needs an org to belong to", async () => {
    await hook()(session());

    expect(staffInserts()).toHaveLength(0);
  });

  it("still records the profile, so HQ sees the signup", async () => {
    await hook()(session());

    const profile = calls.find((c) => c.table === "profiles" && c.op === "upsert");
    expect((profile?.payload as Row | undefined)?.email).toBe(EMAIL);
  });

  /* The old hook read invitations to decide whether to mint an org. Nothing
     here depends on that read any more, and the invite is not consumed at
     sign-in — /start offers it and /invite/accept applies it. */
  it("does not consult invitations at all", async () => {
    listRows = { memberships: [], invitations: [{ id: "inv-1" }] };

    const out = await hook()(session());

    expect(out.orgId).toBeUndefined();
    expect(orders.some((o) => o.table === "invitations")).toBe(false);
  });
});

describe("an existing member opens the same workspace every time", () => {
  it("keeps their org and role, and ensures the staff card", async () => {
    listRows = { memberships: [{ org_id: ORG, role: "staff" }] };

    const out = await hook()(session());

    expect(rpcCalls()).toHaveLength(0);
    expect(out.orgId).toBe(ORG);
    expect(out.orgRole).toBe("staff");
    expect(staffInserts()).toHaveLength(1);
  });

  /* THE PICK IS ORDERED, and that is the whole test. One person can hold
     several memberships; an unordered limit(1) let the database answer with
     whichever row it reached first, so being invited to a second workspace
     could silently change which one you opened in. Mutate either `.order`
     out of lib/auth0.ts and this fails. */
  it("takes the oldest membership, with id as the tiebreak", async () => {
    listRows = { memberships: [{ org_id: ORG, role: "owner" }, { org_id: OTHER_ORG, role: "staff" }] };

    const out = await hook()(session());

    const on = orders.filter((o) => o.table === "memberships");
    expect(on.map((o) => o.column)).toEqual(["created_at", "id"]);
    expect(on.every((o) => (o.opts as { ascending?: boolean })?.ascending === true)).toBe(true);
    expect(out.orgId).toBe(ORG);
  });
});
