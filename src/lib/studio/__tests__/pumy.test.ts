/* PUMY (M-P0860) is VRF (Isaac, 2026-09-28): City Multi heads on joints and
   headers, the M, S and P-series heads on branch boxes, or both. This suite
   holds it to its data book, against the real shipped pack:
   - the envelope: 50–130% of the outdoor's rated kW, and the head counts by
     how the heads connect (p.2-7);
   - golden set D3 and D4: the book's two worked charge examples (p.86-87),
     read as trees, sized and charged by the engine;
   - branch boxes: which box, which heads, their pipes (p.44, 75). */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { validatePack } from "../packs/validate";
import { outdoorReadiness } from "../packs/ready";
import { checkVrfSet, vrfOutdoorsListing, vrfRatio } from "../vrf";
import { provisionalVrfTree, sizeVrfTree, systemVrfTree, type VrfTree } from "../vrf-tree";
import { createDesign, type DesignObject } from "../document";
import type { RoomObj } from "../loads-room";
import { allocationsOf } from "../allocations";
import { addHead, chooseOutdoor } from "../builder";
import { newSystem } from "../zones";
import { branchBoxObject } from "../joints";

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
const odu = (m: string) => pack.outdoor_units.find((o) => o.model === m)!;
const idu = (m: string) => pack.indoor_units.find((u) => u.model === m)!;
const codes = (m: string, heads: string[]) => checkVrfSet(pack, odu(m), heads.map(idu)).filter((f) => f.severity === "red").map((f) => f.code);

/* City Multi heads by P-number, at the kW the book's examples use */
const CM = { 20: "PLFY-P20VFM-E1", 25: "PLFY-P25VFM-E1", 40: "PLFY-P40VEM-A", 63: "PLFY-P63VEM-A" };

it("the pack validates, and every PUMY is a VRF outdoor with its three tables", () => {
  expect(validatePack(pack).errors).toEqual([]);
  const pumy = pack.outdoor_units.filter((o) => o.model.startsWith("PUMY-"));
  expect(pumy).toHaveLength(11);
  for (const o of pumy) {
    expect(o.system_type).toBe("vrf");
    expect(o.ratio_basis).toBe("kw");
    expect(outdoorReadiness(pack, o).roles["vrf-odu"]).toBe(true);
    for (const ref of [o.pipe_table_ref, o.branch_box_table_ref, o.mixed_table_ref])
      expect(pack.vrf_pipe_tables.some((t) => t.series === ref)).toBe(true);
  }
  expect(pack.multi_rules.some((r) => r.odu_model_ref.startsWith("PUMY-"))).toBe(false);
});

describe("the envelope (p.2-7)", () => {
  it("is 50–130% of the outdoor's rated kW, not its index", () => {
    // SP112 is 12.5 kW: 130% is 16.25 (the install manual's 6.3–16.2 kW)
    const heads = [CM[63], CM[63], CM[20]].map(idu); // 7.1 + 7.1 + 2.2 = 16.4 kW
    expect(vrfRatio(odu("PUMY-SP112VKMD2-A"), heads)).toMatchObject({ basis: "kw", pct: 131 });
    expect(codes("PUMY-SP112VKMD2-A", [CM[63], CM[63], CM[20]])).toEqual(["ratio-over"]);
    expect(codes("PUMY-SP112VKMD2-A", [CM[63], CM[63]])).toEqual([]);
  });

  it("counts heads by how they connect: City Multi only, boxes only, or a mixed pair", () => {
    // SP80: City Multi P10-P100 / 9; branch box P15-P100 / 7; mixed 1 box 5+3, 4+4, 3+5
    const small = "MSZ-AP20VGD"; // a box head, 2.0 kW
    const cm20 = CM[20]; // 2.2 kW
    // ratios kept inside 50–130% of 9.0 kW so only the counts speak
    expect(codes("PUMY-SP80VKMD2-A", Array(4).fill(small))).toEqual([]);
    expect(codes("PUMY-SP80VKMD2-A", [...Array(3).fill(cm20), ...Array(2).fill(small)])).toEqual([]);
    expect(codes("PUMY-SP80VKMD2-A", [...Array(2).fill(cm20), ...Array(2).fill(small)])).toEqual([]);
  });

  it("a head no box of this outdoor takes is red, and PUHY takes no box heads at all", () => {
    expect(codes("PUMY-SP112VKMD2-A", ["MSZ-GS25VFD", CM[63], CM[63]])).toContain("not-vrf-head");
    expect(codes("PUHY-P200YNW-A1", ["MSZ-AP25VGD2", CM[63], CM[63], CM[63]])).toContain("not-vrf-head");
  });

  it("M-series heads propose a PUMY: the smallest whose kW band takes them", () => {
    const heads = ["MSZ-AP35VGD2", "MSZ-AP35VGD2", "MSZ-AP25VGD2"].map(idu); // 3.5 + 3.5 + 2.5 = 9.5 kW
    expect(vrfOutdoorsListing(pack, heads)[0].model).toMatch(/^PUMY-SP80[VY]KMD2-A$/);
  });
});

describe("golden D3 and D4: the book's worked charge examples, as trees (p.86-87)", () => {
  const n = (id: string, kind: "odu" | "joint" | "idu", model?: string) => ({ id, kind, model });
  const header = (heads: [string, string, number][], main: number): VrfTree => ({
    provisional: false,
    nodes: [n("OU", "odu"), n("H", "joint"), ...heads.map(([id, m]) => n(id, "idu", m))],
    sections: [{ id: "A", from: "OU", to: "H", lengthM: main }, ...heads.map(([id, , m]) => ({ id, from: "H", to: id, lengthM: m }))],
  });

  it("D3: PUMY-SP125 with P63/P40/P25/P20 on a header is 6.1 kg", () => {
    const tree = header([["a", CM[63], 15], ["b", CM[40], 10], ["c", CM[25], 10], ["d", CM[20], 20]], 30);
    const sized = sizeVrfTree(pack, odu("PUMY-SP125YKMD2-A"), tree);
    expect(sized.method).toBe("joint");
    expect(sized.findings).toEqual([]);
    // the book: A ø9.52 30 m, a ø9.52 15 m, b c d ø6.35
    const liquid = Object.fromEntries(sized.sections.map((s) => [s.id, s.liquidMm]));
    expect(liquid).toEqual({ A: 9.52, a: 9.52, b: 6.35, c: 6.35, d: 6.35 });
    expect(sized.fittings).toEqual([expect.objectContaining({ kind: "header", part: "CMY-Y64-G-E" })]);
    // 45 m × 50 g + 40 m × 19 g + 3.0 kg (16.6 kW) = 6.01 → 6.1 kg
    expect(sized.chargeG).toBe(6100);
  });

  it("D4: PUMY-P250 with four P63 and a P40 on a header is 8.1 kg", () => {
    const tree = header(
      [["a", CM[63], 15], ["b", CM[63], 10], ["c", CM[63], 10], ["d", CM[63], 10], ["e", CM[40], 15]],
      30
    );
    const sized = sizeVrfTree(pack, odu("PUMY-P250YBMD-A"), tree);
    expect(sized.findings).toEqual([]);
    const liquid = Object.fromEntries(sized.sections.map((s) => [s.id, s.liquidMm]));
    expect(liquid).toEqual({ A: 9.52, a: 9.52, b: 9.52, c: 9.52, d: 9.52, e: 6.35 });
    expect(sized.fittings[0].part).toBe("CMY-Y68-G-E"); // five branches: the 8-branch header
    // 75 m × 50 g + 15 m × 19 g + 4.0 kg (32.9 kW) = 8.035 → 8.1 kg
    expect(sized.chargeG).toBe(8100);
  });
});

describe("branch boxes (p.44, 75)", () => {
  const heads = [
    { id: "h1", model: "MSZ-AP25VGD2" },
    { id: "h2", model: "MSZ-AP25VGD2" },
    { id: "h3", model: "MSZ-AP50VGD2" },
    { id: "h4", model: "SLZ-M35FA-A" },
  ];

  it("four box heads on an SP112 go on one PAC-MK54BC, each on its series' pipe", () => {
    const tree = provisionalVrfTree("OU", heads, new Set(heads.map((h) => h.id)), 5);
    const sized = sizeVrfTree(pack, odu("PUMY-SP112VKMD2-A"), tree);
    expect(sized.method).toBe("branch-box");
    expect(sized.findings).toEqual([]);
    expect(sized.fittings).toEqual([expect.objectContaining({ kind: "box", part: "PAC-MK54BC", branches: 4 })]);
    const pipe = Object.fromEntries(sized.sections.filter((s) => s.role === "box").map((s) => [s.to, [s.liquidMm, s.gasMm]]));
    // M/S 22–42 → 6.35/9.52, 50 → 6.35/12.7
    expect(pipe).toEqual({ h1: [6.35, 9.52], h2: [6.35, 9.52], h3: [6.35, 12.7], h4: [6.35, 9.52] });
  });

  it("three box heads take the three-port PAC-MK34BC", () => {
    const three = heads.slice(0, 3);
    const tree = provisionalVrfTree("OU", three, new Set(three.map((h) => h.id)), 5);
    expect(sizeVrfTree(pack, odu("PUMY-SP112VKMD2-A"), tree).fittings[0].part).toBe("PAC-MK34BC");
  });

  it("City Multi heads beside a box make it mixed, sized by the mixed table", () => {
    const mixed = [...heads.slice(0, 2), { id: "c1", model: CM[40] }];
    const tree = provisionalVrfTree("OU", mixed, new Set(["h1", "h2"]), 5);
    const sized = sizeVrfTree(pack, odu("PUMY-SP112VKMD2-A"), tree);
    expect(sized.method).toBe("mixed");
    expect(sized.findings).toEqual([]);
    expect(sized.sections.find((s) => s.to === "c1")).toMatchObject({ role: "branch", liquidMm: 6.35, gasMm: 12.7 });
  });

  it("the staff-confirmed PLA-M EA2 goes on a box as a P-series head", () => {
    const one = [{ id: "p1", model: "PLA-M71EA2-A" }];
    const sized = sizeVrfTree(pack, odu("PUMY-SP112VKMD2-A"), provisionalVrfTree("OU", one, new Set(["p1"]), 5));
    expect(sized.findings).toEqual([]);
    // P series 60–100 → 9.52/15.88
    expect(sized.sections.find((s) => s.to === "p1")).toMatchObject({ liquidMm: 9.52, gasMm: 15.88 });
  });
});

describe("a branch box drawn on the plan", () => {
  it("is the tree's box: its heads hang off it, the part follows their count, the lengths come from the runs", () => {
    let doc = createDesign({ name: "pumy", mode: "blank" }); // 100 units = 1 m
    const floorId = doc.floors[0].id;
    for (const [id, x] of [["z1", 0], ["z2", 1000]] as const)
      doc.objects.push({
        id,
        type: "room",
        systemId: null,
        floorId,
        plane: "room",
        geometry: { kind: "polygon", points: [{ x, y: 0 }, { x: x + 500, y: 0 }, { x: x + 500, y: 500 }, { x, y: 500 }] },
        props: { name: id },
      } as RoomObj as DesignObject);
    const made = newSystem(doc, pack.meta.version);
    doc = made.doc;
    doc = addHead(doc, pack, { systemId: made.systemId, zoneId: "z1", iduModel: "MSZ-AP25VGD2" });
    doc = addHead(doc, pack, { systemId: made.systemId, zoneId: "z2", iduModel: "MSZ-AP35VGD2" });
    doc = chooseOutdoor(doc, pack, "worst-of-both", made.systemId, "PUMY-SP80VKMD2-A");
    const sys = doc.systems.find((s) => s.id === made.systemId)!;
    expect(sys.type).toBe("vrf");
    const allocs = allocationsOf(sys);
    const oduId = allocs.find((a) => a.role === "odu")!.id;
    const [h1, h2] = allocs.filter((a) => a.role === "idu").map((a) => a.id);
    const obj = (id: string, type: string, at: { x: number; y: number }, props: Record<string, unknown> = {}): DesignObject => ({
      id, type, systemId: made.systemId, floorId, geometry: { kind: "point", at }, plane: "room", props,
    });
    const run = (a: { x: number; y: number }, b: { x: number; y: number }, from: [string, string], to: [string, string]): DesignObject => ({
      id: `${from[1]}>${to[1]}`,
      type: "pipe-run",
      systemId: made.systemId,
      floorId,
      geometry: { kind: "polyline", points: [a, b] },
      plane: "room",
      props: { startAttach: { kind: from[0], id: from[1] }, endAttach: { kind: to[0], id: to[1] } },
    });
    const box = branchBoxObject(made.systemId, floorId, { x: 500, y: 1000 });
    doc = {
      ...doc,
      objects: [
        ...doc.objects,
        obj(oduId, "unit", { x: 500, y: 3000 }, { role: "odu" }),
        obj(h1, "unit", { x: 250, y: 250 }, { role: "idu" }),
        obj(h2, "unit", { x: 1250, y: 250 }, { role: "idu" }),
        box,
        run({ x: 500, y: 3000 }, { x: 500, y: 1000 }, ["unit", oduId], ["branch-box", box.id]), // 20 m
        run({ x: 500, y: 1000 }, { x: 250, y: 250 }, ["branch-box", box.id], ["unit", h1]),
        run({ x: 500, y: 1000 }, { x: 1250, y: 250 }, ["branch-box", box.id], ["unit", h2]),
      ],
    };
    const sized = systemVrfTree(pack, doc.systems.find((s) => s.id === made.systemId)!, doc)!;
    expect(sized.provisional).toBe(false);
    expect(sized.method).toBe("branch-box");
    expect(sized.fittings).toEqual([expect.objectContaining({ kind: "box", part: "PAC-MK34BC", branches: 2 })]);
    expect(sized.sections.find((s) => s.role === "main")?.lengthM).toBeCloseTo(20);
    expect(sized.findings).toEqual([]);
  });
});

describe("edge cases found on the overnight run (2026-09-29)", () => {
  const n = (id: string, kind: "odu" | "joint" | "box" | "idu", model?: string) => ({ id, kind, model });

  it("an M-series head wired straight to a joint is red: it needs its branch box", () => {
    const tree: VrfTree = {
      provisional: false,
      nodes: [n("OU", "odu"), n("J", "joint"), n("a", "idu", CM[40]), n("b", "idu", "MSZ-AP25VGD2")],
      sections: [
        { id: "A", from: "OU", to: "J", lengthM: 5 },
        { id: "a", from: "J", to: "a", lengthM: 3 },
        { id: "b", from: "J", to: "b", lengthM: 3 },
      ],
    };
    const f = sizeVrfTree(pack, odu("PUMY-SP112VKMD2-A"), tree).findings;
    expect(f.map((x) => [x.code, x.message])).toEqual([["not-box-head", "MSZ-AP25VGD2 goes on a branch box, not a joint"]]);
  });

  it("a City Multi head on a box is said once", () => {
    const tree: VrfTree = {
      provisional: false,
      nodes: [n("OU", "odu"), n("B", "box"), n("a", "idu", CM[40])],
      sections: [
        { id: "A", from: "OU", to: "B", lengthM: 5 },
        { id: "a", from: "B", to: "a", lengthM: 3 },
      ],
    };
    const f = sizeVrfTree(pack, odu("PUMY-SP112VKMD2-A"), tree).findings;
    expect(f.map((x) => x.code)).toEqual(["not-box-head"]);
  });

  it("an M-series head then a City Multi head makes a VRF, the same as the other way round", () => {
    const build = (models: string[]) => {
      let doc = createDesign({ name: "order", mode: "blank" });
      const floorId = doc.floors[0].id;
      models.forEach((_, i) =>
        doc.objects.push({
          id: `z${i}`, type: "room", systemId: null, floorId, plane: "room",
          geometry: { kind: "polygon", points: [{ x: i * 600, y: 0 }, { x: i * 600 + 500, y: 0 }, { x: i * 600 + 500, y: 500 }, { x: i * 600, y: 500 }] },
          props: { name: `z${i}` },
        } as RoomObj as DesignObject)
      );
      const made = newSystem(doc, pack.meta.version);
      doc = made.doc;
      models.forEach((m, i) => (doc = addHead(doc, pack, { systemId: made.systemId, zoneId: `z${i}`, iduModel: m })));
      const sys = doc.systems.find((s) => s.id === made.systemId)!;
      return { type: sys.type, odu: allocationsOf(sys).find((a) => a.role === "odu")?.model };
    };
    expect(build(["MSZ-AP25VGD2", CM[63]])).toEqual({ type: "vrf", odu: "PUMY-SP80VKMD2-A" });
    expect(build([CM[63], "MSZ-AP25VGD2"])).toEqual({ type: "vrf", odu: "PUMY-SP80VKMD2-A" });
  });

  it("a PUHY over its head count says so in the same words as a PUMY", () => {
    const heads = Array(21).fill(CM[20]);
    expect(codes("PUHY-P200YNW-A1", heads)).toContain("over-max-count");
    const msg = checkVrfSet(pack, odu("PUHY-P200YNW-A1"), heads.map(idu)).find((f) => f.code === "over-max-count")!.message;
    expect(msg).toBe("21 heads, and PUHY-P200YNW-A1 takes up to 20");
  });
});
