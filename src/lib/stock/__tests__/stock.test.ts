import type { QuoteLine } from "@/lib/quotes/lines";
import { allocate, groupOf, jobState, needsOf, optionChoice, ordersOf, orderText, shoppingList, sm8Options, weekOf, type JobNeeds, type StockJob } from "../stock";

const line = (p: Partial<QuoteLine>): QuoteLine => ({
  id: p.id ?? Math.random().toString(36).slice(2),
  optionIndex: 0,
  system: "",
  group: "",
  position: 0,
  name: "Line",
  code: null,
  supplierKey: null,
  kind: "material",
  qty: 1,
  unit: "",
  costCents: 0,
  sellCents: null,
  source: "said",
  why: "",
  duct: false,
  version: 1,
  updatedAt: "",
  updatedBy: "",
  ...p,
});

const job = (uuid: string, number: string, firstAt: string): StockJob => ({ uuid, number, client: null, suburb: null, hue: "purple", kind: null, firstAt, crew: 1 });

describe("the week", () => {
  it("is next Monday to Sunday from a Wednesday, and the week after it", () => {
    expect(weekOf("2026-11-11", "next")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(weekOf("2026-11-11", "after")).toEqual({ from: "2026-11-23", to: "2026-11-29" });
    expect(weekOf("2026-11-15", "next")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(weekOf("2026-11-16", "next")).toEqual({ from: "2026-11-23", to: "2026-11-29" });
  });
});

describe("what a line is to Stock", () => {
  it("takes units, controls by their name, ductwork by its mark, and nothing else", () => {
    expect(groupOf(line({ kind: "unit", name: "Outdoor unit" }))).toBe("unit");
    expect(groupOf(line({ name: "Zone Controller Interface 10 Zone, LINEAR" }))).toBe("control");
    expect(groupOf(line({ name: "ZONEBOSS PLA MOTOR DAMPER 3NM 24V 200MM (EA)", duct: true }))).toBe("control");
    expect(groupOf(line({ name: "Wireless Sensor *Requires wireless receiver" }))).toBe("control");
    expect(groupOf(line({ name: "VORTEX FLEXIBLE DUCT R1.0 200mm", duct: true }))).toBe("duct");
    expect(groupOf(line({ name: "Consumables" }))).toBeNull();
    expect(groupOf(line({ name: "ARDENT PR CU 3/8\" X 5/8\"" }))).toBeNull();
    expect(groupOf(line({ kind: "labour", name: "Zone setup" }))).toBeNull();
  });
});

describe("which option a job takes", () => {
  const two = [line({ optionIndex: 0 }), line({ optionIndex: 1 })];
  it("is the accepted one, the only one, or the one ServiceM8 kept", () => {
    expect(optionChoice(two, [1], [], [])).toEqual({ taken: [1], how: "accepted" });
    expect(optionChoice([line({})], [], [], [])).toEqual({ taken: [0], how: "only" });
    expect(optionChoice(two, [], [], ["Option.2", "Partial invoice #3479A"])).toEqual({ taken: [1], how: "servicem8" });
  });
  it("asks when ServiceM8 still has both, or says nothing", () => {
    expect(optionChoice(two, [], [], ["Option.1", "Option.2"])).toEqual({ taken: null, options: [0, 1] });
    expect(optionChoice(two, [], [], ["As Per Quote"])).toEqual({ taken: null, options: [0, 1] });
  });
  it("leaves a variation out of the count", () => {
    expect(optionChoice([...two, line({ optionIndex: 2 })], [], [1, 2], [])).toEqual({ taken: [0], how: "only" });
  });
  it("reads ServiceM8's option lines however they're written", () => {
    expect(sm8Options(["Option.1", "Option 2", "option #3", "As Per Quote"])).toEqual([0, 1, 2]);
  });
});

describe("what a job needs", () => {
  it("adds the same model up, names a unit by its specs, and folds the ducts into one suggestion", () => {
    const ls = [
      line({ id: "a", kind: "unit", name: "Indoor unit, Room 1", code: "msz-ap25vgkd2-a2", qty: 1 }),
      line({ id: "b", kind: "unit", name: "Indoor unit, Room 2", code: "MSZ-AP25VGKD2-A2", qty: 1 }),
      line({ name: "Wired controller", code: "PAR-41MAAM" }),
      line({ name: "VORTEX FLEXIBLE DUCT 200mm", duct: true, qty: 4 }),
      line({ name: "Floor grille", duct: true, qty: 5 }),
      line({ optionIndex: 1, kind: "unit", name: "Outdoor unit", code: "OTHER" }),
    ];
    const n = needsOf(ls, [0], new Map([["a", { role: "indoor", coolKw: 2.5 }]]));
    expect(n).toEqual([
      { key: "MSZ-AP25VGKD2-A2", code: "msz-ap25vgkd2-a2", title: "Indoor, 2.5 kW", detail: "msz-ap25vgkd2-a2", group: "unit", qty: 2, supplierKey: null },
      { key: "PAR-41MAAM", code: "PAR-41MAAM", title: "Wired controller", detail: "PAR-41MAAM", group: "control", qty: 1, supplierKey: null },
      { key: "duct", code: null, title: "Ductwork, suggested", detail: "4 x VORTEX FLEXIBLE DUCT 200mm, 5 x Floor grille", group: "duct", qty: 1, supplierKey: null },
    ]);
  });
});

describe("sharing out what's on the shelf", () => {
  it("fills the earliest booking first", () => {
    expect(allocate(4, [3, 3])).toEqual([3, 1]);
    expect(allocate(10, [3, 3])).toEqual([3, 3]);
    expect(allocate(0, [3, 3])).toEqual([0, 0]);
  });
});

describe("the shopping list and the order", () => {
  const need = (key: string, qty: number, inStock = 0, ordered = 0) => ({ key, code: key, title: key, detail: key, group: "unit" as const, qty, supplierKey: "aad", need: qty, inStock, ordered, orderedFrom: null, inStockBy: null, inStockAt: null, orderedBy: null, orderedAt: null });
  const jobs: JobNeeds[] = [
    { job: job("j3000", "3000", "2026-11-16 07:30:00"), needs: [need("AP25", 3, 1)] },
    { job: job("j3472", "3472", "2026-11-16 07:00:00"), needs: [need("AP25", 3, 3), need("MUZ", 1, 0, 1)] },
  ];
  it("adds each model up across jobs, earliest booking first", () => {
    const items = shoppingList(jobs);
    expect(items.map((i) => [i.key, i.need, i.inStock, i.ordered, i.jobs.map((j) => j.number)])).toEqual([
      ["AP25", 6, 4, 0, ["3472", "3000"]],
      ["MUZ", 1, 0, 1, ["3472"]],
    ]);
  });
  it("orders only what's neither in nor ordered, by supplier", () => {
    const orders = ordersOf(shoppingList(jobs), (i) => i.supplierKey);
    expect(orders).toEqual([{ supplierKey: "aad", lines: [{ key: "AP25", code: "AP25", title: "AP25", qty: 2, jobs: [{ uuid: "j3000", number: "3000", qty: 2 }] }] }]);
    expect(orderText(orders[0]!)).toBe("2 x AP25");
  });
  it("says a job is in, ordered, or still to order, leaving ductwork out of it", () => {
    expect(jobState([{ need: 3, inStock: 3, ordered: 0, group: "unit" }, { need: 1, inStock: 0, ordered: 0, group: "duct" }])).toBe("in");
    expect(jobState([{ need: 3, inStock: 1, ordered: 2, group: "unit" }])).toBe("ordered");
    expect(jobState([{ need: 3, inStock: 1, ordered: 0, group: "unit" }])).toBe("order");
    expect(jobState([{ need: 1, inStock: 0, ordered: 0, group: "duct" }])).toBe("none");
  });
});
