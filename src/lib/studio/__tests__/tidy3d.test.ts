import type { Floor3D, Opening3D, Space3D, XZ } from "../scene3d";
import { clipOut, snapOpenings, waysIn } from "../tidy3d";

/* The 3D made tidy (Isaac, 9 November 2026: "staircases going into walls,
   rooms going to nowhere, doors going to nowhere"): doors and windows onto
   their walls, no wall where the plan has none, and a way into every room. */

const rect = (x0: number, z0: number, x1: number, z1: number): XZ[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
const room = (name: string, pts: XZ[], kind: Space3D["kind"] = "room"): Space3D => ({ name, kind, pts, existing: false });
const opening = (kind: "door" | "window", a: XZ, b: XZ, external = false): Opening3D => ({ kind, a, b, external, sill: kind === "door" ? 0 : 0.9, head: 2.1 });
const floor = (spaces: Space3D[], openings: Opening3D[] = []): Floor3D => ({ id: "f", name: "Ground", level: 0, y0: 0, ceiling: 2.7, spaces, openings, read: true, tiles: [], pieces: [], stairs: [] });
/** an open stretch lies along this line, between these two points along it */
const opens = (f: Floor3D, along: "x" | "z", at: number, from: number, to: number) =>
  (f.open ?? []).some(([a, b]) => {
    const [i, j] = along === "x" ? [0, 1] : [1, 0];
    return Math.abs(a[j] - at) < 0.02 && Math.abs(b[j] - at) < 0.02 && Math.min(a[i], b[i]) <= from + 0.15 && Math.max(a[i], b[i]) >= to - 0.15;
  });

describe("doors and windows onto their walls", () => {
  it("moves a window read on the outside face of a wall onto the room's wall", () => {
    const bed = room("Bed", rect(0, 0, 4, 4));
    const [w] = snapOpenings([bed], [opening("window", [1, -0.3], [2.5, -0.3], true)]);
    expect(w.a).toEqual([1, 0]);
    expect(w.b).toEqual([2.5, 0]);
  });

  it("moves one read 0.6 m inside an outside wall out onto it (6 Bishops Ave)", () => {
    const living = room("Living", rect(0, 0, 6, 5));
    const [w] = snapOpenings([living], [opening("window", [0.6, 1], [0.6, 2.5], true)]);
    expect(w.a).toEqual([0, 1]);
  });

  it("cuts the far face of a thick wall too, and draws its door once", () => {
    const hall = room("Hall", rect(0, 0, 4, 1.2), "circulation");
    const bed = room("Bed", rect(0, 1.6, 4, 5));
    const out = snapOpenings([hall, bed], [opening("door", [1, 1.2], [1.8, 1.2])]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ a: [1, 1.2], b: [1.8, 1.2] });
    expect(out[1]).toMatchObject({ a: [1, 1.6], b: [1.8, 1.6], echo: true });
  });

  it("leaves one that's on its wall, and one near no wall, where they are", () => {
    const bed = room("Bed", rect(0, 0, 4, 4));
    const on = opening("door", [1, 4], [1.8, 4]);
    const far = opening("door", [10, 10], [11, 10]);
    expect(snapOpenings([bed], [on, far])).toEqual([on, far]);
  });
});

describe("no wall where the plan has none", () => {
  /* 4/48 Avoca St: the entry runs into the living, their outlines meeting */
  it("opens where the hall and the living meet edge to edge", () => {
    const f = floor([room("Entry", rect(0, 0, 3, 1), "circulation"), room("Living / Dining", rect(3, -1, 8, 3))]);
    waysIn(f);
    expect(opens(f, "z", 3, 0, 1)).toBe(true);
  });

  it("keeps the wall between a bedroom and the hall, though they meet edge to edge", () => {
    const f = floor([room("Hall", rect(0, 0, 6, 1.2), "circulation"), room("Bedroom 2", rect(0, 1.2, 4, 4))], [opening("door", [1, 1.2], [1.8, 1.2])]);
    waysIn(f);
    expect(opens(f, "x", 1.2, 0, 4)).toBe(false);
  });

  /* 27 Milroy Ave: the old hall drawn right up to the old rumpus it has a door into */
  it("keeps the wall where a door joins the two", () => {
    const f = floor([room("Entry Hall", rect(0, 0, 6, 1.2), "circulation"), room("Rumpus", rect(0, 1.2, 4, 4))], [opening("door", [1, 1.2], [1.8, 1.2])]);
    waysIn(f);
    expect(f.open ?? []).toEqual([]);
  });
});

describe("a way into every room", () => {
  const hall = () => room("Hall", rect(0, 0, 10, 1.2), "circulation");

  it("opens a kitchen with no door into the living beside it, through the wall's thickness", () => {
    const f = floor([room("Hall", rect(0, 0, 5, 1.2), "circulation"), room("Living", rect(0, 1.4, 5, 5)), room("Kitchen", rect(5.15, 1.4, 8, 5))], [opening("door", [1, 1.2], [2, 1.2])]);
    waysIn(f);
    /* both faces of the wall between them, but for its ends */
    expect(opens(f, "z", 5.15, 1.6, 4.8)).toBe(true);
    expect(opens(f, "z", 5, 1.6, 4.8)).toBe(true);
    /* with floor across the wall's thickness, so no slot shows between them */
    expect(f.bridges).toHaveLength(1);
    const xs = f.bridges![0].map(([x]) => x);
    expect(Math.min(...xs)).toBeCloseTo(5);
    expect(Math.max(...xs)).toBeCloseTo(5.15);
  });

  it("gives a bathroom with no door a door, off the hall, as wide as a door", () => {
    const f = floor([hall(), room("Bath", rect(2, 1.3, 4, 4), "wet")]);
    waysIn(f);
    const doors = f.openings.filter((o) => o.kind === "door" && !o.echo);
    expect(doors).toHaveLength(1);
    const [d] = doors;
    expect(Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1])).toBeCloseTo(0.82);
    expect(d.a[1]).toBeCloseTo(1.3);
    /* the hall's face, a hand's width off, is cut by the same door: no second one */
    expect(f.openings.filter((o) => o.echo)).toEqual([]);
  });

  it("gives a bedroom with no door a door, not an arch", () => {
    const f = floor([hall(), room("Bedroom 4", rect(2, 1.4, 6, 5))]);
    waysIn(f);
    expect(f.openings.filter((o) => o.kind === "door" && !o.echo)).toHaveLength(1);
    expect(f.open ?? []).toEqual([]);
  });

  it("opens a robe's front to the bedroom it's in, and a walk-in robe by a door's width", () => {
    const bed = room("Bed 1", rect(0, 0, 4, 4));
    const robe = room("Robe", rect(0, 4.1, 2.4, 4.7), "cupboard");
    const wir = room("WIR", rect(4.1, 0, 6, 2.5), "cupboard");
    const f = floor([bed, robe, wir], [opening("door", [1, 0], [1.8, 0], true)]);
    waysIn(f);
    /* the robe's whole front, less its ends */
    expect(opens(f, "x", 4.1, 0.2, 2.2)).toBe(true);
    /* the walk-in robe: 0.85 m in the middle of its side to the bedroom */
    const wirOpen = (f.open ?? []).filter(([a]) => Math.abs(a[0] - 4.1) < 0.02);
    expect(wirOpen).toHaveLength(1);
    expect(Math.abs(wirOpen[0][1][1] - wirOpen[0][0][1])).toBeCloseTo(0.85);
  });

  it("leaves a bin store opened from outside shut", () => {
    const f = floor([hall(), room("Bin Store Under Stair", rect(0, 1.3, 1.5, 2.5), "cupboard")]);
    waysIn(f);
    expect(f.open ?? []).toEqual([]);
    expect(f.openings).toEqual([]);
  });

  it("does nothing on a floor drawn from the zones", () => {
    const f = { ...floor([hall(), room("Bath", rect(2, 1.3, 4, 4), "wet")]), read: false };
    expect(waysIn(f)).toEqual([]);
    expect(f.openings).toEqual([]);
  });
});

describe("a wall stops at a flight of stairs", () => {
  const stair = rect(2, 0, 3, 4);

  it("where it would cross it", () => {
    expect(clipOut([0, 2], [5, 2], [stair])).toEqual([
      [
        [0, 2],
        [2, 2],
      ],
      [
        [3, 2],
        [5, 2],
      ],
    ]);
  });

  it("but not along its side", () => {
    expect(clipOut([2, 0], [2, 4], [stair])).toEqual([
      [
        [2, 0],
        [2, 4],
      ],
    ]);
  });
});
