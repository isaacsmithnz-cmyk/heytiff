/* A quote built on its lines, read by the job as a proposal's options: its
   units as equipment rows, its labour as visits, the accepted mark kept
   beside the switch. */
import { readingFromQuote } from "@/lib/certs/from-quote";
import type { QuoteLine } from "../lines";
import { byHandOf, labourVisits, linesDraft, linesHours, linesMaterials, linesUnits, toggleAccepted, withApproval, withLoading, withName, withProposal } from "../lines-job";
import type { UnitSpecs } from "../lookups";
import { acceptedOptions } from "../proposal";

const bh = (accepted: number[]) => ({ accepted, names: [] as string[], loading: {}, compare: {}, supplier: null, proposal: null });
const line = (o: Partial<QuoteLine>): QuoteLine => ({
  id: "x", version: 1, updatedAt: "", updatedBy: "", optionIndex: 0, system: "", group: "Materials", position: 0, name: "x",
  code: null, supplierKey: null, kind: "material", qty: 1, unit: "", costCents: 0, sellCents: null, source: "by_hand", why: "", duct: false, ...o,
});
const spec = (role: "indoor" | "outdoor", coolKw: number): UnitSpecs => ({
  role, model: "", coolKw, heatKw: null, sizeMm: null, weightKg: null, soundDba: { low: null, high: null }, phase: null, maxAmps: null, mcaAmps: null, pipeMm: null,
});

describe("the accepted mark", () => {
  it("is read from the draft's own key, one option, and nothing else", () => {
    expect(byHandOf({})).toEqual(bh([]));
    expect(byHandOf(null)).toEqual(bh([]));
    expect(byHandOf({ accepted: [1], byHand: { accepted: ["2", 3, -1] } })).toEqual(bh([2]));
  });

  it("moves to the option pressed, and comes off when pressed again", () => {
    expect(toggleAccepted(bh([]), 1)).toEqual(bh([1]));
    expect(toggleAccepted(bh([1]), 0)).toEqual(bh([0]));
    expect(toggleAccepted(bh([0]), 0)).toEqual(bh([]));
  });
});

describe("each option's name and loading", () => {
  it("names an option, and blank takes the name off", () => {
    expect(withName(bh([]), 1, "  With a zone for each bedroom ").names).toEqual(["", "With a zone for each bedroom"]);
    expect(withName({ ...bh([]), names: ["A", "B"] }, 1, "").names).toEqual(["A"]);
  });

  it("keeps a loading with its percent, capped, and takes it off with none", () => {
    expect(withLoading(bh([]), 0, { pct: 12, reason: "Parapet access" }).loading).toEqual({ 0: { pct: 12, reason: "Parapet access" } });
    expect(withLoading(bh([]), 0, { pct: 90, reason: "" }).loading[0]!.pct).toBe(50);
    expect(withLoading({ ...bh([]), loading: { 0: { pct: 12, reason: "x" } } }, 0, { pct: 0 }).loading).toEqual({});
    expect(byHandOf({ byHand: { names: ["Good"], loading: { "1": { pct: "10", reason: "Two storeys" }, x: { pct: 5 } } } })).toEqual({ accepted: [], names: ["Good"], loading: { 1: { pct: 10, reason: "Two storeys" } }, compare: {}, supplier: null, proposal: null });
  });
});

describe("the proposal's words (7.1)", () => {
  const none = byHandOf({});
  it("a change keeps one set of words an option, and an approval it doesn't give", () => {
    const approved = withApproval(withProposal(none, { intro: "Hi" }, "2026-10-08T01:00:00Z", 1), "u-isaac", "2026-10-08T02:00:00Z");
    const p = withProposal(approved, { options: [{ summary: "Small" }, { summary: "Big" }, { summary: "Gone" }], approvedAt: null }, "2026-10-08T03:00:00Z", 2).proposal!;
    expect(p.intro).toBe("Hi");
    expect(p.options.map((o) => o.summary)).toEqual(["Small", "Big"]);
    expect(p).toMatchObject({ updatedAt: "2026-10-08T03:00:00Z", approvedAt: "2026-10-08T02:00:00Z", approvedBy: "u-isaac" });
  });

  it("one never written is approved as it's drawn", () => {
    expect(withApproval(none, "u-isaac", "2026-10-08T02:00:00Z").proposal).toMatchObject({ intro: "", updatedAt: "2026-10-08T02:00:00Z", approvedAt: "2026-10-08T02:00:00Z" });
  });
});

describe("the units as equipment", () => {
  it("numbers each system's outdoor and runs its indoors from it, the system's name the room", () => {
    const specs = new Map([
      ["o1", spec("outdoor", 12.5)],
      ["i1", spec("indoor", 12.5)],
      ["o2", spec("outdoor", 7.1)],
    ]);
    const units = linesUnits(
      [
        line({ id: "i1", system: "Downstairs", kind: "unit", code: "PEA-M125HAA", name: "Ducted indoor" }),
        line({ id: "o1", system: "Downstairs", kind: "unit", code: "PUZ-ZM125VKA2", name: "Outdoor" }),
        line({ id: "p", system: "Downstairs", name: "Pair coil" }),
        line({ id: "o2", system: "Upstairs", kind: "unit", code: "PUZ-ZM71VHA", name: "Outdoor" }),
        line({ id: "i2", system: "Upstairs", kind: "unit", code: "", name: "High wall 7.1 kW" }),
      ],
      specs
    );
    expect(units).toEqual([
      { role: "indoor", room: "Downstairs", capacity: "12.5 kW", type: "Ducted", model: "PEA-M125HAA", qty: 1, system: 1, lps: null },
      { role: "outdoor", room: "", capacity: "12.5 kW", type: "", model: "PUZ-ZM125VKA2", qty: 1, system: 1, lps: null },
      { role: "outdoor", room: "", capacity: "7.1 kW", type: "", model: "PUZ-ZM71VHA", qty: 1, system: 2, lps: null },
      { role: "indoor", room: "Upstairs", capacity: "7.1 kW", type: "", model: "", qty: 1, system: 2, lps: null },
    ]);
  });

  it("pairs a nameless system's outdoors and indoors in order, as a quote brought across holds them", () => {
    const units = linesUnits(
      [
        line({ id: "o1", kind: "unit", code: "MUZ-AP25", name: "Outdoor unit" }),
        line({ id: "i1", kind: "unit", code: "MSZ-AP25", name: "Wall unit" }),
        line({ id: "o2", kind: "unit", code: "MUZ-AP35", name: "Outdoor unit" }),
        line({ id: "i2", kind: "unit", code: "MSZ-AP35", name: "Wall unit" }),
        line({ id: "f", kind: "unit", code: "", name: "Exhaust fan", system: "Bathroom" }),
      ],
      new Map()
    );
    expect(units.map((u) => [u.role, u.model, u.system, u.room])).toEqual([
      ["outdoor", "MUZ-AP25", 1, ""],
      ["indoor", "MSZ-AP25", 1, ""],
      ["outdoor", "MUZ-AP35", 2, ""],
      ["indoor", "MSZ-AP35", 2, ""],
      ["fan", "", 0, "Bathroom"],
    ]);
  });
});

describe("the labour", () => {
  it("is each line's hours over its crew in the working day, and one visit with no day set", () => {
    const lines = [line({ kind: "labour", name: "Rough-in: 2 people", qty: 16, unit: "h" }), line({ kind: "labour", name: "Clean up", qty: 4, unit: "h" })];
    expect(labourVisits(lines, 8)).toEqual([
      { stage: "Rough-in", people: 2, days: 1 },
      { stage: "Install", people: 1, days: 0.5 },
    ]);
    expect(labourVisits(lines, null)).toEqual([
      { stage: "Rough-in", people: 2, days: 1 },
      { stage: "Install", people: 1, days: 1 },
    ]);
    expect(linesHours(lines)).toBe(20);
  });
});

describe("the quote as the job reads it", () => {
  const lines = [
    line({ id: "i", system: "Living", kind: "unit", code: "MSZ-AP50VGD", name: "High wall 5 kW" }),
    line({ id: "o", system: "Living", kind: "unit", code: "MUZ-AP50VG", name: "Outdoor unit" }),
    line({ id: "c", system: "Living", name: "Pair coil 1/4 1/2", code: "PC1412", qty: 6.5, unit: "m" }),
    line({ id: "l", kind: "labour", name: "Install", qty: 8, unit: "h" }),
    line({ id: "b", optionIndex: 1, system: "Living", kind: "unit", code: "MSZ-AP60VGD", name: "High wall 6 kW" }),
  ];

  it("is an option for each, named as the quote names it, with its units, labour and the mark", () => {
    const draft = linesDraft(lines, ["Good"], bh([1]), new Map(), 8)!;
    expect(draft.options.map((o) => o.name)).toEqual(["Good", "Option 2"]);
    expect(draft.accepted).toEqual([1]);
    expect(draft.options[0]!.units.map((u) => [u.role, u.model])).toEqual([
      ["indoor", "MSZ-AP50VGD"],
      ["outdoor", "MUZ-AP50VG"],
    ]);
    expect(draft.options[0]!.labour).toEqual({ visits: [{ stage: "Install", people: 1, days: 1 }], from: "you" });
    expect(acceptedOptions(draft).map((o) => o.name)).toEqual(["Option 2"]);
    expect(linesDraft([], [], bh([]), new Map(), 8)).toBeNull();
  });

  it("gives the certificate its systems, and the job its parts", () => {
    const draft = linesDraft(lines, [], bh([0]), new Map(), 8)!;
    const reading = readingFromQuote(acceptedOptions(draft));
    expect(reading.systems).toHaveLength(1);
    expect(reading.systems[0]!.outdoor.model).toBe("MUZ-AP50VG");
    expect(reading.systems[0]!.indoors.map((r) => [r.location, r.model, r.capacityKw])).toEqual([["Living", "MSZ-AP50VGD", 5]]);
    expect(linesMaterials(lines.filter((l) => l.optionIndex === 0))).toEqual([
      { name: "High wall 5 kW", sub: "MSZ-AP50VGD", qty: "1" },
      { name: "Outdoor unit", sub: "MUZ-AP50VG", qty: "1" },
      { name: "Pair coil 1/4 1/2", sub: "PC1412", qty: "6.5 m" },
    ]);
  });
});
