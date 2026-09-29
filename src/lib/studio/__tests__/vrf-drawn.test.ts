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
import { deleteJoint, jointOnRun, nearestOnRuns } from "../joints";
import { systemVrfTree } from "../vrf-tree";
import { buildSystemGraph } from "../graph";
import { combinationWord, doneBlockers, systemFindings } from "../verdict";
import { buildSummaryModel } from "../summary";
import { pairSize, pipeViewOf, sizeTone, tubeSize } from "../pipe-sizes";

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
      message: "A pipe ends without reaching anything",
      fix: "Finish each on a unit, a joint or a box, or erase it",
    });
    t.doc = { ...t.doc, objects: [...t.doc.objects, open("stub2")] };
    expect(systemFindings(t.doc, pack, sys()).find((f) => f.code === "loose-pipe")?.message).toBe(
      "2 pipes end without reaching anything"
    );
    expect(combinationWord(t.doc, pack, sys())).toBe("Fails");
    // a drawing finding fails the combination but never keeps the builder's Done off
    expect(doneBlockers(systemFindings(t.doc, pack, sys()))).toEqual([]);
  });
});
