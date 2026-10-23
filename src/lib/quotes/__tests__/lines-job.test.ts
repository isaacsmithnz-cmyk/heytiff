/* A quote built on its lines, read by the job as a proposal's options: its
   units as equipment rows, its labour as visits, the accepted mark kept
   beside the switch. */
import { readingFromQuote } from "@/lib/certs/from-quote";
import type { QuoteLine } from "../lines";
import { byHandOf, variationInSm8, variationMaterials, variationUntouched, withVariation, withVariationSent, withoutVariation, labourTasks, labourVisits, stageNamed, linesDraft, linesHours, linesMaterials, linesUnits, toggleAccepted, withApproval, withoutApproval, withSent, withLoading, withName, withProposal } from "../lines-job";
import type { UnitSpecs } from "../lookups";
import { acceptedOptions } from "../proposal";

const bh = (accepted: number[]) => ({ accepted, names: [] as string[], loading: {}, compare: {}, supplier: null, proposal: null, researched: {}, variations: [] });
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
    expect(byHandOf({ byHand: { names: ["Good"], loading: { "1": { pct: "10", reason: "Two storeys" }, x: { pct: 5 } } } })).toEqual({ accepted: [], names: ["Good"], loading: { 1: { pct: 10, reason: "Two storeys" } }, compare: {}, supplier: null, proposal: null, researched: {}, variations: [] });
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

  /* Isaac, 2026-10-15: on a multi, "indoor unit study, then model" */
  it("takes a multi's head's room from its name, the system's where it gives none", () => {
    const units = linesUnits(
      [
        line({ id: "o", system: "Upstairs", kind: "unit", code: "MXZ-3F68VF", name: "Outdoor unit" }),
        line({ id: "s", system: "Upstairs", kind: "unit", code: "MSZ-AP25VGD2", name: "Indoor unit, Study" }),
        line({ id: "b", system: "Upstairs", kind: "unit", code: "MSZ-AP35VGD2", name: "Indoor unit, Bed 1" }),
        line({ id: "l", system: "Upstairs", kind: "unit", code: "MSZ-AP50VGD2", name: "Indoor unit" }),
      ],
      new Map()
    );
    expect(units.map((u) => [u.role, u.room, u.model])).toEqual([
      ["outdoor", "", "MXZ-3F68VF"],
      ["indoor", "Study", "MSZ-AP25VGD2"],
      ["indoor", "Bed 1", "MSZ-AP35VGD2"],
      ["indoor", "Upstairs", "MSZ-AP50VGD2"],
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

  it("a line Tiff named for its crew and days, or worked out task by task, keeps its stage and crew (8.2)", () => {
    expect(labourVisits([line({ kind: "labour", name: "Rough-in: 2 people, 3.5 days", qty: 56, unit: "h" })], 8)).toEqual([{ stage: "Rough-in", people: 2, days: 3.5 }]);
    const visit = { stage: "Install and commissioning", people: 2, dayHours: 8, tasks: [{ task: "Set two outdoors", hours: 3, was: null, byHand: false }, { task: "Commission", hours: 5, was: 3, byHand: true }] };
    const lines = [line({ kind: "labour", name: "Two days on the tools", qty: 8, unit: "h", visit }), line({ kind: "labour", name: "Return: 1 person", qty: 2, unit: "h" })];
    expect(labourVisits(lines, 8)).toEqual([
      { stage: "Install", people: 2, days: 0.5 },
      { stage: "Return", people: 1, days: 0.25 },
    ]);
    expect(labourTasks(lines)).toEqual([[{ task: "Set two outdoors", hours: 3 }, { task: "Commission", hours: 5 }], []]);
  });

  it("names a stage from a visit's own words", () => {
    expect(["Rough-in", "Rough in and pre-wire", "Install and commissioning", "Fit-off and commissioning", "Return: grilles", "Commissioning", "Crane day"].map(stageNamed)).toEqual([
      "Rough-in",
      "Rough-in",
      "Install",
      "Fit-off",
      "Return",
      "Commissioning",
      "Install",
    ]);
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

/* Isaac, 2026-10-10: "even after it's been approved… it'll be variation then" */
describe("a variation to the accepted quote", () => {
  const accepted = { ...bh([0]), names: ["Daikin, zoned"] };

  it("is an option of its own, numbered, named, varying the accepted one", () => {
    const b = withVariation(accepted, 2, "  Client wants the upstairs hallway done too. ", "u-isaac", "2026-10-15T00:00:00Z");
    expect(b.names).toEqual(["Daikin, zoned", "", "Variation 1"]);
  });

  it("is read back from the draft, and a broken one left out", () => {
    const b = withVariation(accepted, 1, "x", "u", "t0");
    expect(byHandOf({ byHand: b }).variations).toEqual(b.variations);
    expect(byHandOf({ byHand: { ...b, variations: [{ n: 1, option: 0, of: 0 }, { n: "x", option: 2, of: 0 }] } }).variations).toEqual([]);
  });
});

/* version 2 before it's accepted (quote-versions.ts) */
describe("the approval taken off for the next version", () => {
  it("clears who approved it and when, keeping its words", () => {
    const approved = withApproval(withProposal(bh([]), { intro: "Hi Andrew" }, "t0", 1), "u-isaac", "t1");
    const off = withoutApproval(approved);
    expect(off.proposal).toMatchObject({ approvedAt: null, approvedBy: null, updatedAt: "t0" });
    expect(off.proposal!.intro).toBe(approved.proposal!.intro);
    expect(withoutApproval(bh([]))).toEqual(bh([]));
  });
});

describe("an accepted variation's parts onto the job's materials list", () => {
  it("puts on what it added and the extra of what it has more of, marked with its variation; nothing it has less of", () => {
    const base = [
      line({ id: "d", name: "Cone diffuser 200", code: "CD200", qty: 3 }),
      line({ id: "p", name: "Pair coil 1/4 3/8", code: "PC0610", qty: 15, unit: "m" }),
      line({ id: "i", name: "Isolator", qty: 1 }),
      line({ id: "l", kind: "labour", name: "Install", qty: 16, unit: "h" }),
    ];
    const varied = [
      line({ id: "d2", optionIndex: 1, name: "Cone diffuser 200", code: "cd200", qty: 4 }),
      line({ id: "p2", optionIndex: 1, name: "Pair coil 1/4 3/8", code: "PC0610", qty: 12.5, unit: "m" }),
      line({ id: "z", optionIndex: 1, name: "Zone damper 200", code: "ZD200", qty: 2 }),
      line({ id: "w", optionIndex: 1, name: "Wall controller", qty: 1 }),
      line({ id: "l2", optionIndex: 1, kind: "labour", name: "Install", qty: 20, unit: "h" }),
    ];
    expect(variationMaterials(base, varied, 1)).toEqual([
      { name: "Cone diffuser 200", sub: "cd200, Variation 1", qty: "1" },
      { name: "Zone damper 200", sub: "ZD200, Variation 1", qty: "2" },
      { name: "Wall controller", sub: "Variation 1", qty: "1" },
    ]);
  });
});

describe("sent to ServiceM8 as a quote (7.3)", () => {
  it("is kept and read back, a trial run saying so; a new version takes it off", () => {
    const sent = withSent(withApproval(bh([]), "u", "t1"), "u-isaac", "t2", true);
    expect(byHandOf({ byHand: sent }).sent).toEqual({ at: "t2", by: "u-isaac", trial: true });
    expect(withoutApproval(sent).sent).toBeNull();
    expect(byHandOf({ byHand: bh([]) })).not.toHaveProperty("sent");
  });
});

/* the 2026-10-12 survey: an old draft keeps four options, and a quote on its
   lines read as one lost option 5 on (and the send threw on it) */
it("reads every option of a quote on its lines, not an old draft's four", () => {
  const lines = Array.from({ length: 6 }, (_, i) => line({ id: `l${i}`, optionIndex: i, name: `Unit ${i}`, kind: "unit" }));
  const draft = linesDraft(lines, [], { ...bh([5]) }, new Map(), 8)!;
  expect(draft.options).toHaveLength(6);
  expect(draft.accepted).toEqual([5]);
});

/* v2 step 6, slice D: a variation sent to ServiceM8 as extra lines on the
   job (decision 21), and one Tiff started taken back while still empty */
describe("a variation's send and its take-back", () => {
  const started = withVariation({ ...bh([0]), names: ["Main"] }, 1, "return grille in Bed 2", "auth0|me", "2026-10-18T01:00:00.000Z");
  const v = started.variations[0]!;
  const copy = [line({ id: "a", name: "Return grille", qty: 1, costCents: 4000 }), line({ id: "b", name: "Flex duct", qty: 3, costCents: 800 })];
  const asCopied = copy.map((l) => ({ ...l, id: `${l.id}2`, optionIndex: 1, version: 3, position: 9 }));

  it("keeps what went on the variation, and says when all of it is in ServiceM8 for real", () => {
    const sent = { at: "2026-10-18T03:00:00.000Z", by: "auth0|me", trial: false, jobNumber: "3209", lines: 2, sent: 2, lineUuids: [] };
    const b = withVariationSent(started, 1, sent);
    expect(b.variations[0]!.sm8).toEqual(sent);
    expect(variationInSm8(b.variations[0]!)).toBe(true);
    expect(variationInSm8({ sm8: { ...sent, trial: true } })).toBe(false);
    expect(variationInSm8({ sm8: { ...sent, sent: 1 } })).toBe(false);
    expect(variationInSm8({})).toBe(false);
  });

  it("is still the empty copy while its lines are the accepted option's, line for line", () => {
    expect(variationUntouched(v, copy, asCopied)).toBe(true);
    expect(variationUntouched(v, copy, [asCopied[0]!, { ...asCopied[1]!, qty: 4 }])).toBe(false);
    expect(variationUntouched(v, copy, asCopied.slice(0, 1))).toBe(false);
    expect(variationUntouched({ ...v, approvedAt: "2026-10-18T02:00:00.000Z" }, copy, asCopied)).toBe(false);
    expect(variationUntouched({ ...v, sm8: { at: "x", by: "", trial: true, jobNumber: null, lines: 1, sent: 0, lineUuids: [] } }, copy, asCopied)).toBe(false);
  });

  it("taken back, its record and its name go, and the next one is Variation 1 again", () => {
    const back = withoutVariation(started, 1);
    expect(back.variations).toEqual([]);
    expect(back.names).toEqual(["Main"]);
    expect(withVariation(back, 1, "again", "auth0|me", "2026-10-19T00:00:00.000Z").variations[0]!.n).toBe(1);
  });
});
