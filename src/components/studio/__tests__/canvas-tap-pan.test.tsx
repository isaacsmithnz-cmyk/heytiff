/* Click-to-place tools are TAP-OR-PAN: press and release in place and the
   placement commits; press and travel and the same gesture pans the plan
   instead. Calibration is the reason this exists — picking two points on a
   known dimension is hopeless if you can't bring the far end into view, and
   the old escape hatches (middle-drag, hold-Space) were undiscoverable and
   Space is swallowed once focus is in the measurement field.

   jsdom has no layout: blank floor (10 mm/unit -> grid 100) opens at zoom
   0.56, world origin at screen centre (400,300). */

import { render, fireEvent } from "@testing-library/react";
import { StudioCanvas } from "../canvas";
import { createDesign, type DesignDocument, type Floor } from "@/lib/studio/document";
import type { CanvasTool } from "../canvas";

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

function renderCanvas(tool: CanvasTool, onMutate: (fn: (d: DesignDocument) => DesignDocument) => void = () => {}) {
  const doc = mkDoc();
  const utils = render(
    <StudioCanvas
      doc={doc}
      floor={floor}
      tool={tool}
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
  const svg = utils.container.querySelector("svg")!;
  /* the one <g> carrying pan/zoom — its transform IS the viewport, so it's
     how a pan is observed without any layout */
  const viewport = () =>
    [...svg.querySelectorAll("g")]
      .map((g) => g.getAttribute("transform") ?? "")
      .find((t) => t.startsWith("scale("))!;
  return { ...utils, svg, viewport };
}

const pt = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });

describe("tap-or-pan on click-to-place tools", () => {
  describe("calibrate", () => {
    it("a click in place drops a calibration point", () => {
      const { svg } = renderCanvas("calibrate");
      fireEvent.pointerDown(svg, pt(400, 300));
      fireEvent.pointerUp(svg, pt(400, 300));
      expect(svg.querySelector(".ds-calib")).not.toBeNull();
    });

    it("a drag pans instead, and drops no point", () => {
      const { svg, viewport } = renderCanvas("calibrate");
      const before = viewport();

      fireEvent.pointerDown(svg, pt(400, 300));
      fireEvent.pointerMove(svg, pt(520, 340));
      fireEvent.pointerUp(svg, pt(520, 340));

      expect(viewport()).not.toBe(before); // the plan moved
      expect(svg.querySelector(".ds-calib")).toBeNull(); // nothing was placed
    });

    /* the slop is what makes a click forgiving — a couple of px of hand
       tremor between press and release must still count as a click */
    it("a wobble under the slop is still a click", () => {
      const { svg, viewport } = renderCanvas("calibrate");
      const before = viewport();

      fireEvent.pointerDown(svg, pt(400, 300));
      fireEvent.pointerMove(svg, pt(402, 301));
      fireEvent.pointerUp(svg, pt(402, 301));

      expect(viewport()).toBe(before);
      expect(svg.querySelector(".ds-calib")).not.toBeNull();
    });
  });

  describe("set-north", () => {
    it("a click drops the north marker", () => {
      const mutations: unknown[] = [];
      const { svg } = renderCanvas("set-north", (fn) => mutations.push(fn));
      fireEvent.pointerDown(svg, pt(400, 300));
      fireEvent.pointerUp(svg, pt(400, 300));
      expect(mutations).toHaveLength(1);
    });

    it("a drag pans and writes nothing to the document", () => {
      const mutations: unknown[] = [];
      const { svg, viewport } = renderCanvas("set-north", (fn) => mutations.push(fn));
      const before = viewport();

      fireEvent.pointerDown(svg, pt(400, 300));
      fireEvent.pointerMove(svg, pt(300, 260));
      fireEvent.pointerUp(svg, pt(300, 260));

      expect(viewport()).not.toBe(before);
      expect(mutations).toHaveLength(0);
    });
  });
});
