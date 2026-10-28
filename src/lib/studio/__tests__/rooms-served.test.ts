/* ONE UNIT, SEVERAL ROOMS (Isaac, 2026-10-28): on a VRF, Bed 1 and Bed 2 on
   their own bulkheads, and Living, Kitchen and Dining on one ducted VMA. The
   unit is given its rooms (setRoomsServed); its capacity is shared among
   them by load (coverage.ts loadShare); it is still one unit on the outdoor;
   a room leaving the system leaves the group, and the unit stays. Real
   PUHY-P YNW-A1 and City Multi rows from the shipped pack. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import type { RoomObj } from "../loads-room";
import { roomLoadKw } from "../loads-room";
import { allocationsOf, roomsServed, servesRoom } from "../allocations";
import { addHead, moveZone, removeZone, roomsLabel, setRoomsServed, trayItems } from "../builder";
import { newSystem } from "../zones";
import { roomCoverage } from "../coverage";
import { combinationWord } from "../verdict";

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

const BULK_32 = "PEFY-P32VMS1-E";
const BULK_25 = "PEFY-P25VMS1-E";
const VMA_100 = "PEFY-P100VMA-E4";

/* five rooms on a calibrated floor (1 unit = 10 mm), each its own size so
   each has its own load */
function house(): { doc: DesignDocument; systemId: string } {
  const doc = createDesign({ name: "house", mode: "blank" });
  doc.floors[0] = { ...doc.floors[0], scaleMmPerUnit: 10 };
  const floorId = doc.floors[0].id;
  const rooms: [string, string, number, number][] = [
    ["bed1", "Bed 1", 350, 350],
    ["bed2", "Bed 2", 300, 300],
    ["living", "Living", 600, 500],
    ["kitchen", "Kitchen", 400, 350],
    ["dining", "Dining", 350, 350],
  ];
  let x = 0;
  for (const [id, name, w, h] of rooms) {
    doc.objects.push({
      id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: {
        kind: "polygon",
        points: [
          { x, y: 0 },
          { x: x + w, y: 0 },
          { x: x + w, y: h },
          { x, y: h },
        ],
      },
      props: { name },
    } as RoomObj as DesignObject);
    x += w + 50;
  }
  const made = newSystem(doc, pack.meta.version);
  let d = made.doc;
  d = addHead(d, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: BULK_32 });
  d = addHead(d, pack, { systemId: made.systemId, zoneId: "bed2", iduModel: BULK_25 });
  d = addHead(d, pack, { systemId: made.systemId, zoneId: "living", iduModel: VMA_100 });
  /* the zones a VMA could take are the system's: claim the other two */
  d = { ...d, systems: d.systems.map((s) => (s.id === made.systemId ? { ...s, settings: { ...s.settings, zoneIds: [...(s.settings.zoneIds as string[]), "kitchen", "dining"] } } : s)) };
  return { doc: d, systemId: made.systemId };
}

const sysOf = (d: DesignDocument, id: string) => d.systems.find((s) => s.id === id)!;
const vmaOf = (d: DesignDocument, id: string) => allocationsOf(sysOf(d, id)).find((a) => a.model === VMA_100)!;
const room = (d: DesignDocument, id: string) => d.objects.find((o) => o.id === id) as RoomObj;
const grouped = (): { doc: DesignDocument; systemId: string } => {
  const t = house();
  const doc = setRoomsServed(t.doc, pack, {
    systemId: t.systemId,
    allocationId: vmaOf(t.doc, t.systemId).id,
    roomIds: ["living", "kitchen", "dining"],
  });
  return { doc, systemId: t.systemId };
};

describe("one unit, several rooms", () => {
  it("the VMA is given Living, Kitchen and Dining and stays in Living", () => {
    const t = grouped();
    const vma = vmaOf(t.doc, t.systemId);
    expect(vma.roomId).toBe("living");
    expect(roomsServed(vma)).toEqual(["living", "kitchen", "dining"]);
    expect(servesRoom(vma, "bed1")).toBe(false);
  });

  it("a room that is not the system's is never ticked in, and the unit keeps one room", () => {
    const t = house();
    const id = vmaOf(t.doc, t.systemId).id;
    const d = setRoomsServed(t.doc, pack, { systemId: t.systemId, allocationId: id, roomIds: ["living", "nowhere"] });
    expect(roomsServed(vmaOf(d, t.systemId))).toEqual(["living"]);
    expect(setRoomsServed(t.doc, pack, { systemId: t.systemId, allocationId: id, roomIds: [] })).toBe(t.doc);
  });

  it("each room gets its load's share of the unit, so all three read the same percentage", () => {
    const t = grouped();
    const ids = ["living", "kitchen", "dining"];
    const loads = ids.map((id) => roomLoadKw(t.doc, room(t.doc, id))!);
    const total = loads.reduce((a, b) => a + b, 0);
    const kws = ids.map((id) => {
      const c = roomCoverage(t.doc, pack, room(t.doc, id), "cooling").contributors.filter((x) => x.model === VMA_100);
      expect(c).toHaveLength(1);
      return c[0].kw;
    });
    const unitKw = kws.reduce((a, b) => a + b, 0);
    expect(unitKw).toBeCloseTo(11.2, 5);
    ids.forEach((_, i) => expect(kws[i]).toBeCloseTo((unitKw * loads[i]) / total, 5));
    /* the bedrooms keep their own bulkheads, and nothing of the VMA */
    const bed = roomCoverage(t.doc, pack, room(t.doc, "bed1"), "cooling").contributors;
    expect(bed.map((c) => c.model)).toEqual([BULK_32]);
  });

  it("it is still one unit on the outdoor: P32 + P25 + P100 on a valid PUHY", () => {
    const t = grouped();
    const sys = sysOf(t.doc, t.systemId);
    expect(sys.type).toBe("vrf");
    expect(allocationsOf(sys).filter((a) => a.role === "idu")).toHaveLength(3);
    expect(combinationWord(t.doc, pack, sys)).toBe("Valid");
  });

  it("the tray names every room it serves", () => {
    const t = grouped();
    const item = trayItems(t.doc, pack).find((i) => i.model === VMA_100)!;
    expect(item.label).toBe("Living, Kitchen and Dining");
  });

  it("a room cleared from the system leaves the group; the unit stays", () => {
    const t = grouped();
    const d = removeZone(t.doc, pack, t.systemId, "kitchen");
    expect(roomsServed(vmaOf(d, t.systemId))).toEqual(["living", "dining"]);
    /* its own room cleared: the next room it serves becomes its own */
    const e = removeZone(d, pack, t.systemId, "living");
    const vma = vmaOf(e, t.systemId);
    expect(vma.roomId).toBe("dining");
    expect(roomsServed(vma)).toEqual(["dining"]);
  });

  it("a room moved to another system goes alone; the grouped unit stays behind", () => {
    const t = grouped();
    const other = newSystem(t.doc, pack.meta.version);
    const d = moveZone(other.doc, pack, "kitchen", t.systemId, other.systemId);
    expect(roomsServed(vmaOf(d, t.systemId))).toEqual(["living", "dining"]);
    expect(allocationsOf(sysOf(d, other.systemId)).some((a) => a.model === VMA_100)).toBe(false);
  });

  it("a stored group survives a reload, without its own room twice", () => {
    const t = grouped();
    const sys = sysOf(t.doc, t.systemId);
    const raw = (sys.settings.allocations as Record<string, unknown>[]).map((a) =>
      a.model === VMA_100 ? { ...a, alsoServes: ["living", "kitchen", "kitchen", 7, "dining"] } : a
    );
    const vma = allocationsOf({ ...sys, settings: { ...sys.settings, allocations: raw } }).find((a) => a.model === VMA_100)!;
    expect(roomsServed(vma)).toEqual(["living", "kitchen", "dining"]);
  });

  it("rooms are listed the way a sentence lists them", () => {
    expect(roomsLabel(["Living"])).toBe("Living");
    expect(roomsLabel(["Living", "Dining"])).toBe("Living and Dining");
    expect(roomsLabel(["Living", "Kitchen", "Dining"])).toBe("Living, Kitchen and Dining");
  });
});
