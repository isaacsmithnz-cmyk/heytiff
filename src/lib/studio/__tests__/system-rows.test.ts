/* What a system's screen lists: the outdoor, then a row a zone, each with the
   one thing it's still missing (system-rows.ts). Over the real Mitsubishi
   pack and the fitted house the systems panel's tests use. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createDesign, type DesignDocument, type DesignObject, type DesignSystem } from "../document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { addHead, allocationsOf, placeAllocation } from "../builder";
import { claimZone, newSystem } from "../zones";
import type { RoomObj } from "../loads-room";
import { systemRows, zonesLoadKw } from "../system-rows";

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
const basis = "worst-of-both" as const;

const ZONES = [
  { id: "living", name: "Living", x: 0, y: 0, w: 400, h: 350 },
  { id: "bed1", name: "Bed 1", x: 500, y: 0, w: 400, h: 300 },
  { id: "bed2", name: "Bed 2", x: 1000, y: 0, w: 400, h: 300 },
];

function house(): DesignDocument {
  const doc = createDesign({ name: "house", mode: "blank" });
  const floorId = doc.floors[0].id;
  for (const z of ZONES) {
    doc.objects.push({
      id: z.id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: {
        kind: "polygon",
        points: [
          { x: z.x, y: z.y },
          { x: z.x + z.w, y: z.y },
          { x: z.x + z.w, y: z.y + z.h },
          { x: z.x, y: z.y + z.h },
        ],
      },
      props: { name: z.name },
    } as RoomObj as DesignObject);
  }
  return doc;
}

/** a multi over Living and Bed 1, a head each; Bed 2 claimed with no head */
function multi(): { doc: DesignDocument; id: string } {
  const made = newSystem(house(), pack.meta.version);
  let d = made.doc;
  for (const z of ["living", "bed1", "bed2"]) d = claimZone(d, made.systemId, z);
  d = addHead(d, pack, { systemId: made.systemId, zoneId: "living", iduModel: "MSZ-AP25VGD2" });
  d = addHead(d, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: "MSZ-AP20VGD" });
  return { doc: d, id: made.systemId };
}
const sysOf = (doc: DesignDocument, id: string): DesignSystem => doc.systems.find((s) => s.id === id)!;

describe("a system's rows", () => {
  it("says To place for a unit not on the plan, and No unit for a zone with no head", () => {
    const { doc, id } = multi();
    const rows = systemRows(doc, pack, basis, sysOf(doc, id));
    expect(rows.outdoor?.missing).toBe("To place");
    expect(rows.outdoor?.tray).not.toBeNull();
    const byZone = Object.fromEntries(rows.zones.map((r) => [r.zoneId, r]));
    expect(byZone.living.missing).toBe("To place");
    expect(byZone.living.unit?.model).toBe("MSZ-AP25VGD2");
    expect(byZone.living.unit?.tray).not.toBeNull();
    expect(byZone.bed2.missing).toBe("No unit");
    expect(byZone.bed2.unit).toBeNull();
  });

  it("says No pipe once a head is on the plan with no run on it, and nothing once it has one", () => {
    const { doc, id } = multi();
    let d = doc;
    allocationsOf(sysOf(d, id)).forEach((a, i) => {
      d = placeAllocation(d, pack, id, a.id, d.floors[0].id, { x: 100 + i * 150, y: 1400 });
    });
    let rows = systemRows(d, pack, basis, sysOf(d, id));
    expect(rows.outdoor?.missing).toBeNull();
    const living = rows.zones.find((r) => r.zoneId === "living")!;
    expect(living.missing).toBe("No pipe");
    expect(living.unit?.tray).toBeNull();

    /* a run from the outdoor to the living head */
    const odu = allocationsOf(sysOf(d, id)).find((a) => a.role === "odu")!;
    d = {
      ...d,
      objects: [
        ...d.objects,
        {
          id: "run1",
          type: "pipe-run",
          systemId: id,
          floorId: d.floors[0].id,
          plane: "room",
          geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
          props: { startAttach: { kind: "unit", id: odu.id }, endAttach: { kind: "unit", id: living.unit!.allocationId } },
        } as unknown as DesignObject,
      ],
    };
    rows = systemRows(d, pack, basis, sysOf(d, id));
    expect(rows.zones.find((r) => r.zoneId === "living")!.missing).toBeNull();
    expect(rows.zones.find((r) => r.zoneId === "bed1")!.missing).toBe("No pipe");
  });

  it("tells two heads in one zone apart", () => {
    const { doc, id } = multi();
    const d = addHead(doc, pack, { systemId: id, zoneId: "living", iduModel: "MSZ-AP20VGD" });
    const living = systemRows(d, pack, basis, sysOf(d, id)).zones.filter((r) => r.zoneId === "living");
    expect(living.map((r) => r.of)).toEqual([
      { index: 1, count: 2 },
      { index: 2, count: 2 },
    ]);
  });

  it("sums the zones' loads it knows", () => {
    expect(zonesLoadKw([4.9, 1.8, null, 1.7, 1.5])).toBeCloseTo(9.9);
    expect(zonesLoadKw([null])).toBeNull();
  });
});
