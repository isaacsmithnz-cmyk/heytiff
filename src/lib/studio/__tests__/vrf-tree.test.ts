/* The VRF tree sizer against the book. Golden set D2 is MEES21K029 p.144's
   worked example read as a tree: the book prints every section's liquid size
   and length, so the engine must land on the same sizes (including the two
   sections the 40 m-after-the-first-joint rule steps up) and the same 12.5 kg.
   Gas sizes and fittings are table lookups (p.140), labelled as such. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type AdditionalChargeRule, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { evaluateVrfCharge } from "../materials";
import { provisionalVrfTree, sizeVrfTree, type VrfTree } from "../vrf-tree";

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

/* City Multi heads by P-number (any series: sizing reads the index) */
const HEAD: Record<number, string> = {
  125: "PLFY-P125VEM-A",
  100: "PLFY-P100VEM-A",
  40: pack.indoor_units.find((u) => u.capacity_index === 40 && u.system_roles?.includes("vrf"))!.model,
  32: pack.indoor_units.find((u) => u.capacity_index === 32 && u.system_roles?.includes("vrf"))!.model,
  63: "PLFY-P63VEM-A",
  140: "PEFY-P140VMA-E4",
};

/** p.144: A → J1 (a → P125) → B → J2 (b → P100) → C → J3 (c → P40) → D → J4
    (d → P32, e → P63) */
function page144(): VrfTree {
  const n = (id: string, kind: "odu" | "joint" | "idu", model?: string) => ({ id, kind, model });
  const s = (id: string, from: string, to: string, lengthM: number) => ({ id, from, to, lengthM });
  return {
    provisional: false,
    nodes: [
      n("OU", "odu"),
      n("J1", "joint"),
      n("J2", "joint"),
      n("J3", "joint"),
      n("J4", "joint"),
      n("I1", "idu", HEAD[125]),
      n("I2", "idu", HEAD[100]),
      n("I3", "idu", HEAD[40]),
      n("I4", "idu", HEAD[32]),
      n("I5", "idu", HEAD[63]),
    ],
    sections: [
      s("A", "OU", "J1", 40),
      s("a", "J1", "I1", 10),
      s("B", "J1", "J2", 10),
      s("b", "J2", "I2", 5),
      s("C", "J2", "J3", 15),
      s("c", "J3", "I3", 10),
      s("D", "J3", "J4", 10),
      s("d", "J4", "I4", 10),
      s("e", "J4", "I5", 10),
    ],
  };
}

describe("golden D2: MEES21K029 p.144 as a tree", () => {
  const sized = sizeVrfTree(pack, odu("PUHY-P350YNW-A1"), page144());
  const liquid = Object.fromEntries(sized.sections.map((s) => [s.id, s.liquidMm]));

  it("lands on every liquid size the book prints", () => {
    expect(liquid).toEqual({ A: 12.7, a: 9.52, B: 9.52, b: 9.52, C: 9.52, c: 6.35, D: 9.52, d: 9.52, e: 12.7 });
    expect(sized.findings).toEqual([]);
  });

  it("d and e are the book's step-ups: B+C+D+d and B+C+D+e are 45 m past the first joint", () => {
    expect(sized.sections.filter((s) => s.upsized).map((s) => s.id).sort()).toEqual(["d", "e"]);
  });

  it("the sized tree's charge is the book's 12.5 kg", () => {
    expect(sized.liquidM).toEqual({ "12.7": 50, "9.52": 60, "6.35": 10 });
    const rule = pack.vrf_pipe_tables[0].additional_charge as Extract<
      AdditionalChargeRule,
      { method: "per_meter_by_liquid_size_by_farthest" }
    >;
    const g = evaluateVrfCharge(rule, {
      liquidM: sized.liquidM,
      farthestM: sized.farthestM!,
      connectedIndex: 125 + 100 + 40 + 32 + 63,
      oduModel: "PUHY-P350YNW-A1",
      iduModels: [],
    });
    expect(g).toBe(12500);
  });

  it("gas sizes and joints are the p.140 tables (lookups, not printed in the example)", () => {
    const gas = Object.fromEntries(sized.sections.map((s) => [s.id, s.gasMm]));
    // A is the P350's own connection; B carries P235, C P135, D P95
    expect(gas).toEqual({ A: 28.58, a: 15.88, B: 22.2, b: 15.88, C: 15.88, c: 12.7, D: 15.88, d: 12.7, e: 15.88 });
    const parts = Object.fromEntries(sized.fittings.map((f) => [f.nodeId, f.part]));
    // J1 is the first joint: by outdoor (Table 4-2); the rest by downstream index
    expect(parts).toEqual({ J1: "CMY-Y102LS-G2", J2: "CMY-Y102LS-G2", J3: "CMY-Y102SS-G2", J4: "CMY-Y102SS-G2" });
  });
});

describe("the provisional tree (the zones in list order, nothing drawn)", () => {
  it("is a joint per head but the last, sized with no step-ups and no lengths", () => {
    const heads = [125, 100, 140].map((p, i) => ({ id: `h${i}`, model: HEAD[p] }));
    const tree = provisionalVrfTree("OU", heads);
    expect(tree.nodes.filter((n) => n.kind === "joint")).toHaveLength(2);
    const sized = sizeVrfTree(pack, odu("PUHY-P300YNW-A1"), tree);
    expect(sized.drawn).toBe(false);
    expect(sized.farthestM).toBeNull();
    expect(sized.sections.some((s) => s.upsized)).toBe(false);
    const main = sized.sections.find((s) => s.role === "main")!;
    expect([main.liquidMm, main.gasMm]).toEqual([9.52, 22.2]); // P300's own connection
    // the second joint carries P240 (P100 + P140): Table 2 P201-P300
    const between = sized.sections.find((s) => s.role === "between")!;
    expect([between.downstreamIndex, between.liquidMm, between.gasMm]).toEqual([240, 9.52, 22.2]);
    expect(sized.fittings.map((f) => f.part)).toEqual(["CMY-Y102LS-G2", "CMY-Y102LS-G2"]);
  });

  it("one head hangs straight off the outdoor, with no joint", () => {
    const tree = provisionalVrfTree("OU", [{ id: "h", model: HEAD[125] }]);
    const sized = sizeVrfTree(pack, odu("PUHY-P200YNW-A1"), tree);
    expect(sized.fittings).toEqual([]);
    expect(sized.sections.map((s) => s.role)).toEqual(["main"]);
  });
});

describe("the rules around fittings", () => {
  const n = (id: string, kind: "odu" | "joint" | "idu", model?: string) => ({ id, kind, model });

  it("three or more branches at a point make a header, chosen by branches and index", () => {
    const tree: VrfTree = {
      provisional: false,
      nodes: [n("OU", "odu"), n("H", "joint"), n("a", "idu", HEAD[40]), n("b", "idu", HEAD[40]), n("c", "idu", HEAD[63])],
      sections: [
        { id: "A", from: "OU", to: "H", lengthM: 20 },
        { id: "1", from: "H", to: "a", lengthM: 5 },
        { id: "2", from: "H", to: "b", lengthM: 5 },
        { id: "3", from: "H", to: "c", lengthM: 5 },
      ],
    };
    const sized = sizeVrfTree(pack, odu("PUHY-P200YNW-A1"), tree);
    expect(sized.fittings).toEqual([
      expect.objectContaining({ kind: "header", part: "CMY-Y104-G", branches: 3, downstreamIndex: 143 }),
    ]);
    expect(sized.findings).toEqual([]);
    // the P250 cannot take a CMY-Y104-G directly (Table 5)
    const on250 = sizeVrfTree(pack, odu("PUHY-P250YNW-A1"), tree);
    expect(on250.findings.map((f) => f.code)).toEqual(["header-not-direct"]);
  });

  it("nothing branches after a header", () => {
    const tree: VrfTree = {
      provisional: false,
      nodes: [n("OU", "odu"), n("H", "joint"), n("J", "joint"), ...["a", "b", "c", "d"].map((id) => n(id, "idu", HEAD[40]))],
      sections: [
        { id: "A", from: "OU", to: "H", lengthM: 10 },
        { id: "1", from: "H", to: "a", lengthM: 5 },
        { id: "2", from: "H", to: "b", lengthM: 5 },
        { id: "3", from: "H", to: "J", lengthM: 5 },
        { id: "4", from: "J", to: "c", lengthM: 5 },
        { id: "5", from: "J", to: "d", lengthM: 5 },
      ],
    };
    const codes = sizeVrfTree(pack, odu("PUHY-P200YNW-A1"), tree).findings.map((f) => f.code);
    expect(codes).toContain("branch-after-header");
  });

  it("a head more than 90 m past the first joint is red", () => {
    const tree = page144();
    tree.sections = tree.sections.map((s) => (s.id === "e" ? { ...s, lengthM: 60 } : s));
    const codes = sizeVrfTree(pack, odu("PUHY-P350YNW-A1"), tree).findings.map((f) => f.code);
    expect(codes).toEqual(["after-first-joint-over"]);
  });

  it("the P300's main steps up to 12.7 once the farthest head is 40 m out (Table 1 *2)", () => {
    const tree = page144();
    const sized = sizeVrfTree(pack, odu("PUHY-P300YNW-A1"), tree);
    expect(sized.farthestM).toBe(85);
    expect(sized.sections.find((s) => s.id === "A")!.liquidMm).toBe(12.7);
  });
});

describe("the book's limits on a drawn tree (p.140) and the charge (p.143-144)", () => {
  const withSection = (tree: VrfTree, id: string, patch: Partial<VrfTree["sections"][number]>): VrfTree => ({
    ...tree,
    sections: tree.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
  });
  const codes = (tree: VrfTree, model = "PUHY-P350YNW-A1") =>
    sizeVrfTree(pack, odu(model), tree).findings.map((f) => f.code);

  it("p.144 as drawn: 120 m in all, 85 m to the farthest head, and the charge is the book's 12.5 kg", () => {
    const sized = sizeVrfTree(pack, odu("PUHY-P350YNW-A1"), page144());
    expect(sized.totalM).toBe(120);
    expect(sized.farthestM).toBe(85);
    expect(sized.chargeG).toBe(12500);
    expect(sized.findings).toEqual([]);
  });

  it("the farthest head past 165 m actual is red", () => {
    expect(codes(withSection(page144(), "A", { lengthM: 150 }))).toContain("farthest-over");
  });

  it("inside 165 m actual but past 190 m counting M per bend is red (P350: 0.47 m a bend)", () => {
    // A 120 m: 165 m actual exactly; 60 bends add 28.2 m → 193.2 m
    const t = withSection(page144(), "A", { lengthM: 120, bends: 60 });
    const sized = sizeVrfTree(pack, odu("PUHY-P350YNW-A1"), t);
    expect(sized.farthestM).toBe(165);
    expect(sized.farthestEquivM).toBeCloseTo(193.2);
    expect(sized.findings.map((f) => f.code)).toEqual(["farthest-equiv-over"]);
  });

  it("the outdoor more than 50 m above its heads, or 40 m below them, is red", () => {
    expect(codes(withSection(page144(), "A", { riseM: -55 }))).toEqual(["outdoor-above-over"]);
    expect(codes(withSection(page144(), "A", { riseM: 45 }))).toEqual(["outdoor-below-over"]);
    expect(codes(withSection(page144(), "A", { riseM: -45 }))).toEqual([]);
  });

  it("heads more than 15 m above the base level take their own liquid one size up (5b); past 30 m is red", () => {
    // B, C, D shortened so the 40 m rule (5a) does not step anything up first
    let t = page144();
    for (const id of ["B", "C", "D"]) t = withSection(t, id, { lengthM: 5 });
    const flat = sizeVrfTree(pack, odu("PUHY-P350YNW-A1"), t);
    expect(flat.sections.some((s) => s.upsized)).toBe(false);
    const up20 = sizeVrfTree(pack, odu("PUHY-P350YNW-A1"), withSection(t, "D", { riseM: 20 }));
    const liquid = Object.fromEntries(up20.sections.map((s) => [s.id, s.liquidMm]));
    // d (P32) 6.35 → 9.52, e (P63) 9.52 → 12.7; D itself and the base heads stay
    expect([liquid.d, liquid.e, liquid.D, liquid.c]).toEqual([9.52, 12.7, 9.52, 6.35]);
    expect(up20.findings).toEqual([]);
    expect(codes(withSection(t, "D", { riseM: 35 }))).toEqual(["head-height-over"]);
  });

  it("a charge past the outdoor's maximum is red (P200: 6.5 kg in it, 22.4 kg at most)", () => {
    // a CMY-Y108-G header straight off a P200 with eight P25s 100 m out:
    // 800 m of 6.35 alone is 16.8 kg on the 6.5 already in it
    const n = (id: string, kind: "odu" | "joint" | "idu", model?: string) => ({ id, kind, model });
    const p25 = pack.indoor_units.find((u) => u.capacity_index === 25 && u.system_roles?.includes("vrf"))!.model;
    const heads = Array.from({ length: 8 }, (_, i) => `h${i}`);
    const tree: VrfTree = {
      provisional: false,
      nodes: [n("OU", "odu"), n("H", "joint"), ...heads.map((h) => n(h, "idu", p25))],
      sections: [
        { id: "A", from: "OU", to: "H", lengthM: 10 },
        ...heads.map((h) => ({ id: h, from: "H", to: h, lengthM: 100 })),
      ],
    };
    const sized = sizeVrfTree(pack, odu("PUHY-P200YNW-A1"), tree);
    expect(sized.fittings[0]).toEqual(expect.objectContaining({ kind: "header", part: "CMY-Y108-G" }));
    expect(sized.findings.map((f) => f.code)).toContain("charge-over");
  });
});
