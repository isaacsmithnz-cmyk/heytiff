/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));
jest.mock("@/app/actions/quote-sm8", () => ({}));
jest.mock("@/app/api/workboard/quote-lines/route", () => ({}));
jest.mock("@/app/api/workboard/quote-lookup/route", () => ({}));
jest.mock("@/app/api/workboard/quote-price/route", () => ({}));
jest.mock("@/app/api/workboard/quote-send/route", () => ({}));
jest.mock("@/app/api/workboard/quote-session/route", () => ({}));
jest.mock("@/lib/quotes/lines-server", () => ({}));
jest.mock("@/lib/workboard/all-jobs-query", () => ({}));
jest.mock("../auth", () => ({}));

import { phoneLineOpOf, swapPatch } from "../phone-quote-server";

/* A line removed, priced or swapped from the phone (Isaac, 6 November 2026, on 3054) */

const refs = [{ id: "p1", version: 1 }, { id: "p2", version: 3 }];

it("reads only the line ops it knows, made safe", () => {
  expect(phoneLineOpOf({ op: "line-remove", lines: refs })).toEqual({ op: "remove", lines: refs });
  expect(phoneLineOpOf({ op: "line-remove", lines: [] })).toBeNull();
  expect(phoneLineOpOf({ op: "line-remove", lines: [{ id: 3 }] })).toBeNull();
  expect(phoneLineOpOf({ op: "line-price", lines: refs, costCents: 2965 })).toEqual({ op: "price", lines: refs, costCents: 2965, qty: null });
  expect(phoneLineOpOf({ op: "line-price", lines: refs, costCents: -1 })).toBeNull();
  expect(phoneLineOpOf({ op: "line-undo", changes: [21, 20, "x"] })).toEqual({ op: "undo", changes: [21, 20] });
  expect(phoneLineOpOf({ op: "line-swap", lines: refs, pick: { name: "MTL R/A BX 400X400-400 INS IM NSW", code: "MRA4040-40", supplierKey: "aad", cents: 2965 } })).toMatchObject({
    op: "swap",
    pick: { code: "MRA4040-40", cents: 2965, unit: false },
  });
  expect(phoneLineOpOf({ op: "line-swap", lines: refs, pick: { name: "x", code: "", supplierKey: "aad", cents: 1 } })).toBeNull();
  expect(phoneLineOpOf({ op: "something", lines: refs })).toBeNull();
});

it("swaps a part for the book's, its price to the business's markup, and a line nobody knew becomes one by hand", () => {
  const pick = { name: "MTL R/A BX 400X400-400 INS IM NSW", code: "MRA4040-40", supplierKey: "aad", cents: 2965, unit: false };
  expect(swapPatch({ name: "Return plenum", kind: "material", source: "unknown" }, pick)).toEqual({ name: pick.name, code: "MRA4040-40", supplierKey: "aad", costCents: 2965, sellCents: null, source: "by_hand" });
  expect(swapPatch({ name: "Flex", kind: "material", source: "said" }, pick)).not.toHaveProperty("source");
});
