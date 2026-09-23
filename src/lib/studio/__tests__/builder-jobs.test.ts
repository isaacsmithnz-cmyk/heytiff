/* The system builder's jobs, as tests (spec: Studio System Builder, build
   order step 3 — "the golden set #18 never had").

   Every job runs against the real shipped Mitsubishi pack, so a data change
   that breaks a job fails here. The house is the spec's: a 14.0 kW-class
   living area, three bedrooms, a study. Room loads come from the Studio's own
   load model on the rooms' areas, never typed in.

   The model under test: a system holds ALLOCATIONS — every unit it has,
   placed or not — and a unit put on the plan is an object that reuses its
   allocation's id. So the builder decides which room a unit serves, placing
   only gives it a position, and a swap changes the model on the same object. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { roomLoadKw, type RoomObj } from "../loads-room";
import { sizingCapacityKw } from "../loads";
import { roomAtPoint, roomCoverage, systemCover } from "../coverage";
import { buildSummaryModel } from "../summary";
import { multiConnection } from "../multi";
import {
  addBandUnit,
  addHead,
  addMultiHead,
  addSplit,
  addSplitBeside,
  adoptLegacySystem,
  allocationsOf,
  chooseOutdoor,
  deleteZone,
  moveAllocation,
  moveZone,
  outdoorsListing,
  placeAllocation,
  placeInRoomSpot,
  releaseSystem,
  removeAllocation,
  removeZone,
  roomVerdict,
  swapAllocation,
  systemCheck,
  trayItems,
  useProposal,
  wrongRoomPlacements,
  zonesToAdd,
} from "../builder";
import { claimZone, familyOf, newSystem, systemKind, zoneIdsOf } from "../zones";
import { combinationWord, connectionRatio, doneReason, systemFindings } from "../verdict";

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

const kw = (model: string) =>
  sizingCapacityKw(
    pack.indoor_units.find((u) => u.model === model) ??
      pack.outdoor_units.find((u) => u.model === model)!,
    basis
  );

/* ── the house: rooms belong to the plan (systemId null) ── */

function rect(x: number, y: number, w: number, h: number) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function house(): { doc: DesignDocument; room: Record<string, RoomObj> } {
  const doc = createDesign({ name: "house", mode: "blank" }); // 10 mm per unit
  const floorId = doc.floors[0].id;
  const add = (id: string, name: string, x: number, y: number, w: number, h: number) => {
    const r: RoomObj = {
      id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: { kind: "polygon", points: rect(x, y, w, h) },
      props: { name },
    } as RoomObj;
    doc.objects.push(r as DesignObject);
    return r;
  };
  const room = {
    living: add("living", "Living", 0, 0, 1000, 960), // ~96 m²
    bed1: add("bed1", "Bed 1", 1100, 0, 400, 300), // 12 m²
    bed2: add("bed2", "Bed 2", 1600, 0, 450, 400), // 18 m²
    master: add("master", "Master", 2150, 0, 550, 500), // 27.5 m²
    study: add("study", "Study", 1100, 500, 400, 320), // ~12.8 m²
  };
  return { doc, room };
}

const load = (doc: DesignDocument, r: RoomObj) => roomLoadKw(doc, r)!;

describe("the house's loads come from the load model", () => {
  it("gives a big living area and bedrooms that climb in size", () => {
    const { doc, room } = house();
    expect(load(doc, room.living)).toBeGreaterThan(13);
    expect(load(doc, room.bed1)).toBeLessThan(load(doc, room.bed2));
    expect(load(doc, room.bed2)).toBeLessThan(load(doc, room.master));
  });
});

/* ── job 1: one bedroom, one split ── */

describe("one bedroom, one split", () => {
  it("dropping a pair into a room creates the split, and nothing is on the plan", () => {
    const { doc, room } = house();
    const r = addSplit(doc, pack, {
      roomId: room.bed1.id,
      iduModel: "MSZ-AP25VGD2",
      oduModel: "MUZ-AP25VG2",
    });
    const sys = r.doc.systems.find((s) => s.id === r.systemId)!;
    expect(sys.type).toBe("split");
    expect(allocationsOf(sys).map((a) => [a.role, a.model, a.roomId])).toEqual([
      ["idu", "MSZ-AP25VGD2", room.bed1.id],
      ["odu", "MUZ-AP25VG2", null],
    ]);
    // the engines that read the old settings keep working
    expect(sys.settings.pairIdu).toBe("MSZ-AP25VGD2");
    expect(sys.settings.pairOdu).toBe("MUZ-AP25VG2");
    expect(sys.settings.roomId).toBe(room.bed1.id);
    expect(sys.settings.roomIds).toEqual([room.bed1.id]);
    // allocated, not placed
    expect(r.doc.objects.filter((o) => o.type === "unit")).toHaveLength(0);
    expect(trayItems(r.doc, pack)).toHaveLength(2);
    // the room is covered by the allocation before anything is placed
    expect(roomCoverage(r.doc, pack, room.bed1, basis).coveredKw).toBeCloseTo(kw("MSZ-AP25VGD2"), 5);
  });
});

/* ── job 2 + R12: three bedrooms on one outdoor, the outdoor proposed ── */

describe("the outdoor is proposed, not picked (R12)", () => {
  it("steps up as heads arrive and says so when nothing lists the set", () => {
    const { doc, room } = house();
    let d = doc;
    let sysId: string | null = null;
    const head = (roomId: string, model: string) => {
      const r = addMultiHead(d, pack, basis, { systemId: sysId, roomId, iduModel: model });
      d = r.doc;
      sysId = r.systemId;
      return d.systems.find((s) => s.id === sysId)!;
    };
    const odu = () =>
      allocationsOf(d.systems.find((s) => s.id === sysId)!).find((a) => a.role === "odu")?.model ||
      null;

    head(room.living.id, "SEZ-M71DA(L)");
    expect(odu()).toBe("MXZ-4F80VGD");
    head(room.bed1.id, "MSZ-AP25VGD2");
    head(room.bed2.id, "MSZ-AP35VGD2");
    expect(odu()).toBe("MXZ-4F80VGD");
    const sys = head(room.master.id, "MSZ-AP50VGD2");
    expect(odu()).toBeNull();
    expect(systemCheck(d, pack, basis, sys)).toMatchObject({ kind: "multi", listed: false });

    // take Living's head out: the rest is re-proposed, smallest first
    const living = allocationsOf(sys).find((a) => a.roomId === room.living.id)!;
    d = removeAllocation(d, sysId!, living.id, pack);
    expect(odu()).toBe("MXZ-4F71VGD");
  });

  it("keeps an outdoor chosen by hand while it still lists the set", () => {
    const { doc, room } = house();
    let r = addMultiHead(doc, pack, basis, { systemId: null, roomId: room.bed1.id, iduModel: "MSZ-AP25VGD2" });
    r = addMultiHead(r.doc, pack, basis, { systemId: r.systemId, roomId: room.bed2.id, iduModel: "MSZ-AP35VGD2" });
    const chosen = chooseOutdoor(r.doc, pack, basis, r.systemId, "MXZ-6F120VGD");
    const again = addMultiHead(chosen, pack, basis, {
      systemId: r.systemId,
      roomId: room.master.id,
      iduModel: "MSZ-AP50VGD2",
    });
    const sys = again.doc.systems.find((s) => s.id === r.systemId)!;
    expect(allocationsOf(sys).find((a) => a.role === "odu")?.model).toBe("MXZ-6F120VGD");
    // and the list offered to choose from is only outdoors that list the set
    const listing = outdoorsListing(
      pack,
      ["MSZ-AP25VGD2", "MSZ-AP35VGD2", "MSZ-AP50VGD2"].map((m) => pack.indoor_units.find((u) => u.model === m)!)
    ).map((o) => o.model);
    expect(listing).toEqual(["MXZ-4F71VGD", "MXZ-4F80VGD", "MXZ-5F100VGD", "MXZ-6F120VGD"]);
  });

  it("between two outdoors of one size, proposes the one with the longer pipe run", () => {
    const { doc, room } = house();
    let r = addMultiHead(doc, pack, basis, { systemId: null, roomId: room.bed1.id, iduModel: "MSZ-AP20VGD" });
    r = addMultiHead(r.doc, pack, basis, { systemId: r.systemId, roomId: room.bed2.id, iduModel: "MSZ-AP25VGD2" });
    const sys = r.doc.systems.find((s) => s.id === r.systemId)!;
    // MXZ-2F52VF and MXZ-2F52VGD are both 5.2 kW; the VGD runs 40 m of pipe, the VF 30 m
    expect(allocationsOf(sys).find((a) => a.role === "odu")?.model).toBe("MXZ-2F52VGD");
  });

  it("covers each bedroom at its head's rating — diversity is normal", () => {
    const { doc, room } = house();
    let r = addMultiHead(doc, pack, basis, { systemId: null, roomId: room.bed1.id, iduModel: "MSZ-AP25VGD2" });
    r = addMultiHead(r.doc, pack, basis, { systemId: r.systemId, roomId: room.bed2.id, iduModel: "MSZ-AP35VGD2" });
    r = addMultiHead(r.doc, pack, basis, { systemId: r.systemId, roomId: room.master.id, iduModel: "MSZ-AP50VGD2" });
    const sys = r.doc.systems.find((s) => s.id === r.systemId)!;
    expect(allocationsOf(sys).find((a) => a.role === "odu")?.model).toBe("MXZ-4F71VGD");
    expect(roomCoverage(r.doc, pack, room.master, basis).coveredKw).toBeCloseTo(kw("MSZ-AP50VGD2"), 5);
    const conn = multiConnection(r.doc, pack, sys, basis);
    expect(conn.iduCount).toBe(3);
    expect(conn.findings.filter((f) => f.severity === "red")).toEqual([]);
    expect(systemCheck(r.doc, pack, basis, sys)).toMatchObject({ kind: "multi", listed: true });
  });
});

/* ── job: a 14 kW room on two splits ── */

describe("two splits in one room", () => {
  it("sums both pairs into the room, and the tray tells the two outdoors apart", () => {
    const { doc, room } = house();
    let r = addSplit(doc, pack, { roomId: room.living.id, iduModel: "SEZ-M71DA(L)", oduModel: "SUZ-M71VAD-A" });
    r = addSplit(r.doc, pack, { roomId: room.living.id, iduModel: "SEZ-M71DA(L)", oduModel: "SUZ-M71VAD-A" });
    const cov = roomCoverage(r.doc, pack, room.living, basis);
    expect(cov.coveredKw).toBeCloseTo(2 * 7.1, 5);
    expect(roomVerdict(r.doc, pack, basis, room.living).word).toBe("Fits");
    const odus = trayItems(r.doc, pack).filter((t) => t.role === "odu");
    expect(odus.map((t) => t.label)).toEqual(["Living 1", "Living 2"]);
  });
});

/* ── job: two heads for one room on a multi — the outdoor limits that room ── */

describe("two heads in one room on a multi", () => {
  it("caps the room at the outdoor and reads it as undersized", () => {
    const { doc, room } = house();
    let r = addMultiHead(doc, pack, basis, { systemId: null, roomId: room.living.id, iduModel: "SEZ-M71DA(L)" });
    r = addMultiHead(r.doc, pack, basis, { systemId: r.systemId, roomId: room.living.id, iduModel: "SEZ-M71DA(L)" });
    const sys = r.doc.systems.find((s) => s.id === r.systemId)!;
    expect(allocationsOf(sys).find((a) => a.role === "odu")?.model).toBe("MXZ-4F80VGD");
    const cov = roomCoverage(r.doc, pack, room.living, basis);
    expect(cov.coveredKw).toBeCloseTo(kw("MXZ-4F80VGD"), 5);
    expect(roomVerdict(r.doc, pack, basis, room.living).word).toBe("Undersized");
  });

  it("the book refuses 71 + 71 with three bedroom heads on every MXZ", () => {
    const { doc, room } = house();
    let d = doc;
    let id: string | null = null;
    for (const [roomId, model] of [
      [room.living.id, "SEZ-M71DA(L)"],
      [room.living.id, "SEZ-M71DA(L)"],
      [room.bed1.id, "MSZ-AP25VGD2"],
      [room.bed2.id, "MSZ-AP35VGD2"],
      [room.master.id, "MSZ-AP35VGD2"],
    ] as const) {
      const r = addMultiHead(d, pack, basis, { systemId: id, roomId, iduModel: model });
      d = r.doc;
      id = r.systemId;
    }
    const check = systemCheck(d, pack, basis, d.systems.find((s) => s.id === id)!);
    expect(check).toMatchObject({ kind: "multi", listed: false, alternatives: [] });
  });
});

/* ── placing ── */

describe("placing never changes the room a unit serves", () => {
  it("reuses the allocation's id, keeps its room, and flags a drop in another room", () => {
    const { doc, room } = house();
    const r = addSplit(doc, pack, { roomId: room.bed1.id, iduModel: "MSZ-AP25VGD2", oduModel: "MUZ-AP25VG2" });
    const sys = r.doc.systems.find((s) => s.id === r.systemId)!;
    const idu = allocationsOf(sys).find((a) => a.role === "idu")!;
    // dropped inside Bed 2
    const placed = placeAllocation(r.doc, pack, r.systemId, idu.id, doc.floors[0].id, { x: 1700, y: 100 });
    const obj = placed.objects.find((o) => o.id === idu.id)!;
    expect(obj.type).toBe("unit");
    expect(obj.systemId).toBe(r.systemId);
    expect(obj.props.roomId).toBe(room.bed1.id);
    expect(obj.props.model).toBe("MSZ-AP25VGD2");
    expect(wrongRoomPlacements(placed)).toEqual([
      { systemId: r.systemId, allocationId: idu.id, roomId: room.bed1.id, inRoomId: room.bed2.id },
    ]);
    expect(trayItems(placed, pack).map((t) => t.role)).toEqual(["odu"]);

    // outside every room — the hallway bulkhead — is not flagged
    const hall = placeAllocation(r.doc, pack, r.systemId, idu.id, doc.floors[0].id, { x: 1050, y: 900 });
    expect(wrongRoomPlacements(hall)).toEqual([]);
  });

  it("Place in room puts a head inside its room and an outdoor below it, never two on one spot", () => {
    const { doc, room } = house();
    const floorId = doc.floors[0].id;
    let d = addSplit(doc, pack, { roomId: room.living.id, iduModel: "MSZ-AP71VGD2", oduModel: "MUZ-AP71VG2" }).doc;
    d = addSplit(d, pack, { roomId: room.living.id, iduModel: "MSZ-AP71VGD2", oduModel: "MUZ-AP71VG2" }).doc;
    for (const item of trayItems(d, pack)) {
      const spot = placeInRoomSpot(d, pack, item.systemId, item.allocationId)!;
      expect(spot.floorId).toBe(floorId);
      d = placeAllocation(d, pack, item.systemId, item.allocationId, spot.floorId, spot.at);
    }
    expect(trayItems(d, pack)).toEqual([]);
    const units = d.objects.filter((o) => o.type === "unit");
    const at = (role: string) =>
      units.filter((o) => o.props.role === role).map((o) => (o.geometry.kind === "point" ? o.geometry.at : null)!);
    const heads = at("idu");
    const outs = at("odu");
    expect(heads).toHaveLength(2);
    expect(outs).toHaveLength(2);
    // both heads inside Living, both outdoors outside it and below it
    for (const p of heads) expect(roomAtPoint(d.objects, floorId, p)?.id).toBe(room.living.id);
    for (const p of outs) {
      expect(roomAtPoint(d.objects, floorId, p)).toBeNull();
      expect(p.y).toBeGreaterThan(960);
    }
    // and never on one spot
    expect(heads[0].x).not.toBeCloseTo(heads[1].x, 0);
    expect(outs[0].x).not.toBeCloseTo(outs[1].x, 0);
    // placing moved nothing between rooms
    expect(wrongRoomPlacements(d)).toEqual([]);
  });

  it("an outdoor never lands inside the room next door", () => {
    const { doc, room } = house();
    const floorId = doc.floors[0].id;
    // a hall directly below Master
    doc.objects.push({
      id: "hall",
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: { kind: "polygon", points: rect(2150, 500, 550, 300) },
      props: { name: "Hall" },
    } as DesignObject);
    const r = addSplit(doc, pack, { roomId: room.master.id, iduModel: "MSZ-AP35VGD2", oduModel: "MUZ-AP35VG2" });
    const odu = allocationsOf(r.doc.systems[0]).find((a) => a.role === "odu")!;
    const spot = placeInRoomSpot(r.doc, pack, r.systemId, odu.id)!;
    expect(roomAtPoint(r.doc.objects, floorId, spot.at)).toBeNull();
    // the side that backs onto the hall is passed over for the open one above
    expect(spot.at.y).toBeLessThan(0);
  });

  it("deleting a placed unit on the plan sends it back to the tray", () => {
    const { doc, room } = house();
    const r = addSplit(doc, pack, { roomId: room.bed1.id, iduModel: "MSZ-AP25VGD2", oduModel: "MUZ-AP25VG2" });
    const idu = allocationsOf(r.doc.systems[0]).find((a) => a.role === "idu")!;
    const placed = placeAllocation(r.doc, pack, r.systemId, idu.id, doc.floors[0].id, { x: 1200, y: 100 });
    const deleted = { ...placed, objects: placed.objects.filter((o) => o.id !== idu.id) };
    expect(trayItems(deleted, pack).map((t) => t.allocationId)).toContain(idu.id);
    // still covering its room — the builder decides, not the plan
    expect(roomCoverage(deleted, pack, room.bed1, basis).coveredKw).toBeCloseTo(kw("MSZ-AP25VGD2"), 5);
  });
});

/* ── swap ── */

describe("swap changes the model on the same unit", () => {
  it("keeps the placed unit's id, position and attached run", () => {
    const { doc, room } = house();
    let r = addMultiHead(doc, pack, basis, { systemId: null, roomId: room.bed1.id, iduModel: "MSZ-AP25VGD2" });
    r = addMultiHead(r.doc, pack, basis, { systemId: r.systemId, roomId: room.master.id, iduModel: "MSZ-AP35VGD2" });
    const sys = r.doc.systems.find((s) => s.id === r.systemId)!;
    const master = allocationsOf(sys).find((a) => a.roomId === room.master.id)!;
    let d = placeAllocation(r.doc, pack, r.systemId, master.id, doc.floors[0].id, { x: 2300, y: 100 });
    d = {
      ...d,
      objects: [
        ...d.objects,
        {
          id: "run1",
          type: "pipe-run",
          systemId: r.systemId,
          floorId: doc.floors[0].id,
          plane: "room",
          geometry: { kind: "polyline", points: [{ x: 2300, y: 100 }, { x: 2300, y: 700 }] },
          props: { startAttach: { id: master.id } },
        },
      ],
    };
    const swapped = swapAllocation(d, pack, basis, r.systemId, master.id, "MSZ-AP50VGD2");
    expect(swapped.ok).toBe(true);
    const obj = swapped.doc.objects.find((o) => o.id === master.id)!;
    expect(obj.props.model).toBe("MSZ-AP50VGD2");
    expect(obj.geometry).toEqual({ kind: "point", at: { x: 2300, y: 100 } });
    expect(obj.props.widthMm).toBe(pack.indoor_units.find((u) => u.model === "MSZ-AP50VGD2")!.width_mm);
    expect(swapped.doc.objects.find((o) => o.id === "run1")!.props.startAttach).toEqual({ id: master.id });
    expect(roomCoverage(swapped.doc, pack, room.master, basis).coveredKw).toBeCloseTo(kw("MSZ-AP50VGD2"), 5);
  });

  it("a split's outdoor follows its indoor, same series and phase", () => {
    const { doc, room } = house();
    const study = addSplit(doc, pack, { roomId: room.study.id, iduModel: "MSZ-AP25VGD2", oduModel: "MUZ-AP25VG2" });
    const idu = allocationsOf(study.doc.systems[0]).find((a) => a.role === "idu")!;
    const s1 = swapAllocation(study.doc, pack, basis, study.systemId, idu.id, "MSZ-AP35VGD2");
    expect(allocationsOf(s1.doc.systems[0]).map((a) => a.model)).toEqual(["MSZ-AP35VGD2", "MUZ-AP35VG2"]);
    expect(s1.doc.systems[0].settings.pairOdu).toBe("MUZ-AP35VG2");

    const big = addSplit(doc, pack, { roomId: room.living.id, iduModel: "PEAD-M140JAA(D)", oduModel: "PUZ-ZM140YKA2-A" });
    const bigIdu = allocationsOf(big.doc.systems[0]).find((a) => a.role === "idu")!;
    const s2 = swapAllocation(big.doc, pack, basis, big.systemId, bigIdu.id, "PEAD-M125JAA(D)");
    expect(allocationsOf(s2.doc.systems[0]).find((a) => a.role === "odu")!.model).toBe("PUZ-ZM125YKA2-A");
  });
});

/* ── moving and removing ── */

describe("the builder moves and removes units", () => {
  it("moving a head to another room moves its cover and the room list", () => {
    const { doc, room } = house();
    const r = addMultiHead(doc, pack, basis, { systemId: null, roomId: room.bed1.id, iduModel: "MSZ-AP25VGD2" });
    const head = allocationsOf(r.doc.systems[0]).find((a) => a.role === "idu")!;
    const moved = moveAllocation(r.doc, r.systemId, head.id, room.bed2.id);
    expect(roomCoverage(moved, pack, room.bed1, basis).coveredKw).toBe(0);
    expect(roomCoverage(moved, pack, room.bed2, basis).coveredKw).toBeCloseTo(kw("MSZ-AP25VGD2"), 5);
    expect(moved.systems[0].settings.roomIds).toEqual([room.bed2.id]);
  });

  it("removing a split's indoor unit removes the split", () => {
    const { doc, room } = house();
    const r = addSplit(doc, pack, { roomId: room.bed1.id, iduModel: "MSZ-AP25VGD2", oduModel: "MUZ-AP25VG2" });
    const idu = allocationsOf(r.doc.systems[0]).find((a) => a.role === "idu")!;
    expect(removeAllocation(r.doc, r.systemId, idu.id).systems).toHaveLength(0);
  });
});

/* ── deleting a system ── */

describe("deleting a system gives its rooms back", () => {
  it("keeps every room and heat load, takes the system's units and runs", () => {
    const { doc, room } = house();
    const r = addSplit(doc, pack, { roomId: room.bed1.id, iduModel: "MSZ-AP25VGD2", oduModel: "MUZ-AP25VG2" });
    const idu = allocationsOf(r.doc.systems[0]).find((a) => a.role === "idu")!;
    let d = placeAllocation(r.doc, pack, r.systemId, idu.id, doc.floors[0].id, { x: 1200, y: 100 });
    // a legacy room the system had drawn under it
    d = {
      ...d,
      objects: d.objects.map((o) => (o.id === room.study.id ? { ...o, systemId: r.systemId } : o)),
    };
    const released = releaseSystem(d, r.systemId);
    expect(released.systems).toHaveLength(0);
    expect(released.objects.filter((o) => o.type === "room")).toHaveLength(5);
    expect(released.objects.find((o) => o.id === room.study.id)!.systemId).toBeNull();
    expect(released.objects.filter((o) => o.type === "unit")).toHaveLength(0);
  });
});

/* ── verdict words ── */

describe("room verdicts", () => {
  it("reads Calibrate on an uncalibrated floor and No units on an empty room", () => {
    const { doc, room } = house();
    expect(roomVerdict(doc, pack, basis, room.bed1).word).toBe("No units");
    const uncalibrated = {
      ...doc,
      floors: doc.floors.map((f) => ({ ...f, scaleMmPerUnit: null })),
    };
    expect(roomVerdict(uncalibrated, pack, basis, room.bed1).word).toBe("Calibrate");
  });

  it("reads Oversized past one and a half times the load", () => {
    const { doc, room } = house();
    const r = addSplit(doc, pack, { roomId: room.bed1.id, iduModel: "MSZ-AP50VGD2", oduModel: "MUZ-AP50VG2" });
    expect(roomVerdict(r.doc, pack, basis, room.bed1).word).toBe("Oversized");
  });
});

/* ── old designs ── */

describe("an old design's systems become allocations on first open in the builder", () => {
  it("a placed split keeps its object ids as allocation ids", () => {
    const { doc, room } = house();
    const sysId = "sys_old";
    const floorId = doc.floors[0].id;
    const old: DesignDocument = {
      ...doc,
      systems: [
        {
          id: sysId,
          type: "split",
          brand: "mitsubishi-electric",
          colour: "#2E68FF",
          name: "System 1",
          settings: { pairIdu: "MSZ-AP25VGD2", pairOdu: "MUZ-AP25VG2", roomId: room.bed1.id },
        },
      ],
      objects: [
        ...doc.objects.map((o) => (o.id === room.bed1.id ? { ...o, systemId: sysId } : o)),
        {
          id: "u_idu",
          type: "unit",
          systemId: sysId,
          floorId,
          plane: "room",
          geometry: { kind: "point", at: { x: 1200, y: 100 } },
          props: { role: "idu", model: "MSZ-AP25VGD2", roomId: room.bed1.id },
        },
      ],
    };
    const adopted = adoptLegacySystem(old, pack, sysId);
    const allocs = allocationsOf(adopted.systems[0]);
    expect(allocs.map((a) => [a.id === "u_idu", a.role, a.model, a.roomId])).toEqual([
      [true, "idu", "MSZ-AP25VGD2", room.bed1.id],
      [false, "odu", "MUZ-AP25VG2", null],
    ]);
    expect(trayItems(adopted, pack).map((t) => t.role)).toEqual(["odu"]);
  });

  it("a multi with two heads placed in one room keeps both", () => {
    const { doc, room } = house();
    const sysId = "sys_multi";
    const floorId = doc.floors[0].id;
    const old: DesignDocument = {
      ...doc,
      systems: [
        {
          id: sysId,
          type: "multi-split",
          brand: "mitsubishi-electric",
          colour: "#2E68FF",
          name: "System 1",
          settings: {
            pairOdu: "MXZ-4F71VGD",
            multiIdus: { [room.bed1.id]: "MSZ-AP25VGD2", [room.bed2.id]: "MSZ-AP35VGD2" },
          },
        },
      ],
      objects: [
        ...doc.objects,
        {
          id: "h1",
          type: "unit",
          systemId: sysId,
          floorId,
          plane: "room",
          geometry: { kind: "point", at: { x: 1200, y: 100 } },
          props: { role: "idu", model: "MSZ-AP25VGD2", roomId: room.bed1.id },
        },
        {
          id: "h2",
          type: "unit",
          systemId: sysId,
          floorId,
          plane: "room",
          geometry: { kind: "point", at: { x: 1300, y: 100 } },
          props: { role: "idu", model: "MSZ-AP25VGD2", roomId: room.bed1.id },
        },
      ],
    };
    const allocs = allocationsOf(adoptLegacySystem(old, pack, sysId).systems[0]);
    expect(allocs.filter((a) => a.role === "idu").map((a) => [a.roomId, a.model])).toEqual([
      [room.bed1.id, "MSZ-AP25VGD2"],
      [room.bed1.id, "MSZ-AP25VGD2"],
      [room.bed2.id, "MSZ-AP35VGD2"],
    ]);
    expect(allocs.find((a) => a.role === "odu")!.model).toBe("MXZ-4F71VGD");
  });
});

/* ── step 9: the panel's ring and the design sheet read one calculation ── */

describe("the panel and the sheet read one calculation", () => {
  it("shares a room two splits cover, and counts its load once", () => {
    const { doc, room } = house();
    let r = addSplit(doc, pack, { roomId: room.living.id, iduModel: "SEZ-M71DA(L)", oduModel: "SUZ-M71VAD-A" });
    const first = r.systemId;
    r = addSplit(r.doc, pack, { roomId: room.living.id, iduModel: "SEZ-M71DA(L)", oduModel: "SUZ-M71VAD-A" });
    const livingLoad = load(r.doc, room.living);
    const roomPct = roomCoverage(r.doc, pack, room.living, basis).pct;

    const sheet = buildSummaryModel(r.doc, pack);
    expect(sheet.systems).toHaveLength(2);
    for (const s of sheet.systems) {
      const cover = systemCover(r.doc, pack, r.doc.systems.find((x) => x.id === s.systemId)!, basis);
      const [row] = s.rooms;
      expect(s.rooms).toHaveLength(1);
      // each carries half the room's load and only its own pair
      expect(row.loadKw).toBeCloseTo(livingLoad / 2, 5);
      expect(row.capacityKw).toBeCloseTo(7.1, 5);
      expect(row.indoorModel).toBe("SEZ-M71DA(L)");
      // and reads as the room does, on the sheet and in the ring alike
      expect(row.pct).toBe(roomPct);
      expect(s.pct).toBe(cover.pct);
    }
    // the job's load is the room's, once
    const summed = sheet.systems.reduce((a, s) => a + (s.rooms[0].loadKw ?? 0), 0);
    expect(summed).toBeCloseTo(livingLoad, 5);
    expect(sheet.systems.map((s) => s.systemId)).toContain(first);
  });

  it("lists every unit a room has, and counts units not on the plan yet", () => {
    const { doc, room } = house();
    let r = addMultiHead(doc, pack, basis, { systemId: null, roomId: room.bed1.id, iduModel: "MSZ-AP25VGD2" });
    r = addMultiHead(r.doc, pack, basis, { systemId: r.systemId, roomId: room.bed1.id, iduModel: "MSZ-AP20VGD" });
    r = addMultiHead(r.doc, pack, basis, { systemId: r.systemId, roomId: room.bed2.id, iduModel: "MSZ-AP35VGD2" });
    const sys = r.doc.systems.find((s) => s.id === r.systemId)!;
    const oduModel = allocationsOf(sys).find((a) => a.role === "odu")!.model;
    expect(oduModel).not.toBe("");

    const s = buildSummaryModel(r.doc, pack).systems[0];
    expect(s.rooms.find((x) => x.roomId === room.bed1.id)!.indoorModel).toBe("MSZ-AP25VGD2, MSZ-AP20VGD");
    expect(s.kindLabel).toBe("Multi-split, 3 heads on one outdoor");
    // nothing is placed, and the outdoor and the pick still know the units
    expect(r.doc.objects.filter((o) => o.type === "unit")).toHaveLength(0);
    expect(s.outdoorModel).toBe(oduModel);
    const units = buildSummaryModel(r.doc, pack).picklist.filter((p) => p.group === "units");
    expect(units.map((p) => [p.name, p.qty])).toEqual(
      [
        ["MSZ-AP20VGD", "1"],
        ["MSZ-AP25VGD2", "1"],
        ["MSZ-AP35VGD2", "1"],
        [oduModel, "1"],
      ].sort(([a], [b]) => a.localeCompare(b))
    );
    // placing a unit never counts it twice
    const head = allocationsOf(sys).find((a) => a.role === "idu")!;
    const placed = placeAllocation(r.doc, pack, sys.id, head.id, doc.floors[0].id, { x: 1200, y: 100 });
    const again = buildSummaryModel(placed, pack).picklist.find((p) => p.name === head.model)!;
    expect(again.qty).toBe("1");
  });
});

/* ── the zones flow's jobs (docs/studio-zones-and-systems.md) ── */

/** a system with these zones claimed and nothing in it yet */
function claimed(doc: DesignDocument, zoneIds: string[]): { doc: DesignDocument; systemId: string } {
  const made = newSystem(doc, pack.meta.version);
  let d = made.doc;
  for (const z of zoneIds) d = claimZone(d, made.systemId, z);
  return { doc: d, systemId: made.systemId };
}
const sysOf = (doc: DesignDocument, id: string) => doc.systems.find((s) => s.id === id)!;
const oduOf = (doc: DesignDocument, id: string) =>
  allocationsOf(sysOf(doc, id)).find((a) => a.role === "odu")?.model || null;

describe("the five bedrooms on one multi (the mock's System 2)", () => {
  it("claims the zones first, proposes as heads land, and reads 14.2 kW of cover as valid", () => {
    const { doc, room } = house();
    const zones = [room.bed1.id, room.bed2.id, room.master.id, room.study.id, room.living.id];
    const made = claimed(doc, zones);
    let d = made.doc;
    const sys = () => sysOf(d, made.systemId);
    // five zones claimed: the family starts on multi, and the system is empty
    expect(familyOf(sys())).toBe("multi");
    expect(systemKind(d, sys())).toBe("empty");
    expect(combinationWord(d, pack, sys())).toBeNull();
    expect(sys().settings.roomIds).toEqual(zones);

    d = addHead(d, pack, { systemId: made.systemId, zoneId: room.master.id, iduModel: "MSZ-AP35VGD2" });
    // one head under a multi family is proposed a multi outdoor, not a pair
    expect(oduOf(d, made.systemId)).toBe("MXZ-2F52VGD");
    expect(sys().type).toBe("multi-split");
    d = addHead(d, pack, { systemId: made.systemId, zoneId: room.bed1.id, iduModel: "MSZ-AP20VGD" });
    d = addHead(d, pack, { systemId: made.systemId, zoneId: room.bed2.id, iduModel: "MSZ-AP20VGD" });
    expect(oduOf(d, made.systemId)).toBe("MXZ-3F54VGD");
    d = addHead(d, pack, { systemId: made.systemId, zoneId: room.study.id, iduModel: "MSZ-AP42VGD2" });
    d = addHead(d, pack, { systemId: made.systemId, zoneId: room.living.id, iduModel: "MSZ-AP25VGD2" });
    expect(oduOf(d, made.systemId)).toBe("MXZ-5F100VGD");
    expect(systemKind(d, sys())).toBe("multi");
    expect(combinationWord(d, pack, sys())).toBe("Valid");
    // the one figure: head ratings, capped per zone at the outdoor, summed
    expect(systemCover(d, pack, sys(), basis).coverKw).toBeCloseTo(14.2, 5);
    expect(connectionRatio(pack, sys())).toMatchObject({ connectedKw: 14.2, outdoorKw: 10, pct: 142, heads: 5 });
    // the rack: six units, none on the plan
    expect(trayItems(d, pack).filter((t) => t.systemId === made.systemId)).toHaveLength(6);
  });

  it("the cross on a zone takes its head off and keeps the system; Use the proposal hands a pick back", () => {
    const { doc, room } = house();
    const made = claimed(doc, [room.bed1.id, room.bed2.id]);
    let d = addHead(made.doc, pack, { systemId: made.systemId, zoneId: room.bed1.id, iduModel: "MSZ-AP25VGD2" });
    d = addHead(d, pack, { systemId: made.systemId, zoneId: room.bed2.id, iduModel: "MSZ-AP35VGD2" });
    expect(oduOf(d, made.systemId)).toBe("MXZ-2F52VGD");
    // picked by hand: it stays, whatever the heads do
    d = chooseOutdoor(d, pack, basis, made.systemId, "MXZ-6F120VGD");
    d = removeZone(d, pack, made.systemId, room.bed2.id);
    expect(d.systems).toHaveLength(1);
    expect(zoneIdsOf(sysOf(d, made.systemId))).toEqual([room.bed1.id]);
    expect(allocationsOf(sysOf(d, made.systemId)).filter((a) => a.role === "idu")).toHaveLength(1);
    expect(oduOf(d, made.systemId)).toBe("MXZ-6F120VGD");
    // handed back: one head under one zone, and a multi outdoor still on it, stays a multi
    d = useProposal(d, pack, made.systemId);
    expect(oduOf(d, made.systemId)).toBe("MXZ-2F52VGD");
    expect(sysOf(d, made.systemId).settings.oduChosen).toBeUndefined();
    // and with the last head gone the system stays, empty
    const last = allocationsOf(sysOf(d, made.systemId)).find((a) => a.role === "idu")!;
    d = removeAllocation(d, made.systemId, last.id, pack);
    expect(d.systems).toHaveLength(1);
    expect(systemKind(d, sysOf(d, made.systemId))).toBe("empty");
  });
});

describe("a zone that needs two units (the mock's step 7)", () => {
  it("one 7.8 kW head on a split is short; Add another split puts a second system over the zone", () => {
    const { doc, room } = house();
    const made = claimed(doc, [room.living.id]);
    let d = addHead(made.doc, pack, { systemId: made.systemId, zoneId: room.living.id, iduModel: "MSZ-AP80VGD2" });
    expect(familyOf(sysOf(d, made.systemId))).toBe("split");
    expect(sysOf(d, made.systemId).type).toBe("split");
    expect(oduOf(d, made.systemId)).toBe("MUZ-AP80VG2");
    expect(roomVerdict(d, pack, basis, room.living).word).toBe("Undersized");

    const beside = addSplitBeside(d, pack, { zoneId: room.living.id, iduModel: "MSZ-AP80VGD2" });
    d = beside.doc;
    expect(d.systems).toHaveLength(2);
    expect(zoneIdsOf(sysOf(d, beside.systemId))).toEqual([room.living.id]);
    expect(oduOf(d, beside.systemId)).toBe("MUZ-AP80VG2");
    expect(sysOf(d, beside.systemId).colour).not.toBe(sysOf(d, made.systemId).colour);
    const verdict = roomVerdict(d, pack, basis, room.living);
    expect(verdict.coverKw).toBeCloseTo(15.6, 5);
    expect(verdict.word).not.toBe("Undersized");
    // each system carries its share of the zone's load
    const share = systemCover(d, pack, sysOf(d, made.systemId), basis);
    expect(share.loadKw!).toBeCloseTo(load(d, room.living) / 2, 5);
  });

  it("a second head dropped on a split's zone makes it a multi on one outdoor", () => {
    const { doc, room } = house();
    const made = claimed(doc, [room.living.id]);
    let d = addHead(made.doc, pack, { systemId: made.systemId, zoneId: room.living.id, iduModel: "MSZ-AP71VGD2" });
    d = addHead(d, pack, { systemId: made.systemId, zoneId: room.living.id, iduModel: "MSZ-AP71VGD2" });
    expect(sysOf(d, made.systemId).type).toBe("multi-split");
    expect(oduOf(d, made.systemId)).toBe("MXZ-4F80VGD");
    expect(combinationWord(d, pack, sysOf(d, made.systemId))).toBe("Valid");
    // the zone gets no more than the outdoor gives it
    expect(roomVerdict(d, pack, basis, room.living).coverKw).toBeCloseTo(8, 5);
  });
});

describe("a zone moves with its units (the mock's step 12)", () => {
  function twoSystems() {
    const { doc, room } = house();
    const one = claimed(doc, [room.living.id]);
    let d = addHead(one.doc, pack, { systemId: one.systemId, zoneId: room.living.id, iduModel: "MSZ-AP80VGD2" });
    d = chooseOutdoor(d, pack, basis, one.systemId, "MUZ-AP80VG2");
    const two = claimed(d, [room.bed1.id, room.bed2.id, room.master.id, room.study.id]);
    d = two.doc;
    d = addHead(d, pack, { systemId: two.systemId, zoneId: room.bed1.id, iduModel: "MSZ-AP20VGD" });
    d = addHead(d, pack, { systemId: two.systemId, zoneId: room.bed2.id, iduModel: "MSZ-AP20VGD" });
    d = addHead(d, pack, { systemId: two.systemId, zoneId: room.master.id, iduModel: "MSZ-AP35VGD2" });
    d = addHead(d, pack, { systemId: two.systemId, zoneId: room.study.id, iduModel: "MSZ-AP25VGD2" });
    return { doc: d, room, one: one.systemId, two: two.systemId };
  }

  it("the head comes too; a hand-picked split outdoor then fails, and Use the proposal fixes it", () => {
    const t = twoSystems();
    const before = oduOf(t.doc, t.two);
    let d = moveZone(t.doc, pack, t.room.study.id, t.two, t.one);
    expect(zoneIdsOf(sysOf(d, t.one))).toEqual([t.room.living.id, t.room.study.id]);
    expect(zoneIdsOf(sysOf(d, t.two))).not.toContain(t.room.study.id);
    const moved = allocationsOf(sysOf(d, t.one)).filter((a) => a.role === "idu");
    expect(moved.map((a) => [a.model, a.roomId])).toEqual([
      ["MSZ-AP80VGD2", t.room.living.id],
      ["MSZ-AP25VGD2", t.room.study.id],
    ]);
    // the outdoor picked by hand stays, and says so
    expect(oduOf(d, t.one)).toBe("MUZ-AP80VG2");
    expect(combinationWord(d, pack, sysOf(d, t.one))).toBe("Fails");
    const findings = systemFindings(d, pack, sysOf(d, t.one));
    expect(findings.map((f) => f.code)).toContain("outdoor-takes-one");
    expect(doneReason(findings)).toBe("MUZ-AP80VG2 takes one head. Pick an outdoor that takes them all, or take a zone out.");
    // the system that lost a head is proposed a smaller outdoor
    expect(oduOf(d, t.two)).not.toBe(before);
    expect(combinationWord(d, pack, sysOf(d, t.two))).toBe("Valid");
    // one press: the only outdoor in the pack that takes an 80 and a 25
    d = useProposal(d, pack, t.one);
    expect(oduOf(d, t.one)).toBe("MXZ-6F120VGD");
    expect(combinationWord(d, pack, sysOf(d, t.one))).toBe("Valid");
    expect(sysOf(d, t.one).type).toBe("multi-split");
  });

  it("a drawn run moves with the head and comes loose at the old outdoor", () => {
    const t = twoSystems();
    const floorId = t.doc.floors[0].id;
    const head = allocationsOf(sysOf(t.doc, t.two)).find((a) => a.roomId === t.room.study.id)!;
    const odu = allocationsOf(sysOf(t.doc, t.two)).find((a) => a.role === "odu")!;
    let d = placeAllocation(t.doc, pack, t.two, head.id, floorId, { x: 1200, y: 600 });
    d = placeAllocation(d, pack, t.two, odu.id, floorId, { x: 1200, y: 1000 });
    d = {
      ...d,
      objects: [
        ...d.objects,
        {
          id: "run1",
          type: "pipe-run",
          systemId: t.two,
          floorId,
          plane: "room",
          geometry: { kind: "polyline", points: [{ x: 1200, y: 600 }, { x: 1200, y: 1000 }] },
          props: { startAttach: { kind: "unit", id: head.id }, endAttach: { kind: "unit", id: odu.id } },
        },
      ],
    };
    d = moveZone(d, pack, t.room.study.id, t.two, t.one);
    const run = d.objects.find((o) => o.id === "run1")!;
    expect(run.systemId).toBe(t.one);
    expect(run.props.startAttach).toEqual({ kind: "unit", id: head.id });
    expect(run.props.endAttach).toBeUndefined();
    expect(d.objects.find((o) => o.id === head.id)!.systemId).toBe(t.one);
    // the old system's outdoor stays where it was placed
    expect(d.objects.find((o) => o.id === odu.id)!.systemId).toBe(t.two);
  });

  it("Add zone lists the zones without a system first, then the ones it would share", () => {
    const t = twoSystems();
    const list = zonesToAdd(t.doc, t.one);
    expect(list.map((z) => [z.zone.id, z.sharedWith.map((s) => s.id)])).toEqual([
      [t.room.bed1.id, [t.two]],
      [t.room.bed2.id, [t.two]],
      [t.room.master.id, [t.two]],
      [t.room.study.id, [t.two]],
    ]);
  });
});

describe("a unit on the band serves the whole system", () => {
  it("a ducted unit makes the system ducted with the book's outdoor, and a stray head fails it", () => {
    const { doc, room } = house();
    const made = claimed(doc, [room.bed1.id, room.bed2.id, room.master.id]);
    let d = addBandUnit(made.doc, pack, { systemId: made.systemId, iduModel: "PEAD-M71JAA(D)" });
    const sys = () => sysOf(d, made.systemId);
    expect(sys().type).toBe("ducted");
    expect(systemKind(d, sys())).toBe("ducted");
    expect(oduOf(d, made.systemId)).toBe("PUZ-ZM71VHA2-A");
    expect(combinationWord(d, pack, sys())).toBe("Valid");
    expect(sys().settings.roomIds).toEqual([room.bed1.id, room.bed2.id, room.master.id]);
    // the unit's rating is shared out by load, so every zone reads the same percentage
    expect(systemCover(d, pack, sys(), basis).coverKw).toBeCloseTo(7.1, 5);
    const pcts = [room.bed1, room.bed2, room.master].map((r) => roomCoverage(d, pack, r, basis).pct);
    expect(new Set(pcts).size).toBe(1);
    expect(roomVerdict(d, pack, basis, room.bed1).word).not.toBe("No units");
    d = addHead(d, pack, { systemId: made.systemId, zoneId: room.bed1.id, iduModel: "MSZ-AP20VGD" });
    expect(combinationWord(d, pack, sys())).toBe("Fails");
    expect(systemFindings(d, pack, sys()).map((f) => f.code)).toContain("outdoor-takes-one");
  });
});

/* ── deleting a zone from the plan (Isaac, 2026-09-23: "i cant delete a room
   now"). Deleting the object alone left the system claiming a zone that was
   gone, and its placed heads dropped back into the rack. ── */

describe("a zone deleted from the plan", () => {
  function twoZones() {
    const { doc, room } = house();
    const made = newSystem(doc, pack.meta.version);
    let d = claimZone(made.doc, made.systemId, room.bed1.id);
    d = claimZone(d, made.systemId, room.study.id);
    d = addHead(d, pack, { systemId: made.systemId, zoneId: room.bed1.id, iduModel: "MSZ-AP25VGD2" });
    d = addHead(d, pack, { systemId: made.systemId, zoneId: room.study.id, iduModel: "MSZ-AP25VGD2" });
    const bedHead = allocationsOf(d.systems[0]).find((a) => a.role === "idu" && a.roomId === room.bed1.id)!;
    d = placeAllocation(d, pack, made.systemId, bedHead.id, d.floors[0].id, centreOf(room.bed1));
    return { doc: d, room, systemId: made.systemId, bedHead: bedHead.id };
  }
  const centreOf = (r: RoomObj) => {
    const p = r.geometry.points;
    return { x: (p[0].x + p[2].x) / 2, y: (p[0].y + p[2].y) / 2 };
  };

  it("lets every system that claimed it go, with its heads, placed or not, and goes itself", () => {
    const t0 = twoZones();
    expect(t0.doc.objects.some((o) => o.id === t0.bedHead)).toBe(true);
    const after = deleteZone(t0.doc, pack, t0.room.bed1.id);
    const sys = after.systems.find((s) => s.id === t0.systemId)!;
    expect(after.objects.some((o) => o.id === t0.room.bed1.id)).toBe(false);
    expect(zoneIdsOf(sys)).toEqual([t0.room.study.id]);
    expect(allocationsOf(sys).some((a) => a.roomId === t0.room.bed1.id)).toBe(false);
    // the placed head went with it, and nothing waits in the rack for a zone that is gone
    expect(after.objects.some((o) => o.id === t0.bedHead)).toBe(false);
    expect(trayItems(after, pack).map((i) => i.allocationId)).not.toContain(t0.bedHead);
    // the other zone keeps its head, and the outdoor is proposed for what is left
    expect(allocationsOf(sys).filter((a) => a.role === "idu").map((a) => a.roomId)).toEqual([t0.room.study.id]);
    expect(allocationsOf(sys).some((a) => a.role === "odu" && a.model)).toBe(true);
  });

  it("without a pack still lets the claim go", () => {
    const t0 = twoZones();
    const after = deleteZone(t0.doc, null, t0.room.bed1.id);
    expect(zoneIdsOf(after.systems[0])).toEqual([t0.room.study.id]);
    expect(after.objects.some((o) => o.id === t0.room.bed1.id)).toBe(false);
  });
});
