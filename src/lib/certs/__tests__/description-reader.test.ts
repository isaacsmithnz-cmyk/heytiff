import { mergeDescriptionReading } from "../description-reader";
import { readQuote } from "../quote";
import * as jobs from "./fixtures/jobs";
import reads from "./fixtures/description-reads.json";

/* Tiff's reading of a job's description, laid beside the rule reader's.
   The replies are Opus's own (claude-opus-5-5, effort medium, 2026-10-05),
   recorded so no test calls a model. The first four are the quotes the rule
   reader got wrong and was not given more rules for (quote.test.ts). */

type Job = keyof typeof reads;
const read = (job: Job) => mergeDescriptionReading(reads[job], readQuote(jobs[job]));
const rows = (q: ReturnType<typeof read>) =>
  q.systems.map((s) => ({
    outdoor: [s.outdoor.model, s.outdoor.capacityKw, s.outdoor.location],
    indoors: s.indoors.map((r) => [r.qty, r.model, r.capacityKw, r.location]),
  }));

describe("the held quotes", () => {
  it("2933: the Daikin models without their asterisks, the roof, and the bathroom fan by name", () => {
    const q = read("JOB_2933");
    expect(rows(q)[0].outdoor).toEqual(["RZQ250LY1", 24, "Roof"]);
    expect(rows(q)[0].indoors.map((r) => r.slice(0, 3))).toEqual([[1, "FDYQN250LBV1", 24]]);
    expect(q.fans.map((f) => [f.qty, f.model, f.location])).toEqual([[1, "200mm Silent Series", "Bathroom"]]);
    expect([q.ductwork, q.ventilation]).toEqual([true, true]);
  });

  it("2207: the VRF's three ducted indoor units, by the rooms they serve, with no kW made up", () => {
    expect(rows(read("JOB_2207"))).toEqual([
      {
        outdoor: ["", 15.5, ""],
        indoors: [
          [1, "63 VMHS", null, "First floor bedrooms"],
          [1, "32 VMX", null, "Ground floor guest bedroom/office"],
          [1, "63 VMX", null, "Kitchen and living room"],
        ],
      },
    ]);
  });

  it("1930: the bold room headings, not \"Return air located in hallway\"", () => {
    const q = read("JOB_1930");
    expect(q.systems.map((s) => [s.outdoor.capacityKw, s.indoors.map((r) => r.location)])).toEqual([
      [10, ["Main House"]],
      [3.5, ["Master Bedroom"]],
      [5, ["Pool Room"]],
    ]);
    expect(q.systems.every((s) => s.outdoor.location === "")).toBe(true);
  });

  it("2147: \"final agreed location\" and an optional roof say nothing about where the outdoor unit is", () => {
    const q = read("JOB_2147");
    expect(q.systems.flatMap((s) => s.indoors).reduce((n, r) => n + r.qty, 0)).toBe(4);
    expect(q.systems.map((s) => s.outdoor.location)).toEqual(q.systems.map(() => ""));
  });
});

describe("the golden jobs, read again", () => {
  it("279: the VRF on the bottom level and the Lossnay", () => {
    const q = read("JOB_279");
    expect(rows(q)[0].outdoor).toEqual(["PUHY-P400YNW", 40, "Bottom level"]);
    expect(q.systems[0].indoors.reduce((n, r) => n + r.qty, 0)).toBe(8);
    expect(q.fans.map((f) => f.model)).toEqual(["Lossnay"]);
  });

  it("3326: the roof is where the piping runs, not where the outdoor unit is", () => {
    expect(rows(read("JOB_3326"))).toEqual([{ outdoor: ["MUZ-AP42VGD2-A2", 4.2, ""], indoors: [[1, "MSZ-AP42VGKD2-A2", 4.2, ""]] }]);
  });

  it("2043: the reinstalled underfloor system as well as the VRF, and every fan", () => {
    const q = read("JOB_2043");
    expect(q.systems.map((s) => s.outdoor.capacityKw)).toEqual([null, 15.5]);
    expect(q.fans.reduce((n, f) => n + f.qty, 0)).toBe(8);
  });

  it("1383: the quote's own connected total stays the rule reader's", () => {
    expect(read("JOB_1383").statedConnectedKw).toBe(29);
  });

  it("2699: fire rated, said once in passing", () => {
    expect(read("JOB_2699").fireRated).toBe(true);
  });
});

describe("laying the reading beside the rules", () => {
  const rules = readQuote(jobs.JOB_2699);

  it("a yes from the rules stands when the model passed it over", () => {
    const q = mergeDescriptionReading({ ...reads.JOB_2699, fireRated: false, ductwork: false }, { ...rules, fireRated: true, ductwork: true });
    expect([q.fireRated, q.ductwork]).toEqual([true, true]);
  });

  it("the refrigerant is the model's, else the rules', and every circuit carries it", () => {
    expect(mergeDescriptionReading({ ...reads.JOB_2699, refrigerant: "" }, { ...rules, refrigerant: "R32" }).refrigerant).toBe("R32");
    const q = mergeDescriptionReading({ ...reads.JOB_2699, refrigerant: "r410a" }, rules);
    expect([q.refrigerant, ...q.systems.map((s) => s.test.refrigerant)]).toEqual(["R410A", "R410A"]);
  });

  it("a reading with no units where the rules found some keeps the rules' units", () => {
    const q = mergeDescriptionReading({ systems: [], fans: [] }, rules);
    expect(q.systems).toEqual(rules.systems);
  });

  it("anything malformed is read as not said, never thrown", () => {
    const q = mergeDescriptionReading(
      { systems: [{ outdoor: { qty: -2, model: 7, capacityKw: "big", location: null }, indoors: "x" }], fans: [null], refrigerant: "freon" },
      readQuote(""),
    );
    expect(q.systems).toEqual([{ outdoor: { location: "", model: "", qty: 1, capacityKw: null, serial: "" }, indoors: [], test: { refrigerant: "", addedKg: null } }]);
    expect(q.fans.map((f) => [f.qty, f.model])).toEqual([[1, ""]]);
    expect(mergeDescriptionReading(null, readQuote("")).systems).toEqual([]);
  });
});
