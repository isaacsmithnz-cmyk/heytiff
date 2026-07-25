/* The plan carries no text on its units any more: role and model used to sit
   stacked on every box, and alongside face labels, spigot diameters and pipe
   lengths the drawing stopped being readable. Identity moved to a corner card
   that names whatever the pointer is over. Print is a DIFFERENT renderer
   (summary/plan-figure.tsx) and keeps its labels — paper can't be hovered.

   jsdom has no layout: blank floor (10 mm/unit → grid 100) opens at zoom 0.56,
   world origin at screen centre (400,300). A unit at world (0,0) is therefore
   grabbed at screen (400,300). */

import { render, fireEvent } from "@testing-library/react";
import { StudioCanvas } from "../canvas";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type Floor,
} from "@/lib/studio/document";
import type { IndoorUnit, OutdoorUnit } from "@/lib/studio/packs/schema";

const floor: Floor = {
  id: "flr",
  name: "G",
  level: 0,
  scaleMmPerUnit: 10,
  northDeg: null,
  northPos: null,
  plans: [],
};

const unit = (
  id: string,
  role: "idu" | "odu",
  at = { x: 0, y: 0 },
  props: Record<string, unknown> = {}
): DesignObject => ({
  id,
  type: "unit",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at },
  plane: role === "odu" ? "external-ground" : "room",
  props: { role, model: role === "idu" ? "MSZ-AP25" : "MUZ-AP25", widthMm: 800, depthMm: 300, ...props },
});

const room = (id: string, name: string, pts: { x: number; y: number }[]): DesignObject => ({
  id,
  type: "room",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "polygon", points: pts },
  plane: "room",
  props: { name },
});

const IDU_ROW = {
  model: "MSZ-AP25",
  brand: "me",
  series: "AP",
  form_factor: "wall",
  capacity_cool_kw: 2.5,
  capacity_heat_kw: 3.2,
} as unknown as IndoorUnit;

const ODU_ROW = {
  model: "MUZ-AP25",
  brand: "me",
  series: "AP",
  system_type: "split",
  capacity_cool_kw: 2.5,
  capacity_heat_kw: 3.2,
  phase: "1ph",
} as unknown as OutdoorUnit;

function mkDoc(objects: DesignObject[]): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-23T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "System 1", settings: {} },
  ];
  d.objects = objects;
  return d;
}

function renderCanvas(
  doc: DesignDocument,
  over: Partial<React.ComponentProps<typeof StudioCanvas>> = {}
) {
  const onSelect = jest.fn();
  const utils = render(
    <StudioCanvas
      doc={doc}
      floor={floor}
      tool="select"
      selectedId={null}
      onSelect={onSelect}
      onMutate={() => {}}
      onToolDone={() => {}}
      activeSystemId="sys1"
      component={null}
      iduSpec={(m) => (m === IDU_ROW.model ? IDU_ROW : null)}
      oduSpec={(m) => (m === ODU_ROW.model ? ODU_ROW : null)}
      onPlaced={() => {}}
      onRoomCreated={() => {}}
      onRemarkConsumed={() => {}}
      {...over}
    />
  );
  return { ...utils, onSelect, svg: utils.container.querySelector("svg")! };
}

const pt = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });
const ON_UNIT = pt(400, 300); // world (0,0)
const OFF_UNIT = pt(700, 560); // clear of every footprint

describe("units carry no text on the plan", () => {
  it("renders no role or model label on a placed unit", () => {
    const { container } = renderCanvas(mkDoc([unit("u1", "idu")]));
    expect(container.querySelector(".ds-unit-role")).toBeNull();
    expect(container.querySelector(".ds-unit-model")).toBeNull();
    expect(container.textContent).not.toContain("MSZ-AP25");
  });

  it("still draws the unit itself — only the text went", () => {
    const { container } = renderCanvas(mkDoc([unit("u1", "idu")]));
    expect(container.querySelector(".ds-unit")).toBeTruthy();
  });
});

describe("the hovered-unit card", () => {
  it("names the unit under the pointer and clears when it leaves", () => {
    const { container, svg } = renderCanvas(mkDoc([unit("u1", "idu")]));
    expect(container.querySelector(".ds-unitcard")).toBeNull();

    fireEvent.pointerMove(svg, ON_UNIT);
    const card = container.querySelector(".ds-unitcard")!;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("Indoor unit");
    expect(card.textContent).toContain("MSZ-AP25");
    expect(card.textContent).toContain("System 1");

    fireEvent.pointerMove(svg, OFF_UNIT);
    expect(container.querySelector(".ds-unitcard")).toBeNull();
  });

  it("carries the detail that never fitted on the plan", () => {
    const { container, svg } = renderCanvas(
      mkDoc([
        room("r1", "Lounge", [
          { x: -200, y: -200 },
          { x: 200, y: -200 },
          { x: 200, y: 200 },
          { x: -200, y: 200 },
        ]),
        unit("u1", "idu"),
      ])
    );
    fireEvent.pointerMove(svg, ON_UNIT);
    const card = container.querySelector(".ds-unitcard")!;
    expect(card.textContent).toContain("Wall-mounted"); // form factor, spelled out
    expect(card.textContent).toContain("2.5 kW cool · 3.2 kW heat");
    expect(card.textContent).toContain("Lounge"); // the room it serves
    expect(card.textContent).toContain("800 × 300 mm");
  });

  it("names outdoor units too", () => {
    const { container, svg } = renderCanvas(mkDoc([unit("o1", "odu")]));
    fireEvent.pointerMove(svg, ON_UNIT);
    const card = container.querySelector(".ds-unitcard")!;
    expect(card.textContent).toContain("Outdoor unit");
    expect(card.textContent).toContain("MUZ-AP25");
    // an outdoor unit serves no single room — the row is simply absent
    expect(card.textContent).not.toContain("Serves");
  });

  it("says so when a unit has no model yet, rather than showing a blank", () => {
    const { container, svg } = renderCanvas(mkDoc([unit("u1", "idu", { x: 0, y: 0 }, { model: "" })]));
    fireEvent.pointerMove(svg, ON_UNIT);
    expect(container.querySelector(".ds-unitcard")!.textContent).toContain("No model yet");
  });

  it("hovering does not select — clicking still does", () => {
    const { svg, onSelect } = renderCanvas(mkDoc([unit("u1", "idu")]));
    fireEvent.pointerMove(svg, ON_UNIT);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(svg, ON_UNIT);
    expect(onSelect).toHaveBeenCalledWith("u1");
  });

  it("goes quiet while a drag is in flight", () => {
    const { container, svg } = renderCanvas(mkDoc([unit("u1", "idu")]));
    fireEvent.pointerMove(svg, ON_UNIT);
    expect(container.querySelector(".ds-unitcard")).toBeTruthy();
    // press starts a point-drag on the unit; the card must not ride along
    fireEvent.pointerDown(svg, ON_UNIT);
    fireEvent.pointerMove(svg, pt(420, 320));
    expect(container.querySelector(".ds-unitcard")).toBeNull();
  });

  it("goes quiet while a drawing tool is armed", () => {
    const { container, svg } = renderCanvas(mkDoc([unit("u1", "idu")]), { tool: "pipe" });
    fireEvent.pointerMove(svg, ON_UNIT);
    expect(container.querySelector(".ds-unitcard")).toBeNull();
  });

  it("clears when the pointer leaves the canvas entirely", () => {
    const { container, svg } = renderCanvas(mkDoc([unit("u1", "idu")]));
    fireEvent.pointerMove(svg, ON_UNIT);
    expect(container.querySelector(".ds-unitcard")).toBeTruthy();
    fireEvent.pointerLeave(svg);
    expect(container.querySelector(".ds-unitcard")).toBeNull();
  });
});
