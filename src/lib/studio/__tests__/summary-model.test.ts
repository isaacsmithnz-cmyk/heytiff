/* buildSummaryModel — the shape the redesigned Summary sheet renders.

   The point of this model is that the ROOM is the unit: an indoor unit is
   stamped with `props.roomId`, so a multi has three heads rather than one
   unit serving three rooms, and the outdoor / pipe / components are what
   those rooms SHARE. These tests pin that distinction, because it is the one
   the whole layout rests on.

   Runs against the REAL shipped pack, like summary.test.ts. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { buildSummaryModel, formFactorLabel } from "../summary";

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

const rect = (w: number, h: number) => ({
  kind: "polygon" as const,
  points: [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ],
});

const room = (id: string, floorId: string, name: string, w = 500, h = 400): DesignObject => ({
  id,
  type: "room",
  systemId: null,
  floorId,
  geometry: rect(w, h),
  plane: "room",
  props: { name },
});

const unit = (
  id: string,
  systemId: string,
  floorId: string,
  role: "idu" | "odu",
  model: string,
  roomId?: string
): DesignObject => ({
  id,
  type: "unit",
  systemId,
  floorId,
  geometry: { kind: "point", at: { x: 10, y: 10 } },
  plane: role === "idu" ? "room" : "external-ground",
  props: { role, model, ...(roomId ? { roomId } : {}) },
});

/** one calibrated floor; a split serving Lounge, and two rooms nothing serves */
function splitDoc(): DesignDocument {
  const d = createDesign({ name: "S", mode: "blank", now: "2026-08-15T00:00:00.000Z" });
  d.floors = [
    { id: "f1", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] },
  ];
  d.systems = [
    {
      id: "sys1",
      type: "split",
      brand: "mitsubishi-electric",
      colour: "#2E68FF",
      name: "System 1",
      settings: { pairIdu: "SLZ-M35FA-A", pairOdu: "SUZ-M35VAD-A" },
    },
  ];
  d.settings.climateZone = "5";
  d.objects = [
    room("r1", "f1", "Lounge"),
    room("r2", "f1", "Kitchen", 300, 300),
    unit("i1", "sys1", "f1", "idu", "SLZ-M35FA-A", "r1"),
    unit("o1", "sys1", "f1", "odu", "SUZ-M35VAD-A"),
  ];
  return d;
}

/** a 3-port multi: one outdoor, one head PER ROOM */
function multiDoc(): DesignDocument {
  const d = splitDoc();
  d.systems = [
    {
      id: "sysM",
      type: "multi-split",
      brand: "mitsubishi-electric",
      colour: "#E4572E",
      name: "System 2",
      settings: {
        pairOdu: "MXZ-3F54VGD",
        multiIdus: { r1: "MSZ-LN25VG2V", r2: "MSZ-LN25VG2V", r3: "MSZ-LN25VG2V" },
      },
    },
  ];
  d.objects = [
    room("r1", "f1", "Bed 1"),
    room("r2", "f1", "Bed 2", 300, 300),
    room("r3", "f1", "Bed 3", 300, 300),
    unit("i1", "sysM", "f1", "idu", "MSZ-LN25VG2V", "r1"),
    unit("i2", "sysM", "f1", "idu", "MSZ-LN25VG2V", "r2"),
    unit("i3", "sysM", "f1", "idu", "MSZ-LN25VG2V", "r3"),
    unit("o1", "sysM", "f1", "odu", "MXZ-3F54VGD"),
  ];
  return d;
}

describe("formFactorLabel", () => {
  it("reads the pack's form factors as words", () => {
    expect(formFactorLabel("cassette-1way")).toBe("1-way cassette");
    expect(formFactorLabel("wall")).toBe("Wall-mounted");
    /* the key this sheet never had: it printed the raw slug "bulkhead" while
       the canvas said "Bulkhead" (see form-factors.ts) */
    expect(formFactorLabel("bulkhead")).toBe("Bulkhead");
  });

  it("shows an unknown form rather than swallowing it", () => {
    // a future pack must not render a blank Style row
    expect(formFactorLabel("ceiling-suspended")).toBe("ceiling-suspended");
    expect(formFactorLabel(null)).toBeNull();
  });
});

describe("buildSummaryModel — a split", () => {
  const model = buildSummaryModel(splitDoc(), pack);

  it("reports the rooms the system serves, and only those", () => {
    expect(model.systems).toHaveLength(1);
    expect(model.systems[0].rooms.map((r) => r.name)).toEqual(["Lounge"]);
  });

  it("puts the rooms nothing serves in their own list", () => {
    expect(model.unserved.map((r) => r.name)).toEqual(["Kitchen"]);
  });

  it("does not call a one-room outdoor shared", () => {
    // a split's outdoor belongs in its Equipment, not a Shared section
    expect(model.systems[0].sharedOutdoor).toBe(false);
  });

  it("names the brand, never the pack slug", () => {
    expect(model.systems[0].brandLabel).toBe("Mitsubishi Electric");
  });

  it("carries the outdoor's pipe sizes and refrigerant from the pack", () => {
    const s = model.systems[0];
    expect(s.outdoorModel).toBe("SUZ-M35VAD-A");
    expect(s.pipeLiquidMm).toBe(6.35);
    expect(s.pipeGasMm).toBe(9.52);
    expect(s.refrigerant).toBe("R32");
    expect(s.prechargedKg).toBe(0.9);
  });

  it("gives the room its own capacity and coverage", () => {
    const r = model.systems[0].rooms[0];
    expect(r.level).toBe("Ground");
    expect(r.indoorModel).toBe("SLZ-M35FA-A");
    expect(r.areaM2).toBeGreaterThan(0);
    expect(r.capacityKw).toBeGreaterThan(0);
    expect(r.pct).toBeGreaterThan(0);
  });

  it("leaves an unserved room's capacity null rather than zero", () => {
    // zero would read as "a unit that covers nothing"; null reads as "none"
    const k = model.unserved[0];
    expect(k.capacityKw).toBeNull();
    expect(k.indoorModel).toBeNull();
  });
});

describe("buildSummaryModel — a multi", () => {
  const model = buildSummaryModel(multiDoc(), pack);
  const sys = model.systems[0];

  it("gives every room its OWN head", () => {
    expect(sys.rooms).toHaveLength(3);
    for (const r of sys.rooms) expect(r.indoorModel).toBe("MSZ-LN25VG2V");
  });

  it("calls the outdoor shared once more than one room hangs off it", () => {
    expect(sys.sharedOutdoor).toBe(true);
    expect(sys.outdoorModel).toBe("MXZ-3F54VGD");
  });

  it("totals the system against the rooms it serves", () => {
    const roomLoad = sys.rooms.reduce((a, r) => a + (r.loadKw ?? 0), 0);
    expect(sys.loadKw).toBeCloseTo(Math.round(roomLoad * 10) / 10, 1);
    expect(sys.capacityKw).toBeGreaterThan(0);
  });

  it("keeps per-room coverage separate from the system's", () => {
    /* the distinction the sheet exists to show: a multi can be short at the
       outdoor while each room is over-served by its own head */
    for (const r of sys.rooms) expect(r.pct).not.toBeNull();
    expect(sys.pct).not.toBeNull();
  });
});

describe("buildSummaryModel — no pack", () => {
  it("still lists rooms, and never invents equipment", () => {
    const model = buildSummaryModel(splitDoc(), null);
    const s = model.systems[0];
    expect(s.refrigerant).toBeNull();
    expect(s.pipeLiquidMm).toBeNull();
    expect(s.lines).toEqual([]);
    // the rooms are still there — a pack-less sheet is thin, not blank
    expect(model.unserved.map((r) => r.name)).toContain("Kitchen");
  });
});

describe("buildSummaryModel — the merged sheet", () => {
  it("says what a system is, in words", () => {
    expect(buildSummaryModel(splitDoc(), pack).systems[0].kindLabel).toBe("Split");
    expect(buildSummaryModel(multiDoc(), pack).systems[0].kindLabel).toBe(
      "Multi-split · 3 heads on one outdoor"
    );
  });

  it("carries the outdoor machine's own capacity, not the summed heads", () => {
    const sys = buildSummaryModel(multiDoc(), pack).systems[0];
    expect(sys.outdoorModel).toBe("MXZ-3F54VGD");
    expect(sys.outdoorCapacityKw).toBeGreaterThan(0);
  });

  it("never lists a unit as a takeoff line", () => {
    /* units live in the rooms table and the outdoor block — a unit repeated
       in materials is the double-handling this redesign exists to kill */
    for (const doc of [splitDoc(), multiDoc()]) {
      for (const s of buildSummaryModel(doc, pack).systems)
        for (const l of s.lines) {
          expect(l.name).not.toMatch(/^[A-Z]{2,4}Z?-/); // model-number shapes
        }
    }
  });

  it("picklist counts a multi's units — the split-only rollup missed them", () => {
    const rows = buildSummaryModel(multiDoc(), pack).picklist;
    const heads = rows.find((r) => r.name === "MSZ-LN25VG2V");
    const odu = rows.find((r) => r.name === "MXZ-3F54VGD");
    expect(heads?.qty).toBe("3");
    expect(odu?.qty).toBe("1");
  });

  it("picklist excludes what is supplied by others", () => {
    const d = splitDoc();
    d.systems[0].settings.components = { electrical: "none" };
    const model = buildSummaryModel(d, pack);
    // stated on the system's own materials…
    expect(
      model.systems[0].lines.some((l) => l.name === "Supplied by others")
    ).toBe(true);
    // …but never picked
    expect(
      model.picklist.some((r) => r.name === "Supplied by others")
    ).toBe(false);
  });

  it("states ONE pipe figure — the line and the picklist cannot disagree", () => {
    /* Caught walking prod: the graph returns the raw drawn length (a real run
       measured 3.1494563728466076 m). The picklist rounded it and the system's
       own materials line interpolated the float, so the SAME pipe printed two
       ways on one page. A diagonal run gives an irrational length, which is
       the case that exposes it. */
    const d = splitDoc();
    d.objects.push({
      id: "run1",
      type: "pipe-run",
      systemId: "sys1",
      floorId: "f1",
      geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 200, y: 250 }] },
      plane: "room",
      props: {
        startAttach: { kind: "unit", id: "i1" },
        endAttach: { kind: "unit", id: "o1" },
      },
    } as DesignObject);

    const model = buildSummaryModel(d, pack);
    const line = model.systems[0].lines.find((l) => l.name.includes("pair coil"));
    const pick = model.picklist.find((r) => r.name.includes("pair coil"));

    expect(line).toBeDefined();
    expect(pick).toBeDefined();
    // no raw float reaches the sheet — at most one decimal place
    expect(line!.qty).toMatch(/^\d+(\.\d)? m$/);
    // and both faces of the sheet say the same thing
    expect(line!.qty).toBe(pick!.qty);
  });

  it("picklist sums countable components across systems", () => {
    const rows = buildSummaryModel(multiDoc(), pack).picklist;
    const isolator = rows.find((r) => r.name.startsWith("Isolator"));
    expect(isolator).toBeDefined();
    expect(isolator?.qty).toBe("1");
  });
});
