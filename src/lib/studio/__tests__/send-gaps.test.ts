/* What the plan still lacks before the sheet goes out (send-gaps.ts; walk
   of 29 October 2026): ducted rooms with no supply grille in them, and units
   chosen but not yet on the plan. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { addBandUnit, placeAllocation } from "../builder";
import { allocationsOf } from "../allocations";
import { claimZone, newSystem } from "../zones";
import { buildSummaryModel } from "../summary";
import { grille } from "../grilles";
import { roomsWithoutSupply, unitsNotPlaced } from "../send-gaps";

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

function ducted(): { doc: DesignDocument; systemId: string } {
  const doc = createDesign({ name: "x", mode: "blank" });
  doc.floors[0] = { ...doc.floors[0], scaleMmPerUnit: 10 };
  const floorId = doc.floors[0].id;
  const room = (id: string, name: string, x: number) =>
    doc.objects.push({
      id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: { kind: "polygon", points: [{ x, y: 0 }, { x: x + 400, y: 0 }, { x: x + 400, y: 400 }, { x, y: 400 }] },
      props: { name },
    } as DesignObject);
  room("living", "Living", 0);
  room("bed", "Bed 1", 400);
  const made = newSystem(doc, pack.meta.version);
  let d = claimZone(claimZone(made.doc, made.systemId, "living"), made.systemId, "bed");
  d = addBandUnit(d, pack, { systemId: made.systemId, iduModel: "PEAD-M100JAA(D)" });
  return { doc: d, systemId: made.systemId };
}

describe("before the sheet goes out", () => {
  it("names each ducted room with no supply grille in it", () => {
    const { doc, systemId } = ducted();
    const floorId = doc.floors[0].id;
    expect(roomsWithoutSupply(doc, buildSummaryModel(doc, pack)).map((r) => r.room)).toEqual(["Living", "Bed 1"]);
    const one = { ...doc, objects: [...doc.objects, grille(floorId, systemId, { x: 200, y: 200 }, "supply", { wMm: 300, hMm: 300 })] };
    expect(roomsWithoutSupply(one, buildSummaryModel(one, pack)).map((r) => r.room)).toEqual(["Bed 1"]);
    // a return grille feeds nothing
    const ret = { ...one, objects: [...one.objects, grille(floorId, systemId, { x: 600, y: 200 }, "return", { wMm: 600, hMm: 400 })] };
    expect(roomsWithoutSupply(ret, buildSummaryModel(ret, pack)).map((r) => r.room)).toEqual(["Bed 1"]);
  });

  it("names the units chosen and not yet on the plan", () => {
    const { doc, systemId } = ducted();
    expect(unitsNotPlaced(doc, pack).sort()).toEqual(["PEAD-M100JAA(D)", expect.stringMatching(/^PUZ|^SUZ/)].sort());
    const idu = allocationsOf(doc.systems[0]).find((a) => a.role === "idu")!;
    const placed = placeAllocation(doc, pack, systemId, idu.id, doc.floors[0].id, { x: 400, y: 200 });
    expect(unitsNotPlaced(placed, pack)).not.toContain("PEAD-M100JAA(D)");
    expect(unitsNotPlaced(doc, null)).toEqual([]);
  });
});
