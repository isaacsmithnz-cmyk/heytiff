/* Canvas WIRING for rotating a placed unit (wall head / floor console /
   outdoor). The geometry already carried an optional `rotation`; this covers
   the controls that set it — the [ / ] 90° keyboard steps, the on-canvas knob,
   and that the glyph actually renders turned. Ducted AHUs turn too, carrying
   their air side with them — canvas-rotate-ahu.test.tsx covers that half,
   since it needs a pack row to read as air-capable.

   jsdom has no layout: blank floor (10 mm/unit -> grid 100) opens at zoom 0.56,
   world origin at screen centre (400,300). */

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

const unit = (id: string, role: "idu" | "odu", rotation?: number): DesignObject => ({
  id,
  type: "unit",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 0, y: 0 }, ...(rotation != null ? { rotation } : {}) },
  plane: role === "odu" ? "external-ground" : "room",
  props: { role, model: "M1", widthMm: 800, depthMm: 300 },
});

function mkDoc(objects: DesignObject[]): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-23T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  d.objects = objects;
  return d;
}

const props = (
  doc: DesignDocument,
  selectedId: string | null,
  onMutate: (fn: (d: DesignDocument) => DesignDocument) => void = () => {}
) => ({
  doc,
  floor,
  tool: "select" as const,
  selectedId,
  onSelect: () => {},
  onMutate,
  onToolDone: () => {},
  activeSystemId: "sys1",
  component: null,
  iduSpec: () => null,
  onPlaced: () => {},
  onRoomCreated: () => {},
  onRemarkConsumed: () => {},
});

function renderCanvas(
  doc: DesignDocument,
  selectedId: string | null,
  onMutate?: (fn: (d: DesignDocument) => DesignDocument) => void
) {
  const utils = render(<StudioCanvas {...props(doc, selectedId, onMutate)} />);
  return { ...utils, svg: utils.container.querySelector("svg")! };
}

const rotationOf = (d: DesignDocument, id: string) =>
  (d.objects.find((o) => o.id === id)!.geometry as { rotation?: number }).rotation;

describe("rotating a simple unit", () => {
  it("] steps the selected unit +90 degrees", () => {
    let doc = mkDoc([unit("idu", "idu")]);
    renderCanvas(doc, "idu", (fn) => (doc = fn(doc)));
    fireEvent.keyDown(window, { key: "]" });
    expect(rotationOf(doc, "idu")).toBe(90);
  });

  it("[ from 0 wraps to 270, never negative", () => {
    let doc = mkDoc([unit("odu", "odu")]);
    renderCanvas(doc, "odu", (fn) => (doc = fn(doc)));
    fireEvent.keyDown(window, { key: "[" });
    expect(rotationOf(doc, "odu")).toBe(270);
  });

  it("nothing selected -> the keys are inert", () => {
    let doc = mkDoc([unit("idu", "idu")]);
    renderCanvas(doc, null, (fn) => (doc = fn(doc)));
    fireEvent.keyDown(window, { key: "]" });
    expect(rotationOf(doc, "idu")).toBeUndefined();
  });

  it("shows a rotate knob only for the selected unit", () => {
    const off = renderCanvas(mkDoc([unit("idu", "idu")]), null);
    expect(off.svg.querySelector(".ds-rot-knob")).toBeNull();
    off.unmount();

    const on = renderCanvas(mkDoc([unit("idu", "idu")]), "idu");
    expect(on.svg.querySelector(".ds-rot-knob")).not.toBeNull();
  });

  /* the commit used to REBUILD the geometry object ({kind, at}), which
     silently dropped `rotation` — so every drag un-turned the unit you had
     just turned. Moving must carry the rotation across. */
  it("keeps the rotation when the unit is dragged somewhere else", () => {
    let doc = mkDoc([unit("idu", "idu", 90)]);
    const { svg } = renderCanvas(doc, "idu", (fn) => (doc = fn(doc)));

    // grab the unit at world origin (screen centre) and drop it to the right,
    // clear of the rotate knob that sits above the footprint
    fireEvent.pointerDown(svg, { button: 0, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(svg, { clientX: 520, clientY: 300 });
    fireEvent.pointerUp(svg, { clientX: 520, clientY: 300 });

    const moved = doc.objects.find((o) => o.id === "idu")!;
    expect((moved.geometry as { at: { x: number } }).at.x).not.toBe(0);
    expect(rotationOf(doc, "idu")).toBe(90);
  });

  it("renders the glyph turned when the unit carries a rotation", () => {
    const turned = (svg: Element) =>
      [...svg.querySelectorAll("g.ds-unit g[transform]")].some((g) =>
        g.getAttribute("transform")?.startsWith("rotate(90")
      );

    const flat = renderCanvas(mkDoc([unit("idu", "idu")]), "idu");
    expect(turned(flat.svg)).toBe(false);
    flat.unmount();

    const spun = renderCanvas(mkDoc([unit("idu", "idu", 90)]), "idu");
    expect(turned(spun.svg)).toBe(true);
  });
});
