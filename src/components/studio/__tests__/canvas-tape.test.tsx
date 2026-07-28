/* Tape measure: a quick check on a part of the plan that carries no
   dimension. Drag from one point to another, read the distance, let go and
   it's gone — the document must be untouched, because a reading is not an
   object. That last part is the whole design, so it's what's asserted hardest.

   jsdom has no layout: blank floor (10 mm/unit -> grid 100) opens at zoom
   0.56, world origin at screen centre (400,300). 56 screen px = 100 world
   units = 1 m. */

import { render, fireEvent } from "@testing-library/react";
import { StudioCanvas } from "../canvas";
import { createDesign, type DesignDocument, type Floor } from "@/lib/studio/document";

const floor: Floor = {
  id: "flr",
  name: "G",
  level: 0,
  scaleMmPerUnit: 10,
  northDeg: null,
  northPos: null,
  plans: [],
};

function mkDoc(scaleMmPerUnit: number | null = 10): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-28T00:00:00.000Z" });
  d.floors = [{ ...floor, scaleMmPerUnit }];
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  d.objects = [];
  return d;
}

function renderCanvas(doc = mkDoc(), onMutate: (fn: (d: DesignDocument) => DesignDocument) => void = () => {}) {
  const utils = render(
    <StudioCanvas
      doc={doc}
      floor={doc.floors[0]}
      tool="measure"
      selectedId={null}
      onSelect={() => {}}
      onMutate={onMutate}
      onToolDone={() => {}}
      activeSystemId="sys1"
      component={null}
      iduSpec={() => null}
      onPlaced={() => {}}
      onRoomCreated={() => {}}
      onRemarkConsumed={() => {}}
    />
  );
  return { ...utils, svg: utils.container.querySelector("svg")! };
}

const pt = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });
const tape = (svg: Element) => svg.querySelector('[data-testid="tape-measure"]');

describe("tape measure", () => {
  it("reads the distance while the pointer is down", () => {
    const { svg } = renderCanvas();
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(568, 300)); // 168 px = 300 units = 3 m

    expect(tape(svg)).not.toBeNull();
    expect(tape(svg)!.querySelector(".ds-tape-len")!.textContent).toBe("3.00 m");
  });

  it("vanishes on release — a reading, not a mark", () => {
    const { svg } = renderCanvas();
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(568, 300));
    fireEvent.pointerUp(svg, pt(568, 300));
    expect(tape(svg)).toBeNull();
  });

  /* the point of the tool: it must not reach the document at all, or it would
     land in the undo stack and the summary as an object nobody asked for */
  it("never touches the document", () => {
    const onMutate = jest.fn();
    const { svg } = renderCanvas(mkDoc(), onMutate);
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(500, 380));
    fireEvent.pointerUp(svg, pt(500, 380));
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("Escape drops a measurement mid-drag", () => {
    const { svg } = renderCanvas();
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(568, 300));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(tape(svg)).toBeNull();
  });

  it("Shift holds the tape square to the plan", () => {
    const { svg } = renderCanvas();
    fireEvent.pointerDown(svg, pt(400, 300));
    // 168 px across, 28 px down: the shallow axis is dropped, so it reads 3 m
    fireEvent.pointerMove(svg, { ...pt(568, 328), shiftKey: true });
    expect(tape(svg)!.querySelector(".ds-tape-len")!.textContent).toBe("3.00 m");
  });

  /* no scale, no metres — the tool is greyed out in the menu, and even armed
     it stays silent rather than showing a number with no unit */
  it("says nothing on an uncalibrated floor", () => {
    const { svg } = renderCanvas(mkDoc(null));
    fireEvent.pointerDown(svg, pt(400, 300));
    fireEvent.pointerMove(svg, pt(568, 300));
    expect(tape(svg)).toBeNull();
  });
});
