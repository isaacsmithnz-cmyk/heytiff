import { habitsFrom, type SwapChange } from "../habits";

/* A swap made again and again becomes a question (slice 13.2): VB250 for
   VH250 on three quotes asks whether VH250 should be preferred. */

const swap = (job: string, o: Partial<SwapChange> = {}): SwapChange => ({
  job,
  madeBy: "isaac",
  before: { code: "VB250", name: "Vortex flexible 250" },
  after: { code: "VH250", name: "Vortex acoustic 250", supplierKey: "aad" },
  ...o,
});

it("asks once a swap has happened on three different quotes", () => {
  expect(habitsFrom([swap("a"), swap("b")])).toEqual([]);
  expect(habitsFrom([swap("a"), swap("b"), swap("b"), swap("c")])).toEqual([
    { from: { code: "VB250", name: "Vortex flexible 250" }, to: { code: "VH250", name: "Vortex acoustic 250", supplierKey: "aad" }, quotes: 3 },
  ]);
});

it("counts only a person's swaps, never Tiff's, and nothing that isn't a swap", () => {
  expect(habitsFrom([swap("a"), swap("b"), swap("c", { madeBy: "tiff" })])).toEqual([]);
  expect(habitsFrom([swap("a", { before: { code: "VH250" } }), swap("b", { after: { qty: 2 } as never }), swap("c", { before: null })])).toEqual([]);
});

it("doesn't ask about what's already preferred", () => {
  expect(habitsFrom([swap("a"), swap("b"), swap("c")], new Set(["aad|VH250"]))).toEqual([]);
});
