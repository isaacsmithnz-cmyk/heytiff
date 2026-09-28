/**
 * @jest-environment node
 */

/* Which cards have something on the records. This decides which rows offer
   Delete, so a read that fails must read as "all in use", never as "all clean". */

let answer: { data: unknown; error: unknown } = { data: [], error: null };
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { rpc: async () => answer },
}));

import { staffCardsInUse } from "../query";

it("collects the ids the database names, duplicates and all", async () => {
  answer = { data: ["a", "a", "b"], error: null };
  expect(await staffCardsInUse("org")).toEqual(new Set(["a", "b"]));
});

it("answers null when the read fails, so nothing is offered for deletion", async () => {
  answer = { data: null, error: { message: "boom" } };
  expect(await staffCardsInUse("org")).toBeNull();
});
