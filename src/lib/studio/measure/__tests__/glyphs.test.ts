import { DRAWN, strokeText } from "../glyphs";

describe("numbers drawn as strokes", () => {
  it("draws every digit and x and y, as paths with no type", () => {
    expect(DRAWN.sort()).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "x", "y"]);
    const svg = strokeText("x12", 100, 50, 20, "#a21caf");
    expect(svg).toContain('data-text="x12"');
    expect(svg.match(/<path/g)).toHaveLength(6); /* three glyphs, halo and ink */
    expect(svg).not.toMatch(/<text|font/);
  });
  it("is centred on x, the wider the longer", () => {
    const at = (svg: string) => Number(/translate\(([\d.-]+),/.exec(svg)![1]);
    expect(at(strokeText("x1", 100, 50, 20, "#000"))).toBeCloseTo(100 - 0.7 * 20, 0);
    expect(at(strokeText("x12", 100, 50, 20, "#000"))).toBeLessThan(at(strokeText("x1", 100, 50, 20, "#000")));
  });
  it("leaves out what it can't draw, and draws nothing for nothing", () => {
    expect(strokeText("x<3>", 0, 0, 10, "#000")).toContain('data-text="x3"');
    expect(strokeText("Bed", 0, 0, 10, "#000")).toBe("");
  });
});
