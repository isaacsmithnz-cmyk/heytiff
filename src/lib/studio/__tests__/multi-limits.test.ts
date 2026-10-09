/* The multi limits a book prints beside (or instead of) its combination
   table: a head count, a connected total, a cap on heads of a kind, sets it
   rules out, and the height between heads. Each is optional data on the
   outdoor's rule; each is pinned here to the book form it represents, to
   "absent changes nothing", and to Mitsubishi Electric's 3,931 listed
   combinations passing exactly as before. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  PACK_SECTIONS,
  type CompatibilityRule,
  type DataPack,
  type IndoorUnit,
  type MultiRule,
  type OutdoorUnit,
  type PackMeta,
} from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignDocument, type DesignObject, type DesignSystem } from "../document";
import {
  checkBlock,
  checkMultiCompatibility,
  multiCapableIdus,
  proposeMultiOdus,
  tableStanding,
} from "../multi";
import { outdoorsListing } from "../builder";
import { systemFindings } from "../verdict";

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

/* ── a head of any brand, as a pack row would carry it ── */
function head(model: string, code: number, opts: Partial<IndoorUnit> = {}): IndoorUnit {
  return {
    model,
    brand: "acme",
    series: "S",
    form_factor: "wall",
    capacity_cool_kw: code / 10,
    capacity_heat_kw: code / 10 + 0.5,
    capacity_code: code,
    conn_liquid_mm: 6.35,
    conn_gas_mm: 9.52,
    default_plane: "room",
    allowed_planes: ["room"],
    system_roles: ["multi"],
    refrigerant: "R32",
    width_mm: 800,
    depth_mm: 250,
    height_mm: 300,
    provenance: { kind: "extracted", source: "test" },
    ...opts,
  };
}
const ODU = { model: "ODU-1", ports: 5 } as OutdoorUnit;
const codes = (findings: { code: string }[]) => findings.map((f) => f.code);
const block = (c: CompatibilityRule, idus: IndoorUnit[], table = { accepts: false, lists: false }) =>
  checkBlock(c, ODU, idus, table);

/* ═══════════ Mitsubishi Electric: nothing new fires, the table still rules ═══════════ */

describe("Mitsubishi Electric's 3,931 listed combinations", () => {
  /* every listed combo, built from a head the outdoor's rule accepts at each
     size class. The guide lists 15 and 22 classes the pack has no indoor row
     for: those stand in as a 2.0's row carrying the class, which is all the
     table reads. */
  const listed = pack.multi_rules.flatMap((rule) => {
    const odu = pack.outdoor_units.find((o) => o.model === rule.odu_model_ref)!;
    const byCode = new Map<number, IndoorUnit>();
    for (const u of multiCapableIdus(pack, [rule]).sort((a, b) => a.model.localeCompare(b.model)))
      if (u.capacity_code != null && !byCode.has(u.capacity_code)) byCode.set(u.capacity_code, u);
    const table = rule.compatibility.find((b) => b.method === "capacity_combination_table");
    if (table?.method !== "capacity_combination_table") throw new Error("ME rule without its table");
    const at = (code: number): IndoorUnit => {
      const own = byCode.get(code);
      if (own) return own;
      const stand = byCode.get(20)!;
      return { ...stand, capacity_code: code, capacity_cool_kw: code / 10 };
    };
    return table.combos.map((combo) => ({ rule, odu, set: combo.map(at) }));
  });

  it("are 3,931, and the pack carries none of the new limits", () => {
    expect(listed).toHaveLength(3931);
    const NEW = ["head_count", "connected_capacity", "max_matching", "excluded_combinations"];
    for (const r of pack.multi_rules) {
      expect(r.compatibility.filter((b) => NEW.includes(b.method))).toEqual([]);
      expect(r.max_lift_idu_idu_m).toBeUndefined();
    }
  });

  it("every one passes on its outdoor with no finding at all", () => {
    for (const { rule, odu, set } of listed) {
      expect(set.every(Boolean)).toBe(true);
      expect(checkMultiCompatibility(rule, odu, set)).toEqual([]);
    }
  });

  /* the table is the capacity authority: a count or a total the book prints
     beside it can never refuse a set it lists, however tight */
  it("a head count and a connected total added to every rule refuse none of them", () => {
    for (const { rule, odu, set } of listed) {
      const tight: MultiRule = {
        ...rule,
        compatibility: [
          ...rule.compatibility,
          { method: "head_count", min: 6, max: 1 },
          { method: "connected_capacity", basis: "class_kw", min: 99, max: 1 },
        ],
      };
      expect(checkMultiCompatibility(tight, odu, set)).toEqual([]);
    }
  });
});

/* ═══════════ head_count ═══════════ */

describe("head_count", () => {
  /* Daikin Super Multi NX: "A single indoor unit cannot be connected for the
     reverse cycle type" (PCRAU1729B p.58 note 4) */
  const daikin: CompatibilityRule = { method: "head_count", min: 2 };

  it("Daikin: one head is under the minimum (amber — the set can grow), two are fine", () => {
    expect(block(daikin, [head("FTXM25R", 25)])).toEqual([
      { severity: "amber", code: "under-min-count", message: "1 indoor unit — ODU-1 needs at least 2" },
    ]);
    expect(block(daikin, [head("FTXM25R", 25), head("FTXM35R", 35)])).toEqual([]);
    expect(block(daikin, [])).toEqual([]);
  });

  it("over its maximum is red", () => {
    const five = Array.from({ length: 5 }, (_, i) => head(`H${i}`, 25));
    expect(codes(block({ method: "head_count", min: 3, max: 4 }, five))).toEqual(["over-max-count"]);
  });

  it("a table that accepts the set overrules the maximum, one that lists it the minimum", () => {
    const five = Array.from({ length: 5 }, (_, i) => head(`H${i}`, 25));
    expect(block({ method: "head_count", max: 4 }, five, { accepts: true, lists: false })).toEqual([]);
    expect(block(daikin, [head("A", 25)], { accepts: true, lists: false })).toHaveLength(1); // partial: still under
    expect(block(daikin, [head("A", 25)], { accepts: true, lists: true })).toEqual([]);
  });

  /* MHI SCM100ZS-W (compatibility chart, Jan 2026): normally 3 to 5 heads;
     two only as 2 × SRK-ZSXA, 1 × SRK-ZSXA + 1 × SRF35ZS, or with an
     SRK71/80ZRA (DXK24/28ZRA) and any other */
  const ZSXA = ["SRK20ZSXA*", "SRK25ZSXA*", "SRK35ZSXA*", "SRK50ZSXA*", "SRK60ZSXA*"];
  const BRONTE_BIG = ["SRK71ZRA*", "SRK80ZRA*", "DXK24ZRA*", "DXK28ZRA*"];
  const scm100: CompatibilityRule = {
    method: "head_count",
    min: 3,
    max: 5,
    fewer_allowed: [
      [{ models: ZSXA }, { models: ZSXA }],
      [{ models: ZSXA }, { models: ["SRF35ZS*"] }],
      [{ models: BRONTE_BIG }, {}],
    ],
  };

  it.each([
    ["2 × SRK-ZSXA", [head("SRK35ZSXA-W", 35), head("SRK60ZSXA-WF", 60)]],
    ["SRF35ZS + SRK-ZSXA, either way round", [head("SRF35ZS-W", 35), head("SRK25ZSXA-W", 25)]],
    ["an SRK80ZRA with any head", [head("FDTC25VH1", 25), head("SRK80ZRA-W", 80)]],
  ])("MHI SCM100: two heads are allowed as %s", (_what, set) => {
    expect(block(scm100, set)).toEqual([]);
  });

  it("MHI SCM100: two other heads are under its minimum of 3", () => {
    expect(codes(block(scm100, [head("SRK25ZSA-W", 25), head("SRK25ZSA-W", 25)]))).toEqual(["under-min-count"]);
    // SRF50 is not the SRF35 the chart names
    expect(codes(block(scm100, [head("SRF50ZSX-W", 50), head("SRK25ZSXA-W", 25)]))).toEqual(["under-min-count"]);
    // one head never matches a two-head entry
    expect(codes(block(scm100, [head("SRK80ZRA-W", 80)]))).toEqual(["under-min-count"]);
  });
});

/* ═══════════ connected_capacity ═══════════ */

describe("connected_capacity", () => {
  /* Daikin 4MXM80: "Total capacity of connected indoor units is … up to the
     14.5 kW" (PCRAU1729B p.58 note 3), on the size classes ("2.5 kW Class") */
  const mxm80: CompatibilityRule = { method: "connected_capacity", basis: "class_kw", max: 14.5 };

  it("Daikin 4MXM80: 14.5 kW of classes is in, 15.0 kW is red", () => {
    expect(block(mxm80, [head("A", 25), head("B", 35), head("C", 50), head("D", 35)])).toEqual([]);
    expect(block(mxm80, [head("A", 50), head("B", 50), head("C", 50)])).toEqual([
      {
        severity: "red",
        code: "over-connected",
        message: "The heads come to 15 kW connected — ODU-1 takes up to 14.5 kW",
      },
    ]);
  });

  it("reads the class, not the rating: a 4.6 class rated 4.2 kW counts 4.6", () => {
    const set = [head("A", 46, { capacity_cool_kw: 4.2 }), head("B", 50), head("C", 50)];
    expect(codes(block(mxm80, set))).toEqual(["over-connected"]); // 14.6
    expect(block({ ...mxm80, basis: "rated_cool_kw" }, set)).toEqual([]); // 14.2
  });

  /* MHI SCM100: "total indoor units connection capacity is from 9.0kW ~ 16.0kW" */
  const scm100: CompatibilityRule = { method: "connected_capacity", basis: "class_kw", min: 9, max: 16 };

  it("MHI SCM100: under 9.0 kW is amber, the bounds themselves are in", () => {
    expect(codes(block(scm100, [head("A", 20), head("B", 25), head("C", 35)]))).toEqual(["under-connected"]);
    expect(block(scm100, [head("A", 20), head("B", 35), head("C", 35)])).toEqual([]); // 9.0
    expect(block(scm100, [head("A", 80), head("B", 80)])).toEqual([]); // 16.0
  });

  it("the table stands over both bounds", () => {
    const set = [head("A", 50), head("B", 50), head("C", 50)];
    expect(block(mxm80, set, { accepts: true, lists: false })).toEqual([]);
    expect(block(scm100, [head("A", 20), head("B", 20)], { accepts: true, lists: true })).toEqual([]);
  });

  it("says so rather than guessing when a head has no size class", () => {
    expect(codes(block(mxm80, [head("A", 25, { capacity_code: undefined })]))).toEqual(["capacity-code-unknown"]);
  });
});

/* ═══════════ max_matching ═══════════ */

describe("max_matching", () => {
  const mtap = (code: number) => head(`ARTH${code}KMTAP`, code, { form_factor: "ducted" });
  const wall = (code: number) => head(`ASTH${String(code).padStart(2, "0")}KMTD`, code);

  /* Fujitsu AOTH36/45KBTA5: "Up to 2 units of Medium static pressure duct are
     connectable to the combination. However, in the combination marked with
     *, only 1" (DR_MU034ES_01 f.10, f.16) */
  const kbta5: CompatibilityRule = {
    method: "max_matching",
    match: { models: ["ARTH18KMTAP", "ARTH24KMTAP"] },
    max: 2,
    in_combos: [{ combo: [9, 9, 12, 18, 18], max: 1 }],
    label: "medium-static ducted heads",
  };

  it("Fujitsu KBTA5: two medium-static heads are in, three are red", () => {
    expect(block(kbta5, [mtap(18), mtap(24), wall(9)])).toEqual([]);
    expect(block(kbta5, [mtap(18), mtap(18), mtap(24), wall(9)])).toEqual([
      {
        severity: "red",
        code: "over-matching",
        message: "3 medium-static ducted heads — ODU-1 takes up to 2",
      },
    ]);
  });

  it("a combination marked * takes its own limit, exactly that set only", () => {
    const starred = [mtap(18), mtap(18), wall(9), wall(9), wall(12)];
    expect(block(kbta5, starred)[0].message).toBe("2 medium-static ducted heads — ODU-1 takes up to 1 in this combination");
    // the same two ducted heads in a set still being built: the general 2
    expect(block(kbta5, [mtap(18), mtap(18), wall(9)])).toEqual([]);
  });

  /* AOTH24KBCA3 combos 19, 23 and 30 (7+7+18*, 7+9+18*, 9+9+18*): "Medium
     static pressure duct type indoor unit is not connectable" (f.3) */
  const kbca3: CompatibilityRule = {
    method: "max_matching",
    match: { models: ["ARTH18KMTAP"] },
    in_combos: [
      { combo: [7, 7, 18], max: 0 },
      { combo: [7, 9, 18], max: 0 },
      { combo: [9, 9, 18], max: 0 },
    ],
    label: "medium-static ducted",
  };

  it("Fujitsu KBCA3: no medium-static head in a starred combo, fine in the others", () => {
    expect(block(kbca3, [wall(7), wall(7), mtap(18)])).toEqual([
      {
        severity: "red",
        code: "over-matching",
        message: "ODU-1 can't take a medium-static ducted head in this combination",
      },
    ]);
    expect(block(kbca3, [wall(7), mtap(18)])).toEqual([]); // combo 5
    expect(block(kbca3, [wall(7), wall(7), head("ASTH18KMTD", 18)])).toEqual([]);
  });

  /* MHI SCM100: "5 [units]: SRK-ZSXA-W/WF, SRF35ZS-W, SRF50ZSX-W must be 4 or less" */
  const scm100: CompatibilityRule = {
    method: "max_matching",
    match: { models: ["SRK20ZSXA*", "SRK25ZSXA*", "SRK35ZSXA*", "SRK50ZSXA*", "SRK60ZSXA*", "SRF35ZS*", "SRF50ZSX*"] },
    max: 4,
    from_heads: 5,
  };

  it("MHI SCM100: four of them in a five-head set, never five; four heads aren't judged", () => {
    const zsxa = (n: number) => Array.from({ length: n }, () => head("SRK20ZSXA-W", 20));
    expect(block(scm100, [...zsxa(4), head("SRK25ZSA-W", 25)])).toEqual([]);
    expect(codes(block(scm100, [...zsxa(4), head("SRF35ZS-W", 35)]))).toEqual(["over-matching"]);
    expect(block(scm100, zsxa(4))).toEqual([]);
  });

  it("matches on form factor too, and every criterion given must hold", () => {
    const ducted: CompatibilityRule = { method: "max_matching", match: { form_factors: ["ducted"] }, max: 1 };
    expect(codes(block(ducted, [mtap(18), mtap(24)]))).toEqual(["over-matching"]);
    const both: CompatibilityRule = {
      method: "max_matching",
      match: { models: ["ARTH18*"], form_factors: ["ducted"] },
      max: 0,
    };
    expect(block(both, [mtap(24), head("ARTH18KLLAP", 18, { form_factor: "bulkhead" })])).toEqual([]);
  });
});

/* ═══════════ excluded_combinations ═══════════ */

describe("excluded_combinations", () => {
  /* MHI SCM100: "Combination of indoor units that are Not Possible" */
  const scm100: CompatibilityRule = {
    method: "excluded_combinations",
    combos: [
      [20, 20, 20, 20, 71],
      [20, 20, 20, 20, 80],
      [20, 20, 20, 25, 71],
      [20, 20, 20, 50, 50],
    ],
  };
  const of = (...cs: number[]) => cs.map((c, i) => head(`H${i}`, c));

  it("refuses a set that is exactly one of them, in any order", () => {
    expect(block(scm100, of(71, 20, 20, 20, 20))).toEqual([
      {
        severity: "red",
        code: "excluded-combination",
        message: "20 + 20 + 20 + 20 + 71 is a combination ODU-1's book rules out",
      },
    ]);
    expect(codes(block(scm100, of(50, 20, 50, 20, 20)))).toEqual(["excluded-combination"]);
  });

  it("leaves a set that can still grow past them, and the sets beside them", () => {
    expect(block(scm100, of(20, 20, 20, 20))).toEqual([]);
    expect(block(scm100, of(20, 20, 20, 25, 80))).toEqual([]);
  });
});

/* ═══════════ how the rule composes them ═══════════ */

describe("checkMultiCompatibility with the new limits", () => {
  const rule = (compatibility: CompatibilityRule[]): MultiRule => ({
    odu_model_ref: "ODU-1",
    port_pipe_sizes: [],
    compatibility,
    max_total_pipe_m: 70,
    max_per_branch_m: 25,
    max_lift_m: 15,
    additional_charge: { method: "none_required" },
    provenance: { kind: "extracted", source: "test" },
  });

  it("tableStanding: accepts what can grow into a combo, lists only the combo itself", () => {
    const r = rule([{ method: "capacity_combination_table", combos: [[25, 35, 50]] }]);
    expect(tableStanding(r, [head("A", 35), head("B", 25)])).toEqual({ accepts: true, lists: false });
    expect(tableStanding(r, [head("A", 50), head("B", 35), head("C", 25)])).toEqual({ accepts: true, lists: true });
    expect(tableStanding(r, [head("A", 60)])).toEqual({ accepts: false, lists: false });
    expect(tableStanding(rule([]), [head("A", 25)])).toEqual({ accepts: false, lists: false });
  });

  it("the per-model exceptions apply on top of a table that lists the set", () => {
    const r = rule([
      { method: "capacity_combination_table", combos: [[20, 20, 20, 20, 71]] },
      { method: "excluded_combinations", combos: [[20, 20, 20, 20, 71]] },
    ]);
    const set = [20, 20, 20, 20, 71].map((c, i) => head(`H${i}`, c));
    expect(codes(checkMultiCompatibility(r, ODU, set))).toEqual(["excluded-combination"]);
  });

  it("two blocks that can't read a size class say so once", () => {
    const r = rule([
      { method: "capacity_combination_table", combos: [[25, 35]] },
      { method: "excluded_combinations", combos: [[25, 25]] },
    ]);
    expect(codes(checkMultiCompatibility(r, ODU, [head("A", 25, { capacity_code: undefined })]))).toEqual([
      "capacity-code-unknown",
    ]);
  });

  it("a kind the outdoor never takes is not offered as one of its heads", () => {
    const p: DataPack = {
      ...pack,
      indoor_units: [head("WALL25", 25), head("DUCT25", 25, { form_factor: "ducted" })],
      multi_rules: [
        rule([
          { method: "family_whitelist_with_limits", families: ["WALL", "DUCT"] },
          { method: "max_matching", match: { form_factors: ["ducted"] }, max: 0 },
          { method: "head_count", min: 2 },
          { method: "excluded_combinations", combos: [[25, 25]] },
        ]),
      ],
    };
    expect(multiCapableIdus(p).map((u) => u.model)).toEqual(["WALL25"]);
  });
});

/* ═══════════ the system: picker, proposal, verdict, height ═══════════ */

describe("a Daikin-shaped multi in the builder", () => {
  /* the real ME pack with MXZ-2F52VF's rule given a two-head minimum and a
     height between heads — the ME units stand in for a brand that prints
     both; nothing about ME is being claimed */
  const ODU2 = "MXZ-2F52VF";
  const withLimits = (extra: Partial<MultiRule>, blocks: CompatibilityRule[] = []): DataPack => ({
    ...pack,
    multi_rules: pack.multi_rules.map((r) =>
      r.odu_model_ref === ODU2 ? { ...r, ...extra, compatibility: [...r.compatibility, ...blocks] } : r
    ),
  });
  /* ME's table lists one-head sets; a Daikin table doesn't (#1087 retracted
     them: "A single indoor unit cannot be connected") — so the stand-in's
     table loses its singles, else it would rightly overrule the minimum */
  const noSingles = (r: MultiRule): CompatibilityRule[] =>
    r.compatibility.map((b) =>
      b.method === "capacity_combination_table" ? { ...b, combos: b.combos.filter((c) => c.length > 1) } : b
    );
  const minTwo: DataPack = {
    ...pack,
    multi_rules: pack.multi_rules.map((r) =>
      r.odu_model_ref === ODU2
        ? { ...r, compatibility: [...noSingles(r), { method: "head_count" as const, min: 2 }] }
        : r
    ),
  };
  const unit = (m: string) => pack.indoor_units.find((u) => u.model === m)!;

  function doc(heads: string[], placed: { id: string; floor: 0 | 1; mountM?: number }[] = []): {
    d: DesignDocument;
    sys: DesignSystem;
  } {
    const d = createDesign({ name: "t", mode: "blank", now: "2026-10-09T00:00:00.000Z" });
    d.floors = [
      { id: "f0", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] },
      { id: "f1", name: "Level 1", level: 1, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] },
    ];
    const sys: DesignSystem = {
      id: "sys",
      type: "multi-split",
      brand: "mitsubishi-electric",
      colour: "#2E68FF",
      name: "Multi",
      settings: {
        allocations: [
          { id: "o1", role: "odu", model: ODU2, roomId: null },
          ...heads.map((m, i) => ({ id: `h${i + 1}`, role: "idu", model: m, roomId: `r${i + 1}` })),
        ],
      },
    };
    d.systems = [sys];
    d.objects = placed.map(
      (p): DesignObject => ({
        id: p.id,
        type: "unit",
        systemId: "sys",
        floorId: p.floor === 0 ? "f0" : "f1",
        geometry: { kind: "point", at: { x: 0, y: 0 } },
        plane: "room",
        props: { role: "idu", model: heads[Number(p.id.slice(1)) - 1], ...(p.mountM != null ? { mountM: p.mountM } : {}) },
      })
    );
    return { d, sys };
  }

  it("a lone head: proposed the outdoor (it can grow), the picker says Fails, the verdict holds it", () => {
    const one = [unit("MSZ-AP25VGD2")];
    expect(outdoorsListing(minTwo, one, { proposing: true }).map((o) => o.model)).toContain(ODU2);
    expect(outdoorsListing(minTwo, one).map((o) => o.model)).not.toContain(ODU2);
    // ME as shipped, with no minimum: unchanged
    expect(outdoorsListing(pack, one).map((o) => o.model)).toContain(ODU2);

    const { d, sys } = doc(["MSZ-AP25VGD2"]);
    expect(systemFindings(d, minTwo, sys)).toEqual([
      {
        severity: "red",
        code: "under-min-count",
        message: `1 indoor unit — ${ODU2} needs at least 2`,
        fix: "Add a head, or make this zone a split",
      },
    ]);
    expect(systemFindings(d, pack, sys)).toEqual([]);
  });

  it("two heads pass; a quote's finished set is never fitted under a minimum", () => {
    const { d, sys } = doc(["MSZ-AP25VGD2", "MSZ-AP25VGD2"]);
    expect(systemFindings(d, minTwo, sys)).toEqual([]);
    const fit = (p: DataPack, n: number) =>
      proposeMultiOdus(p, Array.from({ length: n }, () => unit("MSZ-AP25VGD2")), "cooling").find(
        (o) => o.odu.model === ODU2
      )!.fits;
    expect(fit(minTwo, 1)).toBe(false);
    expect(fit(minTwo, 2)).toBe(true);
    expect(fit(pack, 1)).toBe(true);
  });

  /* "7.5 m (between Indoor Units)" — EDTAU122219A */
  const height = withLimits({ max_lift_idu_idu_m: 2.5 });

  it("heads placed further apart in height than the book's figure are red, about the drawing", () => {
    const { d, sys } = doc(["MSZ-AP25VGD2", "MSZ-AP25VGD2"], [
      { id: "h1", floor: 0, mountM: 2.2 },
      { id: "h2", floor: 1, mountM: 2.2 },
    ]);
    expect(systemFindings(d, height, sys)).toEqual([
      {
        severity: "red",
        code: "head-height-over",
        drawing: true,
        message: `Two heads are 3 m apart in height, over ${ODU2}'s 2.5 m between indoor units`,
        fix: "Move a head, or put the far one on its own system",
      },
    ]);
    // absent: nothing checked
    expect(systemFindings(d, pack, sys)).toEqual([]);
  });

  it("within the figure, or with a head not on the plan, nothing", () => {
    const same = doc(["MSZ-AP25VGD2", "MSZ-AP25VGD2"], [
      { id: "h1", floor: 0, mountM: 2.2 },
      { id: "h2", floor: 0, mountM: 0.2 },
    ]);
    expect(systemFindings(same.d, height, same.sys)).toEqual([]); // 2.0 m
    const unplaced = doc(["MSZ-AP25VGD2", "MSZ-AP25VGD2"], [{ id: "h2", floor: 1, mountM: 2.2 }]);
    expect(systemFindings(unplaced.d, height, unplaced.sys)).toEqual([]);
  });
});
