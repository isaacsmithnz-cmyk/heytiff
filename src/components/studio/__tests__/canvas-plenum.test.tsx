/* Ducted Step 2 — plenums on the canvas: placement snapping to an AHU end
   (stream-filtered by the HUD toggle), derived-position carry when the AHU
   moves, the facet render state, built-in-return handling, socket outlines,
   delete-the-AHU carry, and the roster ⤢ chip on spill rooms.

   jsdom has no layout: the blank floor (scale 10 mm/unit → grid 100) opens at
   zoom 0.56 with the world origin at screen centre (400,300), so client
   coordinates map straight to screen (see canvas.test.tsx). The test AHU is
   1400×732 mm at world (0,0) → footprint 140×73.2 world units; its supply end
   face sits at world x=+70 → screen x≈439, the return end at x=−70 → ≈361. */

import { render, fireEvent } from "@testing-library/react";
import { StudioCanvas, type ArmedComponent } from "../canvas";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type Floor,
} from "@/lib/studio/document";
import type { IndoorUnit, OpeningSpec } from "@/lib/studio/packs/schema";

const floor: Floor = {
  id: "flr",
  name: "G",
  level: 0,
  scaleMmPerUnit: 10,
  northDeg: null,
  northPos: null,
  simplePlan: null,
  plans: [],
};

/** a ducted-form pack row — air openings + airflow make it air-capable */
function peadRow(returnOpening: OpeningSpec = { w_mm: 900, h_mm: 250 }): IndoorUnit {
  return {
    model: "PEAD-TEST",
    brand: "me",
    series: "PEAD",
    form_factor: "ducted",
    capacity_cool_kw: 10,
    capacity_heat_kw: 11.2,
    airflow_ls: 567,
    supply_opening: { w_mm: 1000, h_mm: 250 },
    return_opening: returnOpening,
    conn_liquid_mm: 9.52,
    conn_gas_mm: 15.88,
    default_plane: "ceiling-cavity",
    allowed_planes: ["ceiling-cavity"],
    system_roles: ["split-pair"],
    refrigerant: "R32",
    width_mm: 1400,
    depth_mm: 732,
    height_mm: 250,
    provenance: { kind: "user-entered", source: "test" },
  };
}

const ahu = (at = { x: 0, y: 0 }): DesignObject => ({
  id: "u1",
  type: "unit",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at },
  plane: "ceiling-cavity",
  props: { role: "idu", model: "PEAD-TEST", widthMm: 1400, depthMm: 732 },
});

const plenum = (spigots: unknown[] = [], end: "supply" | "return" = "supply"): DesignObject => ({
  id: "pl1",
  type: "plenum",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 70, y: 0 } },
  plane: "ceiling-cavity",
  props: { stream: end, unitId: "u1", end, spigots },
});

function mkDoc(objects: DesignObject[], units: "mm" | "inch" = "mm"): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-14T00:00:00.000Z" });
  d.floors = [floor];
  d.settings.units = units;
  d.systems = [
    { id: "sys1", type: "ducted", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  d.objects = objects;
  return d;
}

function renderCanvas(opts: {
  doc: DesignDocument;
  component?: ArmedComponent | null;
  row?: IndoorUnit;
  selectedId?: string | null;
  onMutate?: (fn: (d: DesignDocument) => DesignDocument) => void;
  onComponentPlaced?: () => void;
}) {
  const row = opts.row ?? peadRow();
  const utils = render(
    <StudioCanvas
      doc={opts.doc}
      floor={floor}
      tool={opts.component ? "component" : "select"}
      selectedId={opts.selectedId ?? null}
      onSelect={() => {}}
      onMutate={opts.onMutate ?? (() => {})}
      onToolDone={() => {}}
      activeSystemId="sys1"
      component={opts.component ?? null}
      onComponentPlaced={opts.onComponentPlaced}
      iduSpec={(model) => (model === row.model ? row : null)}
      onPlaced={() => {}}
      onRoomCreated={() => {}}
      onRemarkConsumed={() => {}}
    />
  );
  const svg = utils.container.querySelector("svg")!;
  return { ...utils, svg };
}

const pt = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });

/** first point of a polygon's points attribute */
function firstPoint(el: Element): { x: number; y: number } {
  const [x, y] = el.getAttribute("points")!.split(" ")[0].split(",").map(Number);
  return { x, y };
}

describe("plenum placement (component tool)", () => {
  it("clicking the glowing supply end creates a supply plenum anchored to the AHU", () => {
    const doc = mkDoc([ahu()]);
    let next: DesignDocument | undefined;
    const placed = jest.fn();
    const { svg } = renderCanvas({
      doc,
      component: { kind: "plenum", stream: "supply" },
      onMutate: (fn) => (next = fn(doc)),
      onComponentPlaced: placed,
    });

    // undetermined orientation: BOTH long faces are candidates for the armed
    // stream — the first placement decides (spec §1a)
    expect(svg.querySelectorAll(".ds-plenum-face")).toHaveLength(2);
    // hovering the +y face (the default supply face) lights it + ghost
    fireEvent.pointerMove(svg, pt(400, 320));
    expect(svg.querySelector(".ds-plenum-face.ready")).not.toBeNull();
    expect(svg.querySelector(".ds-plenum-ghost")).not.toBeNull();

    fireEvent.pointerDown(svg, pt(400, 320));
    const pl = next!.objects.find((o) => o.type === "plenum")!;
    expect(pl.props).toMatchObject({
      stream: "supply",
      unitId: "u1",
      end: "supply",
      spigots: [],
    });
    expect(pl.systemId).toBe("sys1");
    expect(pl.plane).toBe("ceiling-cavity");
    // the default face was used — no flip written
    expect(next!.objects.find((o) => o.id === "u1")!.props.airFlip).toBeUndefined();
    expect(placed).toHaveBeenCalled();
  });

  it("clicking the OPPOSITE face while undetermined flips the unit — that face becomes supply", () => {
    const doc = mkDoc([ahu()]);
    let next: DesignDocument | undefined;
    const { svg } = renderCanvas({
      doc,
      component: { kind: "plenum", stream: "supply" },
      onMutate: (fn) => (next = fn(doc)),
    });
    fireEvent.pointerMove(svg, pt(400, 280)); // the −y face
    fireEvent.pointerDown(svg, pt(400, 280));
    const pl = next!.objects.find((o) => o.type === "plenum")!;
    expect(pl.props).toMatchObject({ stream: "supply", end: "supply" });
    // first placement decided: the unit flipped so −y IS the supply face
    expect(next!.objects.find((o) => o.id === "u1")!.props.airFlip).toBe(true);
  });

  it("once determined, only the correct face is offered — the fitted face refuses", () => {
    const doc = mkDoc([ahu(), plenum()]); // supply plenum fitted (default +y)
    const onMutate = jest.fn();
    const { svg } = renderCanvas({
      doc,
      component: { kind: "plenum", stream: "return" },
      onMutate,
    });
    // determined: exactly ONE candidate (the opposite face)
    expect(svg.querySelectorAll(".ds-plenum-face")).toHaveLength(1);
    fireEvent.pointerDown(svg, pt(400, 320)); // the supply face — occupied
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("an occupied end stops glowing and refuses a second plenum", () => {
    const doc = mkDoc([ahu(), plenum()]);
    const onMutate = jest.fn();
    const { svg } = renderCanvas({
      doc,
      component: { kind: "plenum", stream: "supply" },
      onMutate,
    });
    expect(svg.querySelectorAll(".ds-plenum-face")).toHaveLength(0);
    fireEvent.pointerDown(svg, pt(439, 300));
    expect(onMutate).not.toHaveBeenCalled();
  });
});

describe("plenum rendering", () => {
  it("a bare undetermined AHU is a PLAIN rectangle — no sockets, arrow or labels", () => {
    const doc = mkDoc([ahu()]);
    const { svg } = renderCanvas({ doc });
    // nothing connected → no drop hints, no arrow, no supply?/return? clutter
    expect(svg.querySelectorAll(".ds-ahu-socket")).toHaveLength(0);
    expect(svg.querySelector(".ds-ahu-flow")).toBeNull();
    expect(svg.querySelectorAll(".ds-ahu-face-label")).toHaveLength(0);
  });

  it("the first plenum makes the arrow + SUPPLY/RETURN labels appear (spec §1a)", () => {
    const { svg } = renderCanvas({ doc: mkDoc([ahu(), plenum()]) });
    expect(svg.querySelector(".ds-ahu-flow")).not.toBeNull();
    const labels = [...svg.querySelectorAll(".ds-ahu-face-label")].map((t) => t.textContent);
    expect(labels.sort()).toEqual(["RETURN", "SUPPLY"]);
  });

  it("a fitted supply plenum: base WIDEST on the unit, tapering OUT (spec §1b)", () => {
    const doc = mkDoc([ahu(), plenum()]);
    const { svg } = renderCanvas({ doc });
    expect(svg.querySelectorAll(".ds-ahu-socket")).toHaveLength(1); // return only
    const body = svg.querySelector(".ds-plenum-body")!;
    const pts = body.getAttribute("points")!.split(" ").map((p) => {
      const [x, y] = p.split(",").map(Number);
      return { x, y };
    });
    expect(pts).toHaveLength(4); // trapezoid, never refaceted
    // air flows through the DEPTH: the base edge (the y nearer the unit
    // centre) spans WIDER in x than the far spigot face — tapering outward
    const ys = [...new Set(pts.map((p) => p.y))];
    const nearY = ys.sort((a, b) => Math.abs(a) - Math.abs(b))[0]; // base, on the unit
    const farY = ys[ys.length - 1];
    const spanAt = (y: number) => {
      const xs = pts.filter((p) => Math.abs(p.y - y) < 1e-6).map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spanAt(nearY)).toBeGreaterThan(spanAt(farY));
    // base 1000 mm × 400 depth, from the engine
    expect(svg.querySelector(".ds-plenum-label")!.textContent).toBe("1000 × 400");
  });

  it("spigots render as RECTANGLES on the narrow face, no refacet", () => {
    const spigs = [
      { id: "s1", diaMm: 350, t: 0.33, face: "front" },
      { id: "s2", diaMm: 350, t: 0.66, face: "front" },
    ];
    const doc = mkDoc([ahu(), plenum(spigs)], "inch");
    const { svg } = renderCanvas({ doc });
    const label = svg.querySelector(".ds-plenum-label")!;
    // 2×350 + 3×50 = 850 ≤ 1000 base → a clean trapezoid, no "(3-face)"
    expect(label.textContent).toBe('1000 × 400 · 2 × 14"');
    // spigots are rectangles (polygons), not circles
    expect(svg.querySelectorAll(".ds-spigot polygon")).toHaveLength(2);
    expect(svg.querySelectorAll(".ds-spigot circle")).toHaveLength(0);
    // body stays a 4-point trapezoid (the 3-face refacet model is gone)
    const body = svg.querySelector(".ds-plenum-body")!;
    expect(body.getAttribute("points")!.split(" ")).toHaveLength(4);
  });

  it("too many ducts for the opening → the over-spigot warning state", () => {
    const spigs = [0.2, 0.4, 0.6, 0.8].map((t, i) => ({
      id: `s${i}`,
      diaMm: 350,
      t,
      face: "front",
    }));
    const doc = mkDoc([ahu(), plenum(spigs)], "inch");
    const { svg } = renderCanvas({ doc });
    // 4×350 + 5×50 = 1650 > 1000 base → over-spigot
    expect(svg.querySelector(".ds-plenum.over")).not.toBeNull();
  });

  it("capped spigots wear the blanking-cap tick", () => {
    const doc = mkDoc([
      ahu(),
      plenum([{ id: "s1", diaMm: 350, t: 0.5, face: "front", capped: true }]),
    ]);
    const { svg } = renderCanvas({ doc });
    expect(svg.querySelector(".ds-spigot-cap")).not.toBeNull();
  });

  it("moving the AHU carries its plenums — position derives, never stored", () => {
    const { svg, rerender } = renderCanvas({ doc: mkDoc([ahu(), plenum()]) });
    const before = firstPoint(svg.querySelector(".ds-plenum-body")!);

    // same plenum object (stored point untouched), the unit moved
    const row = peadRow();
    rerender(
      <StudioCanvas
        doc={mkDoc([ahu({ x: 100, y: 50 }), plenum()])}
        floor={floor}
        tool="select"
        selectedId={null}
        onSelect={() => {}}
        onMutate={() => {}}
        onToolDone={() => {}}
        activeSystemId="sys1"
        iduSpec={(model) => (model === row.model ? row : null)}
        onPlaced={() => {}}
        onRoomCreated={() => {}}
        onRemarkConsumed={() => {}}
      />
    );
    // the plenum body shifts by the SAME world delta as the AHU (100, 50)
    const after = firstPoint(svg.querySelector(".ds-plenum-body")!);
    expect(after.x - before.x).toBeCloseTo(100, 3);
    expect(after.y - before.y).toBeCloseTo(50, 3);
  });
});

describe("built-in return (pack flag)", () => {
  const builtIn = peadRow("built-in");

  it("determines the unit on placement: return spigots + arrow pop up, supply socket hints", () => {
    const doc = mkDoc([ahu()]);
    const { svg } = renderCanvas({ doc, row: builtIn });
    // built-in return orients the unit without any plenum (spec §1a)
    expect(svg.querySelector(".ds-plenum-builtin")).not.toBeNull();
    expect(svg.querySelectorAll(".ds-spigot-fixed").length).toBeGreaterThan(0); // return spigots
    expect(svg.querySelector(".ds-ahu-flow")).not.toBeNull(); // arrow appears
    const labels = [...svg.querySelectorAll(".ds-ahu-face-label")].map((t) => t.textContent);
    expect(labels.sort()).toEqual(["RETURN", "SUPPLY"]);
    // only the supply face is open → one socket hint
    expect(svg.querySelectorAll(".ds-ahu-socket")).toHaveLength(1);
  });

  it("refuses a return plenum on that unit — its drop zone never offers", () => {
    const doc = mkDoc([ahu()]);
    const onMutate = jest.fn();
    const { svg } = renderCanvas({
      doc,
      row: builtIn,
      component: { kind: "plenum", stream: "return" },
      onMutate,
    });
    expect(svg.querySelectorAll(".ds-plenum-dropzone")).toHaveLength(0); // no zone
    fireEvent.pointerDown(svg, pt(361, 300));
    expect(onMutate).not.toHaveBeenCalled();
  });
});

describe("AHU lifecycle carries plenums", () => {
  it("the Delete key on the AHU removes its plenums with it", () => {
    const doc = mkDoc([ahu(), plenum()]);
    let next: DesignDocument | undefined;
    renderCanvas({ doc, selectedId: "u1", onMutate: (fn) => (next = fn(doc)) });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(next!.objects).toHaveLength(0);
  });

  it("the eraser on the AHU removes its plenums with it", () => {
    const doc = mkDoc([ahu(), plenum()]);
    let next: DesignDocument | undefined;
    const row = peadRow();
    const { container } = render(
      <StudioCanvas
        doc={doc}
        floor={floor}
        tool="erase"
        selectedId={null}
        onSelect={() => {}}
        onMutate={(fn) => (next = fn(doc))}
        onToolDone={() => {}}
        activeSystemId="sys1"
        iduSpec={(model) => (model === row.model ? row : null)}
        onPlaced={() => {}}
        onRoomCreated={() => {}}
        onRemarkConsumed={() => {}}
      />
    );
    const svg = container.querySelector("svg")!;
    fireEvent.pointerDown(svg, pt(400, 300)); // the unit body
    expect(next!.objects).toHaveLength(0);
  });
});

describe("spill room chip", () => {
  it("spill rooms wear the ⤢ suffix on their canvas label", () => {
    const room: DesignObject = {
      id: "r1",
      type: "room",
      systemId: "sys1",
      floorId: "flr",
      geometry: {
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      },
      plane: "room",
      props: { name: "Hall", spill: true },
    };
    const { svg } = renderCanvas({ doc: mkDoc([room]) });
    expect(svg.querySelector(".ds-room-name")!.textContent).toBe("Hall ⤢");
  });
});
