/* The placement ghost and placed units render a role-specific footprint glyph
   (outdoor = condenser fan, indoor = discharge louvres), not a bare box. */

import { render } from "@testing-library/react";
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
  plans: [],
};

function docWithUnit(role: "idu" | "odu"): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-11T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  const unit: DesignObject = {
    id: `u_${role}`,
    type: "unit",
    systemId: "sys1",
    floorId: "flr",
    geometry: { kind: "point", at: { x: 0, y: 0 } },
    plane: role === "idu" ? "room" : "external-ground",
    props: { role, model: role.toUpperCase(), widthMm: 800, depthMm: 300 },
  };
  d.objects = [unit];
  return d;
}

function renderCanvas(role: "idu" | "odu") {
  render(
    <StudioCanvas
      doc={docWithUnit(role)}
      floor={floor}
      tool="select"
      selectedId={null}
      onSelect={() => {}}
      onMutate={() => {}}
      onToolDone={() => {}}
      activeSystemId="sys1"
      onPlaced={() => {}}
      onRoomCreated={() => {}}
      onRemarkConsumed={() => {}}
    />
  );
}

describe("unit footprint glyph", () => {
  it("an outdoor unit draws its condenser fan (hub + detail)", () => {
    renderCanvas("odu");
    expect(document.querySelector(".ds-unit-hub")).toBeInTheDocument();
    expect(document.querySelectorAll(".ds-unit-detail").length).toBeGreaterThan(1);
  });

  it("an indoor unit draws discharge louvres, no fan hub", () => {
    renderCanvas("idu");
    expect(document.querySelector(".ds-unit-hub")).toBeNull();
    // three louvre lines
    expect(document.querySelectorAll(".ds-unit-detail").length).toBe(3);
  });
});
