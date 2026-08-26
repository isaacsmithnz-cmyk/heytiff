/* Attached-run geometry maintenance (attach.ts) + open-time repair
   (normalizeDesign): moving a unit/riser must carry attached pipe endpoints,
   deletes must strip the refs, and opening a stranded document must repair
   it. Pure geometry — no pack needed. */

import type { DesignObject } from "../document";
import { createDesign, serializeDesign } from "../document";
import {
  deleteRoomWithContents,
  moveEndpointTo,
  pruneObjects,
  reconcileAttachedRuns,
  releaseRoomsFromSystems,
  removedRoomIds,
  roomMemberIds,
  stripAttachesTo,
  translateRoomWithContents,
} from "../attach";
import { normalizeDesign, openDesignJson } from "../migrations";
import { createNote } from "../notes";
import { buildSystemGraph } from "../graph";
import { polylineLength } from "../geometry";

/* ── builders (fixed ids — mirrors split.test.ts style) ── */

const pt = (x: number, y: number) => ({ x, y });

const unit = (id: string, x: number, y: number, type = "unit"): DesignObject => ({
  id,
  type,
  systemId: "sys_a",
  floorId: "flr_1",
  geometry: { kind: "point", at: { x, y } },
  plane: "room",
  props: type === "unit" ? { role: "idu", model: "M1" } : { group: "A" },
});

const run = (
  id: string,
  points: { x: number; y: number }[],
  startAttach: { kind: "unit" | "riser"; id: string } | null,
  endAttach: { kind: "unit" | "riser"; id: string } | null,
  type = "pipe-run"
): DesignObject => ({
  id,
  type,
  systemId: "sys_a",
  floorId: "flr_1",
  geometry: { kind: "polyline", points },
  plane: "room",
  props: {
    ...(startAttach ? { startAttach } : {}),
    ...(endAttach ? { endAttach } : {}),
  },
});

const ptsOf = (o: DesignObject) =>
  (o.geometry as { kind: "polyline"; points: { x: number; y: number }[] }).points;

/* ── moveEndpointTo ── */

describe("moveEndpointTo", () => {
  it("keeps a vertical final segment vertical (penultimate shifts x)", () => {
    // L-run: horizontal then vertical into the unit
    const out = moveEndpointTo([pt(0, 0), pt(100, 0), pt(100, 80)], "end", pt(140, 80));
    expect(out).toEqual([pt(0, 0), pt(140, 0), pt(140, 80)]);
  });

  it("keeps a horizontal final segment horizontal (penultimate shifts y)", () => {
    const out = moveEndpointTo([pt(0, 0), pt(0, 60), pt(90, 60)], "end", pt(90, 100));
    expect(out).toEqual([pt(0, 0), pt(0, 100), pt(90, 100)]);
  });

  it("handles the start end via reversal, preserving ortho", () => {
    const out = moveEndpointTo([pt(100, 80), pt(100, 0), pt(0, 0)], "start", pt(140, 80));
    expect(out).toEqual([pt(140, 80), pt(140, 0), pt(0, 0)]);
  });

  it("stretches a 2-point run without touching the far end", () => {
    const out = moveEndpointTo([pt(0, 0), pt(100, 0)], "end", pt(120, 50));
    expect(out).toEqual([pt(0, 0), pt(120, 50)]);
  });

  it("stretches plainly when the final segment was diagonal (legacy data)", () => {
    const out = moveEndpointTo([pt(0, 0), pt(50, 30), pt(90, 70)], "end", pt(100, 100));
    expect(out).toEqual([pt(0, 0), pt(50, 30), pt(100, 100)]);
  });

  it("drops a corner that collapses onto the endpoint, never below 2 points", () => {
    // endpoint moves onto the corner's adjusted position → bend disappears
    const collapsed = moveEndpointTo([pt(0, 0), pt(100, 0), pt(100, 80)], "end", pt(0, 80));
    expect(collapsed).toEqual([pt(0, 0), pt(0, 80)]);
    // a 2-point run collapsing entirely still keeps two points
    const tiny = moveEndpointTo([pt(0, 0), pt(100, 0)], "end", pt(0, 0));
    expect(tiny).toHaveLength(2);
  });

  it("returns the same reference when the endpoint is already in place", () => {
    const pts = [pt(0, 0), pt(100, 0)];
    expect(moveEndpointTo(pts, "end", pt(100, 0))).toBe(pts);
  });
});

/* ── reconcileAttachedRuns ── */

describe("reconcileAttachedRuns", () => {
  it("snaps the attached endpoint onto the moved unit", () => {
    const objects = [
      unit("u1", 0, 0),
      unit("u2", 100, 40), // already moved in the doc
      run("r1", [pt(0, 0), pt(100, 0)], { kind: "unit", id: "u1" }, { kind: "unit", id: "u2" }),
    ];
    const out = reconcileAttachedRuns(objects, new Set(["u2"]));
    expect(ptsOf(out[2])).toEqual([pt(0, 0), pt(100, 40)]);
    // unmoved start endpoint untouched
    expect(ptsOf(out[2])[0]).toEqual(pt(0, 0));
  });

  it("moves both endpoints when both ends attach to the same moved unit", () => {
    const objects = [
      unit("u1", 50, 50),
      run("r1", [pt(0, 0), pt(80, 0), pt(80, 60)], { kind: "unit", id: "u1" }, { kind: "unit", id: "u1" }),
    ];
    const out = reconcileAttachedRuns(objects, new Set(["u1"]));
    const pts = ptsOf(out[1]);
    expect(pts[0]).toEqual(pt(50, 50));
    expect(pts[pts.length - 1]).toEqual(pt(50, 50));
  });

  it("follows risers exactly like units", () => {
    const objects = [
      unit("rs1", 200, 10, "riser"),
      run("r1", [pt(0, 10), pt(150, 10)], null, { kind: "riser", id: "rs1" }),
    ];
    const out = reconcileAttachedRuns(objects, new Set(["rs1"]));
    expect(ptsOf(out[1])).toEqual([pt(0, 10), pt(200, 10)]);
  });

  it("reconciles duct-runs the same way", () => {
    const objects = [
      unit("u1", 60, 0),
      run("d1", [pt(0, 0), pt(30, 0)], null, { kind: "unit", id: "u1" }, "duct-run"),
    ];
    const out = reconcileAttachedRuns(objects, new Set(["u1"]));
    expect(ptsOf(out[1])).toEqual([pt(0, 0), pt(60, 0)]);
  });

  it("leaves runs with a missing referenced object untouched, ref preserved", () => {
    const objects = [
      run("r1", [pt(0, 0), pt(100, 0)], null, { kind: "unit", id: "gone" }),
    ];
    const out = reconcileAttachedRuns(objects, null);
    expect(out).toBe(objects);
    expect(out[0].props.endAttach).toEqual({ kind: "unit", id: "gone" });
  });

  it("is identity-preserving under the movedIds filter", () => {
    const objects = [
      unit("u1", 0, 0),
      unit("u2", 100, 0),
      run("r1", [pt(0, 0), pt(100, 0)], { kind: "unit", id: "u1" }, { kind: "unit", id: "u2" }),
    ];
    // some other object moved — nothing to do, same array back
    expect(reconcileAttachedRuns(objects, new Set(["elsewhere"]))).toBe(objects);
    // endpoints already in place — also identity
    expect(reconcileAttachedRuns(objects, null)).toBe(objects);
  });
});

/* ── stripAttachesTo ── */

describe("stripAttachesTo", () => {
  it("drops only refs to deleted ids, geometry untouched", () => {
    const objects = [
      unit("u1", 0, 0),
      run("r1", [pt(0, 0), pt(100, 0)], { kind: "unit", id: "u1" }, { kind: "unit", id: "u2" }),
    ];
    const out = stripAttachesTo(objects, new Set(["u2"]));
    expect(out[1].props.startAttach).toEqual({ kind: "unit", id: "u1" });
    expect(out[1].props.endAttach).toBeUndefined();
    expect(ptsOf(out[1])).toEqual([pt(0, 0), pt(100, 0)]);
  });

  it("returns the same reference when nothing matches", () => {
    const objects = [
      run("r1", [pt(0, 0), pt(100, 0)], { kind: "unit", id: "u1" }, null),
    ];
    expect(stripAttachesTo(objects, new Set(["unrelated"]))).toBe(objects);
  });
});

/* ── room moves: units travel with their room ── */

const room = (id: string, x: number, y: number, w: number, h: number): DesignObject => ({
  id,
  type: "room",
  systemId: "sys_a",
  floorId: "flr_1",
  geometry: {
    kind: "polygon",
    points: [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)],
  },
  plane: "room",
  props: { name: id },
});

const inRoom = (
  o: DesignObject,
  roomId: string,
  extra: Record<string, unknown> = {}
): DesignObject => ({ ...o, props: { ...o.props, roomId, ...extra } });

describe("roomMemberIds", () => {
  it("collects units stamped to the room — including roomLock-pinned ones", () => {
    const objects = [
      room("room1", 0, 0, 400, 300),
      inRoom(unit("u1", 0, 150), "room1"), // wall-mounted on the boundary
      inRoom(unit("u2", 390, 20), "room1", { roomLock: true }),
      inRoom(unit("u3", 900, 900), "room2"), // someone else's
      unit("odu1", 600, 150), // never stamped
      unit("rs1", 200, 10, "riser"),
    ];
    expect(roomMemberIds(objects, "room1")).toEqual(new Set(["u1", "u2"]));
  });

  it("is empty for a room with no stamped units", () => {
    expect(roomMemberIds([room("room1", 0, 0, 100, 100)], "room1")).toEqual(new Set());
  });
});

describe("translateRoomWithContents", () => {
  const scene = () => [
    room("room1", 0, 0, 400, 300),
    inRoom(unit("u1", 0, 150), "room1"), // wall-mounted IDU
    unit("odu1", 600, 150), // outside on the ground — stays put
    run("r1", [pt(0, 150), pt(600, 150)], { kind: "unit", id: "u1" }, { kind: "unit", id: "odu1" }),
  ];

  it("translates the polygon and member units; the attached run end follows", () => {
    const out = translateRoomWithContents(scene(), "room1", new Set(["u1"]), pt(50, 40));
    expect((out[0].geometry as { points: { x: number; y: number }[] }).points).toEqual([
      pt(50, 40),
      pt(450, 40),
      pt(450, 340),
      pt(50, 340),
    ]);
    expect((out[1].geometry as { at: { x: number; y: number } }).at).toEqual(pt(50, 190));
    // IDU→ODU run: the attached start rides the unit, the ODU end stays
    expect(ptsOf(out[3])).toEqual([pt(50, 190), pt(600, 150)]);
  });

  it("leaves non-members untouched by reference", () => {
    const objects = scene();
    const out = translateRoomWithContents(objects, "room1", new Set(["u1"]), pt(50, 40));
    expect(out[2]).toBe(objects[2]);
  });

  it("a run between two moved units translates rigidly", () => {
    const objects = [
      room("room1", 0, 0, 400, 300),
      inRoom(unit("u1", 0, 150), "room1"),
      inRoom(unit("u2", 400, 150), "room1"),
      run("r1", [pt(0, 150), pt(400, 150)], { kind: "unit", id: "u1" }, { kind: "unit", id: "u2" }),
    ];
    const out = translateRoomWithContents(objects, "room1", new Set(["u1", "u2"]), pt(-30, 25));
    expect(ptsOf(out[3])).toEqual([pt(-30, 175), pt(370, 175)]);
  });

  it("zero delta returns the same array reference", () => {
    const objects = scene();
    expect(translateRoomWithContents(objects, "room1", new Set(["u1"]), pt(0, 0))).toBe(objects);
  });
});

/* ── room deletes: what belongs to the room goes with it ── */

describe("deleteRoomWithContents", () => {
  const plenum = (id: string, unitId: string): DesignObject => ({
    id,
    type: "plenum",
    systemId: "sys_a",
    floorId: "flr_1",
    geometry: { kind: "point", at: pt(0, 0) },
    plane: "ceiling-cavity",
    props: { unitId, end: "supply" },
  });

  const scene = () => [
    room("room1", 0, 0, 400, 300),
    inRoom(unit("u1", 100, 150), "room1"), // the room's IDU
    plenum("pl1", "u1"), // fitted to that IDU
    unit("odu1", 700, 150), // outside — stays
    room("room2", 800, 0, 200, 200), // someone else's room
    inRoom(unit("u2", 850, 100), "room2"), // and its unit
    run("r1", [pt(100, 150), pt(700, 150)], { kind: "unit", id: "u1" }, { kind: "unit", id: "odu1" }),
  ];

  it("removes the room, its units and their plenums", () => {
    const out = deleteRoomWithContents(scene(), "room1");
    const ids = out.map((o) => o.id);
    expect(ids).not.toContain("room1");
    expect(ids).not.toContain("u1");
    expect(ids).not.toContain("pl1");
    // everything else survives
    expect(ids).toEqual(expect.arrayContaining(["odu1", "room2", "u2", "r1"]));
  });

  it("leaves the run drawn but drops the ref to the deleted unit", () => {
    const out = deleteRoomWithContents(scene(), "room1");
    const r = out.find((o) => o.id === "r1")!;
    expect(ptsOf(r)).toEqual([pt(100, 150), pt(700, 150)]); // geometry untouched
    expect(r.props.startAttach).toBeUndefined(); // u1 is gone
    expect(r.props.endAttach).toEqual({ kind: "unit", id: "odu1" }); // ODU still there
  });

  it("does not touch another room's units", () => {
    const out = deleteRoomWithContents(scene(), "room1");
    expect(out.find((o) => o.id === "u2")).toBeDefined();
    expect(out.find((o) => o.id === "room2")).toBeDefined();
  });

  it("an empty room just removes itself", () => {
    const objects = [room("room1", 0, 0, 100, 100), unit("odu1", 500, 500)];
    const out = deleteRoomWithContents(objects, "room1");
    expect(out.map((o) => o.id)).toEqual(["odu1"]);
  });
});

describe("releaseRoomsFromSystems", () => {
  const sys = (id: string, roomIds?: string[]) => ({
    id,
    type: "split" as const,
    brand: "b",
    colour: "#000",
    name: id,
    settings: roomIds ? { roomIds } : {},
  });

  it("drops deleted ids from every adopted list", () => {
    const out = releaseRoomsFromSystems(
      [sys("s1", ["room1", "room2"]), sys("s2", ["room2"]), sys("s3")],
      new Set(["room1"])
    );
    expect(out[0].settings.roomIds).toEqual(["room2"]);
    expect(out[1].settings.roomIds).toEqual(["room2"]);
    expect(out[2].settings.roomIds).toBeUndefined();
  });

  it("is identity when nothing matches or the set is empty", () => {
    const systems = [sys("s1", ["room9"])];
    expect(releaseRoomsFromSystems(systems, new Set(["room1"]))).toBe(systems);
    expect(releaseRoomsFromSystems(systems, new Set())).toBe(systems);
  });
});

describe("pruneObjects / removedRoomIds", () => {
  const objects = () => [
    room("room1", 0, 0, 200, 200),
    inRoom(unit("u1", 50, 50), "room1"),
    unit("odu1", 900, 50), // a different system's outdoor unit
    run("r1", [pt(50, 50), pt(900, 50)], { kind: "unit", id: "u1" }, { kind: "unit", id: "odu1" }),
  ];

  it("strips attaches to everything the filter removed", () => {
    // delete the room and its unit, keep the foreign run + ODU
    const keep = (o: DesignObject) => o.id !== "room1" && o.id !== "u1";
    const out = pruneObjects(objects(), keep);
    const r = out.find((o) => o.id === "r1")!;
    expect(r.props.startAttach).toBeUndefined();
    expect(r.props.endAttach).toEqual({ kind: "unit", id: "odu1" });
  });

  it("returns the same array when the filter removes nothing", () => {
    const objs = objects();
    expect(pruneObjects(objs, () => true)).toBe(objs);
  });

  it("removedRoomIds reports only the rooms being dropped", () => {
    expect(removedRoomIds(objects(), (o) => o.id !== "room1")).toEqual(new Set(["room1"]));
    expect(removedRoomIds(objects(), (o) => o.id !== "u1")).toEqual(new Set());
  });
});

/* ── normalizeDesign (open-time repair) ── */

describe("normalizeDesign", () => {
  const strandedDoc = () => {
    const doc = createDesign({ name: "t", mode: "blank", now: "2026-01-01T00:00:00.000Z" });
    const floorId = doc.floors[0].id;
    const at = (o: DesignObject): DesignObject => ({ ...o, floorId });
    doc.objects = [
      at(unit("u1", 0, 0)),
      at(unit("u2", 140, 80)), // moved after the pipe was drawn
      at(run("r1", [pt(0, 0), pt(100, 0), pt(100, 80)], { kind: "unit", id: "u1" }, { kind: "unit", id: "u2" })),
      at(run("r2", [pt(0, 0), pt(0, 50)], { kind: "unit", id: "u1" }, { kind: "unit", id: "deleted" })),
    ];
    return doc;
  };

  it("repairs stranded endpoints and strips dead refs", () => {
    const out = normalizeDesign(strandedDoc());
    expect(ptsOf(out.objects[2])).toEqual([pt(0, 0), pt(140, 0), pt(140, 80)]);
    expect(out.objects[3].props.endAttach).toBeUndefined();
    expect(out.objects[3].props.startAttach).toEqual({ kind: "unit", id: "u1" });
  });

  it("is idempotent: a repaired doc comes back by reference", () => {
    const once = normalizeDesign(strandedDoc());
    expect(normalizeDesign(once)).toBe(once);
  });

  it("repaired geometry feeds the graph length", () => {
    const doc = normalizeDesign(strandedDoc());
    const g = buildSystemGraph(doc.objects, doc.floors, "sys_a");
    const edge = g.edges.find((e) => e.id === "r1");
    expect(edge).toBeDefined();
    const mm = doc.floors[0].scaleMmPerUnit!;
    expect(edge!.lengthM).toBeCloseTo((polylineLength(ptsOf(doc.objects[2])) * mm) / 1000);
  });

  /* ── the wordless-note sweep ──
     A note lands on the document at the leader click, before its words exist.
     Every normal way of closing the editor removes an untyped one; a DEPLOY
     RELOAD mid-note does not, and that is how this arrived on a real design
     (prod, 2026-08-26). Open-time repair is what catches it. */
  const notedDoc = (text: string) => {
    const doc = createDesign({ name: "t", mode: "blank", now: "2026-01-01T00:00:00.000Z" });
    const floorId = doc.floors[0].id;
    doc.objects = [
      { ...unit("u1", 0, 0), floorId },
      createNote({ floorId, rect: { x: 0, y: 0, w: 60, h: 40 }, leader: { x: 200, y: 0 }, text, id: "n1" }),
    ];
    return doc;
  };

  it("sweeps a note that never got its words", () => {
    const out = normalizeDesign(notedDoc(""));
    expect(out.objects.map((o) => o.id)).toEqual(["u1"]);
  });

  it("sweeps one that got only whitespace — a space is not a note", () => {
    expect(normalizeDesign(notedDoc("   \n  ")).objects.map((o) => o.id)).toEqual(["u1"]);
  });

  it("keeps a note that has something to say", () => {
    const out = normalizeDesign(notedDoc("Check bulkhead depth"));
    expect(out.objects.map((o) => o.id)).toEqual(["u1", "n1"]);
  });

  /* the identity contract normalizeDesign relies on: a document with nothing
     to sweep and nothing to repair must come back BY REFERENCE, or every open
     would look like an edit */
  it("returns a clean document by reference", () => {
    const doc = notedDoc("Check bulkhead depth");
    expect(normalizeDesign(doc)).toBe(doc);
  });

  /* the whole bug, end to end and through the REAL door: the orphan was saved
     to the server, and what fixes it is the next open — openDesignJson is the
     path store.load and the live viewer both take. */
  it("is gone by the time a saved design is reopened", () => {
    const stranded = serializeDesign(notedDoc(""));
    expect(stranded).toContain("\"type\":\"note\""); // it really was stored
    const { doc } = openDesignJson(stranded);
    expect(doc.objects.map((o) => o.id)).toEqual(["u1"]);
  });

  it("leaves everything that is not a note alone", () => {
    const doc = notedDoc("");
    const room: DesignObject = {
      id: "rm1", type: "room", systemId: "sys_a", floorId: doc.floors[0].id,
      geometry: { kind: "polygon", points: [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)] },
      plane: "room", props: {},
    };
    doc.objects = [...doc.objects, room];
    expect(normalizeDesign(doc).objects.map((o) => o.id)).toEqual(["u1", "rm1"]);
  });

  /* the shape check validates only the top level, so a hand-edited or
     corrupted file can carry runs missing props/geometry or with no points.
     Repair must leave them alone, not throw past DesignDocumentError. */
  it("survives malformed run objects instead of throwing", () => {
    const doc = createDesign({ name: "t", mode: "blank", now: "2026-01-01T00:00:00.000Z" });
    const floorId = doc.floors[0].id;
    const bare = { id: "x", type: "pipe-run", systemId: "sys_a", floorId, plane: "room" };
    doc.objects = [
      { ...unit("u1", 10, 10), floorId },
      { ...bare, geometry: { kind: "polyline", points: [] } } as unknown as DesignObject,
      { ...bare, id: "y", geometry: { kind: "polyline", points: [] }, props: { endAttach: { kind: "unit", id: "u1" } } } as unknown as DesignObject,
      { ...bare, id: "z", props: {} } as unknown as DesignObject,
    ];
    expect(() => normalizeDesign(doc)).not.toThrow();
  });
});
