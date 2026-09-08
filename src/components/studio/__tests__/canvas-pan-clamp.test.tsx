/* The view can no longer be panned away from the drawing.

   Zoom has had a floor since the beginning — you cannot zoom out past roughly
   fit, so the plan never shrinks into a speck. Pan had no matching rule, so
   every gesture that moves the view could carry the drawing off into empty
   grid until Fit was the only way back to it.

   geometry.test.ts pins the ARITHMETIC (clampViewport, from its spec). This
   file pins the WIRING: that each gesture actually goes through it, through
   the real component, because a clamp one code path skips is not a clamp.
   jsdom has no layout, so the canvas keeps its assumed 800×600 box. */

import { render, fireEvent } from "@testing-library/react";
import { StudioCanvas } from "../canvas";
import { createDesign, type DesignDocument, type Floor } from "@/lib/studio/document";
import type { CanvasTool } from "../canvas";
import type { WheelMode } from "@/lib/studio/wheel";

const W = 800;
const H = 600;

const floor: Floor = {
  id: "flr",
  name: "G",
  level: 0,
  scaleMmPerUnit: 10,
  northDeg: null,
  northPos: null,
  plans: [],
};

/** one 4×3 m room at the origin — real bounds for the clamp to hold on to */
const ROOM = { x0: 0, y0: 0, x1: 400, y1: 300 };

function mkDoc(withRoom: boolean): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-28T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  d.objects = withRoom
    ? [
        {
          id: "r1",
          type: "room",
          systemId: null,
          floorId: "flr",
          plane: "room",
          geometry: {
            kind: "polygon",
            points: [
              { x: ROOM.x0, y: ROOM.y0 },
              { x: ROOM.x1, y: ROOM.y0 },
              { x: ROOM.x1, y: ROOM.y1 },
              { x: ROOM.x0, y: ROOM.y1 },
            ],
          },
          props: { name: "Room 1" },
        },
      ]
    : [];
  return d;
}

function renderCanvas(opts: { room?: boolean; tool?: CanvasTool; wheelMode?: WheelMode } = {}) {
  const doc = mkDoc(opts.room ?? true);
  const utils = render(
    <StudioCanvas
      doc={doc}
      floor={floor}
      tool={opts.tool ?? "select"}
      selectedId={null}
      onSelect={() => {}}
      onMutate={() => {}}
      onToolDone={() => {}}
      activeSystemId="sys1"
      component={null}
      iduSpec={() => null}
      onPlaced={() => {}}
      onRoomCreated={() => {}}
      onRemarkConsumed={() => {}}
      wheelMode={opts.wheelMode ?? "pan"}
    />
  );
  const svg = utils.container.querySelector("svg")!;
  const readVp = () => {
    const t = [...svg.querySelectorAll("g")]
      .map((g) => g.getAttribute("transform") ?? "")
      .find((x) => x.startsWith("scale("))!;
    const m = /^scale\(([-\d.]+)\) translate\(([-\d.]+) ([-\d.]+)\)$/.exec(t)!;
    return { zoom: +m[1], x: -+m[2], y: -+m[3] };
  };
  return { ...utils, svg, readVp };
}

const pt = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });

/** how much of the room is still on screen, in px on each axis */
function roomOnScreen(vp: { zoom: number; x: number; y: number }) {
  const span = (lo: number, hi: number, from: number, screen: number) =>
    Math.max(0, Math.min(from + screen / vp.zoom, hi) - Math.max(from, lo)) * vp.zoom;
  return {
    x: span(ROOM.x0, ROOM.x1, vp.x, W),
    y: span(ROOM.y0, ROOM.y1, vp.y, H),
  };
}

/** fire the same scroll `n` times — one flick is not a runaway */
function scroll(svg: Element, dx: number, dy: number, n = 60) {
  for (let i = 0; i < n; i++) fireEvent.wheel(svg, { deltaX: dx, deltaY: dy, deltaMode: 0 });
}

describe("the view cannot be panned away from the drawing", () => {
  it("holds a runaway two-finger scroll with the room still on screen", () => {
    for (const [dx, dy] of [
      [400, 0],
      [-400, 0],
      [0, 400],
      [0, -400],
      [400, 400],
      [-400, -400],
    ]) {
      const { svg, readVp } = renderCanvas({ wheelMode: "pan" });
      scroll(svg, dx, dy);
      const on = roomOnScreen(readVp());
      expect(on.x).toBeGreaterThan(0);
      expect(on.y).toBeGreaterThan(0);
    }
  });

  it("holds a runaway middle-drag too — every gesture, not just the wheel", () => {
    const { svg, readVp } = renderCanvas();
    fireEvent.pointerDown(svg, { ...pt(400, 300), button: 1 });
    // one long travel, far past any screen
    fireEvent.pointerMove(svg, { ...pt(-40000, -30000), button: 1 });
    fireEvent.pointerUp(svg, { ...pt(-40000, -30000), button: 1 });

    const on = roomOnScreen(readVp());
    expect(on.x).toBeGreaterThan(0);
    expect(on.y).toBeGreaterThan(0);
  });

  /* the tap-or-pan gesture that every click-to-place tool starts as travels
     through its own setVp call — the one most likely to be missed */
  it("holds a runaway tap-pan from a placement tool", () => {
    const { svg, readVp } = renderCanvas({ tool: "calibrate" });
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(60000, 45000));
    fireEvent.pointerUp(svg, pt(60000, 45000));

    const on = roomOnScreen(readVp());
    expect(on.x).toBeGreaterThan(0);
    expect(on.y).toBeGreaterThan(0);
  });

  /* A blank floor has no bounds at all, and it is the easiest place to get
     lost — nothing on screen to steer by. The origin stands in for content. */
  it("won't let a blank grid lose the origin either", () => {
    const { svg, readVp } = renderCanvas({ room: false, wheelMode: "pan" });
    scroll(svg, 500, 500, 80);

    const vp = readVp();
    const at = { x: (0 - vp.x) * vp.zoom, y: (0 - vp.y) * vp.zoom };
    expect(at.x).toBeGreaterThanOrEqual(-1);
    expect(at.x).toBeLessThanOrEqual(W + 1);
    expect(at.y).toBeGreaterThanOrEqual(-1);
    expect(at.y).toBeLessThanOrEqual(H + 1);
  });

  /* The clamp must not become a cage: an ordinary scroll still has to move the
     plan, or the fix is worse than the bug. */
  it("leaves an ordinary scroll completely alone", () => {
    const { svg, readVp } = renderCanvas({ wheelMode: "pan" });
    const before = readVp();
    fireEvent.wheel(svg, { deltaX: 24.5, deltaY: 12.25, deltaMode: 0 });
    const after = readVp();

    expect(after.zoom).toBe(before.zoom);
    expect(after.x).toBeCloseTo(before.x + 24.5 / before.zoom, 6);
    expect(after.y).toBeCloseTo(before.y + 12.25 / before.zoom, 6);
  });
});
