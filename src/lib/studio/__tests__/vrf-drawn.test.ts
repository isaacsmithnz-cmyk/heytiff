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
import { jointOnRun, nearestOnRuns } from "../joints";
import { systemVrfTree } from "../vrf-tree";
import { buildSystemGraph } from "../graph";

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
