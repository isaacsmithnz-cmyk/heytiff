/* A room's name moved by hand (Isaac, 2026-09-30: a kitchen island on the
   uploaded drawing under it), and never by accident: only once the room is
   selected does a drag on its name move it. Unselected, the drag pans, as
   it does across the pinned room itself.

   Gestures are written in WORLD units and converted through the canvas's
   own viewport, read back off the scene transform, as canvas-callout does. */

import { render, fireEvent } from "@testing-library/react";
import { StudioCanvas } from "../canvas";
import { createDesign, type DesignDocument, type DesignObject, type Floor } from "@/lib/studio/document";

const floor: Floor = { id: "flr", name: "G", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] };
function at(svg: Element, x: number, y: number) {
  const t = [...svg.querySelectorAll("g")]
    .map((g) => g.getAttribute("transform") ?? "")
    .find((v) => v.startsWith("scale("))!;
  const m = /scale\(([-\d.e]+)\) translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(t)!;
  const [zoom, tx, ty] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { clientX: (x + tx) * zoom, clientY: (y + ty) * zoom, button: 0, pointerId: 1 };
}

const room = (props: Record<string, unknown> = {}): DesignObject => ({
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
  props: { name: "Lounge", shape: "rect", configured: true, ...props },
});

function mkDoc(props?: Record<string, unknown>, settings: Record<string, unknown> = {}): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-09-30T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [{ id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} }];
  d.objects = [room(props)];
  d.settings = { ...d.settings, ...settings };
  return d;
}

function renderCanvas(doc: DesignDocument, selectedId: string | null, onMutate: (fn: (d: DesignDocument) => DesignDocument) => void = () => {}) {
  const utils = render(
    <StudioCanvas
      doc={doc}
      floor={floor}
      tool="select"
      selectedId={selectedId}
      onSelect={() => {}}
      onMutate={onMutate}
      onToolDone={() => {}}
      activeSystemId="sys1"
      iduSpec={() => null}
      onPlaced={() => {}}
      onRoomCreated={() => {}}
      onRemarkConsumed={() => {}}
      reshapeRoomId={null}
      onReshapeConsumed={() => {}}
    />
  );
  return { ...utils, svg: utils.container.querySelector("svg")! };
}

const nameAt = (svg: Element) => {
  const t = svg.querySelector(".ds-room-name")!;
  return { x: Number(t.getAttribute("x")), y: Number(t.getAttribute("y")) };
};

describe("moving a room's name by hand", () => {
  it("unselected, a drag across the name pans the plan and moves nothing", () => {
    const onMutate = jest.fn();
    const { svg } = renderCanvas(mkDoc(), null, onMutate);
    const n = nameAt(svg);
    expect(svg.querySelector(".ds-label-grab")).toBeNull();
    fireEvent.pointerDown(svg, at(svg, n.x, n.y + 4));
    fireEvent.pointerMove(svg, at(svg, n.x + 80, n.y + 4));
    fireEvent.pointerUp(svg, at(svg, n.x + 80, n.y + 4));
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("selected, the name wears its grab outline, and a drag moves it and keeps it on the room", () => {
    const doc = mkDoc();
    let next: DesignDocument | undefined;
    const { svg } = renderCanvas(doc, "rm1", (fn) => (next = fn(doc)));
    expect(svg.querySelector(".ds-label-grab")).not.toBeNull();
    const n = nameAt(svg);
    fireEvent.pointerDown(svg, at(svg, n.x, n.y + 4));
    fireEvent.pointerMove(svg, at(svg, n.x + 40, n.y + 64));
    fireEvent.pointerUp(svg, at(svg, n.x + 40, n.y + 64));
    const moved = next!.objects.find((o) => o.id === "rm1")!;
    // the room's centre is (30, 30); the name was there and went 40 across, 60 down
    const labelAt = moved.props.labelAt as { dx: number; dy: number };
    expect(labelAt.dx).toBeCloseTo(n.x + 40 - 30, 0);
    expect(labelAt.dy).toBeCloseTo(n.y + 60 - 30, 0);
    // the room itself did not move
    expect(moved.geometry).toEqual(room().geometry);
  });

  it("a press that barely rolls costs no undo step", () => {
    const onMutate = jest.fn();
    const { svg } = renderCanvas(mkDoc(), "rm1", onMutate);
    const n = nameAt(svg);
    fireEvent.pointerDown(svg, at(svg, n.x, n.y + 4));
    fireEvent.pointerMove(svg, { ...at(svg, n.x, n.y + 4), clientX: at(svg, n.x, n.y + 4).clientX + 3 });
    fireEvent.pointerUp(svg, { ...at(svg, n.x, n.y + 4), clientX: at(svg, n.x, n.y + 4).clientX + 3 });
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("put by hand, it is drawn there, and its reset mark hands it back to the Studio", () => {
    const doc = mkDoc({ labelAt: { dx: -50, dy: 60 } });
    let next: DesignDocument | undefined;
    const { svg } = renderCanvas(doc, "rm1", (fn) => (next = fn(doc)));
    expect(nameAt(svg)).toEqual({ x: -20, y: 90 });
    const mark = svg.querySelector(".ds-label-reset circle")!;
    const cx = Number(mark.getAttribute("cx"));
    const cy = Number(mark.getAttribute("cy"));
    fireEvent.pointerDown(svg, at(svg, cx, cy));
    fireEvent.pointerUp(svg, at(svg, cx, cy));
    expect(next!.objects.find((o) => o.id === "rm1")!.props).not.toHaveProperty("labelAt");
  });

  it("offers no reset mark while the Studio places it, or while the room is not selected", () => {
    expect(renderCanvas(mkDoc(), "rm1").svg.querySelector(".ds-label-reset")).toBeNull();
    expect(renderCanvas(mkDoc({ labelAt: { dx: 0, dy: 40 } }), null).svg.querySelector(".ds-label-reset")).toBeNull();
  });

  it("View › Label backing puts the words on a white card", () => {
    expect(renderCanvas(mkDoc(), null).svg.querySelector(".ds-label-back")).toBeNull();
    expect(renderCanvas(mkDoc({}, { labelBacks: true }), null).svg.querySelector(".ds-label-back")).not.toBeNull();
  });
});
