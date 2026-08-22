/* Drop = attribution (Units on the bar, slice 4).

   The pure stamp (roomAtPoint) is coverage.ts's; this file pins the canvas's
   half of the contract, through real drop events and the committed document:

   - containment wins: an IDU dropped inside a room serves THAT room;
   - a split IDU dropped outside EVERY room still serves the lens room (the
     plan's own "Bulkhead AC in the hallway void" case) — and only a split:
     other modules keep today's no-stamp until their flows land;
   - while an IDU rides the cursor, every room wears its fit verdict as paint
     (armfit-*), and the room that would take the drop — containment, else
     the lens — carries the verdict line;
   - the missed-fit verdict a host passes in (roomFits) persists on the
     room's area label after the drop.

   The canvas opens fitted to content, so the zoom depends on the scene:
   each test reads the viewport group's transform back off the svg and maps
   world → client through it (jsdom's zero rect makes client = screen). */

import { render, fireEvent, screen } from "@testing-library/react";
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

/** world → client, via the rendered viewport transform
    (scale(z) translate(tx ty) ⇒ client = (world + t) · z) */
function mapper(svg: SVGSVGElement) {
  const g = svg.querySelector("g[transform]")!;
  const m = g
    .getAttribute("transform")!
    .match(/scale\(([-\d.e]+)\) translate\(([-\d.e]+) ([-\d.e]+)\)/)!;
  const z = parseFloat(m[1]);
  const tx = parseFloat(m[2]);
  const ty = parseFloat(m[3]);
  return {
    sx: (x: number) => (x + tx) * z,
    sy: (y: number) => (y + ty) * z,
  };
}

const rect = (x: number, y: number, w: number, h: number) => ({
  kind: "polygon" as const,
  points: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
});

const room = (
  id: string,
  name: string,
  geo: ReturnType<typeof rect>,
  systemId = "sys1"
): DesignObject => ({
  id,
  type: "room",
  systemId,
  floorId: "flr",
  geometry: geo,
  plane: "room",
  props: { name, shape: "rect" },
});

function mkDoc(
  objects: DesignObject[],
  settings: Record<string, unknown> = {},
  type = "split"
): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-08-22T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    { id: "sys1", type: type as never, brand: "me", colour: "#2E68FF", name: "S1", settings },
    { id: "sys2", type: "split", brand: "me", colour: "#E4572E", name: "S2", settings: {} },
  ];
  d.settings.climateZone = "5";
  d.objects = objects;
  return d;
}

const IDU = { role: "idu" as const, model: "IDU-25", widthMm: 798, depthMm: 219 };

function renderPlace(opts: {
  doc: DesignDocument;
  placing?: typeof IDU | { role: "odu"; model: string; widthMm: number; depthMm: number } | null;
  placingKw?: number | null;
  roomFits?: Record<string, "oversized" | "undersized">;
  onMutate?: (fn: (d: DesignDocument) => DesignDocument) => void;
}) {
  const utils = render(
    <StudioCanvas
      doc={opts.doc}
      floor={floor}
      tool={opts.placing ? "place" : "select"}
      selectedId={null}
      onSelect={() => {}}
      onMutate={opts.onMutate ?? (() => {})}
      onToolDone={() => {}}
      activeSystemId="sys1"
      placing={opts.placing ?? null}
      placingKw={opts.placingKw ?? null}
      roomFits={opts.roomFits}
      onPlaced={() => {}}
      component={null}
      iduSpec={() => null}
      onRoomCreated={() => {}}
      onRemarkConsumed={() => {}}
      onReshapeConsumed={() => {}}
    />
  );
  return { ...utils, svg: utils.container.querySelector("svg")! };
}

/** commit a placement at world (x,y) — the place tool's own tap gesture
    (down + release in place), the same path a click-armed unit lands by.
    jsdom's DragEvent drops its coordinates, so the native-drag drop path
    can't be driven here; both funnel into the same addUnit. */
function dropAt(
  svg: SVGSVGElement,
  onMutate: { next?: DesignDocument },
  x: number,
  y: number
) {
  const { sx, sy } = mapper(svg);
  const at = { clientX: sx(x), clientY: sy(y), button: 0, pointerId: 1 };
  fireEvent.pointerDown(svg, at);
  fireEvent.pointerUp(svg, at);
  return onMutate.next!;
}

/** hover the cursor at world (x,y) */
function moveTo(svg: SVGSVGElement, x: number, y: number) {
  const { sx, sy } = mapper(svg);
  fireEvent.pointerMove(svg, { clientX: sx(x), clientY: sy(y), pointerId: 1 });
}

const placedUnit = (d: DesignDocument) =>
  d.objects.find((o) => o.type === "unit")!;

describe("drop = attribution", () => {
  /* Lounge contains the origin; Study is off to the right; sys2 owns Spare */
  const lounge = () => room("lounge", "Lounge", rect(-100, -100, 200, 200));
  const study = () => room("study", "Study", rect(150, -100, 150, 150));

  it("containment wins: a drop inside a room serves that room", () => {
    const d = mkDoc([lounge(), study()], { roomId: "lounge" });
    const cap: { next?: DesignDocument } = {};
    const { svg } = renderPlace({ doc: d, placing: IDU, onMutate: (fn) => (cap.next = fn(d)) });
    const next = dropAt(svg, cap, 200, -50); // inside Study
    expect(placedUnit(next).props.roomId).toBe("study");
  });

  it("a split IDU dropped outside every room serves the lens room", () => {
    const d = mkDoc([lounge(), study()], { roomId: "study" });
    const cap: { next?: DesignDocument } = {};
    const { svg } = renderPlace({ doc: d, placing: IDU, onMutate: (fn) => (cap.next = fn(d)) });
    const next = dropAt(svg, cap, 500, 300); // hallway void — no room here
    expect(placedUnit(next).props.roomId).toBe("study");
  });

  it("without a chosen pair room the fallback is the first served room", () => {
    const d = mkDoc([lounge(), study()]);
    const cap: { next?: DesignDocument } = {};
    const { svg } = renderPlace({ doc: d, placing: IDU, onMutate: (fn) => (cap.next = fn(d)) });
    const next = dropAt(svg, cap, 500, 300);
    expect(placedUnit(next).props.roomId).toBe("lounge");
  });

  it("the fallback is module-gated: a non-split drop outside rooms stays unstamped", () => {
    const d = mkDoc([lounge()], { roomId: "lounge" }, "multi-split");
    const cap: { next?: DesignDocument } = {};
    const { svg } = renderPlace({ doc: d, placing: IDU, onMutate: (fn) => (cap.next = fn(d)) });
    const next = dropAt(svg, cap, 500, 300);
    expect(placedUnit(next).props.roomId).toBeUndefined();
  });

  it("an outdoor unit never takes a room attribution", () => {
    const d = mkDoc([lounge()], { roomId: "lounge" });
    const cap: { next?: DesignDocument } = {};
    const { svg } = renderPlace({
      doc: d,
      placing: { role: "odu", model: "ODU-25", widthMm: 800, depthMm: 285 },
      onMutate: (fn) => (cap.next = fn(d)),
    });
    const next = dropAt(svg, cap, 0, 0); // inside the Lounge, even
    expect(placedUnit(next).props.roomId).toBeUndefined();
  });
});

describe("the fit verdict while a unit rides the cursor", () => {
  /* loads at zone-5 defaults ≈ 145 W/m²: 14 m² ≈ 2.0 kW (2.5 fits), 1 m²
     is far under the 150% cap (oversized), 1000 m² dwarfs it (undersized) */
  const fitsRoom = () => room("r-fit", "Bedroom", rect(-100, -100, 350, 400)); // 3.5×4 m
  const tinyRoom = () => room("r-tiny", "Pantry", rect(300, -100, 100, 100)); // 1×1 m
  const hugeRoom = () => room("r-huge", "Warehouse", rect(-100, 400, 5000, 2000)); // 50×20 m

  const armedDoc = () =>
    mkDoc([fitsRoom(), tinyRoom(), hugeRoom()], { roomId: "r-fit" });

  it("paints every room by how the armed capacity sits against ITS load", () => {
    const { container } = renderPlace({ doc: armedDoc(), placing: IDU, placingKw: 2.5 });
    const classes = [...container.querySelectorAll(".ds-room")].map(
      (g) => g.getAttribute("class")!
    );
    expect(classes.find((c) => c.includes("armfit-fits"))).toBeTruthy();
    expect(classes.find((c) => c.includes("armfit-oversized"))).toBeTruthy();
    expect(classes.find((c) => c.includes("armfit-undersized"))).toBeTruthy();
  });

  it("carries the verdict on the room under the cursor", () => {
    const { svg } = renderPlace({ doc: armedDoc(), placing: IDU, placingKw: 2.5 });
    moveTo(svg, 320, -80); // in the pantry
    expect(screen.getByText(/IDU-25 oversized — needs ≈/)).toBeInTheDocument();
  });

  it("hands the verdict to the lens room while the cursor is outside every room", () => {
    const { svg, container } = renderPlace({ doc: armedDoc(), placing: IDU, placingKw: 2.5 });
    moveTo(svg, 600, 200); // no room here
    expect(screen.getByText(/IDU-25 fits — needs ≈/)).toBeInTheDocument();
    const target = [...container.querySelectorAll(".ds-room")].find((g) =>
      g.getAttribute("class")!.includes("droptgt")
    );
    expect(target!.textContent).toContain("Bedroom");
  });

  it("says nothing while armed with an outdoor unit", () => {
    const { container } = renderPlace({
      doc: armedDoc(),
      placing: { role: "odu", model: "ODU-25", widthMm: 800, depthMm: 285 },
      placingKw: null,
    });
    expect(container.querySelector('[class*="armfit"]')).toBeNull();
  });

  it("wears the persistent verdict a host reports on the area label", () => {
    const { container } = renderPlace({
      doc: mkDoc([fitsRoom()], {}),
      roomFits: { "r-fit": "undersized" },
    });
    expect(container.textContent).toContain("· undersized");
  });
});
