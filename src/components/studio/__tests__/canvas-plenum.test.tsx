/* Ducted Step 2 — plenums on the canvas: placement snapping to an AHU end
   (stream-filtered by the HUD toggle), derived-position carry when the AHU
   moves, the facet render state, built-in-return handling, socket outlines,
   delete-the-AHU carry, and the roster ⤢ chip on spill rooms.

   jsdom has no layout: the blank floor (scale 10 mm/unit → grid 100) opens at
   zoom 0.56 with the world origin at screen centre (400,300), so client
   coordinates map straight to screen (see canvas.test.tsx). The test AHU is
   1400×732 mm at world (0,0) → footprint 140×73.2 world units; its supply end
   face sits at world x=+70 → screen x≈439, the return end at x=−70 → ≈361. */

import { grille } from "@/lib/studio/grilles";
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
/* Click-to-place tools commit on pointer-UP, not down: a press that travels
   pans the plan instead (canvas TAP_SLOP_PX), which is what lets you move the
   drawing mid-placement. So a click in a test has to be the whole gesture. */
const clickAt = (svg: Element, x: number, y: number) => {
  fireEvent.pointerDown(svg, pt(x, y));
  fireEvent.pointerUp(svg, pt(x, y));
};

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

    clickAt(svg, 400, 320);
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
    clickAt(svg, 400, 280);
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
    clickAt(svg, 400, 320); // the supply face — occupied
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
    clickAt(svg, 439, 300);
    expect(onMutate).not.toHaveBeenCalled();
  });
});

describe("plenum rendering", () => {
  it("a bare undetermined AHU is a PLAIN rectangle — no sockets, arrow or labels", () => {
    const doc = mkDoc([ahu()]);
    const { svg } = renderCanvas({ doc });
    // nothing connected → no arrow, no supply?/return? clutter
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
    // the OPENING, W × H (1000 × 250) — the plan depth is never labelled
    expect(svg.querySelector(".ds-plenum-label")!.textContent).toBe("Supply, 1000 × 250");
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
    /* the bar names the plenum + opening; each Ø rides its own spigot */
    expect(label.textContent).toBe("Supply, 1000 × 250");
    const dias = [...svg.querySelectorAll(".ds-spigot-dia")].map((n) => n.textContent);
    expect(dias).toEqual(['14"', '14"']);
    // spigots are rectangles (polygons), not circles
    expect(svg.querySelectorAll(".ds-spigot polygon")).toHaveLength(2);
    expect(svg.querySelectorAll(".ds-spigot circle")).toHaveLength(0);
    // body stays a 4-point trapezoid (the 3-face refacet model is gone)
    const body = svg.querySelector(".ds-plenum-body")!;
    expect(body.getAttribute("points")!.split(" ")).toHaveLength(4);
  });

  /* Field feedback 2026-07-25: the first two takeoffs default to the SIDE
     faces, which slope. They used to draw as axis-aligned boxes, so the duct
     visibly hung off the angled face at an angle. */
  it("side spigots sit SQUARE to the sloped face, not axis-aligned", () => {
    const spigs = [
      { id: "s1", diaMm: 300, t: 0.5, face: "left" },
      { id: "s2", diaMm: 300, t: 0.5, face: "right" },
    ];
    const { svg } = renderCanvas({ doc: mkDoc([ahu(), plenum(spigs)]) });
    const pts = (el: Element) =>
      el.getAttribute("points")!.split(" ").map((p) => {
        const [x, y] = p.split(",").map(Number);
        return { x, y };
      });
    const sub = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      x: a.x - b.x,
      y: a.y - b.y,
    });
    const unit = (v: { x: number; y: number }) => {
      const m = Math.hypot(v.x, v.y);
      return { x: v.x / m, y: v.y / m };
    };
    const cross = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      unit(a).x * unit(b).y - unit(a).y * unit(b).x;
    const dot = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      unit(a).x * unit(b).x + unit(a).y * unit(b).y;

    // body corners: base-left, face-left, face-right, base-right
    const body = pts(svg.querySelector(".ds-plenum-body")!);
    const edges = [sub(body[1], body[0]), sub(body[2], body[3])]; // left, right
    // both sides really slope (otherwise this test proves nothing)
    for (const e of edges) {
      expect(Math.abs(e.x)).toBeGreaterThan(1);
      expect(Math.abs(e.y)).toBeGreaterThan(1);
    }

    const rects = [...svg.querySelectorAll(".ds-spigot polygon")].map(pts);
    expect(rects).toHaveLength(2);
    rects.forEach((r, i) => {
      const foot = sub(r[3], r[0]); // the edge seated on the plenum face
      const stub = sub(r[1], r[0]); // how far the takeoff stands off it
      expect(cross(foot, edges[i])).toBeCloseTo(0, 6); // parallel to the slope
      expect(dot(foot, stub)).toBeCloseTo(0, 6); // and a true rectangle
    });
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

  /* Isaac, 28 October 2026: "Any unit that's placed on the canvas should not
     have anything … Do not attach things to it" */
  it("draws nothing off the unit when it is dropped: no box, spigots or arrow", () => {
    const doc = mkDoc([ahu()]);
    const { svg } = renderCanvas({ doc, row: builtIn });
    expect(svg.querySelector(".ds-plenum-builtin")).toBeNull();
    expect(svg.querySelector(".ds-spigot-fixed")).toBeNull();
    expect(svg.querySelector(".ds-ahu-flow")).toBeNull();
    expect(svg.querySelectorAll(".ds-ahu-face-label")).toHaveLength(0);
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
    clickAt(svg, 361, 300);
    expect(onMutate).not.toHaveBeenCalled();
  });
});

describe("factory spigots on the unit (pack opening)", () => {
  /** the PEA-M HAA case: the book publishes takeoffs, not an opening */
  const sized = peadRow({ spigots: [{ count: 2, dia_mm: 400 }] });

  it("draws nothing off the unit when it is dropped: no takeoffs, label or arrow", () => {
    const doc = mkDoc([ahu()]);
    const { svg } = renderCanvas({ doc, row: sized });
    expect(svg.querySelector(".ds-plenum-body")).toBeNull();
    expect(svg.querySelector(".ds-ahu-spigots")).toBeNull();
    expect(svg.querySelector(".ds-spigot-label")).toBeNull();
    expect(svg.querySelector(".ds-ahu-flow")).toBeNull();
  });

  it("refuses a plenum on the spigot face — its drop zone never offers", () => {
    // peadRow()'s argument is the RETURN opening, so the spigots are on the
    // return face; arming a return plenum must find nowhere to land
    const doc = mkDoc([ahu()]);
    const onMutate = jest.fn();
    const { svg } = renderCanvas({
      doc,
      row: sized,
      component: { kind: "plenum", stream: "return" },
      onMutate,
    });
    expect(svg.querySelectorAll(".ds-plenum-dropzone")).toHaveLength(0);
    clickAt(svg, 361, 300);
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("the OTHER face still takes a plenum — spigots fix one face, not the unit", () => {
    // supply here is a normal W×H opening, so it must still accept a plenum
    const doc = mkDoc([ahu()]);
    const onMutate = jest.fn();
    const { svg } = renderCanvas({
      doc,
      row: sized,
      component: { kind: "plenum", stream: "supply" },
      onMutate,
    });
    expect(svg.querySelectorAll(".ds-plenum-dropzone").length).toBeGreaterThan(0);
    clickAt(svg, 400, 320);
    expect(onMutate).toHaveBeenCalled();
  });

});

describe("a grille from the component palette", () => {
  it("goes down where it is clicked, as the HUD set it, and the tool stays armed", () => {
    const doc = mkDoc([ahu()]);
    let next: DesignDocument | undefined;
    const onComponentPlaced = jest.fn();
    const { svg } = renderCanvas({
      doc,
      component: { kind: "grille", stream: "return", size: { wMm: 600, hMm: 100 } },
      onMutate: (fn) => (next = fn(doc)),
      onComponentPlaced,
    });
    clickAt(svg, 200, 120);
    const g = next!.objects.find((o) => o.type === "grille")!;
    expect(g).toMatchObject({ systemId: "sys1", props: { stream: "return", wMm: 600, hMm: 100 } });
    // square to the plan: it is turned afterwards, on its ring
    expect((g.geometry as { rotation?: number }).rotation).toBeUndefined();
    expect(onComponentPlaced).not.toHaveBeenCalled();
  });

  /* picked, a grille turns and sizes like a unit does (Isaac, 29 October
     2026: "Don't you just rotate it? Like the units."). A 600 mm square at
     world (0,0) is 60 units across, 33.6 px at the test's 0.56 zoom. */
  const picked = (onMutate: (fn: (d: DesignDocument) => DesignDocument) => void) => {
    const g = { ...grille("flr", "sys1", { x: 0, y: 0 }, "supply", { wMm: 600, hMm: 600 }), id: "g1" };
    const doc = mkDoc([g]);
    const utils = renderCanvas({ doc, selectedId: "g1", onMutate });
    return { ...utils, doc };
  };
  const s = (wx: number, wy: number) => pt(400 + wx * 0.56, 300 + wy * 0.56);

  it("] and [ turn a picked grille 90° at a time", () => {
    let next: DesignDocument | undefined;
    const { doc } = picked((fn) => (next = fn(next ?? doc)));
    fireEvent.keyDown(window, { key: "]" });
    expect((next!.objects[0].geometry as { rotation?: number }).rotation).toBe(90);
    fireEvent.keyDown(window, { key: "[" });
    fireEvent.keyDown(window, { key: "[" });
    expect((next!.objects[0].geometry as { rotation?: number }).rotation).toBe(270);
  });

  it("dragging its ring turns it", () => {
    let next: DesignDocument | undefined;
    const { doc, getByTestId } = picked((fn) => (next = fn(doc)));
    const ring = getByTestId("grille-ring");
    const r = Number(ring.getAttribute("r"));
    fireEvent.pointerDown(ring, s(0, -r)); // the grip, straight up
    fireEvent.pointerMove(ring, s(r, 0)); // a quarter turn clockwise
    fireEvent.pointerUp(ring, s(r, 0));
    expect((next!.objects[0].geometry as { rotation?: number }).rotation).toBeCloseTo(90, 0);
  });

  it("dragging an edge sizes it, the far edge staying put, on 25 mm steps", () => {
    let next: DesignDocument | undefined;
    const { doc, getByTestId } = picked((fn) => (next = fn(doc)));
    const east = getByTestId("grille-edge-e");
    fireEvent.pointerDown(east, s(30, 0));
    fireEvent.pointerMove(east, s(40.4, 3)); // 104 mm out, a little off the line
    fireEvent.pointerUp(east, s(40.4, 3));
    const g = next!.objects[0];
    expect(g.props).toMatchObject({ wMm: 700, hMm: 600 });
    // the west edge is still at x = -30: the centre moved half the growth
    expect((g.geometry as { at: { x: number; y: number } }).at).toEqual({ x: 5, y: 0 });
  });

  it("draws as a face on the plan, nothing joined to it", () => {
    const g = grille("flr", "sys1", { x: 100, y: 100 }, "supply", { wMm: 300, hMm: 300 });
    const { svg } = renderCanvas({ doc: mkDoc([ahu(), g]) });
    const face = svg.querySelector(".ds-grille")!;
    expect(face).toHaveAttribute("aria-label", "Supply grille");
    expect(face.querySelectorAll("line")).toHaveLength(2); // a diffuser's diagonals
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
    clickAt(svg, 400, 300); // the unit body
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
