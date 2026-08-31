/* The Next chip's brain — the split ladder, one rung at a time. Each rung
   is pinned by the state that unlocks it, because the chip's whole job is
   never going silent while something is owed (the motivating bug: a real
   design stalled for hours between "outdoor placed" and "indoor placed"). */

import { itemsToPlace, nextMove, panelRests, unitsVerb } from "../next-move";
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

/* The Units verb on the bar: one press whose meaning follows the state —
   browse when nothing is chosen, arm whichever unit is off the plan, browse
   again as a swap once both are down. */
describe("unitsVerb — the Units button's meaning", () => {
  it("says nothing without a system, or for a type whose flow is still in the panel", () => {
    expect(unitsVerb(doc([]), pack(), null)).toBeNull();
    expect(unitsVerb(doc([], {}, "multi-split"), pack(), "sys1")).toBeNull();
  });

  it("is off, with the reason, until a room exists", () => {
    expect(unitsVerb(doc([]), pack(), "sys1")).toEqual({
      kind: "off",
      reason: "draw a room first",
    });
  });

  it("browses on the lens room while no pair is chosen", () => {
    expect(unitsVerb(doc([room("r1", "Bedroom")]), pack(), "sys1")).toEqual({
      kind: "browse",
      roomId: "r1",
    });
    // the lens follows settings.roomId when several rooms are served
    const d = doc([room("r1", "Bedroom"), room("r2", "Study")], { roomId: "r2" });
    expect(unitsVerb(d, pack(), "sys1")).toEqual({ kind: "browse", roomId: "r2" });
  });

  /* It used to ARM the next unplaced unit here, which put placing in two
     places and — worse — made the browser UNREACHABLE between choosing a pair
     and getting both units down: the press armed, a second press disarmed, and
     nothing reached the modal. Placement is the Items-to-place tray's alone
     now (Isaac, 2026-08-25). */
  it("still browses with a pair chosen and nothing placed", () => {
    expect(unitsVerb(doc([room("r1", "Bedroom")], PAIR), pack(), "sys1")).toEqual({
      kind: "browse",
      roomId: "r1",
    });
  });

  it("still browses mid-placement, with one unit down", () => {
    const d = doc([room("r1", "Bedroom"), unit("u1", "idu", "IDU-25")], PAIR);
    expect(unitsVerb(d, pack(), "sys1")).toEqual({ kind: "browse", roomId: "r1" });
  });

  it("needs no pack — it opens a modal, it does not size a ghost", () => {
    expect(unitsVerb(doc([room("r1", "Bedroom")], PAIR), null, "sys1")).toEqual({
      kind: "browse",
      roomId: "r1",
    });
  });

  it("becomes a swap once both are placed, ranked on the room the unit serves", () => {
    const placed = [
      room("r1", "Bedroom"),
      room("r2", "Study"),
      { ...unit("u1", "idu", "IDU-25"), props: { role: "idu", model: "IDU-25", roomId: "r2" } },
      unit("u2", "odu", "ODU-25"),
    ];
    expect(unitsVerb(doc(placed, PAIR), pack(), "sys1")).toEqual({
      kind: "browse",
      roomId: "r2",
    });
    // an unattributed unit falls back to the lens
    const loose = [room("r1", "Bedroom"), unit("u1", "idu", "IDU-25"), unit("u2", "odu", "ODU-25")];
    expect(unitsVerb(doc(loose, PAIR), pack(), "sys1")).toEqual({
      kind: "browse",
      roomId: "r1",
    });
  });
});

/* The panel's two sizes: the FLOW picks. Rests through the room phase, opens
   from pair choice until both units are down, rests again after — and only
   split rests at all until other modules move their arming to the bar. */
describe("panelRests — when the flow lets the cockpit rest", () => {
  it("never rests without a system (the type chooser IS the panel)", () => {
    expect(panelRests(doc([]), null)).toBe(false);
    expect(panelRests(doc([]), "nope")).toBe(false);
  });

  it("never rests for types whose flow still works from the panel", () => {
    expect(panelRests(doc([room("r1", "Bedroom")], {}, "multi-split"), "sys1")).toBe(false);
  });

  it("rests through the room phase — before and after rooms exist", () => {
    expect(panelRests(doc([]), "sys1")).toBe(true);
    expect(panelRests(doc([room("r1", "Bedroom")]), "sys1")).toBe(true);
  });

  it("opens from pair choice until both units are placed", () => {
    expect(panelRests(doc([room("r1", "Bedroom")], PAIR), "sys1")).toBe(false);
    expect(
      panelRests(doc([room("r1", "Bedroom"), unit("u1", "idu", "IDU-25")], PAIR), "sys1")
    ).toBe(false);
  });

  it("rests again once everything is down — connect is the chip's story", () => {
    const placed = [room("r1", "Bedroom"), unit("u1", "idu", "IDU-25"), unit("u2", "odu", "ODU-25")];
    expect(panelRests(doc(placed, PAIR), "sys1")).toBe(true);
  });
});

/* Items to place — the tray's list. The invariant that matters: an item is
   owed until the thing it names is actually ON THE PLAN, and for a per-room
   indoor unit "on the plan" means stamped to THAT room, not merely existing
   somewhere on the system. */
describe("itemsToPlace", () => {
  /** a placed indoor unit attributed to a room (the per-room stamp) */
  const iduIn = (id: string, model: string, roomId: string): DesignObject => ({
    ...unit(id, "idu", model),
    props: { role: "idu", model, roomId },
  });

  it("has nothing to place before anything is chosen", () => {
    expect(itemsToPlace(doc([room("r1", "Lounge")]), pack(), "sys1")).toEqual([]);
  });

  it("offers a chosen pair's two units, the indoor one named for its room", () => {
    const items = itemsToPlace(
      doc([room("r1", "Lounge")], { ...PAIR, roomId: "r1" }),
      pack(),
      "sys1"
    );
    expect(items.map((i) => [i.role, i.model, i.roomName])).toEqual([
      ["idu", "IDU-25", "Lounge"],
      /* the outdoor serves the SYSTEM — naming a room for it would be a lie */
      ["odu", "ODU-25", null],
    ]);
    /* armable to scale, straight from the pack */
    expect(items[0].placing).toEqual({
      role: "idu", model: "IDU-25", widthMm: 798, depthMm: 219,
    });
  });

  it("drops each unit from the list as it lands on the plan", () => {
    const settings = { ...PAIR, roomId: "r1" };
    const half = itemsToPlace(
      doc([room("r1", "Lounge"), iduIn("u1", "IDU-25", "r1")], settings),
      pack(),
      "sys1"
    );
    expect(half.map((i) => i.role)).toEqual(["odu"]);
    const done = itemsToPlace(
      doc(
        [room("r1", "Lounge"), iduIn("u1", "IDU-25", "r1"), unit("u2", "odu", "ODU-25")],
        settings
      ),
      pack(),
      "sys1"
    );
    expect(done).toEqual([]);
  });

  it("per-room: one item per assigned room, and a room keeps its own", () => {
    const d = doc(
      [room("r1", "Lounge"), room("r2", "Study"), iduIn("u1", "IDU-25", "r1")],
      { multiIdus: { r1: "IDU-25", r2: "IDU-25" } },
      "multi-split"
    );
    const items = itemsToPlace(d, pack(), "sys1");
    /* r1 is served, so only r2 is still owed — the placed unit must NOT
       satisfy the whole system, which is the bug a system-wide check makes */
    expect(items.map((i) => [i.roomId, i.roomName])).toEqual([["r2", "Study"]]);
    /* and the two rooms' items carry distinct keys even on the same model */
    const both = itemsToPlace(
      doc([room("r1", "Lounge"), room("r2", "Study")], { multiIdus: { r1: "IDU-25", r2: "IDU-25" } }, "multi-split"),
      pack(),
      "sys1"
    );
    expect(new Set(both.map((i) => i.key)).size).toBe(2);
  });

  it("waits for the catalogue rather than guessing a size", () => {
    /* no pack: a unit armed at a made-up size would drop a wrong-scale ghost
       on the plan, so the tray stays empty until the dimensions are real */
    expect(
      itemsToPlace(doc([room("r1", "Lounge")], { ...PAIR, roomId: "r1" }), null, "sys1")
    ).toEqual([]);
    /* a model the pack has never heard of is skipped, not faked */
    expect(
      itemsToPlace(
        doc([room("r1", "Lounge")], { pairIdu: "GHOST-1", pairOdu: "ODU-25", roomId: "r1" }),
        pack(),
        "sys1"
      ).map((i) => i.model)
    ).toEqual(["ODU-25"]);
  });
});
