/* ESC CANCELS — the whole of what the hint promises.

   It used to clear the in-progress draft and stop there, so pressing it with
   nothing half-drawn did nothing at all: the tool stayed armed, the crosshair
   stayed up, and the hint saying "Esc to cancel" sat on screen being wrong
   (Isaac, 2026-08-26). Right-click had always done both halves.

   Two stages, and both are asserted here because either one alone is a bug:
   mid-gesture Esc drops the SHAPE and keeps the tool (so a fumbled rectangle
   costs one keypress, not a trip back to the toolbar), and with nothing
   underway it hands the tool back. */

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

function mkDoc(): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-28T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  d.objects = [];
  return d;
}

function renderCanvas(tool: "room-rect" | "room-poly" = "room-rect") {
  const onToolDone = jest.fn();
  const doc = mkDoc();
  const utils = render(
    <StudioCanvas
      doc={doc}
      floor={doc.floors[0]}
      tool={tool}
      selectedId={null}
      onSelect={() => {}}
      onMutate={() => {}}
      onToolDone={onToolDone}
      activeSystemId="sys1"
      component={null}
      iduSpec={() => null}
      onPlaced={() => {}}
      onRoomCreated={() => {}}
      onRemarkConsumed={() => {}}
    />
  );
  return { ...utils, onToolDone, svg: utils.container.querySelector("svg")! };
}

const pt = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });
const esc = () => fireEvent.keyDown(window, { key: "Escape" });

describe("Esc cancels", () => {
  it("hands the tool back when nothing is half-drawn", () => {
    const { onToolDone } = renderCanvas();
    esc();
    expect(onToolDone).toHaveBeenCalled();
  });

  it("drops a half-drawn rectangle and KEEPS the tool for another go", () => {
    const { svg, onToolDone, container } = renderCanvas();
    fireEvent.pointerDown(svg, pt(300, 240));
    fireEvent.pointerMove(svg, pt(420, 330));
    expect(container.querySelector(".ds-draft")).toBeInTheDocument();

    esc();
    expect(container.querySelector(".ds-draft")).not.toBeInTheDocument();
    expect(onToolDone).not.toHaveBeenCalled();

    // and a second press, now that nothing is underway, lets the tool go
    esc();
    expect(onToolDone).toHaveBeenCalled();
  });

  it("does the same for a part-placed polygon", () => {
    const { svg, onToolDone } = renderCanvas("room-poly");
    fireEvent.pointerDown(svg, pt(300, 240));
    fireEvent.pointerUp(svg, pt(300, 240));

    esc();
    expect(onToolDone).not.toHaveBeenCalled();
    esc();
    expect(onToolDone).toHaveBeenCalled();
  });
});
