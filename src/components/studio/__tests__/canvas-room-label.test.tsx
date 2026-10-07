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

/* the room is a 180 square from (-60, -60): clockwise from its first corner
   the top wall runs 0–180, the right 180–360, the bottom 360–540, the left
   540–720 — so the middle of the right wall is 0.375 of the way round */

/* A ROOM'S NAME IS A TAB ON ITS WALL (room-tab.ts; Isaac, 2026-10-07): drawn
   under the room on its own paper, its edge dashed, moved round the walls */
describe("a room's name on its wall", () => {
  /* its grey OVER the room's wash — under it, the wash tinted it the room's
     colour and the grey was lost ("where is the grey background") — and the
     wall drawn again over the tab, so it still runs straight through */
  it("is a grey tab over the room's wash, the wall over it, its words left-aligned in it", () => {
    const { svg } = renderCanvas(mkDoc(), null);
    const g = svg.querySelector(".ds-room")!;
    const kids = [...g.children].map((c) => c.getAttribute("class") || c.tagName.toLowerCase());
    const room = kids.indexOf("polygon");
    const tab = kids.indexOf("ds-room-tab");
    const wall = kids.indexOf("ds-room-wall");
    expect(room).toBeLessThan(tab);
    expect(tab).toBeLessThan(wall);
    expect(wall).toBeLessThan(kids.indexOf("ds-room-tab-edge"));
    // the wall's copy never fills, whatever state the room is in
    expect((g.querySelector(".ds-room-wall") as SVGElement).style.fill).toBe("none");
    expect(g.querySelector(".ds-room-name")!.getAttribute("class")).toContain("in-tab");
  });

  it("starts tucked into the room's top-left corner", () => {
    const { svg } = renderCanvas(mkDoc(), null);
    const n = nameAt(svg);
    expect(n.x).toBeGreaterThan(-60);
    expect(n.x).toBeLessThan(0);
    expect(n.y).toBeGreaterThan(-60);
    expect(n.y).toBeLessThan(-30);
  });
});

describe("moving a room's name by hand", () => {
  it("unselected, a drag across the name pans the plan and moves nothing", () => {
    const onMutate = jest.fn();
    const { svg } = renderCanvas(mkDoc(), null, onMutate);
    const n = nameAt(svg);
    expect(svg.querySelector(".ds-label-grab")).toBeNull();
    fireEvent.pointerDown(svg, at(svg, n.x, n.y));
    fireEvent.pointerMove(svg, at(svg, n.x + 80, n.y));
    fireEvent.pointerUp(svg, at(svg, n.x + 80, n.y));
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("selected, its tab slides round the walls by as far as the pointer goes, and is kept as a share of the way round", () => {
    const doc = mkDoc();
    let next: DesignDocument | undefined;
    const { svg } = renderCanvas(doc, "rm1", (fn) => (next = fn(doc)));
    expect(svg.querySelector(".ds-label-grab")).not.toBeNull();
    const n = nameAt(svg);
    // pressed on the words near the top wall, carried round to the right wall's middle
    fireEvent.pointerDown(svg, at(svg, n.x, n.y));
    fireEvent.pointerMove(svg, at(svg, 60, -58));
    fireEvent.pointerMove(svg, at(svg, 118, 30));
    fireEvent.pointerUp(svg, at(svg, 118, 30));
    const moved = next!.objects.find((o) => o.id === "rm1")!;
    const edge = moved.props.labelEdge as number;
    // the tab's middle travelled as far round as the pointer did: from where the
    // press met the top wall to the right wall's middle
    expect(edge).toBeGreaterThan(0.3);
    expect(edge).toBeLessThan(0.45);
    expect(moved.props).not.toHaveProperty("labelAt");
    // the room itself did not move
    expect(moved.geometry).toEqual(room().geometry);
  });

  it("a press that barely rolls costs no undo step", () => {
    const onMutate = jest.fn();
    const { svg } = renderCanvas(mkDoc(), "rm1", onMutate);
    const n = nameAt(svg);
    fireEvent.pointerDown(svg, at(svg, n.x, n.y));
    fireEvent.pointerMove(svg, { ...at(svg, n.x, n.y), clientX: at(svg, n.x, n.y).clientX + 3 });
    fireEvent.pointerUp(svg, { ...at(svg, n.x, n.y), clientX: at(svg, n.x, n.y).clientX + 3 });
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("put on a wall by hand, it is drawn there, and its reset mark hands it back to the Studio", () => {
    const doc = mkDoc({ labelEdge: 0.375 });
    let next: DesignDocument | undefined;
    const { svg } = renderCanvas(doc, "rm1", (fn) => (next = fn(doc)));
    // on the right wall: the words sit at its left edge, short of the wall
    const n = nameAt(svg);
    expect(n.x).toBeGreaterThan(30);
    expect(n.x).toBeLessThan(120);
    const mark = svg.querySelector(".ds-label-reset circle")!;
    const cx = Number(mark.getAttribute("cx"));
    const cy = Number(mark.getAttribute("cy"));
    fireEvent.pointerDown(svg, at(svg, cx, cy));
    fireEvent.pointerUp(svg, at(svg, cx, cy));
    expect(next!.objects.find((o) => o.id === "rm1")!.props).not.toHaveProperty("labelEdge");
  });

  it("put by hand the OLD way, inside the room, it goes on the nearest wall, and its reset mark clears that too", () => {
    // the old spot is (-20, 90): 30 off the bottom wall, 40 off the left
    const doc = mkDoc({ labelAt: { dx: -50, dy: 60 } });
    let next: DesignDocument | undefined;
    const { svg } = renderCanvas(doc, "rm1", (fn) => (next = fn(doc)));
    expect(nameAt(svg).y).toBeGreaterThan(90);
    const mark = svg.querySelector(".ds-label-reset circle")!;
    fireEvent.pointerDown(svg, at(svg, Number(mark.getAttribute("cx")), Number(mark.getAttribute("cy"))));
    fireEvent.pointerUp(svg, at(svg, Number(mark.getAttribute("cx")), Number(mark.getAttribute("cy"))));
    expect(next!.objects.find((o) => o.id === "rm1")!.props).not.toHaveProperty("labelAt");
  });

  it("offers no reset mark while the Studio places it, or while the room is not selected", () => {
    expect(renderCanvas(mkDoc(), "rm1").svg.querySelector(".ds-label-reset")).toBeNull();
    expect(renderCanvas(mkDoc({ labelEdge: 0.375 }), null).svg.querySelector(".ds-label-reset")).toBeNull();
  });

  /* the tab is the name's own paper, so the View's backing (for the plan's
     other words) never doubles it */
  it("a tab is its own backing, whatever View › Label backing says", () => {
    const { svg } = renderCanvas(mkDoc({}, { labelBacks: true }), null);
    expect(svg.querySelector(".ds-room-tab")).not.toBeNull();
    expect(svg.querySelector(".ds-room .ds-label-back")).toBeNull();
  });
});
