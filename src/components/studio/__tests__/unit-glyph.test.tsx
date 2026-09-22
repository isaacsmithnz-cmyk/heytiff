/* The placement ghost and placed units render a role-specific footprint glyph
   (outdoor = condenser fan, indoor = discharge louvres), not a bare box. */

import { fireEvent, render } from "@testing-library/react";
import { StudioCanvas, type PlacingUnit } from "../canvas";
import type { IndoorUnit } from "@/lib/studio/packs/schema";
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
  northDeg: null, northPos: null,
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

function renderCanvas(role: "idu" | "odu", formFactor?: string, placing?: PlacingUnit) {
  const spec = formFactor
    ? ({ model: "IDU", form_factor: formFactor, capacity_cool_kw: 2.5, capacity_heat_kw: 3.2 } as unknown as IndoorUnit)
    : null;
  return render(
    <StudioCanvas
      iduSpec={(m) => (spec && m === spec.model ? spec : null)}
      doc={docWithUnit(role)}
      floor={floor}
      tool={placing ? "place" : "select"}
      placing={placing ?? null}
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

/* WHICH WAY IT BLOWS. A solid arrow on the body of every head the pack
   knows, pointing out of the discharge face; the pattern is the form
   factor's. An air-capable ducted unit hands over to its own flow arrow once
   a plenum has oriented it, and an outdoor unit blows nowhere anyone draws. */
describe("the throw arrow", () => {
  const throws = () => document.querySelectorAll(".ds-throw");

  it("a wall head throws one way, out the front, as a stem and a solid head", () => {
    renderCanvas("idu", "wall");
    expect(throws().length).toBe(1);
    expect(throws()[0].querySelector("line")).not.toBeNull();
    expect(throws()[0].querySelector("path")).not.toBeNull();
  });

  it("a 4-way cassette throws four ways — four arrows, not a cross", () => {
    renderCanvas("idu", "cassette-4way");
    expect(throws().length).toBe(4);
    /* each starts OFF the centre, so the four never meet in the middle */
    for (const g of throws()) {
      const l = g.querySelector("line")!;
      const x1 = Number(l.getAttribute("x1"));
      const y1 = Number(l.getAttribute("y1"));
      expect(Math.hypot(x1, y1)).toBeGreaterThan(0);
    }
  });

  it("every other head the pack knows throws one way, ducted and bulkhead included", () => {
    for (const ff of ["cassette-1way", "floor-console", "under-ceiling", "floor-concealed", "ducted", "bulkhead"]) {
      document.body.innerHTML = "";
      renderCanvas("idu", ff);
      expect([ff, throws().length]).toEqual([ff, 1]);
    }
  });

  it("an outdoor unit gets none, and so does a head the pack does not know", () => {
    renderCanvas("odu");
    expect(throws().length).toBe(0);
    document.body.innerHTML = "";
    renderCanvas("idu");
    expect(throws().length).toBe(0);
  });

  it("the arrow lies ON the body: the stem starts at the back and the head lands at the face", () => {
    renderCanvas("idu", "wall");
    const g = throws()[0];
    const l = g.querySelector("line")!;
    // 300 mm deep at 10 mm/unit, centred on y=0: back face y=-15, front y=+15
    expect(Number(l.getAttribute("y1"))).toBeGreaterThan(-15);
    expect(Number(l.getAttribute("y1"))).toBeLessThan(0);
    const tip = Number(g.querySelector("path")!.getAttribute("d")!.match(/^M[\d.-]+ ([\d.-]+)/)![1]);
    expect(tip).toBeGreaterThanOrEqual(15);
  });

  it("rides the placing ghost, so which way a unit will face is known before it is let go of", () => {
    const { container } = renderCanvas("odu", "wall", {
      role: "idu",
      model: "IDU",
      widthMm: 800,
      depthMm: 300,
    });
    const svg = container.querySelector("svg")!;
    fireEvent.pointerMove(svg, { clientX: 300, clientY: 200 });
    expect(document.querySelector(".ds-place-ghost")).not.toBeNull();
    expect(document.querySelectorAll(".ds-place-ghost .ds-throw").length).toBe(1);
  });
});
