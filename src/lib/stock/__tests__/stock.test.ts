import type { QuoteLine } from "@/lib/quotes/lines";
import {
  allocate,
  bookVisits,
  dropsOf,
  groupOf,
  jobState,
  laterOf,
  needsOf,
  NO_MARK,
  optionChoice,
  ordersOf,
  orderText,
  planOf,
  quoteVisit,
  rowWord,
  shoppingList,
  sm8Options,
  weekOf,
  type JobNeed,
  type JobNeeds,
  type StockJob,
} from "../stock";

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

const job = (uuid: string, number: string, firstAt: string | null): StockJob => ({ uuid, number, client: null, suburb: null, address: null, hue: "purple", kind: null, firstAt, crew: 1 });
const need = (key: string, qty: number, at: string | null, m: Partial<JobNeed> = {}): JobNeed => ({
  key,
  code: key,
  title: key,
  detail: key,
  group: "unit",
  qty,
  supplierKey: "aad",
  role: null,
  ...NO_MARK,
  need: qty,
  visit: null,
  at,
  ...m,
});

describe("the week", () => {
  it("is next Monday to Sunday from a Wednesday, the week after it, and Later past both", () => {
    expect(weekOf("2026-11-11", "next")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(weekOf("2026-11-11", "after")).toEqual({ from: "2026-11-23", to: "2026-11-29" });
    expect(weekOf("2026-11-15", "next")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(weekOf("2026-11-16", "next")).toEqual({ from: "2026-11-23", to: "2026-11-29" });
    expect(weekOf("2026-11-13", "later")).toEqual({ from: "2026-11-30", to: "9999-12-31" });
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
    expect(sm8Options(["Option.1", "Option 2", "option #3", "As Per Quote", "Option 1 Mitsubishi Electric multi"])).toEqual([0, 1, 2]);
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
      { key: "MSZ-AP25VGKD2-A2", code: "msz-ap25vgkd2-a2", title: "Indoor, 2.5 kW", detail: "msz-ap25vgkd2-a2", group: "unit", qty: 2, supplierKey: null, role: "indoor" },
      { key: "PAR-41MAAM", code: "PAR-41MAAM", title: "Wired controller", detail: "PAR-41MAAM", group: "control", qty: 1, supplierKey: null, role: null },
      { key: "duct", code: null, title: "Ductwork, suggested", detail: "4 x VORTEX FLEXIBLE DUCT 200mm, 5 x Floor grille", group: "duct", qty: 1, supplierKey: null, role: null },
    ]);
  });
});

/* 2845, 7 Cutler Rd: its quote's visits as Tiff wrote them (13 November 2026) */
const visit = (position: number, stage: string, tasks: string[], people = 2, hours = 8) =>
  line({ kind: "labour", position, name: stage, visit: { stage, people, dayHours: 8, tasks: tasks.map((task) => ({ task, hours: hours / tasks.length })) } });
const cutler = [
  visit(1, "Rough-in: ground floor ducting", ["Ducted plenum and 5 supply takeoffs", "5 zone dampers fitted in their runs", "Sensor cabling and damper wiring back to the zone controller"], 2, 32),
  visit(2, "Rough-in: upstairs VRF", ["VRF pipe (20 m to first joint), tee joints and transmission cable to 3 bulkhead", "3 plenums at the bulkhead heads"]),
  visit(3, "Install", ["Both outdoors placed, mounted and levelled", "Hang 3 bulkhead heads", "Hang PEA-M125HAA (66 kg), connect plenum and returns", "Zone controller, wired controllers, 4 Wi-Fi interfaces"], 3, 48),
  visit(4, "Fit-off and commissioning", ["Zone balancing, sensor pairing, Wi-Fi set-up on all four units"]),
];

describe("a job over many visits", () => {
  const plan = planOf(cutler, [0]);
  it("takes the quote's visits in order, a part day a day of its own", () => {
    expect(plan.map((v) => [v.stage, v.days])).toEqual([
      ["Rough-in: ground floor ducting", 2],
      ["Rough-in: upstairs VRF", 1],
      ["Install", 2],
      ["Fit-off and commissioning", 1],
    ]);
  });
  it("puts each visit on the job's booked days, counting a visit's days, and leaves the rest unbooked", () => {
    const booked = bookVisits(plan, ["2026-11-16 07:00:00", "2026-11-17 07:00:00", "2026-11-17 07:30:00", "2026-11-18 07:00:00", "2026-12-07 07:00:00"]);
    expect(booked.map((v) => [v.n, v.at])).toEqual([
      [1, "2026-11-16 07:00:00"],
      [2, "2026-11-18 07:00:00"],
      [3, "2026-12-07 07:00:00"],
      [4, null],
    ]);
  });
  it("needs the motors at the rough-in that fits them, the units and controllers at Install", () => {
    const v = plan.map((x, i) => ({ ...x, n: i + 1 }));
    expect(quoteVisit({ group: "control", title: "ZONEBOSS PLA MOTOR DAMPER 3NM 24V 300MM (EA)", code: "1609272-1", role: null }, v)).toBe(1);
    expect(quoteVisit({ group: "unit", title: "Outdoor, 14 kW", code: "PUMY-SP140VKMD2-A", role: "outdoor" }, v)).toBe(3);
    expect(quoteVisit({ group: "unit", title: "Indoor, 6.3 kW", code: "PEFY-P63VMX-E1", role: "indoor" }, v)).toBe(3);
    expect(quoteVisit({ group: "unit", title: "Indoor, 12.5 kW", code: "PEA-M125HAA", role: "indoor" }, v)).toBe(3);
    expect(quoteVisit({ group: "control", title: "Zone Controller Interface 10 Zone, LINEAR", code: "PAC-ZC10L240C-A", role: null }, v)).toBe(3);
    expect(quoteVisit({ group: "control", title: "Wireless Sensor", code: "PAR-ZR01S-A", role: null }, v)).toBe(3);
    expect(quoteVisit({ group: "duct", title: "Ductwork, suggested", code: null, role: null }, v)).toBe(1);
  });
  it("hangs a head at the rough-in that says so, and its outdoor at the fit-off, on a two-visit job", () => {
    const v = [
      { n: 1, stage: "Rough-in", tasks: ["Set out the bulkhead with the builder: framing, depth, service access", "Hang the indoor in the bulkhead framing, level, with fall to the drain"] },
      { n: 2, stage: "Fit-off", tasks: ["Outdoor on rubber feet down the side, connect pipe and cable", "Wired controller on the wall"] },
    ];
    expect(quoteVisit({ group: "unit", title: "Indoor", code: "PEAD-M50", role: "indoor" }, v)).toBe(1);
    expect(quoteVisit({ group: "unit", title: "Outdoor", code: "PUZ-ZM50", role: "outdoor" }, v)).toBe(2);
    expect(quoteVisit({ group: "control", title: "Wired controller", code: "PAR-41MAAM", role: null }, v)).toBe(2);
  });
  it("takes a bracket for the wall, not the unit", () => {
    const v = [
      { n: 1, stage: "Rough-in", tasks: ["Mark up and fit 3 indoor brackets", "Fit 2 outdoor wall brackets"] },
      { n: 2, stage: "Install and commissioning", tasks: ["Hang 3 indoor units and connect pipes, drains", "Set 2 outdoor units, flare and connect pipe"] },
    ];
    expect(quoteVisit({ group: "unit", title: "Indoor", code: "MSZ-AP25", role: "indoor" }, v)).toBe(2);
    expect(quoteVisit({ group: "unit", title: "Outdoor", code: "MUZ-AP25", role: "outdoor" }, v)).toBe(2);
    expect(quoteVisit({ group: "unit", title: "Outdoor", code: "PUMY-SP112", role: "outdoor" }, [{ n: 1, stage: "Rough-in", tasks: ["Mount outdoor unit on wall bracket"] }, { n: 2, stage: "Fit-off", tasks: [] }])).toBe(1);
  });
  it("says nothing on a job of one visit", () => {
    expect(quoteVisit({ group: "unit", title: "Outdoor", code: "X", role: "outdoor" }, [{ n: 1, stage: "Install", tasks: [] }])).toBeNull();
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
  const jobs: JobNeeds[] = [
    { job: job("j3449", "3449", "2026-11-20 07:30:00"), needs: [need("AP25", 2, "2026-11-20 07:30:00")] },
    { job: job("j3516", "3516", "2026-11-19 07:00:00"), needs: [need("AP25", 3, "2026-11-19 07:00:00", { inStock: 3 }), need("MXZ", 1, "2026-11-19 07:00:00", { ordered: 1 })] },
    { job: job("j2845", "2845", "2026-11-16 07:00:00"), needs: [need("PUMY", 1, "2026-11-19 07:00:00", { ordered: 1, orderedTo: "site", orderedDue: "2026-11-19" }), need("MOTOR", 5, "2026-11-16 07:00:00", { group: "control", had: 5, hadWhere: "van", hadWho: "Luke Smith" })] },
  ];
  it("adds each model up across jobs, by when each is wanted, the job number breaking a tie", () => {
    const items = shoppingList(jobs);
    expect(items.map((i) => [i.key, i.need, i.inStock, i.ordered, i.covered, i.open, i.jobs.map((j) => j.number)])).toEqual([
      ["PUMY", 1, 0, 1, 1, 0, ["2845"]],
      ["AP25", 5, 3, 0, 3, 2, ["3516", "3449"]],
      ["MXZ", 1, 0, 1, 0, 0, ["3516"]],
      ["MOTOR", 5, 0, 0, 5, 0, ["2845"]],
    ]);
  });
  it("words each row: to order, ordered, to site on its day, in a van", () => {
    const words = shoppingList(jobs).map((i) => rowWord(i, "2026-11-13"));
    expect(words).toEqual([
      { tone: "good", word: "To site, Thu" },
      { tone: "look", word: "2 to order" },
      { tone: "info", word: "Ordered" },
      { tone: "good", word: "In Luke's van" },
    ]);
  });
  it("is red when the supplier says a day after the visit", () => {
    const late = shoppingList([{ job: job("j3479", "3479", "2026-11-17 07:00:00"), needs: [need("MFZ", 1, "2026-11-17 07:00:00", { ordered: 1, orderedDue: "2026-11-18" })] }]);
    expect(rowWord(late[0]!, "2026-11-13")).toEqual({ tone: "wrong", word: "Due after Tue" });
  });
  it("orders only what's neither in, had, nor ordered, by supplier, and splits it by drop", () => {
    const orders = ordersOf(shoppingList(jobs), (i) => i.supplierKey);
    expect(orders).toEqual([{ supplierKey: "aad", lines: [{ key: "AP25", code: "AP25", title: "AP25", qty: 2, jobs: [{ uuid: "j3449", number: "3449", qty: 2 }] }] }]);
    expect(orderText(orders[0]!.lines)).toBe("2 x AP25");
    expect(dropsOf(orders[0]!, new Set(["j3449"]))).toEqual([{ site: "j3449", lines: [{ key: "AP25", code: "AP25", title: "AP25", qty: 2, jobs: [{ uuid: "j3449", number: "3449", qty: 2 }] }] }]);
    expect(dropsOf(orders[0]!, new Set()).map((d) => d.site)).toEqual([null]);
  });
  it("says a job is covered, late, ordered, or still to order, leaving ductwork out of it", () => {
    const n = (m: Partial<JobNeed>) => need("X", 3, "2026-11-17 07:00:00", m);
    expect(jobState([n({ inStock: 3 }), need("duct", 1, null, { group: "duct" })])).toBe("in");
    expect(jobState([n({ inStock: 1, had: 2 })])).toBe("in");
    expect(jobState([n({ ordered: 3, orderedTo: "site" })])).toBe("in");
    expect(jobState([n({ inStock: 1, ordered: 2 })])).toBe("ordered");
    expect(jobState([n({ ordered: 3, orderedDue: "2026-11-18" })])).toBe("late");
    expect(jobState([n({ inStock: 1 })])).toBe("order");
    expect(jobState([need("duct", 1, null, { group: "duct" })])).toBe("none");
  });
});

describe("Later", () => {
  it("adds up what's still to order by supplier, with what it comes to at the book's price", () => {
    const items = shoppingList([
      { job: job("j2798", "2798", null), needs: [need("PUMY-SP140VKMD3", 2, null, { supplierKey: "mitsubishi" }), need("PEFY-P32", 3, null, { supplierKey: "mitsubishi" })] },
      { job: job("j3209", "3209", null), needs: [need("PEFY-P32", 1, null, { supplierKey: "mitsubishi", ordered: 1 })] },
      { job: job("j3446", "3446", null), needs: [need("MSZ-AP25", 2, null)] },
    ]);
    const cents: Record<string, number> = { "PEFY-P32": 87152, "MSZ-AP25": 28581 };
    const later = laterOf(items, (i) => i.supplierKey, (i) => cents[i.key] ?? null);
    expect(later.map((s) => [s.supplierKey, s.units, s.jobs, s.cents, s.unpriced])).toEqual([
      ["mitsubishi", 5, 1, 3 * 87152, 2],
      ["aad", 2, 1, 2 * 28581, 0],
    ]);
  });
});
