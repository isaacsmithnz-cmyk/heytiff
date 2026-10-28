/**
 * @jest-environment node
 */
/* What Tiff reads of a Studio design (Isaac, 2026-10-17: "I think Tiff can
   already read the studio design. Or can she not?" She couldn't). Designs
   made with the Studio's own builders, read off the Mitsubishi Electric
   pack as installed: every figure is the Summary's. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { createDesign, newId, type DesignDocument, type DesignObject, type Point } from "@/lib/studio/document";
import type { RoomObj } from "@/lib/studio/loads-room";
import { addBandUnit, addHead, addSplit, allocationsOf, chooseOutdoor, placeAllocation } from "@/lib/studio/builder";
import { claimZone, newSystem } from "@/lib/studio/zones";
import { jointOnRun, nearestOnRuns } from "@/lib/studio/joints";
import { buildSummaryModel } from "@/lib/studio/summary";
import { systemVrfTree } from "@/lib/studio/vrf-tree";
import { designRead, fitDesignRead } from "../design-read";

const DIR = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
function loadPack(): DataPack {
  const meta = JSON.parse(readFileSync(join(DIR, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(DIR, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const pack = loadPack();

/* a blank design is 10 mm a unit: 100 units = 1 m */
const M = 100;
const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** the builder-jobs house: a big living area, three bedrooms and a study */
function house(): { doc: DesignDocument; floorId: string } {
  const doc = createDesign({ name: "12 Example St", mode: "blank", now: "2026-10-15T09:00:00.000Z" });
  doc.settings.climateZone = "5";
  const floorId = doc.floors[0]!.id;
  const add = (id: string, name: string, x: number, y: number, w: number, h: number) =>
    doc.objects.push({ id, type: "room", systemId: null, floorId, plane: "room", geometry: { kind: "polygon", points: rect(x, y, w, h) }, props: { name } } as RoomObj as DesignObject);
  add("living", "Living", 0, 0, 1000, 960);
  add("bed1", "Bed 1", 1100, 0, 400, 300);
  add("bed2", "Bed 2", 1600, 0, 450, 400);
  add("master", "Master", 2150, 0, 550, 500);
  add("study", "Study", 1100, 500, 400, 320);
  return { doc, floorId };
}

const run = (systemId: string, floorId: string, from: string, to: string, points: Point[], kinds: [string, string] = ["unit", "unit"]): DesignObject => ({
  id: newId("obj"),
  type: "pipe-run",
  systemId,
  floorId,
  geometry: { kind: "polyline", points },
  plane: "room",
  props: { startAttach: { kind: kinds[0], id: from }, endAttach: { kind: kinds[1], id: to } },
});

/** a split in Bed 1, placed, its pipe drawn 6 m from the outdoor */
function splitHouse() {
  const { doc, floorId } = house();
  const made = addSplit(doc, pack, { roomId: "bed1", iduModel: "MSZ-AP25VGD2", oduModel: "MUZ-AP25VG2" });
  const allocs = allocationsOf(made.doc.systems.find((s) => s.id === made.systemId)!);
  const idu = allocs.find((a) => a.role === "idu")!.id;
  const odu = allocs.find((a) => a.role === "odu")!.id;
  let d = placeAllocation(made.doc, pack, made.systemId, idu, floorId, { x: 1200, y: 100 });
  d = placeAllocation(d, pack, made.systemId, odu, floorId, { x: 1200, y: -500 });
  d = { ...d, objects: [...d.objects, run(made.systemId, floorId, odu, idu, [{ x: 1200, y: -500 }, { x: 1200, y: 100 }])] };
  return { doc: d, systemId: made.systemId, floorId, idu, odu };
}

describe("a design, as Tiff reads it", () => {
  it("reads a split: its room's area and load, the unit, what it gives and whether it covers it, and the pipe drawn", () => {
    const { doc } = splitHouse();
    const read = designRead(doc, pack);
    const summary = buildSummaryModel(doc, pack);
    expect(read.design).toEqual({ id: doc.id, name: "12 Example St", saved: "15 Oct 2026" });
    expect(read.basis).toBe("Zone 5 (Sydney), residential, sized on heat/cool");
    const sys = read.systems[0]!;
    expect(sys).toMatchObject({ kind: "Split", brand: "Mitsubishi Electric", outdoor: "MUZ-AP25VG2", combination: "valid", pipe: { drawn: true, total_m: 6, farthest_m: 6 } });
    expect(sys.rooms).toEqual([
      expect.objectContaining({ room: "Bed 1", floor: "Ground floor", area_m2: 12, unit: "MSZ-AP25VGD2", pipe: expect.stringMatching(/^6 m, [\d.]+ \/ [\d.]+ mm$/) }),
    ]);
    expect(sys.rooms[0]!.load_kw).toBe(Math.round(summary.systems[0]!.rooms[0]!.loadKw! * 10) / 10);
  });

  it("reads a multi: a head short of its room says by how much, and a room nothing serves says so", () => {
    const { doc, floorId } = house();
    const made = newSystem(doc, pack.meta.version);
    let d = made.doc;
    for (const z of ["bed1", "bed2", "master"]) d = claimZone(d, made.systemId, z);
    d = addHead(d, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: "MSZ-AP25VGD2" });
    d = addHead(d, pack, { systemId: made.systemId, zoneId: "bed2", iduModel: "MSZ-AP25VGD2" });
    /* 27.5 m² on a 2.0 kW head */
    d = addHead(d, pack, { systemId: made.systemId, zoneId: "master", iduModel: "MSZ-AP20VGD" });
    const allocs = allocationsOf(d.systems.find((s) => s.id === made.systemId)!);
    const odu = allocs.find((a) => a.role === "odu")!;
    const head = (room: string) => allocs.find((a) => a.role === "idu" && a.roomId === room)!.id;
    d = placeAllocation(d, pack, made.systemId, odu.id, floorId, { x: 1800, y: -600 });
    const at: Record<string, Point> = { bed1: { x: 1200, y: 100 }, bed2: { x: 1800, y: 100 }, master: { x: 2400, y: 100 } };
    for (const [room, p] of Object.entries(at)) d = placeAllocation(d, pack, made.systemId, head(room), floorId, p);
    /* bed 1 and bed 2 drawn; the master's pipe not yet */
    d = {
      ...d,
      objects: [
        ...d.objects,
        run(made.systemId, floorId, odu.id, head("bed1"), [{ x: 1800, y: -600 }, { x: 1200, y: -600 }, { x: 1200, y: 100 }]),
        run(made.systemId, floorId, odu.id, head("bed2"), [{ x: 1800, y: -600 }, { x: 1800, y: 100 }]),
      ],
    };
    const read = designRead(d, pack);
    const sys = read.systems[0]!;
    expect(sys).toMatchObject({ kind: "Multi-split, 3 heads on one outdoor", outdoor: "MXZ-3F54VGD", outdoor_kw: 5.4, combination: "valid", refrigerant: "R32", precharged_kg: 2.4, covers: "no" });
    expect(sys.rooms.map((r) => [r.room, r.unit, r.capacity_kw, r.covers, r.short_kw, r.pipe])).toEqual([
      ["Bed 1", "MSZ-AP25VGD2", 2.5, "yes", undefined, "13 m, 6.35 / 9.52 mm"],
      ["Bed 2", "MSZ-AP25VGD2", 2.5, "no", 0.1, "7 m, 6.35 / 9.52 mm"],
      ["Master", "MSZ-AP20VGD", 2, "no", 2, "not drawn, 6.35 / 9.52 mm"],
    ]);
    /* the farthest only once every head's pipe is drawn */
    expect(sys.pipe).toEqual({ drawn: true, total_m: 20 });
    expect(read.rooms_with_no_system).toEqual([
      { room: "Living", floor: "Ground floor", area_m2: 96, load_kw: 13.9 },
      { room: "Study", floor: "Ground floor", area_m2: 12.8, load_kw: 1.9 },
    ]);
  });

  it("reads a ducted unit over its zones: each zone's share, the unit's pipe, and and that no air side is drawn until the person draws one", () => {
    const { doc } = house();
    const made = newSystem(doc, pack.meta.version);
    let d = made.doc;
    for (const z of ["bed1", "bed2", "master"]) d = claimZone(d, made.systemId, z);
    d = addBandUnit(d, pack, { systemId: made.systemId, iduModel: "PEAD-M71JAA(D)" });
    const sys = designRead(d, pack).systems[0]!;
    expect(sys).toMatchObject({
      kind: "Ducted",
      outdoor: "PUZ-ZM71VHA2-A",
      indoor: "PEAD-M71JAA(D), Ducted, 7.1 kW, pipe not drawn, 9.52 / 15.88 mm",
      capacity_kw: 7.1,
      load_kw: 8.3,
      covers: "no",
      pipe: { drawn: false },
      charge: "Pre-charged, pipe not drawn",
      // nothing is drawn off a unit for it: Tiff reads that none is drawn
      air_side: ["No outlets, duct runs or return grille drawn"],
    });
    /* the unit shared out by load: no zone carries a pipe of its own */
    expect(sys.rooms.map((r) => [r.room, r.unit, r.capacity_kw, r.short_kw, r.pipe])).toEqual([
      ["Bed 1", "PEAD-M71JAA(D)", 1.5, 0.3, undefined],
      ["Bed 2", "PEAD-M71JAA(D)", 2.2, 0.4, undefined],
      ["Master", "PEAD-M71JAA(D)", 3.4, 0.6, undefined],
    ]);
  });

  it("reads a VRF drawn on the plan: each head's pipe and size off its sized tree, the farthest, the joints and the charge", () => {
    const { doc } = page144Drawn();
    const sys = designRead(doc, pack).systems[0]!;
    const tree = systemVrfTree(pack, doc.systems[0]!, doc)!;
    expect(sys).toMatchObject({ kind: "VRF, 5 heads on one outdoor", outdoor: "PUHY-P350YNW-A1", refrigerant: "R410A", combination: "valid" });
    expect(sys.rooms.map((r) => [r.room, r.unit, r.pipe])).toEqual([
      ["Office 125", "PLFY-P125VEM-A", "50 m, 9.52 / 15.88 mm"],
      ["Office 100", "PLFY-P100VEM-A", "55 m, 9.52 / 15.88 mm"],
      ["Office 40", "PLFY-P40VEM-A", "75 m, 6.35 / 12.7 mm"],
      ["Office 32", "PLFY-P32VEM-A", "85 m, 9.52 / 12.7 mm"],
      ["Office 63", "PLFY-P63VEM-A", "85 m, 12.7 / 15.88 mm"],
    ]);
    expect(sys.pipe).toMatchObject({ drawn: true, total_m: 120, farthest_m: 85 });
    expect(sys.pipe.by_size).toContain("ø12.7 / ø28.58: 40 m");
    /* the charge is the tree's, as the Studio works it out */
    expect(sys.extra_charge_kg).toBe(tree.chargeG! / 1000);
    expect(sys.charge).toBe(`Pre-charged + ${(tree.chargeG! / 1000).toFixed(2)} kg top-up`);
    expect(sys.takeoff).toEqual(["Joint CMY-Y102LS-G2: 2 (Sized to the heads it feeds)", "Joint CMY-Y102SS-G2: 2 (Sized to the heads it feeds)"]);
  });

  it("says a system with zones and no units yet is none, its zones served by nothing", () => {
    const { doc } = house();
    const made = newSystem(doc, pack.meta.version);
    const read = designRead(claimZone(made.doc, made.systemId, "living"), pack);
    expect(read.systems).toEqual([expect.objectContaining({ kind: "No units yet", outdoor: null, rooms: [], pipe: { drawn: false } })]);
    expect(read.rooms_with_no_system?.map((r) => r.room)).toContain("Living");
  });

  it("says what fails the Studio's checks, in its words", () => {
    const { doc, systemId, floorId } = splitHouse();
    const loose: DesignObject = { id: "loose", type: "pipe-run", systemId, floorId, geometry: { kind: "polyline", points: [{ x: 0, y: 2000 }, { x: 500, y: 2000 }] }, plane: "room", props: {} };
    const sys = designRead({ ...doc, objects: [...doc.objects, loose] }, pack).systems[0]!;
    expect(sys.fails).toEqual(["A pipe isn't connected at one end. Connect it, or delete it"]);
    expect(designRead(doc, pack).systems[0]!.fails).toBeUndefined();
  });

  it("says when there's no data pack for the brand, and still reads the rooms and the units", () => {
    const { doc } = splitHouse();
    const sys = designRead(doc, null).systems[0]!;
    expect(sys).toMatchObject({ outdoor: "MUZ-AP25VG2", note: "HeyTiff has no data pack for mitsubishi-electric: its capacities, pipe sizes and checks aren't read" });
    expect(sys.combination).toBeUndefined();
    expect(sys.rooms).toEqual([{ room: "Bed 1", floor: "Ground floor", area_m2: 12, load_kw: 1.7, unit: "MSZ-AP25VGD2", covers: "not known", pipe: "6 m" }]);
    expect(sys).toMatchObject({ capacity_kw: null, covers: "not known" });
    expect(designRead(doc, null).rooms_with_no_system?.map((r) => r.room)).toEqual(["Living", "Bed 2", "Master", "Study"]);
  });

  it("says a floor not to scale and a climate zone not set, rather than reading them as figures", () => {
    const { doc } = splitHouse();
    const d = { ...doc, settings: { ...doc.settings, climateZone: null }, floors: doc.floors.map((f) => ({ ...f, scaleMmPerUnit: null })) };
    const read = designRead(d, pack);
    expect(read.notes).toEqual([
      "Ground floor isn't to scale: its rooms have no area or load, and pipe drawn on it has no length",
      "The design's climate zone isn't set: its loads are on the Studio's default, zone 5",
    ]);
    expect(read.systems[0]!.rooms[0]).toMatchObject({ area_m2: null, load_kw: null, covers: "not known", pipe: "drawn, the floor isn't to scale, 6.35 / 9.52 mm" });
    expect(read.systems[0]!.pipe).toEqual({ drawn: true, said: "drawn, but a floor it's on isn't to scale" });
  });

  it("reads a whole house in well under 6,000 characters", () => {
    let d = splitHouse().doc;
    const multi = newSystem(d, pack.meta.version);
    d = multi.doc;
    for (const z of ["bed2", "master", "study"]) {
      d = claimZone(d, multi.systemId, z);
      d = addHead(d, pack, { systemId: multi.systemId, zoneId: z, iduModel: "MSZ-AP35VGD2" });
    }
    const ducted = newSystem(d, pack.meta.version);
    d = claimZone(ducted.doc, ducted.systemId, "living");
    d = addBandUnit(d, pack, { systemId: ducted.systemId, iduModel: "PEA-M140HAA" });
    const read = designRead(d, pack);
    expect(read.systems.map((s) => s.kind)).toEqual(["Split", "Multi-split, 3 heads on one outdoor", "Ducted"]);
    expect(read.rooms_with_no_system).toBeUndefined();
    expect(JSON.stringify(read).length).toBeLessThan(6000);
  });
});

describe("a long read, narrowed", () => {
  it("drops the takeoffs first, counted, then reads one system at a time, the others by name", () => {
    const { doc } = page144Drawn();
    const read = designRead(doc, pack);
    expect(fitDesignRead(read)).toBe(read);
    const size = JSON.stringify(read).length;
    const lean = fitDesignRead(read, {}, size - 10);
    expect(lean.systems[0]).toMatchObject({ takeoff_not_shown: 2 });
    expect(lean.systems[0]).not.toHaveProperty("takeoff");

    const two = { ...read, systems: [read.systems[0]!, { ...read.systems[0]!, name: "System 2" }] };
    const one = fitDesignRead(two, { system: "system 2" });
    expect(one.systems[0]).toEqual({ name: "System 1", kind: "VRF, 5 heads on one outdoor", outdoor: "PUHY-P350YNW-A1", rooms: 5, read_with: { system: "System 1" } });
    expect(one.systems[1]).toMatchObject({ name: "System 2", takeoff: read.systems[0]!.takeoff });
    expect(one.read_with).toBe("One system at a time: read another by its name (system)");
  });
});

/** MEES21K029 p.144 as a person draws it (vrf-drawn.test.ts): a trunk from
    the outdoor to the last head, each branch landed on it, a joint at each */
function page144Drawn(): { doc: DesignDocument; systemId: string } {
  let doc = createDesign({ name: "p144", mode: "blank", now: "2026-10-15T09:00:00.000Z" });
  doc.settings.climateZone = "5";
  const floorId = doc.floors[0]!.id;
  const vrfOf = (p: number) => pack.indoor_units.find((u) => u.capacity_index === p && u.system_roles?.includes("vrf"))!.model;
  const layout: [number, number, number][] = [
    [125, 40, 10],
    [100, 50, 5],
    [40, 65, 10],
    [32, 75, 10],
  ];
  for (const [p, x] of [...layout, [63, 85, 0] as [number, number, number]])
    doc.objects.push({ id: `z${p}`, type: "room", systemId: null, floorId, plane: "room", geometry: { kind: "polygon", points: rect(x * M - 200, 400, 400, 800) }, props: { name: `Office ${p}` } } as RoomObj as DesignObject);
  const made = newSystem(doc, pack.meta.version);
  const systemId = made.systemId;
  doc = made.doc;
  for (const p of [125, 100, 40, 32, 63]) doc = addHead(doc, pack, { systemId, zoneId: `z${p}`, iduModel: vrfOf(p) });
  doc = chooseOutdoor(doc, pack, "worst-of-both", systemId, "PUHY-P350YNW-A1");
  const allocs = allocationsOf(doc.systems.find((s) => s.id === systemId)!);
  const idOf = (p: number) => allocs.find((a) => a.role === "idu" && a.roomId === `z${p}`)!.id;
  const oduId = allocs.find((a) => a.role === "odu")!.id;
  doc = placeAllocation(doc, pack, systemId, oduId, floorId, { x: 0, y: 0 });
  for (const [p, x, drop] of layout) doc = placeAllocation(doc, pack, systemId, idOf(p), floorId, { x: x * M, y: drop * M });
  doc = placeAllocation(doc, pack, systemId, idOf(63), floorId, { x: 85 * M, y: 0 });
  doc = { ...doc, objects: [...doc.objects, run(systemId, floorId, oduId, idOf(63), [{ x: 0, y: 0 }, { x: 85 * M, y: 0 }])] };
  const runs = () => doc.objects.filter((o): o is DesignObject & { geometry: { kind: "polyline"; points: Point[] } } => o.type === "pipe-run" && o.geometry.kind === "polyline");
  for (const [p, x, drop] of layout) {
    const hit = nearestOnRuns(runs(), { x: x * M, y: 0 }, 1)!;
    const cut = jointOnRun(doc, hit.runId, hit.seg, hit.at)!;
    doc = { ...cut.doc, objects: [...cut.doc.objects, run(systemId, floorId, idOf(p), cut.jointId, [{ x: x * M, y: drop * M }, { x: x * M, y: 0 }], ["unit", "joint"])] };
  }
  return { doc, systemId };
}
