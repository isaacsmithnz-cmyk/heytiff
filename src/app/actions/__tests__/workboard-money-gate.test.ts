/* The money gate on the WRITE side. Reading a project's money has always
   needed `workboard_money` — the loaders never SELECT a budget, a variation or
   a claim without it, and the Money and Variations cards are absent — but the
   writes asked only `workboard_manage`. Admin holds manage by default and not
   money, so an admin who could not see a job's total could still set it, or
   log a claim against it, by posting straight to the Server Function.

   The reader here is the REAL admin default (ROLE_DEFAULTS.admin), not a
   hand-picked set, so the day money slips into that list these tests say so.
   Every refusal is checked for silence too: not one row read or written. */

import { ROLE_DEFAULTS } from "@/lib/permissions";

const reads: string[] = [];
const writes: { table: string; op: "insert" | "update" | "delete" }[] = [];

let rows: Record<string, Record<string, unknown> | null> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = () => {
        reads.push(table);
        return chain;
      };
      chain.eq = self;
      chain.order = self;
      chain.limit = self;
      chain.maybeSingle = async () => ({ data: rows[table] ?? null });
      chain.single = async () => ({ data: { id: "new-1" }, error: null });
      chain.then = (res: (v: { data: null; error: null }) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(res);
      chain.insert = () => {
        writes.push({ table, op: "insert" });
        return chain;
      };
      chain.update = () => {
        writes.push({ table, op: "update" });
        return chain;
      };
      chain.delete = () => {
        writes.push({ table, op: "delete" });
        return chain;
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

import {
  addClaim,
  addVariation,
  decideVariation,
  removeClaim,
  removeVariation,
  setClaimPaid,
  setProjectBudget,
  setProjectHoursBudget,
} from "../workboard-projects";

const ADMIN = ROLE_DEFAULTS.admin;

/** Every action that writes a dollar figure, called the way its form calls
    it. A variation's decision and its removal count: an approved variation
    moves the job's total, and the row IS an amount. */
const MONEY_WRITES: [string, () => Promise<{ ok: boolean }>][] = [
  ["setProjectBudget", () => setProjectBudget("p-1", { cents: 1_250_000, source: "manual" })],
  ["setProjectBudget (clearing)", () => setProjectBudget("p-1", { cents: null })],
  ["addVariation", () => addVariation("p-1", { title: "Extra head", amountCents: 180_000 })],
  ["decideVariation", () => decideVariation("v-1", "approved", "Sarah Bowden")],
  ["removeVariation", () => removeVariation("v-1")],
  ["addClaim", () => addClaim("p-1", { label: "Deposit", amountCents: 500_000 })],
  ["setClaimPaid", () => setClaimPaid("c-1", true, "2026-09-27")],
  ["removeClaim", () => removeClaim("c-1")],
];

beforeEach(() => {
  reads.length = 0;
  writes.length = 0;
  rows = {
    projects: { id: "p-1", name: "Bowden St", status: "active", defects_task_id: null },
    project_variations: { id: "v-1", project_id: "p-1", status: "pending" },
    project_claims: { id: "c-1", project_id: "p-1", source: "manual" },
  };
});

it("the admin default still holds manage and still does not hold money", () => {
  // The premise of every test below. If either half moves, re-read this file.
  expect(ADMIN).toContain("workboard_manage");
  expect(ADMIN).not.toContain("workboard_money");
});

describe.each(MONEY_WRITES)("%s", (_name, call) => {
  it("is refused to an admin without money, before a row is read or written", async () => {
    caps = new Set(ADMIN);
    const res = await call();
    expect(res).toEqual({ ok: false, error: "You don't have access to the Workboard's money." });
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("goes through once the owner grants money", async () => {
    caps = new Set([...ADMIN, "workboard_money"]);
    expect((await call()).ok).toBe(true);
    expect(writes.length).toBeGreaterThan(0);
  });

  it("money alone is not enough — it still needs manage", async () => {
    caps = new Set(["workboard", "workboard_money"]);
    const res = await call();
    expect(res).toEqual({ ok: false, error: "You don't have access to manage the Workboard." });
    expect(writes).toEqual([]);
  });
});

/* HOURS ARE NOT MONEY. The labour budget is read without the grant — the
   loaders select `hours_budget` for everyone and the board shows "40 of 48 h"
   to the techs doing the hours — and it sits in the Dates card, not the Money
   one. Gating its write on money would stop the foreman setting a number the
   whole crew already reads. */
describe("setProjectHoursBudget", () => {
  it("stays a manage call: an admin without money can set it", async () => {
    caps = new Set(ADMIN);
    expect((await setProjectHoursBudget("p-1", 48)).ok).toBe(true);
    expect(writes).toEqual([{ table: "projects", op: "update" }]);
  });
});
