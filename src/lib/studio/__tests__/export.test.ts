/* Export/print model — the content rules the print document trusts: what a
   schedule-only export drops, which floors make pages, sibling behaviour,
   sheet-ref dedupe. Runs against the REAL shipped pack. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import {
  buildPrintModel,
  collectSheetRefs,
  defaultExportOptions,
} from "../export";

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

const rect = (x: number, y: number, w: number, h: number) => ({
  kind: "polygon" as const,
  points: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
});

const sheet = (id: string, imageRef: string) => ({
  id,
  imageRef,
  pageNumber: 1,
  name: id,
  width: 1000,
  height: 700,
  x: 0,
  y: 0,
});

function fixtureDoc(): DesignDocument {
  const d = createDesign({ name: "Exp", mode: "plan", now: "2026-07-19T00:00:00.000Z" });
  d.floors = [
    { id: "f1", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: 15, northPos: { x: 100, y: 100 }, plans: [sheet("s1", "ref-a"), sheet("s2", "ref-b")] },
    { id: "f2", name: "Level 1", level: 1, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [sheet("s3", "ref-a")] },
  ];
  d.systems = [
    { id: "sys1", type: "split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: { pairIdu: "MSZ-AP25VGD", pairOdu: "MUZ-AP25VGD" } },
  ];
  const room: DesignObject = {
    id: "room1",
    type: "room",
    systemId: "sys1",
    floorId: "f1",
    geometry: rect(0, 0, 500, 400),
    plane: "room",
    props: { name: "Lounge" },
  };
  const idu: DesignObject = {
    id: "i1",
    type: "unit",
    systemId: "sys1",
    floorId: "f1",
    geometry: { kind: "point", at: { x: 100, y: 100 } },
    plane: "room",
    props: { role: "idu", model: "MSZ-AP25VGD", roomId: "room1" },
  };
  const odu: DesignObject = {
    id: "o1",
    type: "unit",
    systemId: "sys1",
    floorId: "f1",
    geometry: { kind: "point", at: { x: 900, y: 100 } },
    plane: "external-ground",
    props: { role: "odu", model: "MUZ-AP25VGD" },
  };
  d.objects = [room, idu, odu];
  return d;
}

describe("defaultExportOptions", () => {
  it("starts with everything: full content, all floors, own doc, colour", () => {
    const d = fixtureDoc();
    const o = defaultExportOptions(d);
    expect(o.content).toBe("full");
    expect(o.floorIds).toEqual(["f1", "f2"]);
    expect(o.variantIds).toEqual([d.id]);
    expect(o.layers).toEqual({ plan: true, units: true, pipes: true, labels: true });
    expect(o.grayscale).toBe(false);
    expect(o.paper).toBe("A4");
  });
});

describe("buildPrintModel", () => {
  it("full: schedule + all selected floors, level-ordered", () => {
    const d = fixtureDoc();
    const m = buildPrintModel([d], pack, defaultExportOptions(d));
    expect(m.variants).toHaveLength(1);
    expect(m.variants[0].schedule.systems).toHaveLength(1);
    expect(m.variants[0].rollup.length).toBeGreaterThan(0);
    expect(m.variants[0].floors.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(m.variants[0].basis.zone).toBe(5);
  });

  it("schedule-only: no floor pages", () => {
    const d = fixtureDoc();
    const m = buildPrintModel([d], pack, {
      ...defaultExportOptions(d),
      content: "schedule",
    });
    expect(m.variants[0].floors).toEqual([]);
    expect(m.variants[0].schedule.systems).toHaveLength(1);
  });

  it("plans-only: no schedule, floor pages remain", () => {
    const d = fixtureDoc();
    const m = buildPrintModel([d], pack, {
      ...defaultExportOptions(d),
      content: "plans",
    });
    expect(m.variants[0].schedule.systems).toEqual([]);
    expect(m.variants[0].rollup).toEqual([]);
    expect(m.variants[0].floors).toHaveLength(2);
  });

  it("floor subset applies to the primary doc; siblings keep all floors", () => {
    const d = fixtureDoc();
    const sibling = fixtureDoc();
    sibling.id = "dsn_sibling";
    sibling.meta.variantLabel = "Option 2";
    const m = buildPrintModel([d, sibling], pack, {
      ...defaultExportOptions(d),
      floorIds: ["f2"],
      variantIds: [d.id, sibling.id],
    });
    expect(m.variants[0].floors.map((f) => f.id)).toEqual(["f2"]);
    expect(m.variants[1].floors.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(m.variants[1].label).toBe("Option 2");
  });
});

describe("collectSheetRefs", () => {
  it("dedupes refs across floors and variants", () => {
    const d = fixtureDoc();
    const m = buildPrintModel([d], pack, defaultExportOptions(d));
    expect(collectSheetRefs(m).sort()).toEqual(["ref-a", "ref-b"]);
  });

  it("schedule-only collects nothing (no pages, no rasters)", () => {
    const d = fixtureDoc();
    const m = buildPrintModel([d], pack, {
      ...defaultExportOptions(d),
      content: "schedule",
    });
    expect(collectSheetRefs(m)).toEqual([]);
  });
});
