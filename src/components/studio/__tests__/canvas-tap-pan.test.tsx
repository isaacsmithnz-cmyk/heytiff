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
import type { WheelMode } from "@/lib/studio/wheel";

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

function renderCanvas(
  tool: CanvasTool,
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void = () => {},
  wheelMode: WheelMode = "pan"
) {
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
      wheelMode={wheelMode}
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

  /* What a bare scroll does is the user's SETTING — reading it off the event
     was wrong twice (see wheel.ts). Pan is the trackpad's only pan gesture:
     middle-drag needs a button it hasn't got, and hold-Space is swallowed once
     focus is in the measurement field. Zoom is what a mouse wheel wants, and
     is the default. Both are pinned here, through the real component. */
  describe("wheel gestures", () => {
    /** `scale(z) translate(-x -y)` — pulled apart so a pan and a zoom can be
        told from each other rather than just "the transform changed" */
    const readVp = (t: string) => {
      const m = /^scale\(([-\d.]+)\) translate\(([-\d.]+) ([-\d.]+)\)$/.exec(t)!;
      return { zoom: +m[1], x: -+m[2], y: -+m[3] };
    };

    it("a two-finger scroll pans, and does not zoom", () => {
      const { svg, viewport } = renderCanvas("calibrate", undefined, "pan");
      const before = readVp(viewport());

      // trackpad shape: pixel units, fractional, both axes live
      fireEvent.wheel(svg, { deltaX: 24.5, deltaY: 12.25, deltaMode: 0 });

      const after = readVp(viewport());
      expect(after.zoom).toBe(before.zoom);
      expect(after.x).toBeGreaterThan(before.x);
      expect(after.y).toBeGreaterThan(before.y);
    });

    /* the sharpest edge of the old handler: a sideways swipe has deltaY 0,
       which read as "not < 0" and zoomed OUT — swiping across a sheet shrank it */
    it("a sideways swipe pans sideways instead of zooming out", () => {
      const { svg, viewport } = renderCanvas("calibrate", undefined, "pan");
      const before = readVp(viewport());

      fireEvent.wheel(svg, { deltaX: -30.5, deltaY: 0, deltaMode: 0 });

      const after = readVp(viewport());
      expect(after.zoom).toBe(before.zoom);
      expect(after.x).toBeLessThan(before.x);
    });

    /* THE DEFAULT IS THE BUG SURFACE. Shipped as "zoom" it left a trackpad
       unable to cross a plan — two fingers zoomed, and a pad has no other pan
       gesture. Whatever else moves, an unset canvas pans on a bare scroll and
       zooms only on a pinch. */
    it("pans on a two-finger scroll by DEFAULT, with no mode set", () => {
      const { svg, viewport } = renderCanvas("select");
      const before = readVp(viewport());

      fireEvent.wheel(svg, { deltaX: 12.5, deltaY: 18.25, deltaMode: 0 });

      const after = readVp(viewport());
      expect(after.zoom).toBe(before.zoom);
      expect(after.x).toBeGreaterThan(before.x);
      expect(after.y).toBeGreaterThan(before.y);
    });

    it("zooms on a pinch by DEFAULT — the trackpad's only zoom", () => {
      const { svg, viewport } = renderCanvas("select");
      const before = readVp(viewport());

      fireEvent.wheel(svg, { deltaX: 0, deltaY: -8.5, deltaMode: 0, ctrlKey: true });

      expect(readVp(viewport()).zoom).toBeGreaterThan(before.zoom);
    });

    /* THE REPORT that ended the device-guessing: a Logitech wheel reports
       fractional deltas, which the old classifier called a trackpad. In zoom
       mode — the default — nothing about the delta's shape can stop it. */
    it("zooms on a high-resolution wheel's fractional delta", () => {
      const { svg, viewport } = renderCanvas("select", undefined, "zoom");
      const before = readVp(viewport());

      fireEvent.wheel(svg, { deltaX: 0, deltaY: -4.8, deltaMode: 0 });

      expect(readVp(viewport()).zoom).toBeGreaterThan(before.zoom);
    });

    /* the same event, the other way round: the setting is what decides */
    it("pans on that same delta once the wheel is set to pan", () => {
      const { svg, viewport } = renderCanvas("select", undefined, "pan");
      const before = readVp(viewport());

      fireEvent.wheel(svg, { deltaX: 0, deltaY: -4.8, deltaMode: 0 });

      const after = readVp(viewport());
      expect(after.zoom).toBe(before.zoom);
      expect(after.y).toBeLessThan(before.y);
    });

    it("a mouse notch still zooms — the mouse loses nothing", () => {
      const { svg, viewport } = renderCanvas("calibrate", undefined, "zoom");
      const before = readVp(viewport());

      fireEvent.wheel(svg, { deltaX: 0, deltaY: -120, deltaMode: 0 });

      expect(readVp(viewport()).zoom).toBeGreaterThan(before.zoom);
    });

    it("a pinch zooms — macOS sends it as ctrl+wheel", () => {
      const { svg, viewport } = renderCanvas("calibrate");
      const before = readVp(viewport());

      fireEvent.wheel(svg, { deltaX: 0, deltaY: -8.5, deltaMode: 0, ctrlKey: true });

      expect(readVp(viewport()).zoom).toBeGreaterThan(before.zoom);
    });

    it("panning by wheel places nothing", () => {
      const { svg } = renderCanvas("calibrate", undefined, "pan");
      fireEvent.wheel(svg, { deltaX: 24.5, deltaY: 12.25, deltaMode: 0 });
      expect(svg.querySelector(".ds-calib")).toBeNull();
    });

    /* A leftward pan is ALSO the macOS/Chrome back-swipe, and it fired
       mid-design and navigated away from the canvas. preventDefault can't be
       the fix — momentum wheel events are non-cancelable — so the root gets
       the declaration, and must give it back on unmount so the rest of the
       app keeps swipe-back. */
    it("locks overscroll on the root while the canvas is mounted", () => {
      expect(document.documentElement.style.overscrollBehaviorX).toBe("");
      const { unmount } = renderCanvas("select");
      expect(document.documentElement.style.overscrollBehaviorX).toBe("none");
      unmount();
      expect(document.documentElement.style.overscrollBehaviorX).toBe("");
    });

    /* a momentum event cannot be cancelled; calling preventDefault on one is
       a no-op Chrome warns about, and it must still pan */
    it("still pans on a non-cancelable momentum event", () => {
      const { svg, viewport } = renderCanvas("select", undefined, "pan");
      const before = readVp(viewport());
      fireEvent.wheel(svg, { deltaX: 18.5, deltaY: 0, deltaMode: 0, cancelable: false });
      expect(readVp(viewport()).x).toBeGreaterThan(before.x);
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
