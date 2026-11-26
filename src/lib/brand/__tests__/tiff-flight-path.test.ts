import fs from "node:fs";
import path from "node:path";
import { FLIGHT, flightAt } from "../tiff-flight-path";

/* The front page's 3D boomerang flies the app's own flight. The numbers live
   twice, in scripts/tiff-flight.mjs (which writes the app's keyframes) and in
   tiff-flight-path.ts (which the 3D reads live), so this holds them equal. */

const script = fs.readFileSync(path.join(process.cwd(), "scripts/tiff-flight.mjs"), "utf8");
const num = (re: RegExp) => {
  const m = re.exec(script);
  if (!m) throw new Error(`scripts/tiff-flight.mjs no longer has ${re}`);
  return m.slice(1).map(Number);
};

describe("the front page's boomerang flies the app's flight", () => {
  it("takes the script's numbers", () => {
    expect(num(/const HOME = \[(\d+), (\d+)\]/)).toEqual([...FLIGHT.HOME]);
    expect(num(/const C = \[(\d+), (\d+)\], R = (\d+), LIFT = (\d+)/)).toEqual([...FLIGHT.C, FLIGHT.R, FLIGHT.LIFT]);
    expect(num(/const FAR = ([\d.]+)/)).toEqual([FLIGHT.FAR]);
    expect(num(/const NEAR = ([\d.]+)/)).toEqual([FLIGHT.NEAR]);
    expect(num(/const TH0 = \((\d+) \* Math\.PI\)/)).toEqual([FLIGHT.TH0_DEG]);
    expect(num(/const OPEN_MS = (\d+)/)).toEqual([FLIGHT.OPEN_MS]);
    expect(num(/const SLOWER = ([\d.]+)/)).toEqual([FLIGHT.SLOWER]);
    expect(num(/const OPEN_TURNS = (\d+)/)).toEqual([FLIGHT.OPEN_TURNS]);
  });

  it("leaves her hand and comes home square, a whole number of turns later", () => {
    for (const f of [0, 1]) {
      const p = flightAt(f, 1.4);
      expect(Math.hypot(p.x, p.y, p.z)).toBeLessThan(1e-9);
    }
    expect(flightAt(0).spin).toBe(0);
    expect(flightAt(1).spin / (2 * Math.PI)).toBeCloseTo(FLIGHT.OPEN_TURNS, 9);
  });

  it("goes up and out to her top left, and further when it is thrown further", () => {
    const far = (reach: number) => {
      let left = 0, up = 0;
      for (let i = 0; i <= 200; i++) {
        const p = flightAt(i / 200, reach);
        left = Math.min(left, p.x);
        up = Math.min(up, p.y);
      }
      return { left, up };
    };
    const own = far(1), further = far(1.4);
    expect(own.left).toBeLessThan(-80);
    expect(own.up).toBeLessThan(-30);
    expect(further.left).toBeCloseTo(own.left * 1.4, 6);
  });

  it("never jumps: at sixty frames a second each step is a small share of the loop", () => {
    let prev = flightAt(0), worst = 0;
    for (let i = 1; i <= 96; i++) {
      const p = flightAt(i / 96);
      worst = Math.max(worst, Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z));
      prev = p;
    }
    expect(worst).toBeLessThan(FLIGHT.R / 4);
  });
});
