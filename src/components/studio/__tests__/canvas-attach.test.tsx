/* Canvas WIRING for attached-run maintenance (attach.ts).

   attach.test.ts covers the pure helpers; this file covers the thing that
   suite cannot see — whether the canvas actually CALLS them. A commit that
   shipped attach.ts with none of the handlers wired left every pure test
   green, so these assertions go through real pointer/key events and read
   the committed document.

   jsdom has no layout: the blank floor (scale 10 mm/unit → grid 100) opens
   at zoom 0.56 with the world origin at screen centre (400,300), so client
   coords map straight to screen — world x → 400 + x*0.56 (see
   canvas.test.tsx). Scene below: IDU at world (0,0) → screen (400,300),
   ODU at world (200,100) → (512,356), joined by an L-shaped run. */

import { render, fireEvent } from "@testing-library/react";
import { StudioCanvas } from "../canvas";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type Floor,
} from "@/lib/studio/document";

const floor: Floor = {
  id: "flr",
  name: "G",
  level: 0,
  scaleMmPerUnit: 10,
  northDeg: null,
  northPos: null,
  plans: [],
};

/** world → screen at the fixture's zoom */
const sx = (x: number) => 400 + x * 0.56;
const sy = (y: number) => 300 + y * 0.56;
const pt = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });

const unit = (
  id: string,
  at: { x: number; y: number },
  role: "idu" | "odu",
  props: Record<string, unknown> = {}
): DesignObject => ({
  id,
  type: "unit",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at },
  plane: role === "odu" ? "external-ground" : "room",
  props: { role, model: "M1", widthMm: 800, depthMm: 300, ...props },
});

const room = (id: string): DesignObject => ({
  id,
  type: "room",
  systemId: "sys1",
  floorId: "flr",
  geometry: {
    kind: "polygon",
    points: [
      { x: -60, y: -60 },
      { x: 120, y: -60 },
      { x: 120, y: 120 },
      { x: -60, y: 120 },
    ],
  },
  plane: "room",
  props: { name: "Lounge", shape: "rect" },
});

/** L-run: IDU (0,0) → corner (200,0) → ODU (200,100), attached both ends */
const lRun = (): DesignObject => ({
  id: "r1",
  type: "pipe-run",
  systemId: "sys1",
  floorId: "flr",
  geometry: {
    kind: "polyline",
    points: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
    ],
  },
  plane: "room",
  props: {
    startAttach: { kind: "unit", id: "idu" },
    endAttach: { kind: "unit", id: "odu" },
  },
});

const plenum = (id: string, unitId: string): DesignObject => ({
  id,
  type: "plenum",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 0, y: 20 } },
  plane: "ceiling-cavity",
  props: { stream: "supply", unitId, end: "supply", spigots: [] },
});

function mkDoc(objects: DesignObject[], roomIds?: string[]): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-19T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    {
      id: "sys1",
      type: "split",
      brand: "me",
      colour: "#2E68FF",
      name: "S1",
      settings: roomIds ? { roomIds } : {},
    },
  ];
  d.objects = objects;
  return d;
}

function renderCanvas(opts: {
  doc: DesignDocument;
  tool?: "select" | "erase";
  selectedId?: string | null;
  onMutate?: (fn: (d: DesignDocument) => DesignDocument) => void;
  /** unpin a saved room for resizing / moving (the modal's Edit shape) */
  reshapeRoomId?: string;
}) {
  const utils = render(
    <StudioCanvas
      doc={opts.doc}
      floor={floor}
      tool={opts.tool ?? "select"}
      selectedId={opts.selectedId ?? null}
      onSelect={() => {}}
      onMutate={opts.onMutate ?? (() => {})}
      onToolDone={() => {}}
      activeSystemId="sys1"
      component={null}
      iduSpec={() => null}
      onPlaced={() => {}}
      onRoomCreated={() => {}}
      onRemarkConsumed={() => {}}
      reshapeRoomId={opts.reshapeRoomId ?? null}
      onReshapeConsumed={() => {}}
    />
  );
  return { ...utils, svg: utils.container.querySelector("svg")! };
}

const runPoints = (d: DesignDocument) =>
  (d.objects.find((o) => o.id === "r1")!.geometry as { points: { x: number; y: number }[] }).points;
const renderedRun = (svg: Element) =>
  svg.querySelector("g.ds-pipe polyline")!.getAttribute("points");
const ids = (d: DesignDocument) => d.objects.map((o) => o.id);

/* ── moving a unit ── */

describe("moving a unit carries its pipework", () => {
  it("commits reconciled run points, keeping the last segment axis-aligned", () => {
    const doc = mkDoc([unit("idu", { x: 0, y: 0 }, "idu"), unit("odu", { x: 200, y: 100 }, "odu"), lRun()]);
    let next: DesignDocument | undefined;
    const { svg } = renderCanvas({ doc, onMutate: (fn) => (next = fn(doc)) });

    // drag the ODU 100 world units right: (200,100) → (300,100)
    fireEvent.pointerDown(svg, pt(sx(200), sy(100)));
    fireEvent.pointerMove(svg, pt(sx(300), sy(100)));
    fireEvent.pointerUp(svg, pt(sx(300), sy(100)));

    expect(next).toBeDefined();
    // the vertical final segment stays vertical — the corner moved with it
    expect(runPoints(next!)).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 100 },
    ]);
  });

  it("previews the follow mid-drag, before anything is committed", () => {
    const doc = mkDoc([unit("idu", { x: 0, y: 0 }, "idu"), unit("odu", { x: 200, y: 100 }, "odu"), lRun()]);
    const onMutate = jest.fn();
    const { svg } = renderCanvas({ doc, onMutate });

    expect(renderedRun(svg)).toBe("0,0 200,0 200,100");
    fireEvent.pointerDown(svg, pt(sx(200), sy(100)));
    fireEvent.pointerMove(svg, pt(sx(300), sy(100)));

    // the drawn polyline tracks the unit while the document is untouched
    expect(renderedRun(svg)).toBe("0,0 300,0 300,100");
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("leaves an unattached run alone", () => {
    const loose: DesignObject = { ...lRun(), id: "r1", props: {} };
    const doc = mkDoc([unit("idu", { x: 0, y: 0 }, "idu"), unit("odu", { x: 200, y: 100 }, "odu"), loose]);
    let next: DesignDocument | undefined;
    const { svg } = renderCanvas({ doc, onMutate: (fn) => (next = fn(doc)) });

    fireEvent.pointerDown(svg, pt(sx(200), sy(100)));
    fireEvent.pointerMove(svg, pt(sx(300), sy(100)));
    fireEvent.pointerUp(svg, pt(sx(300), sy(100)));

    expect(runPoints(next!)).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
    ]);
  });
});

/* ── moving a room ── */

describe("moving a room carries its units and their pipework", () => {
  it("translates room, stamped unit and the attached run in one mutate", () => {
    const doc = mkDoc([
      room("rm1"),
      unit("idu", { x: 0, y: 0 }, "idu", { roomId: "rm1" }),
      unit("odu", { x: 200, y: 100 }, "odu"),
      lRun(),
    ]);
    let next: DesignDocument | undefined;
    /* a saved room is pinned to the plan — Edit shape unpins it, which is the
       only state where a room drag moves anything (field feedback 2026-07-25) */
    const { svg } = renderCanvas({
      doc,
      reshapeRoomId: "rm1",
      onMutate: (fn) => (next = fn(doc)),
    });

    // grab the room away from the IDU footprint (±40×15 world at (0,0))
    fireEvent.pointerDown(svg, pt(sx(100), sy(100)));
    fireEvent.pointerMove(svg, pt(sx(150), sy(100)));
    fireEvent.pointerUp(svg, pt(sx(150), sy(100)));

    expect(next).toBeDefined();
    /* zoom is fit-to-content, so assert the RELATIONSHIP rather than the
       arithmetic (attach.test.ts pins the maths): everything that belongs
       to the room shifts by the same delta, and nothing else moves. */
    const movedRoom = next!.objects.find((o) => o.id === "rm1")!;
    const dx = (movedRoom.geometry as { points: { x: number }[] }).points[0].x - -60;
    expect(dx).toBeGreaterThan(0); // the drag actually committed

    const idu = next!.objects.find((o) => o.id === "idu")!.geometry as {
      at: { x: number; y: number };
    };
    expect(idu.at).toEqual({ x: 0 + dx, y: 0 }); // stamped unit travelled
    expect((next!.objects.find((o) => o.id === "odu")!.geometry as { at: unknown }).at).toEqual({
      x: 200,
      y: 100,
    }); // the ODU stayed put
    expect(runPoints(next!)[0]).toEqual(idu.at); // and the run followed the unit
    expect(runPoints(next!)[2]).toEqual({ x: 200, y: 100 }); // far end unmoved
  });
});

/* ── deleting a room ── */

describe("deleting a room takes its contents", () => {
  it("removes the room, its stamped units and their plenums", () => {
    const doc = mkDoc(
      [
        room("rm1"),
        unit("idu", { x: 0, y: 0 }, "idu", { roomId: "rm1" }),
        plenum("pl1", "idu"),
        unit("odu", { x: 200, y: 100 }, "odu"),
        lRun(),
      ],
      ["rm1"]
    );
    let next: DesignDocument | undefined;
    renderCanvas({ doc, selectedId: "rm1", onMutate: (fn) => (next = fn(doc)) });
    fireEvent.keyDown(window, { key: "Delete" });

    expect(ids(next!)).toEqual(["odu", "r1"]);
  });

  it("leaves the run drawn but drops the ref to the deleted unit", () => {
    const doc = mkDoc(
      [room("rm1"), unit("idu", { x: 0, y: 0 }, "idu", { roomId: "rm1" }), unit("odu", { x: 200, y: 100 }, "odu"), lRun()],
      ["rm1"]
    );
    let next: DesignDocument | undefined;
    renderCanvas({ doc, selectedId: "rm1", onMutate: (fn) => (next = fn(doc)) });
    fireEvent.keyDown(window, { key: "Delete" });

    const r = next!.objects.find((o) => o.id === "r1")!;
    expect(r.props.startAttach).toBeUndefined(); // the IDU went with the room
    expect(r.props.endAttach).toEqual({ kind: "unit", id: "odu" });
    expect((r.geometry as { points: unknown[] }).points).toHaveLength(3); // geometry kept
  });

  it("releases the room id from the system's adopted list", () => {
    const doc = mkDoc([room("rm1"), unit("idu", { x: 0, y: 0 }, "idu", { roomId: "rm1" })], ["rm1", "other"]);
    let next: DesignDocument | undefined;
    renderCanvas({ doc, selectedId: "rm1", onMutate: (fn) => (next = fn(doc)) });
    fireEvent.keyDown(window, { key: "Delete" });

    expect(next!.systems[0].settings.roomIds).toEqual(["other"]);
  });

  it("does not disturb a unit stamped to a different room", () => {
    const other = { ...room("rm2"), id: "rm2" };
    const doc = mkDoc([
      room("rm1"),
      other,
      unit("idu", { x: 0, y: 0 }, "idu", { roomId: "rm2" }),
    ]);
    let next: DesignDocument | undefined;
    renderCanvas({ doc, selectedId: "rm1", onMutate: (fn) => (next = fn(doc)) });
    fireEvent.keyDown(window, { key: "Delete" });

    expect(ids(next!)).toEqual(["rm2", "idu"]);
  });
});

/* ── deleting a unit ── */

describe("deleting a unit leaves an honest open end", () => {
  it("the Delete key strips the run's attach ref", () => {
    const doc = mkDoc([unit("idu", { x: 0, y: 0 }, "idu"), unit("odu", { x: 200, y: 100 }, "odu"), lRun()]);
    let next: DesignDocument | undefined;
    renderCanvas({ doc, selectedId: "odu", onMutate: (fn) => (next = fn(doc)) });
    fireEvent.keyDown(window, { key: "Delete" });

    const r = next!.objects.find((o) => o.id === "r1")!;
    expect(r.props.endAttach).toBeUndefined();
    expect(r.props.startAttach).toEqual({ kind: "unit", id: "idu" });
  });

  it("the eraser strips it too", () => {
    const doc = mkDoc([unit("idu", { x: 0, y: 0 }, "idu"), unit("odu", { x: 200, y: 100 }, "odu"), lRun()]);
    let next: DesignDocument | undefined;
    const { svg } = renderCanvas({ doc, tool: "erase", onMutate: (fn) => (next = fn(doc)) });
    /* the eraser fires on pointer-UP now: a press that travels pans the plan
       instead, so the whole gesture has to be sent */
    fireEvent.pointerDown(svg, pt(sx(200), sy(100)));
    fireEvent.pointerUp(svg, pt(sx(200), sy(100)));

    const r = next!.objects.find((o) => o.id === "r1")!;
    expect(r.props.endAttach).toBeUndefined();
    expect(next!.objects.find((o) => o.id === "odu")).toBeUndefined();
  });
});
