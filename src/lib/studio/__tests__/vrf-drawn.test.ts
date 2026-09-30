/* A VRF tree DRAWN on the plan (docs/studio-vrf.md, step 3): runs, joints
   made by landing a run on another run, and the sizer reading the drawing.
   The drawing is MEES21K029 p.144 laid out the way a person draws it: one
   trunk from the outdoor to the last head, then each branch from its head
   onto the trunk — every landing cuts the trunk and puts a joint there. The
   drawn tree must size exactly as the book does (golden D2). */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, newId, type DesignDocument, type DesignObject, type Point } from "../document";
import type { RoomObj } from "../loads-room";
import { allocationsOf } from "../allocations";
import { addHead, chooseOutdoor } from "../builder";
import { newSystem } from "../zones";
import { deleteFromSchematic, deleteJoint, jointOnRun, nearestOnRuns, riserOnRun, slideOnRun } from "../joints";
import { reconcileAttachedRuns } from "../attach";
import { systemVrfTree } from "../vrf-tree";
import { answerInstall, equipmentList, installQuestions } from "../install";
import { attachOf, buildSystemGraph, riserGapOf, setFloorHeight, setMount as setMountOf, setRiserHeight } from "../graph";
import { combinationWord, doneBlockers, systemFindings } from "../verdict";
import { buildSummaryModel } from "../summary";
import { pairSize, pipeViewOf, setRunSizes, sizeTone, tubeSize } from "../pipe-sizes";

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
const vrfOf = (p: number) =>
  pack.indoor_units.find((u) => u.capacity_index === p && u.system_roles?.includes("vrf"))!.model;

/* a blank design is 10 mm a unit: 100 units = 1 m */
const M = 100;

type Polyline = DesignObject & { geometry: { kind: "polyline"; points: Point[] } };
const runsOf = (d: DesignDocument, systemId: string) =>
  d.objects.filter((o): o is Polyline => o.type === "pipe-run" && o.systemId === systemId && o.geometry.kind === "polyline");

function page144Drawn(): { doc: DesignDocument; systemId: string; heads: Record<number, string> } {
  let doc = createDesign({ name: "p144", mode: "blank" });
  const floorId = doc.floors[0].id;
  const zone = (id: string, x: number) =>
    doc.objects.push({
      id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: {
        kind: "polygon",
        points: [
          { x: x - 200, y: 400 },
          { x: x + 200, y: 400 },
          { x: x + 200, y: 1200 },
          { x: x - 200, y: 1200 },
        ],
      },
      props: { name: id },
    } as RoomObj as DesignObject);
  /* heads along the trunk: a P125 at 40 m, P100 at 50, P40 at 65, P32 at 75, P63 at the end, 85 */
  const layout: [number, number, number][] = [
    [125, 40, 10],
    [100, 50, 5],
    [40, 65, 10],
    [32, 75, 10],
  ];
  for (const [p, x] of layout) zone(`z${p}`, x * M);
  zone("z63", 85 * M);
  const made = newSystem(doc, pack.meta.version);
  const systemId = made.systemId;
  doc = made.doc;
  for (const p of [125, 100, 40, 32, 63]) doc = addHead(doc, pack, { systemId, zoneId: `z${p}`, iduModel: vrfOf(p) });
  doc = chooseOutdoor(doc, pack, "worst-of-both", systemId, "PUHY-P350YNW-A1");

  const allocs = allocationsOf(doc.systems.find((s) => s.id === systemId)!);
  const idOf = (p: number) => allocs.find((a) => a.role === "idu" && a.model === vrfOf(p))!.id;
  const oduId = allocs.find((a) => a.role === "odu")!.id;
  const unit = (id: string, role: string, model: string, at: Point): DesignObject => ({
    id,
    type: "unit",
    systemId,
    floorId,
    geometry: { kind: "point", at },
    plane: "room",
    props: { role, model },
  });
  const run = (points: Point[], props: Record<string, unknown>): DesignObject => ({
    id: newId("obj"),
    type: "pipe-run",
    systemId,
    floorId,
    geometry: { kind: "polyline", points },
    plane: "room",
    props,
  });
  doc = {
    ...doc,
    objects: [
      ...doc.objects,
      unit(oduId, "odu", "PUHY-P350YNW-A1", { x: 0, y: 0 }),
      ...[...layout.map(([p, x, drop]) => unit(idOf(p), "idu", vrfOf(p), { x: x * M, y: drop * M })),
        unit(idOf(63), "idu", vrfOf(63), { x: 85 * M, y: 0 })],
      // the trunk: outdoor → the last head, 85 m
      run(
        [
          { x: 0, y: 0 },
          { x: 85 * M, y: 0 },
        ],
        { startAttach: { kind: "unit", id: oduId }, endAttach: { kind: "unit", id: idOf(63) } }
      ),
    ],
  };
  /* each branch: from its head straight up onto the trunk — the landing
     makes the joint and cuts the trunk (what the canvas does on a click) */
  for (const [p, x, drop] of layout) {
    const hit = nearestOnRuns(runsOf(doc, systemId), { x: x * M, y: 0 }, 1)!;
    const cut = jointOnRun(doc, hit.runId, hit.seg, hit.at)!;
    doc = {
      ...cut.doc,
      objects: [
        ...cut.doc.objects,
        run(
          [
            { x: x * M, y: drop * M },
            { x: x * M, y: 0 },
          ],
          { startAttach: { kind: "unit", id: idOf(p) }, endAttach: { kind: "joint", id: cut.jointId } }
        ),
      ],
    };
  }
  return { doc, systemId, heads: Object.fromEntries([125, 100, 40, 32, 63].map((p) => [p, idOf(p)])) };
}

describe("joints made by landing a run on a run", () => {
  it("cut the trunk into five and make four joints", () => {
    const t = page144Drawn();
    expect(t.doc.objects.filter((o) => o.type === "joint")).toHaveLength(4);
    const graph = buildSystemGraph(t.doc.objects, t.doc.floors, t.systemId);
    expect(graph.orphanRuns).toEqual([]);
    // 5 trunk pieces + 4 branches
    expect(graph.edges).toHaveLength(9);
  });

  it("a joint at a run's free end attaches it there without a cut", () => {
    const t = page144Drawn();
    const loose: DesignObject = {
      id: "loose",
      type: "pipe-run",
      systemId: t.systemId,
      floorId: t.doc.floors[0].id,
      geometry: {
        kind: "polyline",
        points: [
          { x: 0, y: 5000 },
          { x: 1000, y: 5000 },
        ],
      },
      plane: "room",
      props: {},
    };
    const d = { ...t.doc, objects: [...t.doc.objects, loose] };
    const r = jointOnRun(d, "loose", 0, { x: 1000, y: 5000 })!;
    const after = r.doc.objects.find((o) => o.id === "loose")!;
    expect(after.props.endAttach).toEqual({ kind: "joint", id: r.jointId });
    expect(r.doc.objects.filter((o) => o.type === "pipe-run").length).toBe(d.objects.filter((o) => o.type === "pipe-run").length);
  });
});

describe("golden D2, drawn: the plan's tree sizes as the book does", () => {
  it("is read from the drawing once every head is joined", () => {
    const t = page144Drawn();
    const sized = systemVrfTree(pack, t.doc.systems.find((s) => s.id === t.systemId)!, t.doc)!;
    expect(sized.provisional).toBe(false);
    expect([sized.joined, sized.heads]).toEqual([5, 5]);
    expect(sized.farthestM).toBeCloseTo(85);
    const liquidTo = (p: number) => sized.sections.find((s) => s.to === t.heads[p])!.liquidMm;
    // a 9.52, b 9.52, c 6.35, d 9.52 (stepped up), e 12.7 (stepped up)
    expect([125, 100, 40, 32, 63].map(liquidTo)).toEqual([9.52, 9.52, 6.35, 9.52, 12.7]);
    const main = sized.sections.find((s) => s.role === "main")!;
    expect([main.liquidMm, main.lengthM]).toEqual([12.7, 40]);
    expect(sized.liquidM).toEqual({ "12.7": 50, "9.52": 60, "6.35": 10 });
    expect(sized.fittings.map((f) => f.part)).toEqual([
      "CMY-Y102LS-G2",
      "CMY-Y102LS-G2",
      "CMY-Y102SS-G2",
      "CMY-Y102SS-G2",
    ]);
  });

  it("stays provisional while a head is not joined", () => {
    const t = page144Drawn();
    const cut = { ...t.doc, objects: t.doc.objects.filter((o) => !(o.type === "pipe-run" && o.props.startAttach && (o.props.startAttach as { id: string }).id === t.heads[40])) };
    const sized = systemVrfTree(pack, cut.systems.find((s) => s.id === t.systemId)!, cut)!;
    expect(sized.provisional).toBe(true);
    expect([sized.joined, sized.heads]).toEqual([4, 5]);
  });
});

describe("the verdict reads the drawing", () => {
  it("is Valid as the book draws it, and Fails once the outdoor is 120 m further off", () => {
    const t = page144Drawn();
    const sys = (d: DesignDocument) => d.systems.find((s) => s.id === t.systemId)!;
    expect(combinationWord(t.doc, pack, sys(t.doc))).toBe("Valid");
    const oduId = allocationsOf(sys(t.doc)).find((a) => a.role === "odu")!.id;
    const far = -120 * M;
    const moved: DesignDocument = {
      ...t.doc,
      objects: t.doc.objects.map((o) => {
        if (o.id === oduId) return { ...o, geometry: { kind: "point", at: { x: far, y: 0 } } };
        const start = o.props.startAttach as { id?: string } | undefined;
        if (o.type === "pipe-run" && start?.id === oduId && o.geometry.kind === "polyline") {
          const [, ...rest] = o.geometry.points;
          return { ...o, geometry: { kind: "polyline", points: [{ x: far, y: 0 }, ...rest] } };
        }
        return o;
      }),
    };
    const codes = systemFindings(moved, pack, sys(moved)).map((f) => f.code);
    expect(codes).toContain("farthest-over");
    expect(combinationWord(moved, pack, sys(moved))).toBe("Fails");
  });
});

describe("on paper: the sheet and the picklist", () => {
  it("list the drawn p.144 pipe by size pair, the joints by part, and the book's 12.5 kg", () => {
    const t = page144Drawn();
    const model = buildSummaryModel(t.doc, pack);
    const sys = model.systems.find((s) => s.systemId === t.systemId)!;
    const pipe = sys.lines.filter((l) => l.name.endsWith("pair coil")).map((l) => [l.name, l.qty]);
    expect(pipe).toEqual([
      ["ø12.7 / ø28.58 pair coil", "40 m"],
      ["ø12.7 / ø15.88 pair coil", "10 m"], // e, stepped up
      ["ø9.52 / ø22.2 pair coil", "10 m"], // B carries P235
      ["ø9.52 / ø15.88 pair coil", "40 m"], // C, D, a, b
      ["ø9.52 / ø12.7 pair coil", "10 m"], // d, stepped up
      ["ø6.35 / ø12.7 pair coil", "10 m"], // c
    ]);
    const fittings = sys.lines.filter((l) => l.name.startsWith("Joint")).map((l) => [l.name, l.qty]);
    expect(fittings).toEqual([
      ["Joint CMY-Y102LS-G2", "2"],
      ["Joint CMY-Y102SS-G2", "2"],
    ]);
    expect(sys.lines.find((l) => l.name === "Additional refrigerant")?.qty).toBe("12500 g");

    const pick = model.picklist.filter((r) => r.group === "pipe").map((r) => [r.name, r.qty]);
    expect(pick).toContainEqual(["ø9.52 / ø15.88 pair coil", "40 m"]);
    expect(pick).toContainEqual(["Joint CMY-Y102LS-G2", "2"]);
    expect(model.picklist.find((r) => r.name === "Additional refrigerant")?.qty).toBe("12500 g");
  });

  it("before the drawing reaches every head: the sizes stand, with no metres to pick", () => {
    const t = page144Drawn();
    const cut = {
      ...t.doc,
      objects: t.doc.objects.filter(
        (o) => !(o.type === "pipe-run" && (o.props.startAttach as { id?: string } | undefined)?.id === t.heads[40])
      ),
    };
    const model = buildSummaryModel(cut, pack);
    const sys = model.systems.find((s) => s.systemId === t.systemId)!;
    expect(sys.lines.filter((l) => l.name.endsWith("pair coil")).every((l) => l.qty === "—")).toBe(true);
    expect(sys.lines.some((l) => l.name === "Additional refrigerant")).toBe(false);
    expect(model.picklist.some((r) => r.name.endsWith("pair coil"))).toBe(false);
  });
});

describe("deleting a joint (Isaac, 2026-09-29)", () => {
  it("puts the run it cut back together and takes its branch with it", () => {
    const t = page144Drawn();
    const joints = t.doc.objects.filter((o) => o.type === "joint");
    const runsBefore = t.doc.objects.filter((o) => o.type === "pipe-run").length;
    const after = deleteJoint(t.doc, joints[0].id);
    expect(after.objects.filter((o) => o.type === "joint")).toHaveLength(joints.length - 1);
    // two halves became one, and the branch went: two fewer runs
    expect(after.objects.filter((o) => o.type === "pipe-run")).toHaveLength(runsBefore - 2);
    const graph = buildSystemGraph(after.objects, after.floors, t.systemId);
    expect(graph.orphanRuns).toEqual([]);
  });

  it("a joint placed on its own just goes, leaving its runs loose", () => {
    const t = page144Drawn();
    const free = { id: "free", type: "joint", systemId: t.systemId, floorId: t.doc.floors[0].id, geometry: { kind: "point" as const, at: { x: 0, y: 9000 } }, plane: "room" as const, props: {} };
    const d = { ...t.doc, objects: [...t.doc.objects, free] };
    expect(deleteJoint(d, "free").objects.some((o) => o.id === "free")).toBe(false);
  });
});

/* what the plan shows on a drawn VRF (Isaac, 2026-09-29): each run's size,
   a picked run's whole section, and what goes in and out of each joint */
describe("the plan's pipe sizes, from the drawn tree", () => {
  it("every drawn run belongs to one sized section, and a section lists its runs", () => {
    const t = page144Drawn();
    const view = pipeViewOf(t.doc, pack, t.doc.systems.find((s) => s.id === t.systemId)!)!;
    const runs = runsOf(t.doc, t.systemId);
    expect(runs.every((r) => view.byRun.has(r.id))).toBe(true);
    for (const sec of view.sections) for (const e of sec.edges) expect(view.byRun.get(e)).toBe(sec);
    // the head's own run is its section on its own
    const toP40 = view.sections.find((s) => s.to === t.heads[40])!;
    expect(toP40.edges).toHaveLength(1);
  });

  it("a joint says the size in and each size out", () => {
    const t = page144Drawn();
    const view = pipeViewOf(t.doc, pack, t.doc.systems.find((s) => s.id === t.systemId)!)!;
    const joints = [...view.fittings.values()].filter((f) => f.fitting.kind === "joint");
    expect(joints).toHaveLength(4);
    for (const j of joints) {
      expect(j.feed?.to).toBe(j.fitting.nodeId);
      expect(j.outs).toHaveLength(2);
      for (const o of j.outs) expect(o.from).toBe(j.fitting.nodeId);
    }
  });

  it("is not shown until every head is piped", () => {
    const t = page144Drawn();
    const last = runsOf(t.doc, t.systemId).find((r) => (r.props.startAttach as { id: string }).id === t.heads[32])!;
    const cut = { ...t.doc, objects: t.doc.objects.filter((o) => o.id !== last.id) };
    expect(pipeViewOf(cut, pack, cut.systems.find((s) => s.id === t.systemId)!)).toBeNull();
  });
});

describe("pipe sizes in words", () => {
  it("reads inches by default, the fraction the copper is sold by", () => {
    expect(tubeSize(9.52, "in")).toBe('3/8"');
    expect(tubeSize(28.58, "in")).toBe('1 1/8"');
    expect(pairSize(6.35, 12.7, "in")).toBe('1/4" / 1/2"');
    expect(pairSize(6.35, 12.7, "mm")).toBe("6.35 / 12.7 mm");
  });

  it("a size it has no fraction for says its mm", () => {
    expect(tubeSize(10, "in")).toBe("10 mm");
  });

  it("colours step up with the gas size, one step each", () => {
    expect([9.52, 12.7, 15.88, 19.05, 22.2, 25.4, 28.58, 31.75, 41.28].map(sizeTone)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8]);
  });
});

/* walk C (2026-09-29): a pipe drawn out to nowhere was allowed, and nothing said so */
describe("a pipe that goes nowhere", () => {
  it("is red on the system, counted, with the fix", () => {
    const t = page144Drawn();
    const sys = () => t.doc.systems.find((s) => s.id === t.systemId)!;
    expect(systemFindings(t.doc, pack, sys()).map((f) => f.code)).not.toContain("loose-pipe");
    const trunkEnd = runsOf(t.doc, t.systemId)[0].props.startAttach;
    const open = (id: string): DesignObject => ({
      id,
      type: "pipe-run",
      systemId: t.systemId,
      floorId: t.doc.floors[0].id,
      geometry: { kind: "polyline", points: [{ x: 0, y: 3000 }, { x: 900, y: 3000 }] },
      plane: "room",
      props: { startAttach: trunkEnd },
    });
    t.doc = { ...t.doc, objects: [...t.doc.objects, open("stub1")] };
    expect(systemFindings(t.doc, pack, sys()).find((f) => f.code === "loose-pipe")).toEqual({
      severity: "red",
      code: "loose-pipe",
      drawing: true,
      message: "A pipe isn't connected at one end",
      fix: "Connect it, or delete it",
    });
    t.doc = { ...t.doc, objects: [...t.doc.objects, open("stub2")] };
    expect(systemFindings(t.doc, pack, sys()).find((f) => f.code === "loose-pipe")?.message).toBe(
      "2 pipes aren't connected at one end"
    );
    expect(combinationWord(t.doc, pack, sys())).toBe("Fails");
    // a drawing finding fails the combination but never keeps the builder's Done off
    expect(doneBlockers(systemFindings(t.doc, pack, sys()))).toEqual([]);
  });
});

/* Delete on the schematic (Isaac, 2026-09-29) */
describe("deleting from the schematic", () => {
  it("a section's runs go, a joint puts its cut run back together", () => {
    const t = page144Drawn();
    const sys = t.doc.systems.find((s) => s.id === t.systemId)!;
    const view = pipeViewOf(t.doc, pack, sys)!;
    const toP40 = view.sections.find((s) => s.to === t.heads[40])!;
    const cut = deleteFromSchematic(t.doc, { kind: "runs", ids: toP40.edges });
    expect(runsOf(cut, t.systemId)).toHaveLength(runsOf(t.doc, t.systemId).length - toP40.edges.length);
    // the P40's joint now has one run in and one out: deleting it rejoins the trunk
    const joint = t.doc.objects.find((o) => o.type === "joint" && runsOf(t.doc, t.systemId).some((r) => toP40.edges.includes(r.id) && (r.props.endAttach as { id: string }).id === o.id))!;
    const rejoined = deleteFromSchematic(cut, { kind: "joint", id: joint.id });
    expect(rejoined.objects.some((o) => o.id === joint.id)).toBe(false);
    expect(runsOf(rejoined, t.systemId)).toHaveLength(runsOf(cut, t.systemId).length - 1);
  });
});

/* a size set by hand from the schematic (Isaac, 2026-09-29): it wins over the
   book, the book's size is kept beside it, the charge follows, and clearing
   it gives the book's back */
describe("overriding a section's size", () => {
  it("takes the hand-set size, keeps the book's, and clears back", () => {
    const t = page144Drawn();
    const sys = () => t.doc.systems.find((s) => s.id === t.systemId)!;
    const before = pipeViewOf(t.doc, pack, sys())!;
    const toP40 = before.sections.find((s) => s.to === t.heads[40])!;
    const book = { liquidMm: toP40.liquidMm, gasMm: toP40.gasMm };
    const chargeBefore = systemVrfTree(pack, sys(), t.doc)!.chargeG;

    const set = setRunSizes(t.doc, toP40.edges, { liquidMm: 9.52, gasMm: 15.88 });
    const after = pipeViewOf(set, pack, set.systems.find((s) => s.id === t.systemId)!)!;
    const sec = after.sections.find((s) => s.to === t.heads[40])!;
    expect([sec.liquidMm, sec.gasMm]).toEqual([9.52, 15.88]);
    expect(sec.override).toEqual({ bookLiquidMm: book.liquidMm, bookGasMm: book.gasMm });
    // a bigger liquid line holds more refrigerant
    expect(systemVrfTree(pack, set.systems.find((s) => s.id === t.systemId)!, set)!.chargeG!).toBeGreaterThan(chargeBefore!);

    const cleared = setRunSizes(set, toP40.edges, null);
    const back = pipeViewOf(cleared, pack, cleared.systems.find((s) => s.id === t.systemId)!)!;
    const again = back.sections.find((s) => s.to === t.heads[40])!;
    expect([again.liquidMm, again.gasMm]).toEqual([book.liquidMm, book.gasMm]);
    expect(again.override).toBeUndefined();
  });
});

/* Isaac, 2026-09-29: "if I put a join on somewhere and just leave it, it just
   gets placed, but it's not actually connected to anything" */
describe("a joint that branches nothing", () => {
  it("is red with its fix, a box with no pipes too, and Delete takes them", () => {
    const t = page144Drawn();
    const sys = () => t.doc.systems.find((s) => s.id === t.systemId)!;
    const codes = () => systemFindings(t.doc, pack, sys()).map((f) => f.code);
    expect(codes()).not.toContain("stray-joint"); // four joints, three pipes on each
    const floorId = t.doc.floors[0].id;
    const lone = { id: "lone", type: "joint", systemId: t.systemId, floorId, plane: "room", geometry: { kind: "point", at: { x: 5, y: 5 } }, props: {} } as DesignObject;
    const box = { id: "box", type: "branch-box", systemId: t.systemId, floorId, plane: "room", geometry: { kind: "point", at: { x: 9, y: 9 } }, props: {} } as DesignObject;
    t.doc = { ...t.doc, objects: [...t.doc.objects, lone, box] };
    const f = systemFindings(t.doc, pack, sys());
    expect(f.find((x) => x.code === "stray-joint")).toMatchObject({ severity: "red", drawing: true, message: "A joint isn't connected" });
    expect(f.find((x) => x.code === "stray-box")?.message).toBe("A branch box isn't connected");
    expect(doneBlockers(f).map((x) => x.code)).not.toContain("stray-joint");
    t.doc = deleteFromSchematic(deleteFromSchematic(t.doc, { kind: "joint", id: "lone" }), { kind: "box", id: "box" });
    expect(codes()).not.toContain("stray-joint");
    expect(codes()).not.toContain("stray-box");
  });
});

describe("heights: floors stack, units sit above their floor (Isaac, 2026-09-30)", () => {
  const setMount = (doc: DesignDocument, id: string, mountM: number): DesignDocument => ({
    ...doc,
    objects: doc.objects.map((o) => (o.id === id ? { ...o, props: { ...o.props, mountM } } : o)),
  });
  const sized = (doc: DesignDocument, systemId: string) =>
    systemVrfTree(pack, doc.systems.find((s) => s.id === systemId)!, doc)!;
  const codes = (doc: DesignDocument, systemId: string) => sized(doc, systemId).findings.map((f) => f.code);

  it("everything on one floor at 0 m is level, as before", () => {
    const t = page144Drawn();
    const tree = sized(t.doc, t.systemId);
    expect(Object.values(tree.levels).every((v) => v === 0)).toBe(true);
    expect(tree.findings).toEqual([]);
  });

  it("a head 20 m up takes its liquid one size up; 35 m up is red", () => {
    const t = page144Drawn();
    const up = sized(setMount(t.doc, t.heads[63], 20), t.systemId);
    expect(up.levels[t.heads[63]]).toBe(20);
    expect(up.sections.find((s) => s.to === t.heads[63])!.upsized).toBe(true);
    expect(up.findings).toEqual([]);
    expect(codes(setMount(t.doc, t.heads[63], 35), t.systemId)).toContain("head-height-over");
  });

  it("an outdoor on a roof 55 m over its heads is red, before a pipe is drawn", () => {
    const t = page144Drawn();
    const oduId = allocationsOf(t.doc.systems.find((s) => s.id === t.systemId)!).find((a) => a.role === "odu")!.id;
    const undrawn = { ...t.doc, objects: t.doc.objects.filter((o) => o.type !== "pipe-run" && o.type !== "joint") };
    const tree = sized(setMount(undrawn, oduId, 55), t.systemId);
    expect(tree.drawn).toBe(false);
    expect(tree.findings.map((f) => f.code)).toContain("outdoor-above-over");
    expect(codes(setMount(undrawn, oduId, 45), t.systemId)).not.toContain("outdoor-above-over");
  });

  it("a head not on the plan yet is left out of the lift limits", () => {
    const t = page144Drawn();
    const undrawn = {
      ...t.doc,
      objects: t.doc.objects.filter((o) => o.type !== "pipe-run" && o.type !== "joint" && o.id !== t.heads[32]),
    };
    const tree = sized(setMount(undrawn, t.heads[63], 35), t.systemId);
    expect(tree.levels[t.heads[32]]).toBeUndefined();
    // P63 at 35 m against the others at 0: red, and the missing P32 changes nothing
    expect(tree.findings.map((f) => f.code)).toContain("head-height-over");
  });
});

describe("a riser between floors", () => {
  it("is as tall as the floor it leaves, rises by it, and turns at each end a run leaves it", () => {
    let doc = createDesign({ name: "two floors", mode: "blank" });
    const g = doc.floors[0];
    const up = { ...g, id: "flr_up", name: "Level 1", level: 1 };
    doc = { ...doc, floors: [{ ...g, heightM: 4.2 }, up, { ...g, id: "flr_roof", name: "Roof", level: 2 }] };
    const obj = (id: string, type: string, floorId: string, props: Record<string, unknown> = {}): DesignObject => ({
      id,
      type,
      systemId: "sys",
      floorId,
      geometry: { kind: "point", at: { x: 0, y: 0 } },
      plane: "room",
      props,
    }) as DesignObject;
    const run = (id: string, floorId: string, a: string, b: string, akind: string, bkind: string): DesignObject =>
      ({
        id,
        type: "pipe-run",
        systemId: "sys",
        floorId,
        geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
        plane: "room",
        props: { startAttach: { kind: akind, id: a }, endAttach: { kind: bkind, id: b } },
      }) as DesignObject;
    doc = {
      ...doc,
      objects: [
        obj("odu", "unit", g.id, { role: "odu" }),
        obj("r0", "riser", g.id, { group: "A" }),
        obj("r1", "riser", "flr_up", { group: "A" }),
        obj("r2", "riser", "flr_roof", { group: "A" }),
        obj("idu", "unit", "flr_roof", { role: "idu", mountM: 2.4 }),
        run("p0", g.id, "odu", "r0", "unit", "riser"),
        run("p2", "flr_roof", "r2", "idu", "riser", "unit"),
      ],
    };
    const graph = buildSystemGraph(doc.objects, doc.floors, "sys");
    const gaps = graph.edges.filter((e) => e.id.startsWith("riser-gap:"));
    // ground is 4.2 m tall, Level 1 the default 3 m
    expect(gaps.map((e) => [e.lengthM, e.riseM, e.bends])).toEqual([
      [4.2, 4.2, 1],
      [3, 3, 1],
    ]);
    // the head sits 2.4 m above the roof floor, its riser at the floor
    expect(graph.edges.find((e) => e.id === "p2")!.riseM).toBeCloseTo(2.4);
  });

  it("set by hand, it is that tall, and the lift still comes from the floors (Isaac: floor console to the ceiling above, 6 m)", () => {
    let doc = createDesign({ name: "manual riser", mode: "blank" });
    const g = doc.floors[0];
    doc = { ...doc, floors: [g, { ...g, id: "flr_up", name: "Level 1", level: 1 }] };
    const riser = (id: string, floorId: string): DesignObject =>
      ({ id, type: "riser", systemId: "sys", floorId, geometry: { kind: "point", at: { x: 0, y: 0 } }, plane: "room", props: { group: "A", heightM: 3 } }) as DesignObject;
    doc = { ...doc, objects: [riser("r0", g.id), riser("r1", "flr_up")] };
    const gap = () => buildSystemGraph(doc.objects, doc.floors, "sys").edges.find((e) => e.id.startsWith("riser-gap:"))!;
    // the legacy heightM every riser carries is not a hand-set height
    expect(riserGapOf(doc.objects, doc.floors, "r1")).toMatchObject({ lowerId: "r0", planM: 3, manualM: null });
    doc = setRiserHeight(doc, "r0", 6);
    expect([gap().lengthM, gap().riseM]).toEqual([6, 3]);
    expect(riserGapOf(doc.objects, doc.floors, "r0")!.manualM).toBe(6);
    doc = setRiserHeight(doc, "r0", null);
    expect(gap().lengthM).toBe(3);
  });
});

describe("sliding a joint along its pipe (Isaac, 2026-09-30)", () => {
  const jointAt = (doc: DesignDocument, x: number) =>
    doc.objects.find((o) => o.type === "joint" && o.geometry.kind === "point" && Math.abs(o.geometry.at.x - x) < 1)!;
  const pts = (doc: DesignDocument | { objects: DesignObject[] }, id: string) =>
    (doc.objects.find((o) => o.id === id)!.geometry as { points: Point[] }).points;

  it("moves along the trunk: the half behind shortens, the half ahead lengthens, the branch follows", () => {
    const t = page144Drawn();
    const j = jointAt(t.doc, 40 * M);
    const slid = slideOnRun(t.doc.objects, j.id, { x: 38 * M, y: 0.2 * M }, 1 * M)!;
    expect(slid.at).toEqual({ x: 38 * M, y: 0 });
    const into = runsOf({ ...t.doc, objects: slid.objects }, t.systemId).find(
      (r) => attachOf(r.props.endAttach)?.id === j.id && r.props.cutEnd === j.id
    )!;
    const on = runsOf({ ...t.doc, objects: slid.objects }, t.systemId).find(
      (r) => attachOf(r.props.startAttach)?.id === j.id && r.props.cutStart === j.id
    )!;
    expect(into.geometry.points.at(-1)).toEqual({ x: 38 * M, y: 0 });
    expect(on.geometry.points[0]).toEqual({ x: 38 * M, y: 0 });
    expect(on.geometry.points.at(-1)).toEqual(pts(t.doc, on.id).at(-1));
    // the trunk as a whole is unchanged in length: 85 m still reaches P63
    const doc = { ...t.doc, objects: reconcileAttachedRuns(slid.objects, new Set([j.id])) };
    const tree = systemVrfTree(pack, doc.systems.find((s) => s.id === t.systemId)!, doc)!;
    expect(tree.drawn).toBe(true);
    expect(tree.sections.find((s) => s.to === t.heads[63])!.lengthM).toBeCloseTo(10);
  });

  it("carries on through a T onto the next run (Isaac: \"even through T's\")", () => {
    const t = page144Drawn();
    const j1 = jointAt(t.doc, 40 * M);
    const j2 = jointAt(t.doc, 50 * M);
    // past the P100's joint at 50 m, to 55 m
    const slid = slideOnRun(t.doc.objects, j1.id, { x: 55 * M, y: 0 }, 1 * M)!;
    expect(slid.at).toEqual({ x: 55 * M, y: 0 });
    const doc = { ...t.doc, objects: reconcileAttachedRuns(slid.objects, new Set([j1.id])) };
    const sys = doc.systems.find((s) => s.id === t.systemId)!;
    const tree = systemVrfTree(pack, sys, doc)!;
    // still one drawn tree reaching every head; the P125 now branches after the P100
    expect(tree.drawn).toBe(true);
    expect(tree.sections.find((s) => s.to === j1.id)!.from).toBe(j2.id);
    expect(tree.sections.find((s) => s.to === t.heads[125])!.from).toBe(j1.id);
    // no run left loose, no id lost
    expect(systemFindings(doc, pack, sys).map((f) => f.code)).not.toContain("loose-pipe");
    expect(runsOf(doc, t.systemId)).toHaveLength(runsOf(t.doc, t.systemId).length);
  });

  it("dragged well off the line, there is no slide (it comes free)", () => {
    const t = page144Drawn();
    const j = jointAt(t.doc, 40 * M);
    expect(slideOnRun(t.doc.objects, j.id, { x: 38 * M, y: 3 * M }, 1 * M)).toBeNull();
  });

  it("passes a corner over from one half to the other", () => {
    // a run with a corner: (0,0) → (10,0) → (10,10), a joint at (5,0)
    let doc = createDesign({ name: "corner", mode: "blank" });
    const floorId = doc.floors[0].id;
    doc = {
      ...doc,
      objects: [
        { id: "run", type: "pipe-run", systemId: "s", floorId, plane: "room", geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }, props: {} } as DesignObject,
      ],
    };
    const cut = jointOnRun(doc, "run", 0, { x: 5, y: 0 }, "J")!;
    const slid = slideOnRun(cut.doc.objects, "J", { x: 10.2, y: 4 }, 1)!;
    expect(slid.at).toEqual({ x: 10, y: 4 });
    const runs = slid.objects.filter((o) => o.type === "pipe-run").map((o) => (o.geometry as { points: Point[] }).points);
    expect(runs).toContainEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }]);
    expect(runs).toContainEqual([{ x: 10, y: 4 }, { x: 10, y: 10 }]);
  });
});

describe("deleting a riser dropped in a pipe (Isaac, 2026-09-30: it left the trunk in two)", () => {
  it("puts the pipe back together, as deleting a joint does", () => {
    let doc = createDesign({ name: "riser delete", mode: "blank" });
    const floorId = doc.floors[0].id;
    doc = {
      ...doc,
      objects: [
        { id: "run", type: "pipe-run", systemId: "s", floorId, plane: "room", geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, props: { startAttach: { kind: "unit", id: "odu" } } } as DesignObject,
      ],
    };
    const riser = { id: "R", type: "riser", systemId: "s", floorId, plane: "room", geometry: { kind: "point", at: { x: 4, y: 0 } }, props: { group: "A" } } as DesignObject;
    const cut = riserOnRun(doc, "run", 0, riser, 0.1)!;
    expect(cut.objects.filter((o) => o.type === "pipe-run")).toHaveLength(2);
    const back = deleteJoint(cut, "R");
    const runs = back.objects.filter((o) => o.type === "pipe-run");
    expect(runs).toHaveLength(1);
    expect((runs[0].geometry as { points: Point[] }).points).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 10, y: 0 }]);
    expect(attachOf(runs[0].props.startAttach)?.id).toBe("odu");
    expect(back.objects.some((o) => o.id === "R")).toBe(false);
  });
});

describe("branch kits or refrigeration tees (Isaac, 2026-09-30)", () => {
  it("is asked of a VRF that branches at joints; tees take each joint's place, a tee per pipe", () => {
    const t = page144Drawn();
    const sys = () => t.doc.systems.find((s) => s.id === t.systemId)!;
    expect(installQuestions(t.doc, pack, sys()).map((q) => q.id)).toContain("branch-joints");
    const joints = (doc: DesignDocument) =>
      equipmentList(doc, pack, doc.systems.find((s) => s.id === t.systemId)!).rows.filter(
        (r) => r.name === "Joint" || r.name.startsWith("Refrigeration tee")
      );
    // unanswered, the book's kits are listed
    expect(joints(t.doc).every((r) => r.name === "Joint")).toBe(true);
    const teed = answerInstall(t.doc, t.systemId, "branch-joints", ["tees"]);
    const rows = joints(teed);
    expect(rows.some((r) => r.name === "Joint")).toBe(false);
    // four joints, a liquid and a gas tee each
    expect(rows.reduce((n, r) => n + (r.qty ?? 0), 0)).toBe(8);
    // copper as it is sold: in, then the two out, e.g. 1 1/8" × 7/8" × 5/8"
    expect(rows.every((r) => /^[\d/ ]+" × [\d/ ]+" × [\d/ ]+"$/.test(r.model ?? ""))).toBe(true);
    expect(rows.map((r) => r.model)).toContain('1 1/8" × 7/8" × 5/8"');
  });
});

describe("a riser on a pipe's end (Isaac, 2026-09-30)", () => {
  const setup = () => {
    let doc = createDesign({ name: "end riser", mode: "blank" });
    const floorId = doc.floors[0].id;
    doc = {
      ...doc,
      objects: [
        { id: "run", type: "pipe-run", systemId: "s", floorId, plane: "room", geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }, props: { startAttach: { kind: "unit", id: "odu" } } } as DesignObject,
      ],
    };
    const riser = { id: "R", type: "riser", systemId: "s", floorId, plane: "room", geometry: { kind: "point", at: { x: 10.3, y: 9.6 } }, props: { group: "A" } } as DesignObject;
    return { doc, riser };
  };
  it("dropped near a free end, takes that pipe up there: no T, the riser on the end", () => {
    const { doc, riser } = setup();
    const joined = riserOnRun(doc, "run", 1, riser, 1)!;
    const runs = joined.objects.filter((o) => o.type === "pipe-run");
    expect(runs).toHaveLength(1);
    expect(attachOf(runs[0].props.endAttach)?.id).toBe("R");
    expect((joined.objects.find((o) => o.id === "R")!.geometry as { at: Point }).at).toEqual({ x: 10, y: 10 });
  });
  it("slides back along its own pipe, round the corner, shortening it", () => {
    const { doc, riser } = setup();
    const joined = riserOnRun(doc, "run", 1, riser, 1)!;
    const slid = slideOnRun(joined.objects, "R", { x: 6, y: 0.3 }, 1)!;
    expect(slid.at).toEqual({ x: 6, y: 0 });
    const run = slid.objects.find((o) => o.id === "run")!;
    expect((run.geometry as { points: Point[] }).points).toEqual([{ x: 0, y: 0 }, { x: 6, y: 0 }]);
  });
});

describe("a header with refrigeration tees (Isaac, 2026-09-30: headers go the company's way too)", () => {
  it("is a row of N − 1 tees on each pipe, in place of the header", () => {
    let doc = createDesign({ name: "header", mode: "blank" });
    const floorId = doc.floors[0].id;
    for (const [i, id] of ["za", "zb", "zc"].entries())
      doc.objects.push({
        id,
        type: "room",
        systemId: null,
        floorId,
        plane: "room",
        geometry: { kind: "polygon", points: [{ x: i * 500, y: 400 }, { x: i * 500 + 400, y: 400 }, { x: i * 500 + 400, y: 800 }, { x: i * 500, y: 800 }] },
        props: { name: id },
      } as RoomObj as DesignObject);
    const made = newSystem(doc, pack.meta.version);
    const systemId = made.systemId;
    doc = made.doc;
    for (const id of ["za", "zb", "zc"]) doc = addHead(doc, pack, { systemId, zoneId: id, iduModel: vrfOf(40) });
    doc = chooseOutdoor(doc, pack, "worst-of-both", systemId, "PUHY-P200YNW-A1");
    const allocs = allocationsOf(doc.systems.find((s) => s.id === systemId)!);
    const odu = allocs.find((a) => a.role === "odu")!;
    const heads = allocs.filter((a) => a.role === "idu");
    const pt = (id: string, x: number, y: number, props: Record<string, unknown>, type = "unit"): DesignObject =>
      ({ id, type, systemId, floorId, geometry: { kind: "point", at: { x, y } }, plane: "room", props }) as DesignObject;
    const run = (id: string, a: [string, string, number, number], b: [string, string, number, number]): DesignObject =>
      ({
        id,
        type: "pipe-run",
        systemId,
        floorId,
        geometry: { kind: "polyline", points: [{ x: a[2], y: a[3] }, { x: b[2], y: b[3] }] },
        plane: "room",
        props: { startAttach: { kind: a[0], id: a[1] }, endAttach: { kind: b[0], id: b[1] } },
      }) as DesignObject;
    doc = {
      ...doc,
      objects: [
        ...doc.objects,
        pt(odu.id, 0, 0, { role: "odu", model: odu.model }),
        pt("H", 700, 0, {}, "joint"),
        ...heads.map((h, i) => pt(h.id, i * 500 + 200, 600, { role: "idu", model: h.model })),
        run("main", ["unit", odu.id, 0, 0], ["joint", "H", 700, 0]),
        ...heads.map((h, i) => run(`b${i}`, ["joint", "H", 700, 0], ["unit", h.id, i * 500 + 200, 600])),
      ],
    };
    const sys = () => doc.systems.find((s) => s.id === systemId)!;
    expect(systemVrfTree(pack, sys(), doc)!.fittings.map((f) => f.kind)).toEqual(["header"]);
    expect(installQuestions(doc, pack, sys()).map((q) => q.id)).toContain("branch-joints");
    const teed = answerInstall(doc, systemId, "branch-joints", ["tees"]);
    const rows = equipmentList(teed, pack, teed.systems.find((s) => s.id === systemId)!).rows;
    expect(rows.some((r) => r.name === "Header")).toBe(false);
    const tees = rows.filter((r) => r.name.startsWith("Refrigeration tee"));
    // three branches: two tees on each pipe
    expect(tees.reduce((n, r) => n + (r.qty ?? 0), 0)).toBe(4);
    expect(tees.every((r) => r.why === "In place of the header: a row of tees, one branch off each")).toBe(true);
  });
});

/* THE RULES SETTLED ON THE 2026-09-30 WALK, held in place. Each one was
   reversed at least once on the night; these pin where they landed. */
describe("the 2026-09-30 walk's rules", () => {
  const pts = (objects: readonly DesignObject[], id: string) =>
    (objects.find((o) => o.id === id)!.geometry as { points: Point[] }).points;
  const atOf = (objects: readonly DesignObject[], id: string) => (objects.find((o) => o.id === id)!.geometry as { at: Point }).at;
  const jointAt = (doc: DesignDocument, x: number) =>
    doc.objects.find((o) => o.type === "joint" && o.geometry.kind === "point" && Math.abs(o.geometry.at.x - x) < 1)!;
  const riserObj = (id: string, systemId: string, floorId: string, at: Point): DesignObject =>
    ({ id, type: "riser", systemId, floorId, plane: "room", geometry: { kind: "point", at }, props: { group: "A" } }) as DesignObject;

  /* page 144 with its P32 taken upstairs: the P32's branch comes off the
     trunk, a riser goes in the trunk at 80 m, and the P32 is piped from the
     riser's top on Level 1 */
  const p32Upstairs = () => {
    const t = page144Drawn();
    const g = t.doc.floors[0];
    let doc: DesignDocument = { ...t.doc, floors: [g, { ...g, id: "flr_up", name: "Level 1", level: 1 }] };
    doc = deleteJoint(doc, jointAt(doc, 75 * M).id);
    const trunk = nearestOnRuns(runsOf(doc, t.systemId), { x: 80 * M, y: 0 }, 1)!;
    doc = riserOnRun(doc, trunk.runId, trunk.seg, riserObj("R0", t.systemId, g.id, { x: 80 * M, y: 0 }), 1)!;
    doc = {
      ...doc,
      objects: [
        ...doc.objects.map((o) => (o.id === t.heads[32] ? { ...o, floorId: "flr_up", geometry: { kind: "point" as const, at: { x: 80 * M, y: 6 * M } } } : o)),
        riserObj("R1", t.systemId, "flr_up", { x: 80 * M, y: 0 }),
        {
          id: "up-run",
          type: "pipe-run",
          systemId: t.systemId,
          floorId: "flr_up",
          plane: "room",
          geometry: { kind: "polyline", points: [{ x: 80 * M, y: 0 }, { x: 80 * M, y: 6 * M }] },
          props: { startAttach: { kind: "riser", id: "R1" }, endAttach: { kind: "unit", id: t.heads[32] } },
        } as DesignObject,
      ],
    };
    return { ...t, doc };
  };

  it("a riser dropped mid-pipe is a T: the pipe carries on past it along the floor, and it branches in the tree like a joint", () => {
    const t = p32Upstairs();
    // the trunk is two runs either side of the riser, the riser the far end of one and the start of the other
    const onR0 = runsOf(t.doc, t.systemId).filter(
      (r) => attachOf(r.props.startAttach)?.id === "R0" || attachOf(r.props.endAttach)?.id === "R0"
    );
    expect(onR0).toHaveLength(2);
    expect(atOf(t.doc.objects, "R0")).toEqual({ x: 80 * M, y: 0 });
    const sys = t.doc.systems.find((s) => s.id === t.systemId)!;
    const tree = systemVrfTree(pack, sys, t.doc)!;
    expect(tree.drawn).toBe(true);
    // the riser's foot is the branch: on along the floor to the P63, 5 m; up to the P32, 3 m of riser and 6 m on Level 1
    expect(tree.fittings.find((f) => f.nodeId === "R0")?.kind).toBe("joint");
    expect(tree.sections.find((s) => s.to === t.heads[63])).toMatchObject({ from: "R0", lengthM: 5 });
    const up = tree.sections.find((s) => s.to === t.heads[32])!;
    expect(up.from).toBe("R0");
    expect(up.lengthM).toBeCloseTo(9);
    expect(tree.levels[t.heads[32]]).toBeCloseTo(3);
    expect(systemFindings(t.doc, pack, sys).map((f) => f.code)).not.toContain("stray-riser");
    // tees: the riser's T is a tee pair like any joint — still four branches, eight tees
    const teed = answerInstall(t.doc, t.systemId, "branch-joints", ["tees"]);
    const tees = equipmentList(teed, pack, teed.systems.find((s) => s.id === t.systemId)!).rows.filter((r) =>
      r.name.startsWith("Refrigeration tee")
    );
    expect(tees.reduce((n, r) => n + (r.qty ?? 0), 0)).toBe(8);
  });

  it("a riser near a pipe's end a unit is on does not take the unit's pipe: it goes in as a T where it was dropped", () => {
    let doc = createDesign({ name: "no steal", mode: "blank" });
    const floorId = doc.floors[0].id;
    doc = {
      ...doc,
      objects: [
        { id: "run", type: "pipe-run", systemId: "s", floorId, plane: "room", geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, props: { startAttach: { kind: "unit", id: "odu" }, endAttach: { kind: "unit", id: "idu" } } } as DesignObject,
      ],
    };
    const cut = riserOnRun(doc, "run", 0, riserObj("R", "s", floorId, { x: 9.6, y: 0 }), 1)!;
    const runs = cut.objects.filter((o) => o.type === "pipe-run");
    expect(runs).toHaveLength(2);
    expect(atOf(cut.objects, "R")).toEqual({ x: 9.6, y: 0 });
    expect(runs.map((r) => attachOf(r.props.endAttach)?.id).sort()).toEqual(["R", "idu"]);
    expect(runs.map((r) => attachOf(r.props.startAttach)?.id).sort()).toEqual(["R", "odu"]);
  });

  it("a riser that is a T slides along the pipe as a joint does, and deleting it heals the pipe", () => {
    const t = p32Upstairs();
    const slid = slideOnRun(t.doc.objects, "R0", { x: 78 * M, y: 0.3 * M }, 1 * M)!;
    expect(slid.at).toEqual({ x: 78 * M, y: 0 });
    const doc = { ...t.doc, objects: reconcileAttachedRuns(slid.objects, new Set(["R0"])) };
    const tree = systemVrfTree(pack, doc.systems.find((s) => s.id === t.systemId)!, doc)!;
    expect(tree.sections.find((s) => s.to === t.heads[63])!.lengthM).toBeCloseTo(7);
    // the riser's pipe up is on the other floor: it does not come off with the slide
    expect(runsOf(doc, t.systemId).find((r) => r.id === "up-run")).toBeDefined();
  });

  it("a slide never jumps onto another system's pipe, or a pipe on another floor", () => {
    const t = page144Drawn();
    const j = jointAt(t.doc, 40 * M);
    const floorId = t.doc.floors[0].id;
    const near = (id: string, systemId: string, fid: string): DesignObject =>
      ({ id, type: "pipe-run", systemId, floorId: fid, plane: "room", geometry: { kind: "polyline", points: [{ x: 30 * M, y: 0.5 * M }, { x: 45 * M, y: 0.5 * M }] }, props: {} }) as DesignObject;
    const objects = [...t.doc.objects, near("other-sys", "sys_other", floorId), near("other-floor", t.systemId, "flr_elsewhere")];
    // the foreign pipes are 0.05 m off; the trunk 0.45 m
    const slid = slideOnRun(objects, j.id, { x: 38 * M, y: 0.45 * M }, 1 * M)!;
    expect(slid.at).toEqual({ x: 38 * M, y: 0 });
    expect(pts(slid.objects, "other-sys")).toEqual(pts(objects, "other-sys"));
    expect(pts(slid.objects, "other-floor")).toEqual(pts(objects, "other-floor"));
  });

  it("a slide stops short of a pipe's end, so it never lands on the outdoor", () => {
    const t = page144Drawn();
    const j = jointAt(t.doc, 40 * M);
    const slid = slideOnRun(t.doc.objects, j.id, { x: 0.1 * M, y: 0 }, 1 * M)!;
    expect(slid.at).toEqual({ x: 0.5 * M, y: 0 });
    const fromOdu = slid.objects.find(
      (o) => o.type === "pipe-run" && attachOf(o.props.endAttach)?.id === j.id && o.props.cutEnd === j.id
    )!;
    expect(attachOf(fromOdu.props.startAttach)?.kind).toBe("unit");
    expect(pts(slid.objects, fromOdu.id)[0]).toEqual({ x: 0, y: 0 });
  });

  it("a slide through a T makes no id and loses none", () => {
    const t = page144Drawn();
    const ids = (objects: readonly DesignObject[]) => objects.map((o) => o.id).sort();
    const slid = slideOnRun(t.doc.objects, jointAt(t.doc, 40 * M).id, { x: 55 * M, y: 0 }, 1 * M)!;
    expect(ids(slid.objects)).toEqual(ids(t.doc.objects));
  });

  describe("a riser on a pipe's end", () => {
    const setup = () => {
      let doc = createDesign({ name: "end riser", mode: "blank" });
      const floorId = doc.floors[0].id;
      doc = {
        ...doc,
        objects: [
          { id: "run", type: "pipe-run", systemId: "s", floorId, plane: "room", geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, props: { startAttach: { kind: "unit", id: "odu" } } } as DesignObject,
        ],
      };
      return riserOnRun(doc, "run", 0, riserObj("R", "s", floorId, { x: 9.8, y: 0.2 }), 1)!;
    };
    it("pulled back out along the line it was drawn on, lengthens the pipe", () => {
      const slid = slideOnRun(setup().objects, "R", { x: 13, y: 0.4 }, 1)!;
      expect(slid.at).toEqual({ x: 13, y: 0 });
      expect(pts(slid.objects, "run")).toEqual([{ x: 0, y: 0 }, { x: 13, y: 0 }]);
    });
    it("a dot left in line is no bend: only a real corner counts toward the book's limit", () => {
      const t = page144Drawn();
      const trunk = (d: DesignDocument) => runsOf(d, t.systemId).find((r) => attachOf(r.props.endAttach)?.id === t.heads[63])!;
      const bendsTo63 = (d: DesignDocument) =>
        systemVrfTree(pack, d.systems.find((s) => s.id === t.systemId)!, d)!.sections.find((s) => s.to === t.heads[63])!.bends;
      const withPoints = (d: DesignDocument, points: Point[]) => ({
        ...d,
        objects: d.objects.map((o) => (o.id === trunk(d).id ? { ...o, geometry: { kind: "polyline" as const, points } } : o)),
      });
      const [a, b] = [trunk(t.doc).geometry.points[0], trunk(t.doc).geometry.points.at(-1)!];
      expect(bendsTo63(t.doc)).toBe(0);
      // a dot mid-line, and a doubled one: still straight
      expect(bendsTo63(withPoints(t.doc, [a, { x: 80 * M, y: 0 }, { x: 80 * M, y: 0 }, b]))).toBe(0);
      // a dog-leg: two real corners
      expect(bendsTo63(withPoints(t.doc, [a, { x: 78 * M, y: 0 }, { x: 78 * M, y: 2 * M }, { x: 82 * M, y: 2 * M }, { x: 82 * M, y: 0 }, b]))).toBe(4);
    });
    it("never slides back onto the pipe's other end", () => {
      expect(slideOnRun(setup().objects, "R", { x: 0.1, y: 0 }, 1)).toBeNull();
    });
    it("with no pipe on its floor, does not slide", () => {
      const doc = setup();
      const lone = { ...doc, objects: doc.objects.filter((o) => o.type !== "pipe-run") };
      expect(slideOnRun(lone.objects, "R", { x: 5, y: 0 }, 1)).toBeNull();
    });
  });

  it("floor heights: a riser from the plans follows its floor, and clearing the floor goes back to 3 m", () => {
    let doc = createDesign({ name: "floors", mode: "blank" });
    const g = doc.floors[0];
    doc = { ...doc, floors: [g, { ...g, id: "flr_up", name: "Level 1", level: 1 }] };
    doc = { ...doc, objects: [riserObj("r0", "sys", g.id, { x: 0, y: 0 }), riserObj("r1", "sys", "flr_up", { x: 0, y: 0 })] };
    // picked from either end, it is the same vertical
    expect(riserGapOf(doc.objects, doc.floors, "r1")).toMatchObject({ lowerId: "r0", fromFloorId: g.id, toFloorId: "flr_up", planM: 3 });
    doc = setFloorHeight(doc, g.id, 4.5);
    expect(riserGapOf(doc.objects, doc.floors, "r0")!.planM).toBe(4.5);
    // a riser set up off its floor (a console's pipe leaving at 0.6 m) is that much shorter
    expect(riserGapOf(setMountOf(doc, "r0", 0.6).objects, doc.floors, "r0")!.planM).toBeCloseTo(3.9);
    expect(setMountOf(setMountOf(doc, "r0", 0.6), "r0", 0).objects.find((o) => o.id === "r0")!.props).not.toHaveProperty("mountM");
    doc = setFloorHeight(doc, g.id, null);
    expect(doc.floors[0]).not.toHaveProperty("heightM");
    expect(riserGapOf(doc.objects, doc.floors, "r0")!.planM).toBe(3);
    // 0 or less is no height: back to the default too
    expect(setFloorHeight(doc, g.id, 0).floors[0]).not.toHaveProperty("heightM");
  });

  describe("the tees question", () => {
    it("offers refrigeration tees first", () => {
      const t = page144Drawn();
      const q = installQuestions(t.doc, pack, t.doc.systems.find((s) => s.id === t.systemId)!).find((x) => x.id === "branch-joints")!;
      expect(q.options.map((o) => o.id).slice(0, 2)).toEqual(["tees", "kits"]);
      expect(q.group).toBe("Pipework");
    });
    it("ticked both ways, the maker's kits stay listed to confirm on the day", () => {
      const t = page144Drawn();
      const both = answerInstall(t.doc, t.systemId, "branch-joints", ["tees", "kits"]);
      const rows = equipmentList(both, pack, both.systems.find((s) => s.id === t.systemId)!).rows;
      expect(rows.some((r) => r.name === "Joint")).toBe(true);
      expect(rows.some((r) => r.name.startsWith("Refrigeration tee"))).toBe(false);
    });
    it("is not asked of a VRF with no joint: one head straight off the outdoor", () => {
      let doc = createDesign({ name: "one head", mode: "blank" });
      const floorId = doc.floors[0].id;
      doc.objects.push({
        id: "z1",
        type: "room",
        systemId: null,
        floorId,
        plane: "room",
        geometry: { kind: "polygon", points: [{ x: 0, y: 400 }, { x: 400, y: 400 }, { x: 400, y: 800 }, { x: 0, y: 800 }] },
        props: { name: "z1" },
      } as RoomObj as DesignObject);
      const made = newSystem(doc, pack.meta.version);
      doc = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "z1", iduModel: vrfOf(125) });
      doc = chooseOutdoor(doc, pack, "worst-of-both", made.systemId, "PUHY-P200YNW-A1");
      const sys = doc.systems.find((s) => s.id === made.systemId)!;
      expect(installQuestions(doc, pack, sys).map((q) => q.id)).not.toContain("branch-joints");
    });
  });
});
