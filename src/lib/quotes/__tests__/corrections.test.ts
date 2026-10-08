/* Corrections (slice 13.1): a person's change to a line Tiff wrote, in a
   few words, with the kind of job; her own changes and people's changes to
   their own lines aren't corrections. */
import { changeWords, correctionsFrom, type ChangeRow } from "../corrections";

const row = (o: Partial<ChangeRow>): ChangeRow => ({ lineId: "l1", job: "j1", action: "change", before: null, after: null, why: "", madeBy: "u-isaac", madeAt: "2026-10-08T00:00:00Z", ...o });

it("says a change in a few words", () => {
  expect(changeWords({ action: "change", before: { qty: 4 }, after: { qty: 6 } })).toBe("qty 4 → 6");
  expect(changeWords({ action: "change", before: { code: "PC1412", name: "a" }, after: { code: "PC1438", name: "b" } })).toBe("PC1412 → PC1438");
  expect(changeWords({ action: "change", before: { costCents: 1000 }, after: { costCents: 1250 } })).toBe("cost $10.00 → $12.50");
  expect(changeWords({ action: "remove", before: {}, after: null })).toBe("took it off");
});

it("keeps only people's changes to Tiff's lines, newest first, each with its job's kind", () => {
  const rows = [
    row({ lineId: "t1", action: "add", madeBy: "tiff", after: { name: "Spring hangers" } }),
    row({ lineId: "p1", action: "add", madeBy: "u-isaac", after: { name: "Feet" } }),
    row({ lineId: "t1", madeBy: "u-isaac", before: { qty: 4 }, after: { qty: 2 }, why: "two will do on the slab", madeAt: "2026-10-08T01:00:00Z" }),
    row({ lineId: "t1", madeBy: "tiff", before: { qty: 2 }, after: { qty: 4 } }),
    row({ lineId: "p1", madeBy: "u-isaac", before: { qty: 1 }, after: { qty: 2 } }),
    row({ lineId: "t1", action: "remove", madeBy: "u-luke", before: {}, madeAt: "2026-10-08T02:00:00Z" }),
  ];
  const out = correctionsFrom(rows, new Map([["j1", "Residential install"]]));
  expect(out.map((c) => [c.line, c.what, c.by, c.kind, c.why])).toEqual([
    ["Spring hangers", "took it off", "u-luke", "Residential install", ""],
    ["Spring hangers", "qty 4 → 2", "u-isaac", "Residential install", "two will do on the slab"],
  ]);
});
