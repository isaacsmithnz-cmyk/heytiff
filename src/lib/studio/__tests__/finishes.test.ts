import { inside } from "../reading";
import { finishInside, roofFinishFor, roofFinishOf, stairFinishOf, surfaceFinishOf } from "../finishes";

describe("the closest standard finish to what a drawing writes", () => {
  it("names a roof", () => {
    expect(roofFinishOf("Colorbond Kliplock at 3 deg behind brick parapets")).toBe("metal");
    expect(roofFinishOf("Selected Custom Orb metal sheeting at 6.00°")).toBe("metal");
    expect(roofFinishOf("New concrete roof tiles over non-permeable foil sarking")).toBe("tiled");
    expect(roofFinishOf("RF-02 concrete canopy/planter roof with waterproof membrane")).toBe("flat");
    expect(roofFinishOf("Pitch is derived from the ridge")).toBeNull();
  });

  it("names a floor, a stair or a deck", () => {
    expect(surfaceFinishOf("HYBRID")).toBe("timber");
    expect(surfaceFinishOf("TILED TO OWNERS CHOICE")).toBe("tile");
    expect(surfaceFinishOf("CONCRETE")).toBe("concrete");
    expect(surfaceFinishOf("CARPET")).toBe("carpet");
    expect(surfaceFinishOf("NEW TIMBER STAIRS TO PART 11.2 AND")).toBe("timber");
  });

  it("leaves the frame and the walls out of it", () => {
    expect(surfaceFinishOf("PRE-PRIMED TIMBER POSTS AND BEAMS TO")).toBeNull();
    expect(surfaceFinishOf("110mm BRICK WALLING")).toBeNull();
  });
});

describe("a roof part's covering", () => {
  const bishops =
    "Existing main hip roof: tiles, retained (provisional sum to strip, re-sark and retile). Front verandah: metal sheet, to be replaced with Colorbond corrugated. New rear house roof RF-01: Colorbond Kliplock at 3 deg behind brick parapets.";

  it("takes the part's own note first", () => {
    expect(roofFinishFor({ source: "A100 RF-01 (new house main roof, Colorbond Kliplock at 3 deg)", existing: false }, bishops)).toBe("metal");
    expect(roofFinishFor({ source: "A100 RF-02 concrete canopy/planter roof with waterproof membrane", existing: false }, bishops)).toBe("flat");
  });

  it("else what the read says of the kept roof, or of the new one", () => {
    expect(roofFinishFor({ source: "A103 elevations (ridge RL 92300)", existing: true }, bishops)).toBe("tiled");
    expect(roofFinishFor({ source: "Sheet 7 Section BB", existing: false }, "New concrete roof tiles over foil sarking. The separate garage gets Colorbond.")).toBe("tiled");
  });

  it("claims nothing the drawings don't say", () => {
    expect(roofFinishFor({ source: "Sheet 7 roof plan (dashed hip lines)", existing: true }, "New roof: Klip-Lok metal deck at 2°. The existing front hipped roof's material is not stated.")).toBeNull();
  });
});

describe("the plan's own words", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  it("finds a room's finish written inside it, and not one outside", () => {
    expect(finishInside([{ text: "HYBRID", at: { x: 50, y: 50 } }], square, inside)).toBe("timber");
    expect(finishInside([{ text: "TILES", at: { x: 150, y: 50 } }], square, inside)).toBeNull();
  });

  it("gives the stairs a note that names them", () => {
    expect(stairFinishOf([{ text: "BRICK VENEER WALLING", at: { x: 0, y: 0 } }, { text: "NEW TIMBER STAIRS TO PART 11.2 AND", at: { x: 9, y: 9 } }])).toBe("timber");
    expect(stairFinishOf([{ text: "TILES", at: { x: 0, y: 0 } }])).toBeNull();
  });
});
