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
import { roomCoverage } from "../coverage";
import { multiConnection } from "../multi";
import {
  addMultiHead,
  addSplit,
  adoptLegacySystem,
  allocationsOf,
  chooseOutdoor,
  moveAllocation,
  outdoorsListing,
  placeAllocation,
  releaseSystem,
  removeAllocation,
  roomVerdict,
  swapAllocation,
  systemCheck,
  trayItems,
  wrongRoomPlacements,
} from "../builder";

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
