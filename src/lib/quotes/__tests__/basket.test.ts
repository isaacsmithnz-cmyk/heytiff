/* A job's lines as a couple of whole-order options: every line at its
   lowest, or everything from one supplier that stocks it all, with what the
   one pickup costs over. */
import { basketOptions, type BasketLine } from "../basket";

const aad = (cents: number) => ({ supplierKey: "aad", supplierName: "AAD", cents });
const reece = (cents: number) => ({ supplierKey: "reece", supplierName: "Reece", cents });

it("offers lowest each, then all from one supplier with what it costs over", () => {
  const lines: BasketLine[] = [
    { key: "unit", qty: 1, offers: [aad(167867)] },
    { key: "coil", qty: 7, offers: [aad(955), reece(972)] },
    { key: "bracket", qty: 1, offers: [aad(3079), reece(3496)] },
  ];
  /* AAD is lowest on everything: one option, and it says so */
  expect(basketOptions(lines).map((o) => o.label)).toEqual(["All from AAD"]);

  const mixed: BasketLine[] = [
    { key: "unit", qty: 1, offers: [aad(167867)] },
    { key: "coil", qty: 7, offers: [aad(955), reece(762)] },
    { key: "trunking", qty: 2, offers: [aad(4000), reece(3614)] },
  ];
  const opts = basketOptions(mixed);
  /* Reece doesn't sell the unit, so "all from Reece" isn't offered */
  expect(opts.map((o) => [o.label, o.totalCents, o.overCents])).toEqual([
    ["Lowest each", 167867 + 7 * 762 + 2 * 3614, 0],
    ["All from AAD", 167867 + 7 * 955 + 2 * 4000, 7 * (955 - 762) + 2 * (4000 - 3614)],
  ]);
  expect(opts[1]!.picks).toEqual({ unit: "aad", coil: "aad", trunking: "aad" });
});

it("leaves $0.00 and unpriced lines out of the sums", () => {
  expect(basketOptions([{ key: "x", qty: 1, offers: [aad(0)] }])).toEqual([]);
});

/* Isaac, 2026-10-05: "Anything that's a pair should come from one supplier, not mix and match" */
it("bought together, offers only the suppliers that have every line — lowest each only when none does", () => {
  const pair: BasketLine[] = [
    { key: "indoor", qty: 1, offers: [aad(40927), reece(42000)] },
    { key: "outdoor", qty: 1, offers: [aad(126940), reece(120000)] },
  ];
  expect(basketOptions(pair, { together: true }).map((o) => [o.label, o.totalCents, o.overCents])).toEqual([
    ["All from Reece", 162000, 0],
    ["All from AAD", 167867, 5867],
  ]);
  const nobodyHasBoth: BasketLine[] = [
    { key: "indoor", qty: 1, offers: [aad(40927)] },
    { key: "outdoor", qty: 1, offers: [reece(120000)] },
  ];
  expect(basketOptions(nobodyHasBoth, { together: true }).map((o) => o.label)).toEqual(["Lowest each"]);
});
