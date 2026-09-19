/* Zones on the plan (docs/studio-zones-and-systems.md, "Zones" and "The
   panel and the plan"), through the mounted canvas with the builder flag on.

   A zone wears the colour of the system that claimed it, has no colour of its
   own while nobody has, and carries both systems' dots in its corner when two
   share it. Claim mode's tap gives a zone to the system being built (the
   toggle itself is zones.ts's; the canvas only says which zone was tapped). A
   head dragged off its rack outlines its own zone, wherever the cursor is.
   And the Zone tool names what it draws a zone, numbered across the plan.

   jsdom has no layout: the canvas opens fitted to the house at its own zoom,
   so each test reads the viewport transform back off the svg and maps
   world → client through it (canvas-place-attribute.test.tsx). The flag is
   read at render (modules.ts builderEnabled), so it is set for the file and
   put back after. */

import { render, fireEvent } from "@testing-library/react";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { StudioCanvas, type CanvasTool, type PlacingUnit } from "../canvas";
import { createDesign, type DesignDocument, type DesignObject, type DesignSystem } from "@/lib/studio/document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { addHead, trayItems } from "@/lib/studio/builder";
import { claimZone, newSystem } from "@/lib/studio/zones";
import type { RoomObj } from "@/lib/studio/loads-room";

const FLAG = "NEXT_PUBLIC_STUDIO_BUILDER";
let flagBefore: string | undefined;
beforeAll(() => {
  flagBefore = process.env[FLAG];
  process.env[FLAG] = "1";
});
afterAll(() => {
  if (flagBefore === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flagBefore;
});

const SEED_DIR = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
function loadPack(): DataPack {
  const meta = JSON.parse(readFileSync(join(SEED_DIR, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(SEED_DIR, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const pack = loadPack();

/** the builder-jobs house: five zones that belong to the plan, 10 mm per unit */
function house(): { doc: DesignDocument; room: Record<string, RoomObj> } {
  const doc = createDesign({ name: "house", mode: "blank" });
  const floorId = doc.floors[0].id;
  const add = (id: string, name: string, x: number, y: number, w: number, h: number) => {
    const r = {
      id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: {
        kind: "polygon",
        points: [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ],
      },
      props: { name },
    } as RoomObj;
    doc.objects.push(r as DesignObject);
    return r;
  };
  const room = {
    living: add("living", "Living", 0, 0, 1000, 960),
    bed1: add("bed1", "Bed 1", 1100, 0, 400, 300),
    bed2: add("bed2", "Bed 2", 1600, 0, 450, 400),
    master: add("master", "Master", 2150, 0, 550, 500),
    study: add("study", "Study", 1100, 500, 400, 320),
  };
  return { doc, room };
}

/** a system with these zones claimed and nothing in it yet */
function claimed(doc: DesignDocument, zoneIds: string[]): { doc: DesignDocument; systemId: string } {
  const made = newSystem(doc, pack.meta.version);
  let d = made.doc;
  for (const z of zoneIds) d = claimZone(d, made.systemId, z);
  return { doc: d, systemId: made.systemId };
}

/** System 1 over Master and Bed 1, System 2 over Master and Study: Master is
    shared, and Living and Bed 2 have no system */
function twoSystems(): { doc: DesignDocument; room: Record<string, RoomObj>; one: DesignSystem; two: DesignSystem } {
  const { doc, room } = house();
  const one = claimed(doc, ["master", "bed1"]);
  const two = claimed(one.doc, ["master", "study"]);
  return { doc: two.doc, room, one: two.doc.systems[0], two: two.doc.systems[1] };
}

function mount(opts: {
  doc: DesignDocument;
  tool?: CanvasTool;
  activeSystemId?: string | null;
  placing?: PlacingUnit | null;
  onClaimToggle?: jest.Mock;
  onMutate?: (fn: (d: DesignDocument) => DesignDocument) => void;
}) {
  const utils = render(
    <StudioCanvas
      doc={opts.doc}
      floor={opts.doc.floors[0]}
      tool={opts.tool ?? "select"}
      selectedId={null}
      onSelect={() => {}}
      onMutate={opts.onMutate ?? (() => {})}
      onToolDone={() => {}}
      activeSystemId={opts.activeSystemId ?? null}
      placing={opts.placing ?? null}
      placingKw={null}
      onPlaced={() => {}}
      component={null}
      iduSpec={() => null}
      onRoomCreated={() => {}}
      onClaimToggle={opts.onClaimToggle}
      onRemarkConsumed={() => {}}
      onReshapeConsumed={() => {}}
    />
  );
  return { ...utils, svg: utils.container.querySelector("svg")! };
}

/** world → client, via the rendered viewport transform
    (scale(z) translate(tx ty) ⇒ client = (world + t) · z) */
function mapper(svg: SVGSVGElement) {
  const g = svg.querySelector("g[transform]")!;
  const m = g.getAttribute("transform")!.match(/scale\(([-\d.e]+)\) translate\(([-\d.e]+) ([-\d.e]+)\)/)!;
  const z = parseFloat(m[1]);
  const tx = parseFloat(m[2]);
  const ty = parseFloat(m[3]);
  return {
    sx: (x: number) => (x + tx) * z,
    sy: (y: number) => (y + ty) * z,
  };
}

const pt = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });

/** a tap: press and release in place */
function tap(svg: SVGSVGElement, x: number, y: number) {
  fireEvent.pointerDown(svg, pt(x, y));
  fireEvent.pointerUp(svg, pt(x, y));
}

/** the middle of a rectangular zone, in world units */
function centre(r: RoomObj): { x: number; y: number } {
  const p = r.geometry.points;
  return { x: (p[0].x + p[2].x) / 2, y: (p[0].y + p[2].y) / 2 };
}

/** the <g> the plan draws a zone as, found by its label */
function zoneEl(container: HTMLElement, name: string): SVGGElement {
  const g = [...container.querySelectorAll<SVGGElement>(".ds-room")].find(
    (el) => el.querySelector(".ds-room-name")?.textContent === name
  );
  if (!g) throw new Error(`no zone named ${name} on the plan`);
  return g;
}

/** jsdom's style engine may keep a colour as written or rewrite it as rgb() */
function rgb(c: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c.trim());
  return m
    ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})`
    : c.trim().toLowerCase();
}

function captureCommit(doc: DesignDocument) {
  let committed: DesignDocument = doc;
  const onMutate = (fn: (d: DesignDocument) => DesignDocument) => {
    committed = fn(committed);
  };
  return { onMutate, get: () => committed };
}

describe("a zone wears the colour of the system that claimed it", () => {
  it("a claimed zone is zoned in its system's colour; an unclaimed one has no colour of its own", () => {
    const { doc, one } = twoSystems();
    const { container } = mount({ doc });
    const bed1 = zoneEl(container, "Bed 1");
    expect(bed1).toHaveClass("zoned");
    expect(rgb(bed1.style.getPropertyValue("--zc"))).toBe(rgb(one.colour));
    expect(bed1.querySelectorAll(".ds-zone-dot")).toHaveLength(0); // one owner needs no dots
    const living = zoneEl(container, "Living");
    expect(living).not.toHaveClass("zoned");
    expect(living.style.getPropertyValue("--zc")).toBe("");
    expect(living.querySelectorAll(".ds-zone-dot")).toHaveLength(0);
  });

  it("a zone claimed by two systems wears the first system's colour with both dots in its corner", () => {
    const { doc, one, two } = twoSystems();
    const { container } = mount({ doc });
    const master = zoneEl(container, "Master");
    expect(master).toHaveClass("zoned");
    expect(rgb(master.style.getPropertyValue("--zc"))).toBe(rgb(one.colour));
    const dots = [...master.querySelectorAll<SVGCircleElement>(".ds-zone-dot")];
    expect(dots).toHaveLength(2);
    expect(dots.map((d) => rgb(d.style.fill))).toEqual([rgb(one.colour), rgb(two.colour)]);
    expect(one.colour).not.toBe(two.colour);
  });
});

describe("claim mode", () => {
  it("a tap on a zone hands that zone to the system being built, claimed or not", () => {
    const { doc, room } = house();
    const made = claimed(doc, ["bed1"]);
    const onClaimToggle = jest.fn();
    const { svg } = mount({ doc: made.doc, tool: "claim", activeSystemId: made.systemId, onClaimToggle });
    const { sx, sy } = mapper(svg);
    const m = centre(room.master);
    tap(svg, sx(m.x), sy(m.y));
    expect(onClaimToggle).toHaveBeenCalledTimes(1);
    expect(onClaimToggle).toHaveBeenCalledWith("master");
    // a zone it already has is clickable too: the same call, and the toggle decides
    const b = centre(room.bed1);
    tap(svg, sx(b.x), sy(b.y));
    expect(onClaimToggle).toHaveBeenLastCalledWith("bed1");
    expect(onClaimToggle).toHaveBeenCalledTimes(2);
  });

  it("a tap on the empty plan claims nothing", () => {
    const { doc } = house();
    const made = claimed(doc, ["bed1"]);
    const onClaimToggle = jest.fn();
    const { svg } = mount({ doc: made.doc, tool: "claim", activeSystemId: made.systemId, onClaimToggle });
    const { sx, sy } = mapper(svg);
    tap(svg, sx(2000), sy(800)); // between Bed 2, Master and Study: no zone here
    expect(onClaimToggle).not.toHaveBeenCalled();
  });

  it("a press that travels pans the plan and claims nothing", () => {
    const { doc, room } = house();
    const made = claimed(doc, []);
    const onClaimToggle = jest.fn();
    const { svg } = mount({ doc: made.doc, tool: "claim", activeSystemId: made.systemId, onClaimToggle });
    const { sx, sy } = mapper(svg);
    const m = centre(room.master);
    const before = svg.querySelector("g[transform]")!.getAttribute("transform");
    fireEvent.pointerDown(svg, pt(sx(m.x), sy(m.y)));
    fireEvent.pointerMove(svg, pt(sx(m.x) + 60, sy(m.y) + 40));
    fireEvent.pointerUp(svg, pt(sx(m.x) + 60, sy(m.y) + 40));
    expect(onClaimToggle).not.toHaveBeenCalled();
    expect(svg.querySelector("g[transform]")!.getAttribute("transform")).not.toBe(before);
  });
});

describe("a head dragged off its rack", () => {
  it("outlines its own zone and no other, wherever the cursor is", () => {
    const { doc, room } = house();
    const made = claimed(doc, ["master", "bed1"]);
    const d = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "master", iduModel: "MSZ-AP35VGD2" });
    const item = trayItems(d, pack).find((t) => t.model === "MSZ-AP35VGD2")!;
    const placing: PlacingUnit = item.placing;
    expect(placing).toMatchObject({ role: "idu", allocationId: expect.any(String), systemId: made.systemId, roomId: "master" });
    const { container, svg } = mount({ doc: d, tool: "place", activeSystemId: made.systemId, placing });
    expect(zoneEl(container, "Master")).toHaveClass("droptgt");
    for (const name of ["Bed 1", "Bed 2", "Study", "Living"]) {
      expect(zoneEl(container, name)).not.toHaveClass("droptgt");
    }
    // a rack unit already has its zone, so no zone is painted with a fit verdict
    expect(container.querySelector('[class*="armfit"]')).toBeNull();
    // the cursor over another zone changes nothing: dropped there, it still serves its own
    const { sx, sy } = mapper(svg);
    const b = centre(room.bed1);
    fireEvent.pointerMove(svg, { clientX: sx(b.x), clientY: sy(b.y), pointerId: 1 });
    expect(zoneEl(container, "Master")).toHaveClass("droptgt");
    expect(zoneEl(container, "Bed 1")).not.toHaveClass("droptgt");
  });
});

describe("the Zone tool", () => {
  /** the rectangle tool: press at one corner, drag to the other, release */
  function drawRect(svg: SVGSVGElement, from: { x: number; y: number }, to: { x: number; y: number }) {
    fireEvent.pointerDown(svg, pt(from.x, from.y));
    fireEvent.pointerMove(svg, pt(to.x, to.y));
    fireEvent.pointerUp(svg, pt(to.x, to.y));
  }

  it("names what it draws a zone, numbered across the plan, and gives it to the plan, not a system", () => {
    const { doc } = house();
    const made = claimed(doc, ["master"]);
    const c = captureCommit(made.doc);
    const { svg } = mount({ doc: made.doc, tool: "room-rect", activeSystemId: made.systemId, onMutate: c.onMutate });
    const { sx, sy } = mapper(svg);
    drawRect(svg, { x: sx(1100), y: sy(900) }, { x: sx(1500), y: sy(1200) });
    const rooms = c.get().objects.filter((o) => o.type === "room");
    expect(rooms).toHaveLength(6);
    const drawn = rooms[5];
    expect(drawn.props.name).toBe("Zone 6");
    expect(drawn.systemId).toBeNull();
    expect(drawn.props.shape).toBe("rect");
  });

  it("with the flag off the old flow still draws Room 1, scoped to its system", () => {
    process.env[FLAG] = "0";
    try {
      const { doc } = house();
      const made = claimed(doc, ["master"]);
      const c = captureCommit(made.doc);
      const { svg } = mount({ doc: made.doc, tool: "room-rect", activeSystemId: made.systemId, onMutate: c.onMutate });
      const { sx, sy } = mapper(svg);
      drawRect(svg, { x: sx(1100), y: sy(900) }, { x: sx(1500), y: sy(1200) });
      const rooms = c.get().objects.filter((o) => o.type === "room");
      expect(rooms).toHaveLength(6);
      expect(rooms[5].props.name).toBe("Room 1");
      expect(rooms[5].systemId).toBe(made.systemId);
    } finally {
      process.env[FLAG] = "1";
    }
  });
});
