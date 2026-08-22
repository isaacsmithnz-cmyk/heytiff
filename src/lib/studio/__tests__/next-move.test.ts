/* The Next chip's brain — the split ladder, one rung at a time. Each rung
   is pinned by the state that unlocks it, because the chip's whole job is
   never going silent while something is owed (the motivating bug: a real
   design stalled for hours between "outdoor placed" and "indoor placed"). */

import { nextMove } from "../next-move";
import { createDesign, type DesignDocument, type DesignObject, type Floor } from "../document";
import { emptyPack, type DataPack, type IndoorUnit, type OutdoorUnit } from "../packs/schema";

const prov = { kind: "extracted" as const, source: "test" };

function pack(): DataPack {
  const p = emptyPack({ brand: "me", version: "1", packSchemaVersion: 1, name: "t" });
  p.indoor_units.push({
    model: "IDU-25", brand: "me", series: "T", form_factor: "wall",
    capacity_cool_kw: 2.5, capacity_heat_kw: 3,
    conn_liquid_mm: 6.35, conn_gas_mm: 9.52,
    default_plane: "room", allowed_planes: ["room"],
    system_roles: ["split-pair"], refrigerant: "R32",
    width_mm: 798, depth_mm: 219, height_mm: 299, provenance: prov,
  } as IndoorUnit);
  p.outdoor_units.push({
    model: "ODU-25", brand: "me", series: "T", system_type: "split",
    capacity_cool_kw: 2.5, capacity_heat_kw: 3, phase: "1",
    conn_liquid_mm: 6.35, conn_gas_mm: 9.52, refrigerant: "R32",
    width_mm: 800, depth_mm: 285, height_mm: 550, provenance: prov,
  } as OutdoorUnit);
  return p;
}

const floor: Floor = {
  id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10,
  northDeg: null, northPos: null, plans: [],
};

const room = (id: string, name: string): DesignObject => ({
  id, type: "room", systemId: "sys1", floorId: "flr",
  geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] },
  plane: "room", props: { name },
});

const unit = (id: string, role: "idu" | "odu", model: string): DesignObject => ({
  id, type: "unit", systemId: "sys1", floorId: "flr",
  geometry: { kind: "point", at: { x: 50, y: 50 } },
  plane: role === "odu" ? "external-ground" : "room",
  props: { role, model },
});

const run = (a: string, b: string | null): DesignObject => ({
  id: `run-${a}-${b ?? "loose"}`, type: "pipe-run", systemId: "sys1", floorId: "flr",
  geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
  plane: "room",
  props: { startAttach: { id: a }, ...(b ? { endAttach: { id: b } } : {}) },
});

function doc(
  objects: DesignObject[],
  settings: Record<string, unknown> = {},
  type: "split" | "multi-split" = "split"
): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-08-22T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [{ id: "sys1", type, brand: "me", colour: "#2E68FF", name: "System 1", settings }];
  d.objects = objects;
  return d;
}

const PAIR = { pairIdu: "IDU-25", pairOdu: "ODU-25" };

describe("nextMove — the split ladder", () => {
  it("says nothing without a system, and nothing for types whose module hasn't declared a ladder", () => {
    expect(nextMove(doc([]), pack(), null)).toBeNull();
    expect(nextMove(doc([], {}, "multi-split"), pack(), "sys1")).toBeNull();
  });

  it("starts at the first room", () => {
    expect(nextMove(doc([]), pack(), "sys1")).toEqual({
      key: "draw-room",
      label: "Draw the first room",
    });
  });

  it("asks for a unit once a room exists, named after the pair's room", () => {
    const move = nextMove(doc([room("r1", "Bedroom")]), pack(), "sys1");
    expect(move).toEqual({
      key: "choose-pair",
      label: "Choose a unit for Bedroom",
      roomId: "r1",
    });
  });

  it("follows settings.roomId when several rooms are served", () => {
    const d = doc([room("r1", "Bedroom"), room("r2", "Study")], { roomId: "r2" });
    expect(nextMove(d, pack(), "sys1")).toMatchObject({
      key: "choose-pair",
      label: "Choose a unit for Study",
      roomId: "r2",
    });
  });

  it("arms the indoor unit with the pack's dimensions once the pair is chosen", () => {
    const d = doc([room("r1", "Bedroom")], PAIR);
    expect(nextMove(d, pack(), "sys1")).toEqual({
      key: "place-idu",
      label: "Place the indoor unit in Bedroom",
      placing: { role: "idu", model: "IDU-25", widthMm: 798, depthMm: 219 },
    });
  });

  it("says nothing while the pack is still loading — never a dead button", () => {
    const d = doc([room("r1", "Bedroom")], PAIR);
    expect(nextMove(d, null, "sys1")).toBeNull();
  });

  it("moves to the outdoor unit once the indoor is down", () => {
    const d = doc([room("r1", "Bedroom"), unit("u1", "idu", "IDU-25")], PAIR);
    expect(nextMove(d, pack(), "sys1")).toEqual({
      key: "place-odu",
      label: "Place the outdoor unit",
      placing: { role: "odu", model: "ODU-25", widthMm: 800, depthMm: 285 },
    });
  });

  it("asks for the run while the pair isn't plumbed — a run touching one end doesn't count", () => {
    const placed = [room("r1", "Bedroom"), unit("u1", "idu", "IDU-25"), unit("u2", "odu", "ODU-25")];
    expect(nextMove(doc(placed, PAIR), pack(), "sys1")).toEqual({
      key: "connect",
      label: "Connect the pair",
    });
    expect(nextMove(doc([...placed, run("u1", null)], PAIR), pack(), "sys1")).toMatchObject({
      key: "connect",
    });
  });

  it("completes when a run attaches both units", () => {
    const d = doc(
      [room("r1", "Bedroom"), unit("u1", "idu", "IDU-25"), unit("u2", "odu", "ODU-25"), run("u1", "u2")],
      PAIR
    );
    expect(nextMove(d, pack(), "sys1")).toMatchObject({ key: "complete" });
  });
});
