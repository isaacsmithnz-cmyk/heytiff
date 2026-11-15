import { jobMaterials } from "../materials";
import type { EquipmentRow } from "../stock";

const unit = (o: Partial<EquipmentRow> = {}): EquipmentRow => ({ key: "u", title: "Ducted unit 14 kW", detail: "PEA-M140HAA", qty: 1, group: "unit", when: null, word: { tone: "look", word: "To order" }, ...o });
const item = (o: Partial<{ id: string; name: string; sub: string; qty: string; kind: "material" | "todo"; picked: boolean; pickedBy: string | null; pickedAt: string | null }> = {}) => ({
  id: "p1", name: "Paired coil", sub: "PC1438, AAD", qty: "2", kind: "material" as const, picked: false, pickedBy: null, pickedAt: null, ...o,
});

it("a job with no list still shows the quote's units, with Stock's word, ready to load", () => {
  expect(jobMaterials([], [unit(), unit({ key: "d", group: "duct", title: "Ductwork, suggested", word: null })])).toEqual([
    { id: null, key: "q-u", name: "Ducted unit 14 kW", sub: "PEA-M140HAA", qty: "1", picked: false, by: null, at: null, word: { tone: "look", word: "To order" } },
  ]);
});

it("a unit on the list carries the word and comes first; a loaded one drops it; the quote's copy isn't listed twice", () => {
  const rows = jobMaterials([item(), item({ id: "p2", name: "Indoor", sub: "PEA-M140HAA" })], [unit()]);
  expect(rows.map((r) => [r.key, r.word?.word ?? null])).toEqual([["p2", "To order"], ["p1", null]]);
  expect(jobMaterials([item({ id: "p2", sub: "PEA-M140HAA", picked: true, pickedBy: "Luke" })], [unit()])[0]).toMatchObject({ picked: true, by: "Luke", word: null });
});

it("a to do on the list isn't a material", () => {
  expect(jobMaterials([item({ kind: "todo" })], [])).toEqual([]);
});
