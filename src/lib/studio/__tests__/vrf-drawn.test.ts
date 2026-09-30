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
import { deleteFromSchematic, deleteJoint, jointOnRun, nearestOnRuns } from "../joints";
import { systemVrfTree } from "../vrf-tree";
import { buildSystemGraph } from "../graph";
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
});
