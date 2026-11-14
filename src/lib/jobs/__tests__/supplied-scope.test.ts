import { drawingWords, emailSupplies, sheetNumbersOf, suppliedOf, suppliedPrompt, suppliedWords, SOURCE_WORDS_MAX } from "../supplied-scope";
import { scopeOf, scopePrompt } from "../job-scope";

const SUPPLIED = {
  lede: "Watershed Architects' tender set, Issue G.",
  systems: [{ area: "First floor", kind: "Ducted", text: "Two FXDQ40 and an FXDQ50 in the ceiling.", from: ["CD106"] }],
  fine: [{ text: "Refrigerant GWP 700 or under", from: "Spec 0702, page 180" }],
  notOurs: ["Existing lights"],
  clarify: [{ q: "Who ducts the rangehood?", who: "Architect" }],
};

describe("the supplied scope", () => {
  it("keeps what Tiff wrote, clamped, and nothing when it says nothing", () => {
    expect(suppliedOf(SUPPLIED)).toEqual(SUPPLIED);
    expect(suppliedOf({ lede: "", systems: [], fine: [] })).toBeNull();
    expect(suppliedOf(null)).toBeNull();
    expect(suppliedOf({ ...SUPPLIED, fine: [{ text: "", from: "x" }, { text: " Filters  G4 ", from: "p 180" }] })?.fine).toEqual([{ text: "Filters G4", from: "p 180" }]);
  });

  it("cuts a set of drawings to each sheet's air-side lines and title", () => {
    const words = drawingWords([
      { n: 6, lines: ["RCP - GROUND FLOOR", "CD105", "LI-10", "DAIKIN", "FXDQ25TV1C", "A/C GRILL", "SMOKE ALARM"] },
      { n: 12, lines: ["NORTH ELEVATION", "BRICK VENEER"] },
    ]);
    expect(words).toBe("[Drawings, page 6: RCP - GROUND FLOOR]\nDAIKIN\nFXDQ25TV1C\nA/C GRILL");
  });

  it("counts an email as supplied when it's about the air side", () => {
    expect(emailSupplies("Watters - 6/40 Raglan St", "the floor plan and the engineer's report")).toBe(false);
    expect(emailSupplies("Grilles", "Please use Airfoil linear bar grilles for the air conditioning")).toBe(true);
  });

  it("hands Tiff the newest sources first, to a limit", () => {
    const big = "x".repeat(SOURCE_WORDS_MAX);
    const prompt = suppliedPrompt({ client: "JT Construct", site: "7 Cutler Rd", sources: [{ id: "a", at: "2", kind: "email", label: "JT's email", words: big }, { id: "b", at: "1", kind: "spec", label: "The spec", words: "late" }] });
    expect(prompt).toContain("Client: JT Construct");
    expect(prompt).toContain("JT's email");
    expect(prompt).not.toContain("late");
  });

  it("is said in a few lines for the quote", () => {
    expect(suppliedWords(SUPPLIED)).toBe(
      "Watershed Architects' tender set, Issue G.\nFirst floor: Ducted. Two FXDQ40 and an FXDQ50 in the ceiling. (CD106)\nFine print: Refrigerant GWP 700 or under (Spec 0702, page 180)\nNot ours: Existing lights",
    );
  });
});

describe("the quoted scope against it", () => {
  it("marks a system that departs from the supplied one", () => {
    const brief = scopeOf({ lede: "Mitsubishi.", systems: [{ area: "First floor", kind: "VRF", text: "PUMY.", from: [], differs: true }, { area: "Subfloor", kind: "Ventilation", text: "Fan.", from: [], differs: false }], added: [], notOurs: [], clarify: [], updates: [], undoSaid: "" });
    expect(brief?.systems.map((s) => s.differs ?? false)).toEqual([true, false]);
  });

  it("hands the brief's writer the supplied scope", () => {
    const prompt = scopePrompt({ status: "Quote", clientName: "JT Construct", scope: null, workDone: null, lines: [], supplied: SUPPLIED });
    expect(prompt).toContain("The supplied scope, what the drawings, the specification and the emails asked for:");
    expect(prompt).toContain("Two FXDQ40 and an FXDQ50");
  });
});

describe("each sheet's own number, off its title block", () => {
  const at = (s: string, fx = 0.97, fy = 0.96, size = 15.6) => ({ s, fx, fy, size });

  it("reads the number in the spot where the set prints one on most sheets", () => {
    const pages = [
      [at("CD00", 0.85, 0.05, 11.7), at("CD101", 0.85, 0.08, 11.7)], // the cover's drawing list: no corner number
      [at("CD101"), at("CD204", 0.36, 0.84, 7)],
      [at("CD102"), at("CD204", 0.36, 0.84, 7)],
      [at("CD103"), at("DA10", 0.36, 0.84, 7)],
      [at("CD105"), at("LI-10", 0.05, 0.07, 8)],
    ];
    expect(sheetNumbersOf(pages)).toEqual([null, "CD101", "CD102", "CD103", "CD105"]);
  });

  it("never takes a tag that repeats in one spot for a sheet number", () => {
    const pages = [[at("D5", 0.8, 0.8)], [at("D5", 0.8, 0.8)], [at("D5", 0.8, 0.8)]];
    expect(sheetNumbersOf(pages)).toEqual([null, null, null]);
  });

  it("gives none where numbers wander from sheet to sheet", () => {
    const pages = [[at("BED 1", 0.62, 0.7)], [at("RL 17.28", 0.9, 0.65)], [at("S9", 0.7, 0.95)], [at("W3", 0.66, 0.9)]];
    expect(sheetNumbersOf(pages)).toEqual([null, null, null, null]);
  });

  it("puts the number in the sheet's heading for Tiff", () => {
    expect(drawingWords([{ n: 6, number: "CD105", lines: ["RCP - GROUND FLOOR", "DAIKIN"] }])).toBe("[Drawings, page 6, sheet CD105: RCP - GROUND FLOOR]\nDAIKIN");
  });
});
