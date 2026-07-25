/* The business's own licences & policies — owner-only, org-scoped, validated
   before anything is written. Modelled on org.test.ts, because the gate is the
   same one: these are the company's papers, not a staff record, so a delegated
   admin is refused exactly as they are on the rest of the org profile. */

const eqCalls: [string, unknown][] = [];
const insert = jest.fn().mockResolvedValue({ error: null });
const update = jest.fn();
const del = jest.fn();

let writeError: { message: string } | null = null;

/* A .eq().eq() chain that is also awaitable — every write here ends in two
   scoping calls, and `eqCalls` is how the tests prove BOTH of them happened. */
const chainWithEq = () => {
  const chain: Record<string, unknown> = {};
  chain.eq = (col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return chain;
  };
  chain.then = (resolve: (v: unknown) => void) => resolve({ error: writeError });
  return chain;
};

const from = jest.fn(() => ({
  insert: (row: Record<string, unknown>) => {
    insert(row);
    return Promise.resolve({ error: writeError });
  },
  update: (patch: Record<string, unknown>) => {
    update(patch);
    return chainWithEq();
  },
  delete: () => {
    del();
    return chainWithEq();
  },
}));

let dbRole: string | null = "owner";

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (...a: unknown[]) => from(...(a as [])) },
}));
jest.mock("@/lib/auth0", () => ({
  auth0: {
    getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|owner" }, orgId: "org-1" }),
  },
}));
jest.mock("@/lib/permissions-server", () => ({
  getDbRole: jest.fn(() => Promise.resolve(dbRole)),
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { addOrgCredential, removeOrgCredential, updateOrgCredential } from "../org-credentials";

const NOT_OWNER = "Only an owner can change organisation settings.";

beforeEach(() => {
  insert.mockClear();
  update.mockClear();
  del.mockClear();
  from.mockClear();
  eqCalls.length = 0;
  writeError = null;
  dbRole = "owner";
});

describe("addOrgCredential", () => {
  it("inserts a validated row against the caller's own org", async () => {
    const res = await addOrgCredential({
      kind: "insurance",
      name: "Public liability",
      number: "PL-9",
      issuer: "QBE",
      expiryDate: "2027-03-01",
      color: "#2E68FF",
    });
    expect(res).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith("org_credentials");
    expect(insert).toHaveBeenCalledWith({
      org_id: "org-1",
      kind: "insurance",
      name: "Public liability",
      number: "PL-9",
      issuer: "QBE",
      expiry_date: "2027-03-01",
      color: "#2E68FF",
    });
  });

  it("refuses a non-owner before touching the table", async () => {
    dbRole = "admin";
    expect(await addOrgCredential({ kind: "licence", name: "ARC" })).toEqual({
      ok: false,
      error: NOT_OWNER,
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses an unnamed credential, and an impossible date", async () => {
    expect(await addOrgCredential({ kind: "licence", name: "  " })).toEqual({
      ok: false,
      error: "Give this licence or policy a name.",
    });
    expect(
      await addOrgCredential({ kind: "licence", name: "ARC", expiryDate: "31/02/2027" })
    ).toEqual({ ok: false, error: "Check the expiry date — use dd/mm/yyyy." });
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses a kind the table's CHECK would reject anyway", async () => {
    expect(await addOrgCredential({ kind: "warranty", name: "x" })).toEqual({
      ok: false,
      error: "Choose whether this is a licence or an insurance policy.",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("reports a write failure rather than claiming it saved", async () => {
    writeError = { message: "boom" };
    expect(await addOrgCredential({ kind: "licence", name: "ARC" })).toEqual({
      ok: false,
      error: "Couldn't add that.",
    });
  });
});

describe("updateOrgCredential", () => {
  it("scopes the update by org AND id, and stamps updated_at", async () => {
    const res = await updateOrgCredential("cred-1", {
      kind: "licence",
      name: "Contractor licence",
      number: "VBA-1",
    });
    expect(res).toEqual({ ok: true });
    expect(update.mock.calls[0][0]).toMatchObject({
      kind: "licence",
      name: "Contractor licence",
      number: "VBA-1",
    });
    expect(update.mock.calls[0][0]).toHaveProperty("updated_at");
    expect(eqCalls).toEqual([
      ["org_id", "org-1"],
      ["id", "cred-1"],
    ]);
  });

  it("refuses a non-owner", async () => {
    dbRole = "admin";
    expect(await updateOrgCredential("cred-1", { kind: "licence", name: "x" })).toEqual({
      ok: false,
      error: NOT_OWNER,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("validates before writing", async () => {
    expect(await updateOrgCredential("cred-1", { kind: "licence", name: "" })).toEqual({
      ok: false,
      error: "Give this licence or policy a name.",
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("removeOrgCredential", () => {
  it("deletes only within the caller's org", async () => {
    expect(await removeOrgCredential("cred-1")).toEqual({ ok: true });
    expect(del).toHaveBeenCalled();
    expect(eqCalls).toEqual([
      ["org_id", "org-1"],
      ["id", "cred-1"],
    ]);
  });

  it("refuses a non-owner", async () => {
    dbRole = "admin";
    expect(await removeOrgCredential("cred-1")).toEqual({ ok: false, error: NOT_OWNER });
    expect(del).not.toHaveBeenCalled();
  });
});
