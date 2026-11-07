import { ductLabel, ductPaint, plenumInkOf, ribDash, supplyInkOf } from "../duct-size";
import type { DesignObject } from "../document";

const duct = (props: Record<string, unknown>) => ({ id: "d", type: "duct-run", props }) as unknown as DesignObject;

describe("a duct's colour is its size", () => {
  it.each([
    [400, "#A855F7"],
    [350, "#F5F5F4"],
    [300, "#22C55E"],
    [250, "#FACC15"],
    [200, "#2563EB"],
    [150, "#EC4899"],
  ])("Ø%i is its own colour", (dia, body) => {
    expect(ductPaint(dia).body).toBe(body);
  });

  it.each([100, 450, 500, 375])("Ø%i, off the list, is black with white ribs", (dia) => {
    expect(ductPaint(dia)).toEqual({ body: "#050505", edge: "#050505", rib: "#FFFFFF" });
  });

  it("the whitey 14 inch still has a wall to see on white paper", () => {
    expect(ductPaint(350).edge).toBe("#4B5563");
  });
});

describe("its small label", () => {
  it("is the size and the length", () => {
    expect(ductLabel({ diaMm: 400, stream: "supply" }, 5.43)).toBe("Ø400, 5.4 m");
  });
  it("says return, since colour no longer does", () => {
    expect(ductLabel({ diaMm: 400, stream: "return" }, 5.43)).toBe("Ø400 return, 5.4 m");
  });
  it("is the size alone on a plan with no scale", () => {
    expect(ductLabel({ diaMm: 300 }, null)).toBe("Ø300");
  });
});

describe("ribs", () => {
  it("are 100 mm apart on the plan", () => {
    expect(ribDash(10, 1)).toBe("2 8");
  });
  it("go when they would be a smear", () => {
    expect(ribDash(10, 0.2)).toBeNull();
  });
});

describe("what takes a duct's colour", () => {
  const onGrille = { kind: "grille", id: "g1" };

  it("a grille's supply side, from the duct on it", () => {
    expect(supplyInkOf([duct({ form: "flex", diaMm: 300, endAttach: onGrille })], "g1")).toBe("#15803D");
  });
  it("not from a return duct, a duct with no form or another grille's duct", () => {
    expect(supplyInkOf([duct({ form: "flex", stream: "return", diaMm: 300, endAttach: onGrille })], "g1")).toBeNull();
    expect(supplyInkOf([duct({ diaMm: 300, endAttach: onGrille })], "g1")).toBeNull();
    expect(supplyInkOf([duct({ form: "flex", diaMm: 300, endAttach: { kind: "grille", id: "g2" } })], "g1")).toBeNull();
  });
  it("a plenum its ducts made, from the biggest of them; a placed plenum keeps its own", () => {
    expect(plenumInkOf({ fromDucts: true, spigots: [{ diaMm: 300 }, { diaMm: 400 }] })).toBe("#7E22CE");
    expect(plenumInkOf({ spigots: [{ diaMm: 400 }] })).toBeNull();
  });
});
