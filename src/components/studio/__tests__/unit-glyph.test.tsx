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

/* WHICH WAY IT BLOWS. A big solid arrow shows while a head is IN HAND —
   placed from the ghost, dragged, or turned — pointing out of the discharge
   face; the pattern is the form factor's. At rest, nothing: a plan of resting
   heads each wearing an arrow was a plan of arrows. */
describe("the throw arrow", () => {
  const throws = () => document.querySelectorAll(".ds-throw");
  const grab = (svg: Element) => {
    // the unit sits at world (0,0) = screen (400,300); moving it starts a drag
    fireEvent.pointerDown(svg, { button: 0, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(svg, { clientX: 460, clientY: 340 });
  };

  it("is not there on a head at rest", () => {
    renderCanvas("idu", "wall");
    expect(throws().length).toBe(0);
  });

  it("appears while a wall head is being dragged, one way out the front, and goes when it is let go", () => {
    const { container } = renderCanvas("idu", "wall");
    const svg = container.querySelector("svg")!;
    grab(svg);
    expect(throws().length).toBe(1);
    expect(throws()[0].querySelector("line")).not.toBeNull();
    expect(throws()[0].querySelector("path")).not.toBeNull();
    fireEvent.pointerUp(svg, { clientX: 460, clientY: 340 });
    expect(throws().length).toBe(0);
  });

  it("a 4-way cassette in hand throws four ways — four arrows, not a cross", () => {
    const { container } = renderCanvas("idu", "cassette-4way");
    grab(container.querySelector("svg")!);
    expect(throws().length).toBe(4);
    for (const g of throws()) {
      const l = g.querySelector("line")!;
      expect(Math.hypot(Number(l.getAttribute("x1")), Number(l.getAttribute("y1")))).toBeGreaterThan(0);
    }
  });

  it("every other head the pack knows throws one way in hand, ducted and bulkhead included", () => {
    for (const ff of ["cassette-1way", "floor-console", "under-ceiling", "floor-concealed", "ducted", "bulkhead"]) {
      document.body.innerHTML = "";
      const { container } = renderCanvas("idu", ff);
      grab(container.querySelector("svg")!);
      expect([ff, throws().length]).toEqual([ff, 1]);
    }
  });

  it("an outdoor unit in hand gets none, and so does a head the pack does not know", () => {
    const odu = renderCanvas("odu");
    grab(odu.container.querySelector("svg")!);
    expect(throws().length).toBe(0);
    document.body.innerHTML = "";
    const idu = renderCanvas("idu");
    grab(idu.container.querySelector("svg")!);
    expect(throws().length).toBe(0);
  });

  it("is big and screen-sized: it starts at the back of the body and runs well past the face", () => {
    const { container } = renderCanvas("idu", "wall");
    grab(container.querySelector("svg")!);
    const g = throws()[0];
    const l = g.querySelector("line")!;
    const tip = Number(g.querySelector("path")!.getAttribute("d")!.match(/^M[\d.-]+ ([\d.-]+)/)![1]);
    // the unit is 300 mm deep = 30 world units, so its face is 15 from its
    // centre; the arrow leaves from the back and reaches past the face
    const y1 = Number(l.getAttribute("y1"));
    expect(tip - y1).toBeGreaterThan(30);
    expect(tip).toBeGreaterThan(15);
  });

  it("rides the placing ghost, so which way a unit will face is known before it is let go of", () => {
    const { container } = renderCanvas("odu", "wall", { role: "idu", model: "IDU", widthMm: 800, depthMm: 300 });
    fireEvent.pointerMove(container.querySelector("svg")!, { clientX: 300, clientY: 200 });
    expect(document.querySelector(".ds-place-ghost")).not.toBeNull();
    expect(document.querySelectorAll(".ds-place-ghost .ds-throw").length).toBe(1);
  });
});
