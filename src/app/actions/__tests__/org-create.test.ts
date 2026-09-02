/* Founding a company — the act that used to happen by accident.

   Signing in called create_org_for_owner for anyone without a membership, so
   whoever created an account before their invite existed owned an empty
   company named after their gmail. These tests pin the replacement: it is a
   button, it is idempotent, and it never founds a second workspace for
   somebody who already belongs to one. */

type Call = { table: string; op: string; payload?: unknown; orders: string[] };

const calls: Call[] = [];
const rpcCalls: { fn: string; args: unknown }[] = [];

let membershipRows: Record<string, unknown>[] = [];
let rpcResult: { data: unknown; error: { message: string } | null } = {
  data: "org-new",
  error: null,
};
let session: unknown = { user: { sub: "auth0|founder", email: "founder@example.com" } };
const updated: unknown[] = [];

const table = (name: string) => {
  const call: Call = { table: name, op: "select", orders: [] };
  const c: Record<string, unknown> = {};
  const chain = () => c;
  c.eq = () => chain();
  c.limit = () => chain();
  c.select = () => chain();
  c.order = (col: string) => {
    call.orders.push(col);
    return chain();
  };
  c.then = (res: (v: { data: unknown; error: null }) => unknown) => {
    calls.push(call);
    return Promise.resolve({ data: membershipRows, error: null }).then(res);
  };
  return c;
};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (n: string) => table(n),
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
  },
}));

const ensureStaffCard = jest.fn(async () => {});
jest.mock("@/lib/auth0", () => ({
  auth0: {
    getSession: jest.fn(async () => session),
    updateSession: jest.fn(async (s: unknown) => {
      updated.push(s);
    }),
  },
  ensureStaffCard: (...args: unknown[]) => ensureStaffCard(...(args as [])),
}));

import { createMyOrg } from "../org-create";

beforeEach(() => {
  calls.length = 0;
  rpcCalls.length = 0;
  updated.length = 0;
  ensureStaffCard.mockClear();
  membershipRows = [];
  rpcResult = { data: "org-new", error: null };
  session = { user: { sub: "auth0|founder", email: "founder@example.com" } };
});

describe("createMyOrg", () => {
  it("mints the org and the owner membership in one RPC, naming the founder", async () => {
    expect(await createMyOrg()).toEqual({ ok: true });

    expect(rpcCalls).toEqual([
      {
        fn: "create_org_for_owner",
        args: { p_user_id: "auth0|founder", p_name: "founder@example.com" },
      },
    ]);
    /* Never two inserts: organizations.primary_owner_user_id is NOT NULL and
       its composite FK onto memberships is DEFERRABLE INITIALLY DEFERRED, so
       the pair only lands inside one transaction. */
    expect(calls.filter((c) => c.table === "organizations")).toHaveLength(0);
  });

  /* updateSession writes the cookie directly and does NOT run
     beforeSessionSaved — the only other thing that seats a card — so /welcome
     and everything after it would find none. Same reason the invite-accept
     route calls it by hand. */
  it("seats the founder's staff card before the session flips", async () => {
    await createMyOrg();

    expect(ensureStaffCard).toHaveBeenCalledTimes(1);
    expect(updated).toEqual([
      expect.objectContaining({ orgId: "org-new", orgRole: "owner" }),
    ]);
  });

  /* The double-press and the stale cookie are the same case: they already
     belong somewhere, so adopt it rather than found a second one. */
  it("never founds a second workspace for an existing member", async () => {
    membershipRows = [{ org_id: "org-old", role: "staff" }];

    expect(await createMyOrg()).toEqual({ ok: true });

    expect(rpcCalls).toHaveLength(0);
    expect(updated).toEqual([
      expect.objectContaining({ orgId: "org-old", orgRole: "staff" }),
    ]);
  });

  /* The pick has to match beforeSessionSaved's, or founding and signing in
     would disagree about which workspace is theirs. */
  it("picks the membership the same way signing in does", async () => {
    membershipRows = [{ org_id: "org-old", role: "staff" }];

    await createMyOrg();

    expect(calls.find((c) => c.table === "memberships")?.orders).toEqual([
      "created_at",
      "id",
    ]);
  });

  it("refuses when nobody is signed in", async () => {
    session = null;

    expect(await createMyOrg()).toEqual({ ok: false, error: "You're not signed in." });
    expect(rpcCalls).toHaveLength(0);
  });

  it("reports a failed RPC without flipping the session", async () => {
    const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
    rpcResult = { data: null, error: { message: "boom" } };

    const res = await createMyOrg();

    expect(res.ok).toBe(false);
    expect(updated).toHaveLength(0);
    expect(ensureStaffCard).not.toHaveBeenCalled();
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});
