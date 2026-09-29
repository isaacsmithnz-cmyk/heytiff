/* The Next chip's brain — the zones flow's ladder, one rung at a time. Each
   rung is pinned by the state that unlocks it, because the chip's whole job
   is never going silent while something is owed (the motivating bug: a real
   design stalled for hours between "outdoor placed" and "indoor placed"). */

import { nextMoveZones } from "../next-move";
import { claimZone, newSystem } from "../zones";
import { createDesign, type DesignDocument, type DesignObject, type Floor } from "../document";

const floor: Floor = {
  id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10,
  northDeg: null, northPos: null, plans: [],
};

const room = (id: string, name: string): DesignObject => ({
  id, type: "room", systemId: "sys1", floorId: "flr",
  geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] },
  plane: "room", props: { name },
});

/* THE ZONES FLOW'S CHIP says the step the system's card says, so the two
   agree: a system with no zone yet has no Build system on its card, only
   Add zones (Isaac, 2026-09-23) */
describe("nextMoveZones — the zones flow's chip", () => {
  const plan = (withZone: boolean): DesignDocument => {
    const d = createDesign({ name: "t", mode: "blank" });
    d.floors = [floor];
    d.objects = withZone ? [{ ...room("z1", "Zone 1"), systemId: null }] : [];
    return d;
  };

  it("draws a zone, then adds a system", () => {
    expect(nextMoveZones(plan(false), null)).toEqual({ key: "draw-room", label: "Draw a zone" });
    expect(nextMoveZones(plan(true), null)).toEqual({ key: "add-system", label: "Add a system" });
  });

  it("asks a system with no zone for its zones before asking to build it", () => {
    const made = newSystem(plan(true), "1");
    expect(nextMoveZones(made.doc, null)).toEqual({ key: "add-zones", label: "Add zones", systemId: made.systemId });
    const zoned = claimZone(made.doc, made.systemId, "z1");
    expect(nextMoveZones(zoned, null)).toEqual({ key: "build-system", label: "Build system", systemId: made.systemId });
  });
});
