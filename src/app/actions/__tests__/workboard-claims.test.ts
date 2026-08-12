/* The claim actions, with one question in mind: who is allowed to write a
   number that ServiceM8 also writes? A mirrored claim is rewritten by the sync
   on every board load, so a human press on the same field would be silently
   undone next paint — the worst kind of wrong, because it looks like it
   worked. Both writing paths refuse it; only the hand-typed ledger is ours. */

const updates: { table: string; patch: Record<string, unknown> }[] = [];
const deletes: { table: string }[] = [];

let rows: Record<string, Record<string, unknown> | null> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = self;
      chain.order = self;
      chain.limit = self;
      chain.maybeSingle = async () => ({ data: rows[table] ?? null });
      chain.update = (patch: Record<string, unknown>) => {
        const sub: Record<string, unknown> = {};
        sub.eq = () => sub;
        sub.then = (res: (v: { error: null }) => unknown) => {
          updates.push({ table, patch });
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
      };
      chain.delete = () => {
        const sub: Record<string, unknown> = {};
        sub.eq = () => sub;
        sub.then = (res: (v: { error: null }) => unknown) => {
          deletes.push({ table });
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
      };
      return chain;
    },
  },
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ user: { sub: "auth0|me" }, orgId: "org-1" })) },
}));

let caps = new Set<string>();
jest.mock("@/lib/permissions-server", () => ({ can: async (c: string) => caps.has(c) }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));

import { removeClaim, setClaimPaid } from "../workboard-projects";

beforeEach(() => {
  updates.length = 0;
  deletes.length = 0;
  rows = {};
  caps = new Set(["workboard", "workboard_manage"]);
});

describe("setClaimPaid", () => {
  it("marks a hand-typed claim paid, and stamps the day", async () => {
    rows.project_claims = { id: "c-1", project_id: "p-1", source: "manual" };
    const res = await setClaimPaid("c-1", true, "2026-08-06");
    expect(res.ok).toBe(true);
    expect(updates[0].patch).toMatchObject({ status: "paid", paid_on: "2026-08-06" });
  });

  it("takes a hand-typed claim back to awaiting and clears the day", async () => {
    rows.project_claims = { id: "c-1", project_id: "p-1", source: "manual" };
    await setClaimPaid("c-1", false);
    expect(updates[0].patch).toMatchObject({ status: "awaiting", paid_on: null });
  });

  /* THE GUARD. removeClaim has always carried it; without the same one here,
     the sync and a button owned the same field. */
  it("refuses a claim that mirrors a ServiceM8 invoice, and writes nothing", async () => {
    rows.project_claims = { id: "c-1", project_id: "p-1", source: "servicem8" };
    const res = await setClaimPaid("c-1", true);
    expect(res.ok).toBe(false);
    // It has to say WHERE to go, or the refusal is just a dead end.
    expect(res.ok === false && res.error).toMatch(/ServiceM8/);
    expect(updates).toHaveLength(0);
  });

  it("refuses a Xero-sourced claim the same way", async () => {
    rows.project_claims = { id: "c-1", project_id: "p-1", source: "xero" };
    expect((await setClaimPaid("c-1", true)).ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("still needs workboard_manage", async () => {
    caps = new Set(["workboard"]);
    rows.project_claims = { id: "c-1", project_id: "p-1", source: "manual" };
    expect((await setClaimPaid("c-1", true)).ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("a claim from another org is simply not there", async () => {
    rows.project_claims = null;
    expect((await setClaimPaid("c-1", true)).ok).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

describe("removeClaim", () => {
  it("deletes a hand-typed claim", async () => {
    rows.project_claims = { id: "c-1", project_id: "p-1", source: "manual" };
    expect((await removeClaim("c-1")).ok).toBe(true);
    expect(deletes.map((d) => d.table)).toContain("project_claims");
  });

  it("refuses a mirrored claim — it clears itself when the invoice does", async () => {
    rows.project_claims = { id: "c-1", project_id: "p-1", source: "servicem8" };
    const res = await removeClaim("c-1");
    expect(res.ok).toBe(false);
    expect(deletes).toHaveLength(0);
  });
});
