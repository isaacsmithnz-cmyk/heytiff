/* What each supply outlet is (outlets.ts; Isaac, 2026-10-28: "circular …
   linear … grills", and linears "1500 long and 150 high"): square where
   every outlet starts, round, or a linear bar grille at a stock length and
   height; marked when its size is too small for its air, and named on the
   sheet the way the price book names them. */

import { createDesign } from "../document";
import { outletName, outletPicks, outletSpec, setOutletPick, snapLength } from "../outlets";

const along = { x: 1, y: 0 };

describe("an outlet as made", () => {
  it("starts square, at the neck the room's air gives it", () => {
    expect(outletSpec(undefined, 101, 250, along)).toEqual({
      kind: "square",
      neckMm: 250,
      lengthMm: null,
      heightMm: null,
      along: null,
      over: false,
    });
  });

  it("a round or square neck picked too small for its air is marked: Ø200 carries 94 L/s at 3 m/s", () => {
    expect(outletSpec({ kind: "round", neckMm: 200 }, 90, 250, along)).toMatchObject({ kind: "round", neckMm: 200, over: false });
    expect(outletSpec({ kind: "round", neckMm: 200 }, 101, 250, along)).toMatchObject({ over: true });
  });

  it("a linear is 1200 × 150 along its room until drawn or picked, marked over 2 m/s across its face", () => {
    expect(outletSpec({ kind: "linear" }, 101, 250, along)).toMatchObject({ lengthMm: 1200, heightMm: 150, along, neckMm: 250, over: false });
    // 600 × 100 is 0.06 m²: 2 m/s takes 120 L/s
    expect(outletSpec({ kind: "linear", lengthMm: 600, heightMm: 100 }, 119, 250, along).over).toBe(false);
    expect(outletSpec({ kind: "linear", lengthMm: 600, heightMm: 100 }, 121, 250, along).over).toBe(true);
  });

  it("is named as the price book names it, by its size", () => {
    expect(outletName(outletSpec(undefined, 101, 250, along))).toBe("Square diffuser, 250 neck");
    expect(outletName(outletSpec({ kind: "round" }, 63, 200, along))).toBe("Round diffuser, 200 neck");
    expect(outletName(outletSpec({ kind: "linear", lengthMm: 1500 }, 101, 250, along))).toBe("Linear bar grille 1500 × 150");
  });

  it("a drawn length snaps to the nearest stock length", () => {
    expect(snapLength(1550)).toBe(1500);
    expect(snapLength(200)).toBe(600);
    expect(snapLength(9000)).toBe(3000);
  });
});

describe("the pick, on the system", () => {
  it("is kept by the outlet's key, merged, and a field set to undefined goes back to the default", () => {
    const doc = createDesign({ name: "x", mode: "blank" });
    doc.systems.push({ id: "s1", name: "S", type: "ducted", settings: {} } as never);
    let d = setOutletPick(doc, "s1", "u/r/0", { kind: "linear", heightMm: 200 });
    d = setOutletPick(d, "s1", "u/r/0", { lengthMm: 1800 });
    expect(outletPicks(d.systems[0])).toEqual({ "u/r/0": { kind: "linear", heightMm: 200, lengthMm: 1800 } });
    d = setOutletPick(d, "s1", "u/r/0", { heightMm: undefined });
    expect(outletPicks(d.systems[0])).toEqual({ "u/r/0": { kind: "linear", lengthMm: 1800 } });
  });

  it("ignores what it cannot read", () => {
    const sys = { settings: { ductOutlet: { a: { kind: "hex", neckMm: -1 }, b: "no", c: { along: { x: 0, y: 3 } } } } } as never;
    expect(outletPicks(sys)).toEqual({ a: {}, c: { along: { x: 0, y: 1 } } });
  });
});
