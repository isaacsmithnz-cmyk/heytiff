import type { BuildLine } from "../buildup";
import { adoptLines } from "../lines-adopt";

/* A quote Tiff's builder priced, brought across to its kept lines as it's
   priced today: nothing re-picked. */

const part = (o: Partial<BuildLine>): BuildLine => ({ key: "x", group: "Units", name: "MSZ-AP71VGD2", code: "MSZ-AP71VGKD2-A2", supplierKey: "aad", qty: 1, unitBuyCents: 40000, kind: "unit", ...o });

it("keeps every part at its book price, each visit as hours, and what wasn't priced as not known yet", () => {
  const out = adoptLines(
    [
      {
        lines: [part({}), part({ key: "pair-coil", group: "Pipe and power", name: "Pair coil 1/4+1/2, 7 m", code: "PC1412", kind: "material", qty: 7, unitBuyCents: 19100 / 20, assumed: "7 m" })],
        visits: [{ stage: "Install", people: 2, days: 1 }],
        unpriced: [{ name: "Mystery bracket", qty: "1", why: "Not in your price book" }],
      },
      { lines: [part({ name: "MSZ-AP80VGD2", unitBuyCents: 52000 })], visits: [], unpriced: [] },
    ],
    8,
    11200
  );
  expect(out.map((l) => [l.optionIndex, l.group, l.name, l.qty, l.unit, l.costCents, l.source])).toEqual([
    [0, "Units", "MSZ-AP71VGD2", 1, "", 40000, "said"],
    [0, "Pipe and power", "Pair coil 1/4+1/2, 7 m", 7, "m", 955, "assumed"],
    [0, "Labour", "Install: 2 people", 16, "h", 11200, "said"],
    [0, "Still to price", "Mystery bracket", 1, "", 0, "unknown"],
    [1, "Units", "MSZ-AP80VGD2", 1, "", 52000, "said"],
  ]);
  expect(out[1]!.why).toBe("7 m assumed");
});

it("costs labour at nothing when the business has no hour's cost, rather than guessing one", () => {
  expect(adoptLines([{ lines: [], visits: [{ stage: "Install", people: 1, days: 1 }], unpriced: [] }], 8, null)[0]).toMatchObject({ qty: 8, costCents: 0 });
});
