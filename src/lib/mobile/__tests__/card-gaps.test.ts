/**
 * @jest-environment node
 */

/* What your card still wants, on the phone's To do: only what you can add
   yourself, and nothing once it's there. */

let card: Record<string, unknown> | null = null;
let licences = 0;
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: card, error: null }),
        then: (res: (v: unknown) => unknown) => res({ count: table === "staff_licences" ? licences : 0, error: null }),
      };
      return q;
    },
  },
}));

import { cardGaps } from "../card-gaps";

test("a card from a skipped first run asks for each thing, a licence last", async () => {
  card = { birthday: null, address: "", phone: null, emergency_name: null, emergency_phone: null };
  licences = 0;
  expect((await cardGaps("o", "s")).map((g) => g.title)).toEqual([
    "Add your date of birth",
    "Add your mobile",
    "Add your home address",
    "Add an emergency contact",
    "Add your licences",
  ]);
});

test("an emergency contact with no mobile asks for the mobile", async () => {
  card = { birthday: "1996-03-14", address: "12 Example St", phone: "0400 555 018", emergency_name: "Riley Carter", emergency_phone: "" };
  licences = 1;
  expect(await cardGaps("o", "s")).toEqual([{ key: "emergency_phone", title: "Add your emergency contact's mobile" }]);
});

test("a whole card asks for nothing, and no card asks for nothing", async () => {
  card = { birthday: "1996-03-14", address: "12 Example St", phone: "0400 555 018", emergency_name: "Riley Carter", emergency_phone: "0400 555 077" };
  licences = 2;
  expect(await cardGaps("o", "s")).toEqual([]);
  card = null;
  expect(await cardGaps("o", "s")).toEqual([]);
});
