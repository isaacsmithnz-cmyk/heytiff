/**
 * @jest-environment node
 *
 * The lease's claim semantics. Two presses racing is the case that bills
 * twice, so the claim path is exercised against a fake supabase whose answers
 * mirror what Postgres would do: the conditional UPDATE lets one racer
 * through, the PK insert refuses a lost first-ever race.
 */

import type { AiValuation } from "@/components/fleet/logic";

type Answer = { updateRows?: { org_id: string }[]; insertError?: { code: string } | null };
const answers: Answer = {};
const calls: { table: string; op: string; args: unknown }[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from(table: string) {
      return {
        update(args: unknown) {
          calls.push({ table, op: "update", args });
          const chain = {
            eq: () => chain,
            or: () => chain,
            select: async () => ({ data: answers.updateRows ?? [] }),
            // release's terminal .eq() — make the chain awaitable
            then: (r: (v: unknown) => void) => r({ data: null }),
          };
          return chain;
        },
        insert: async (args: unknown) => {
          calls.push({ table, op: "insert", args });
          return { error: answers.insertError ?? null };
        },
        select() {
          const chain = {
            eq: () => chain,
            maybeSingle: async () => ({ data: { lease_until: answers.updateRows?.[0] ?? null } }),
          };
          return chain;
        },
      };
    },
  },
}));

import { claimValuationLease, persistValuations } from "../valuation-store";

beforeEach(() => {
  answers.updateRows = [];
  answers.insertError = null;
  calls.length = 0;
});

it("a free lease is claimed by the conditional update alone", async () => {
  answers.updateRows = [{ org_id: "org-1" }];
  expect(await claimValuationLease("org-1")).toBe(true);
  expect(calls.map((c) => c.op)).toEqual(["update"]); // no insert needed
});

it("a first-ever run inserts the row and wins", async () => {
  answers.updateRows = []; // no row to update yet
  expect(await claimValuationLease("org-1")).toBe(true);
  expect(calls.map((c) => c.op)).toEqual(["update", "insert"]);
});

it("losing the first-ever race reads as a live lease, not an error", async () => {
  answers.updateRows = [];
  answers.insertError = { code: "23505" }; // the other press got the PK first
  expect(await claimValuationLease("org-1")).toBe(false);
});

it("a live lease refuses the claim — that press must not bill", async () => {
  // row exists but the conditional update let nobody through
  answers.updateRows = [];
  answers.insertError = { code: "23505" };
  expect(await claimValuationLease("org-1")).toBe(false);
});

it("persist writes each valuation to its own row, org-scoped", async () => {
  const val: AiValuation = { point: 42000, low: 38000, high: 46000, note: "n", atOdo: 55500 };
  await persistValuations("org-1", { v1: val, v2: { ...val, point: 20000 } });
  const writes = calls.filter((c) => c.table === "vehicles" && c.op === "update");
  expect(writes).toHaveLength(2);
  expect(writes[0].args).toEqual({ ai_value: val });
});
