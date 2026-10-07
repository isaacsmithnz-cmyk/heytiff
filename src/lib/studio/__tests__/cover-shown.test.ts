/* A ROOM IS SHORT ONLY BY A SHORTFALL THAT SHOWS (Isaac, 2026-10-07).

   Living needed a hair over 4.5 kW and had a PEFY-P40VMX-E, rated 4.5 kW, on
   a PUMY-SP140 whose combination was valid. Every kW on screen is shown to
   one decimal, so it read "4.5 kW" against "4.5 kW" — and was called short:
   the zone said "0.0 kW short", the card "Living short, 99%". */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { roomLoadKw, type RoomObj } from "../loads-room";
import { addHead, chooseOutdoor, roomVerdict } from "../builder";
import { newSystem } from "../zones";
import { cardStatus } from "../status";
import { roomCoverage } from "../coverage";
import { capacityFit, coverPct, coversLoad, shortKw } from "../fit";

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

describe("the one test of covered", () => {
  it("calls a shortfall that rounds to nothing covered, at 100%", () => {
    expect(coversLoad(4.5, 4.53)).toBe(true);
    expect(shortKw(4.53, 4.5)).toBe(0);
    expect(coverPct(4.5, 4.53)).toBe(100);
  });

  it("calls a shortfall that shows short, by at least the 0.1 kW it shows as", () => {
    expect(coversLoad(4.5, 4.56)).toBe(false);
    expect(shortKw(4.56, 4.5)).toBe(0.1);
    expect(coverPct(4.5, 4.56)).toBe(99);
  });

  it("never reads 100% for a load it calls short", () => {
    // 19.98 against 20.04 is 99.7% — rounded, 100 — and 0.06 kW short
    expect(coversLoad(19.98, 20.04)).toBe(false);
    expect(coverPct(19.98, 20.04)).toBe(99);
  });

  it("leaves a real oversize and a real shortfall alone", () => {
    expect(coverPct(6, 3.6)).toBe(167);
    expect(coverPct(2, 4)).toBe(50);
    expect(shortKw(4, 0)).toBe(4);
  });

  it("is the pickers' test too", () => {
    expect(capacityFit(4.5, 4.53, 1.5)).toBe("fits");
    expect(capacityFit(4.5, 4.56, 1.5)).toBe("undersized");
  });
});

/* Isaac's system, rebuilt against the real pack */
describe("a zone a hair over its unit's rating", () => {
  const rect = (id: string, name: string, x: number, w: number, h: number) =>
    ({
      id, type: "room", systemId: null, floorId: "", plane: "room",
      geometry: { kind: "polygon", points: [{ x, y: 0 }, { x: x + w, y: 0 }, { x: x + w, y: h }, { x, y: h }] },
      props: { name },
    }) as RoomObj as DesignObject;

  function build(): { doc: DesignDocument; sid: string; living: RoomObj; load: number } {
    let doc = createDesign({ name: "x", mode: "blank" });
    const floorId = doc.floors[0].id;
    // a Living whose load lands just over the head's 4.5 kW
    let living: RoomObj | null = null;
    let load = 0;
    for (let w = 300; w < 2000 && !living; w++) {
      const r = { ...rect("living", "Living", 0, w, 500), floorId } as RoomObj;
      const kw = roomLoadKw({ ...doc, objects: [r] }, r);
      if (kw != null && kw > 4.5 && kw < 4.55) {
        living = r;
        load = kw;
      }
    }
    if (!living) throw new Error("no width put Living just over 4.5 kW");
    doc.objects.push(
      living,
      { ...rect("study", "Study", 3000, 300, 300), floorId },
      { ...rect("kitchen", "Kitchen/Sitting", 4000, 500, 500), floorId }
    );
    const made = newSystem(doc, pack.meta.version);
    doc = made.doc;
    for (const [zoneId, iduModel] of [
      ["living", "PEFY-P40VMX-E"],
      ["study", "PEFY-P20VMX-E"],
      ["kitchen", "PEFY-P50VMX-E"],
      ["kitchen", "PEFY-P50VMX-E"],
    ])
      doc = addHead(doc, pack, { systemId: made.systemId, zoneId, iduModel });
    doc = chooseOutdoor(doc, pack, "worst-of-both", made.systemId, "PUMY-SP140VKMD2-A");
    return { doc, sid: made.systemId, living, load };
  }

  it("reads covered on the zone, the card and the sheet's coverage alike", () => {
    const { doc, sid, living, load } = build();
    expect(load).toBeGreaterThan(4.5); // the case: raw, it IS a hair short
    expect(roomVerdict(doc, pack, "worst-of-both", living).word).toBe("Fits");
    const cov = roomCoverage(doc, pack, living, "worst-of-both");
    expect(cov.status).toBe("covered");
    expect(cov.pct).toBe(100);
    const status = cardStatus(doc, pack, "worst-of-both", doc.systems.find((s) => s.id === sid)!);
    expect(status.text).not.toMatch(/short/);
  });
});
