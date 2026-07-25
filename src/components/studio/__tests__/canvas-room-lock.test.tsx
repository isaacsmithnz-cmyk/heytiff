/* A saved room is PINNED to the plan (field feedback 2026-07-25).

   Rooms used to move on any drag, so panning across a plan with the pointer
   over a room dragged the whole space instead of the view. Now a drawn room
   stays loose only until it's saved; after that a drag pans, and the modal's
   "Edit room shape" is the deliberate way back in.

   jsdom has no layout: the blank floor (scale 10 mm/unit → grid 100) opens at
   zoom 0.56 with the world origin at screen centre (400,300), so client
   coords map straight to screen — world x → 400 + x*0.56 (see
   canvas.test.tsx). */

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

const sx = (x: number) => 400 + x * 0.56;
const sy = (y: number) => 300 + y * 0.56;
const pt = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });

const room = (): DesignObject => ({
  id: "rm1",
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
  props: { name: "Lounge", shape: "rect", configured: true },
});

function mkDoc(): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-25T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  d.objects = [room()];
  return d;
}

function renderCanvas(opts: {
  doc: DesignDocument;
  selectedId?: string | null;
  reshapeRoomId?: string | null;
  onMutate?: (fn: (d: DesignDocument) => DesignDocument) => void;
}) {
  const utils = render(
    <StudioCanvas
      doc={opts.doc}
      floor={floor}
      tool="select"
      selectedId={opts.selectedId ?? null}
      onSelect={() => {}}
      onMutate={opts.onMutate ?? (() => {})}
      onToolDone={() => {}}
      activeSystemId="sys1"
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

/** where the room polygon is drawn right now (world = view coords) */
const roomPoints = (svg: Element) =>
  svg.querySelector(".ds-room polygon")!.getAttribute("points")!;

describe("a saved room is pinned to the plan", () => {
  it("dragging it pans the view instead of moving the room", () => {
    const doc = mkDoc();
    const onMutate = jest.fn();
    const { svg } = renderCanvas({ doc, onMutate });
    const before = roomPoints(svg);
    const scene = () => svg.querySelector("g[transform^='scale']")!.getAttribute("transform");
    const sceneBefore = scene();

    // grab inside the room and drag 50 world units right
    fireEvent.pointerDown(svg, pt(sx(30), sy(30)));
    fireEvent.pointerMove(svg, pt(sx(80), sy(30)));
    fireEvent.pointerUp(svg, pt(sx(80), sy(30)));

    // the room's own geometry is untouched — nothing was committed…
    expect(onMutate).not.toHaveBeenCalled();
    expect(roomPoints(svg)).toBe(before);
    // …the drag went to the VIEW instead: the scene transform panned
    expect(scene()).not.toBe(sceneBefore);
  });

  it("offers no corner handles until it is unpinned", () => {
    const { svg } = renderCanvas({ doc: mkDoc(), selectedId: "rm1" });
    expect(svg.querySelectorAll(".ds-vertex")).toHaveLength(0);
    expect(svg.querySelector(".ds-room.loose")).toBeNull();
  });

  it("Edit room shape unpins it — corners pull and the body moves again", () => {
    const doc = mkDoc();
    let next: DesignDocument | undefined;
    const { svg } = renderCanvas({
      doc,
      reshapeRoomId: "rm1",
      onMutate: (fn) => (next = fn(doc)),
    });

    // the room reads as loose and hands back its corner handles
    expect(svg.querySelector(".ds-room.loose")).not.toBeNull();
    expect(svg.querySelectorAll(".ds-vertex")).toHaveLength(4);

    fireEvent.pointerDown(svg, pt(sx(30), sy(30)));
    fireEvent.pointerMove(svg, pt(sx(80), sy(30)));
    fireEvent.pointerUp(svg, pt(sx(80), sy(30)));

    const moved = next!.objects.find((o) => o.id === "rm1")!;
    const x0 = (moved.geometry as { points: { x: number }[] }).points[0].x;
    expect(x0).toBeGreaterThan(-60); // it travelled
  });

  it("Save pins it again — the panel closes and the drag stops moving it", () => {
    const doc = mkDoc();
    const { svg, getByRole, queryByText } = renderCanvas({ doc, reshapeRoomId: "rm1" });
    fireEvent.click(getByRole("button", { name: "Save shape" }));

    expect(queryByText("Edit the room")).toBeNull();
    expect(svg.querySelector(".ds-room.loose")).toBeNull();
    expect(svg.querySelectorAll(".ds-vertex")).toHaveLength(0);
  });
});
