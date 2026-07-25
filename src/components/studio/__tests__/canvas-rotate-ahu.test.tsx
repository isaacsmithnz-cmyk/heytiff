/* Rotating a DUCTED AHU (field feedback 2026-07-25).

   PR #106 gave wall heads, consoles and outdoor units a rotate control but
   excluded air handlers, because their angle drives the air side rather than
   just a glyph. This covers that follow-up: the AHU turns, and its supply and
   return faces, plenum body and takeoffs all turn with it.

   jsdom has no layout: blank floor (10 mm/unit → grid 100) opens at zoom 0.56,
   world origin at screen centre (400,300) — see canvas.test.tsx. */

import { render, fireEvent } from "@testing-library/react";
import { StudioCanvas } from "../canvas";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type Floor,
} from "@/lib/studio/document";
import type { IndoorUnit } from "@/lib/studio/packs/schema";

const floor: Floor = {
  id: "flr",
  name: "G",
  level: 0,
  scaleMmPerUnit: 10,
  northDeg: null,
  northPos: null,
  plans: [],
};

/** ducted form + air openings + airflow = air-capable, so it reads as an AHU */
const row: IndoorUnit = {
  model: "PEAD-TEST",
  brand: "me",
  series: "PEAD",
  form_factor: "ducted",
  capacity_cool_kw: 10,
  capacity_heat_kw: 11.2,
  airflow_ls: 567,
  supply_opening: { w_mm: 1000, h_mm: 250 },
  return_opening: { w_mm: 900, h_mm: 250 },
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

const ahu = (rotation?: number): DesignObject => ({
  id: "u1",
  type: "unit",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 0, y: 0 }, ...(rotation != null ? { rotation } : {}) },
  plane: "ceiling-cavity",
  props: { role: "idu", model: "PEAD-TEST", widthMm: 1400, depthMm: 732 },
});

const plenum = (): DesignObject => ({
  id: "pl1",
  type: "plenum",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 0, y: 36.6 } },
  plane: "ceiling-cavity",
  props: {
    stream: "supply",
    unitId: "u1",
    end: "supply",
    spigots: [
      { id: "s1", diaMm: 300, t: 0.5, face: "left" },
      { id: "s2", diaMm: 300, t: 0.5, face: "right" },
    ],
  },
});

function mkDoc(objects: DesignObject[]): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-25T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    { id: "sys1", type: "ducted", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  d.objects = objects;
  return d;
}

function renderCanvas(opts: {
  doc: DesignDocument;
  selectedId?: string | null;
  onMutate?: (fn: (d: DesignDocument) => DesignDocument) => void;
}) {
  const utils = render(
    <StudioCanvas
      doc={opts.doc}
      floor={floor}
      tool="select"
      selectedId={opts.selectedId ?? null}
      onSelect={() => {}}
      onMutate={opts.onMutate ?? (() => {})}
      onToolDone={() => {}}
      activeSystemId="sys1"
      iduSpec={(m) => (m === row.model ? row : null)}
      onPlaced={() => {}}
      onRoomCreated={() => {}}
      onRemarkConsumed={() => {}}
    />
  );
  return { ...utils, svg: utils.container.querySelector("svg")! };
}

const pts = (el: Element) =>
  el.getAttribute("points")!.split(" ").map((p) => {
    const [x, y] = p.split(",").map(Number);
    return { x, y };
  });

/** turn a point about the unit centre (0,0) by `deg`, SVG's sense */
const turn = (p: { x: number; y: number }, deg: number) => {
  const r = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
};

describe("a ducted AHU rotates with its air side", () => {
  it("[ and ] step it 90°, same as a simple unit", () => {
    const doc = mkDoc([ahu()]);
    let next: DesignDocument | undefined;
    renderCanvas({ doc, selectedId: "u1", onMutate: (fn) => (next = fn(doc)) });

    fireEvent.keyDown(window, { key: "]" });
    const g = next!.objects.find((o) => o.id === "u1")!.geometry as { rotation?: number };
    expect(g.rotation).toBe(90);
  });

  it("offers the rotate knob on a selected AHU", () => {
    const { svg } = renderCanvas({ doc: mkDoc([ahu()]), selectedId: "u1" });
    expect(svg.querySelector(".ds-rot-knob")).not.toBeNull();
  });

  it("turns the glyph group by the stored angle", () => {
    const { svg } = renderCanvas({ doc: mkDoc([ahu(90)]) });
    const turned = [...svg.querySelectorAll(".ds-unit g[transform]")].some((g) =>
      g.getAttribute("transform")!.startsWith("rotate(90")
    );
    expect(turned).toBe(true);
  });

  it("carries the plenum body and its takeoffs round with the unit", () => {
    const flat = renderCanvas({ doc: mkDoc([ahu(), plenum()]) });
    const flatBody = pts(flat.svg.querySelector(".ds-plenum-body")!);
    const flatSpigs = [...flat.svg.querySelectorAll(".ds-spigot polygon")].map(pts);
    flat.unmount();

    const spun = renderCanvas({ doc: mkDoc([ahu(90), plenum()]) });
    const spunBody = pts(spun.svg.querySelector(".ds-plenum-body")!);
    const spunSpigs = [...spun.svg.querySelectorAll(".ds-spigot polygon")].map(pts);

    // the body is the SAME shape, turned a quarter-turn about the unit centre
    expect(spunBody).toHaveLength(4);
    flatBody.forEach((p, i) => {
      const want = turn(p, 90);
      expect(spunBody[i].x).toBeCloseTo(want.x, 6);
      expect(spunBody[i].y).toBeCloseTo(want.y, 6);
    });
    // and so is every takeoff — they stay seated on their sloped faces
    expect(spunSpigs).toHaveLength(2);
    flatSpigs.forEach((rect, i) =>
      rect.forEach((p, j) => {
        const want = turn(p, 90);
        expect(spunSpigs[i][j].x).toBeCloseTo(want.x, 6);
        expect(spunSpigs[i][j].y).toBeCloseTo(want.y, 6);
      })
    );
  });

  it("keeps the plenum on the unit rather than beside it", () => {
    const { svg } = renderCanvas({ doc: mkDoc([ahu(90), plenum()]) });
    const body = pts(svg.querySelector(".ds-plenum-body")!);
    /* supply is the +y face unrotated; a quarter-turn clockwise (SVG's sense,
       y down) swings it to −x, so the base edge sits on the unit's left-hand
       end — half the 732 mm depth = 36.6 world units out */
    const baseXs = [body[0].x, body[3].x];
    expect(baseXs[0]).toBeCloseTo(-36.6, 3);
    expect(baseXs[1]).toBeCloseTo(-36.6, 3);
    expect(body[1].x).toBeLessThan(-36.6); // and it tapers outward from there
  });
});
