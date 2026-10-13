/* A VRF sized by kW, not by capacity index — Fujitsu AIRSTAGE (#1141, the
   GENERAL design & technical manuals). The rows here are the PR's staged
   tables, written as a pack would hold them; the engine is generic, and ME's
   City Multi and PUMY goldens (vrf-tree.test.ts, pumy.test.ts) pin that the
   index path is unchanged.

   J-IV (DV_J4T068EF_09 f.06-18, 06-23, 06-24, 06-25): Table B by downstream
   kW 2.2–11.1 → 9.52/15.88, 11.2–23.2 → 9.52/19.05; Table C by model code
   07–14 → 6.35/12.70, 18–34 → 9.52/15.88, 36–54 → 9.52/19.05; tubes
   UTP-AX054A ≤ 19.6 kW, UTP-AX090A ≤ 28.0; farthest ≥ 90 m → main gas 19.05;
   outdoor → nearest ≥ 5 m, → first tube ≥ 3 m.
   J-IVL (DV_J4LT065EF_07 f.06-23, 06-24): > 110% → 10 HP main liquid 12.70;
   > 70 m to the first tube → 8/10 HP main 12.70/22.22; 07/09 branch gas
   12.70 past 20 m; ARXC060–096 only in its lineup (f.01-3…01-5). */

import type { DataPack, IndoorUnit, OutdoorUnit, Part, VrfPipeTable } from "../packs/schema";
import { emptyPack } from "../packs/schema";
import { indoorReadiness, outdoorReadiness, vrfCountsInKw } from "../packs/ready";
import { validatePack } from "../packs/validate";
import { sizeVrfTree, type VrfTree } from "../vrf-tree";
import { checkVrfSet } from "../vrf";

const prov = { kind: "extracted" as const, source: "AIRSTAGE J-IV Design & Technical Manual" };

function head(model: string, code: number, kw: number, form: IndoorUnit["form_factor"] = "wall"): IndoorUnit {
  return {
    model,
    brand: "fujitsu",
    series: model.slice(0, 4),
    form_factor: form,
    capacity_cool_kw: kw,
    capacity_heat_kw: kw + 0.3,
    capacity_code: code,
    conn_liquid_mm: 6.35,
    conn_gas_mm: 12.7,
    default_plane: "room",
    allowed_planes: ["room"],
    system_roles: ["vrf"],
    refrigerant: "R410A",
    width_mm: 900,
    depth_mm: 250,
    height_mm: 300,
    provenance: prov,
  };
}

function outdoor(model: string, kw: number, table: string, extra: Partial<OutdoorUnit> = {}): OutdoorUnit {
  return {
    model,
    brand: "fujitsu",
    series: model.slice(0, 3),
    system_type: "vrf",
    capacity_cool_kw: kw,
    capacity_heat_kw: kw + 1,
    phase: "1",
    conn_liquid_mm: 9.52,
    conn_gas_mm: 15.88,
    refrigerant: "R410A",
    ratio_min_pct: 50,
    ratio_max_pct: 150,
    ratio_basis: "kw",
    max_idus: 9,
    pipe_table_ref: table,
    width_mm: 970,
    depth_mm: 370,
    height_mm: 1428,
    provenance: prov,
    ...extra,
  };
}

const part = (part_type: Part["part_type"], model: string, extra: Partial<Part> = {}): Part => ({
  part_type,
  model,
  brand: "fujitsu",
  provenance: prov,
  ...extra,
});

const limits = {
  max_total_m: 180,
  max_farthest_actual_m: 120,
  max_after_first_joint_m: 40,
  max_lift_odu_above_m: 50,
  max_lift_odu_below_m: 40,
  max_lift_idu_idu_m: 15,
  min_odu_to_nearest_m: 5,
  min_odu_to_first_joint_m: 3,
};

const J4: VrfPipeTable = {
  series: "J-IV",
  pipe_sizing: {
    method: "size_by_downstream_kw",
    steps: [
      { kw_max: 11.1, liquid_mm: 9.52, gas_mm: 15.88 },
      { kw_max: 23.2, liquid_mm: 9.52, gas_mm: 19.05 },
    ],
  },
  /* Table C keys on the model code: a head with no index is read by it */
  branch_sizing: {
    method: "size_by_downstream_index",
    steps: [
      { index_max: 14, liquid_mm: 6.35, gas_mm: 12.7 },
      { index_max: 34, liquid_mm: 9.52, gas_mm: 15.88 },
      { index_max: 54, liquid_mm: 9.52, gas_mm: 19.05 },
    ],
  },
  joint_selection: {
    steps: [
      { kw_max: 19.6, part_ref: "UTP-AX054A" },
      { kw_max: 28.0, part_ref: "UTP-AX090A" },
    ],
  },
  header_selection: {
    steps: [
      { branches_max: 6, kw_max: 28.0, part_ref: "UTR-H0906L" },
      { branches_max: 8, kw_max: 28.0, part_ref: "UTR-H0908L" },
    ],
  },
  liquid_step_ups: [{ odus: ["AJT054LBLCH"], farthest_m_min: 90, gas_mm: 19.05, roles: ["main"] }],
  limits,
  additional_charge: {
    method: "per_meter_by_liquid_size_by_farthest",
    bands: [{ farthest_m_max: null, rates: { "6.35": 21, "9.52": 58 } }],
    round_up_g: 10,
  },
  provenance: prov,
};

const J4L: VrfPipeTable = {
  ...J4,
  series: "J-IVL",
  pipe_sizing: {
    method: "size_by_downstream_kw",
    steps: [
      { kw_max: 11.1, liquid_mm: 9.52, gas_mm: 15.88 },
      { kw_max: 13.9, liquid_mm: 9.52, gas_mm: 19.05 },
      { kw_max: 19.6, liquid_mm: 12.7, gas_mm: 19.05 },
      { kw_max: 28.0, liquid_mm: 12.7, gas_mm: 22.22 },
    ],
  },
  liquid_step_ups: [
    { odus: ["AJY090LELBH"], ratio_over_pct: 110, liquid_mm: 12.7, roles: ["main"] },
    { odus: ["AJY072LELBH", "AJY090LELBH"], to_first_joint_over_m: 70, liquid_mm: 12.7, gas_mm: 22.22, roles: ["main"] },
  ],
  branch_step_ups: [{ below_index: 12, own_over_m: 20, gas_mm: 12.7 }],
};

function fujitsu(): DataPack {
  const p = emptyPack({ brand: "fujitsu", version: "t", packSchemaVersion: 1, name: "t" });
  p.brands.push({ id: "fujitsu", name: "Fujitsu" });
  p.indoor_units = [
    head("ASYA07GACH", 7, 2.2),
    head("ASYA09GACH", 9, 2.8),
    head("ASYA12GACH", 12, 3.6),
    head("ASYA18GACH", 18, 5.6),
    head("ASYA24GACH", 24, 7.1),
    head("ARXC060GTEH", 60, 18.0, "ducted"),
    head("AUXA36GALH", 36, 10.0, "cassette-4way"),
  ];
  p.outdoor_units = [
    outdoor("AJT054LBLCH", 15.5, "J-IV", { vrf_head_families: ["ASYA*", "AUXA*"] }),
    outdoor("AJY072LELBH", 22.4, "J-IVL", { phase: "3", vrf_head_families: ["ASYA*", "ARXC*"] }),
    outdoor("AJY090LELBH", 28.0, "J-IVL", { phase: "3", vrf_head_families: ["ASYA*", "ARXC*"] }),
  ];
  p.parts = [
    part("joint", "UTP-AX054A", { max_kw: 19.6 }),
    part("joint", "UTP-AX090A", { max_kw: 28.0 }),
    part("header", "UTR-H0906L", { branches: 6, max_kw: 28.0 }),
    part("header", "UTR-H0908L", { branches: 8, max_kw: 28.0 }),
  ];
  p.vrf_pipe_tables = [J4, J4L];
  return p;
}
const pack = fujitsu();
const odu = (m: string) => pack.outdoor_units.find((o) => o.model === m)!;
const unit = (m: string) => pack.indoor_units.find((u) => u.model === m)!;

/* OU → J1 → heads; lengths in metres */
function tree(heads: { model: string; m: number }[], mainM = 10, opts: { header?: boolean } = {}): VrfTree {
  const nodes: VrfTree["nodes"] = [
    { id: "OU", kind: "odu" },
    { id: "J1", kind: "joint" },
    ...heads.map((h, i) => ({ id: `I${i + 1}`, kind: "idu" as const, model: h.model })),
  ];
  if (heads.length > 2 && !opts.header) {
    /* a chain of tubes, two ways each: J1 → I1 + J2 → I2 + I3 … */
    const sections: VrfTree["sections"] = [{ id: "A", from: "OU", to: "J1", lengthM: mainM }];
    let at = "J1";
    heads.forEach((h, i) => {
      const last = i === heads.length - 1;
      if (i > 0 && !last) {
        const j = `J${i + 1}`;
        nodes.push({ id: j, kind: "joint" });
        sections.push({ id: `B${i}`, from: at, to: j, lengthM: 5 });
        at = j;
      }
      sections.push({ id: `b${i}`, from: at, to: `I${i + 1}`, lengthM: h.m });
    });
    return { provisional: false, nodes, sections };
  }
  return {
    provisional: false,
    nodes,
    sections: [
      { id: "A", from: "OU", to: "J1", lengthM: mainM },
      ...heads.map((h, i) => ({ id: `b${i}`, from: "J1", to: `I${i + 1}`, lengthM: h.m })),
    ],
  };
}
const section = (t: ReturnType<typeof sizeVrfTree>, id: string) => t.sections.find((s) => s.id === id)!;

describe("a VRF head the book gives no capacity index", () => {
  it("is VRF-ready when every outdoor of its brand that takes it counts in kW", () => {
    expect(indoorReadiness(pack, unit("ASYA12GACH")).roles["vrf-idu"]).toBe(true);
    expect(vrfCountsInKw(pack, unit("ASYA12GACH"))).toBe(true);
    expect(outdoorReadiness(pack, odu("AJT054LBLCH")).roles["vrf-odu"]).toBe(true);
  });

  it("still needs its index where an outdoor that takes it counts by index", () => {
    const mixed: DataPack = {
      ...pack,
      outdoor_units: [...pack.outdoor_units, outdoor("AJX999", 20, "J-IV", { ratio_basis: "index", capacity_index: 200 })],
    };
    expect(indoorReadiness(mixed, unit("ASYA12GACH")).missing["vrf-idu"]).toContain("capacity_index");
    // a head no VRF outdoor of its brand takes proves nothing either
    const lonely = { ...unit("ASYA12GACH"), brand: "other" };
    expect(vrfCountsInKw(pack, lonely)).toBe(false);
  });

  it("the validator takes kW-keyed tubes and headers and the conditional sizes", () => {
    const res = validatePack(pack);
    expect(res.errors).toEqual([]);
  });
});

describe("tubes, headers and pipe sizes by downstream kW", () => {
  it("two heads, 9.2 kW downstream: UTP-AX054A, Table B 9.52/15.88 on the main's next section, Table C on each head", () => {
    const t = sizeVrfTree(pack, odu("AJT054LBLCH"), tree([{ model: "ASYA12GACH", m: 8 }, { model: "ASYA18GACH", m: 8 }]));
    expect(t.findings).toEqual([]);
    expect(t.fittings).toEqual([expect.objectContaining({ kind: "joint", part: "UTP-AX054A", downstreamKw: 9.2 })]);
    expect(section(t, "b0")).toMatchObject({ liquidMm: 6.35, gasMm: 12.7 }); // code 12
    expect(section(t, "b1")).toMatchObject({ liquidMm: 9.52, gasMm: 15.88 }); // code 18
  });

  it("past 19.6 kW the tube is UTP-AX090A, and between tubes Table B steps up", () => {
    const t = sizeVrfTree(
      pack,
      odu("AJY090LELBH"),
      tree([
        { model: "ASYA24GACH", m: 8 },
        { model: "ASYA24GACH", m: 8 },
        { model: "ASYA24GACH", m: 8 },
      ])
    );
    expect(t.fittings.map((f) => [f.part, f.downstreamKw])).toEqual([
      ["UTP-AX090A", 21.3],
      ["UTP-AX054A", 14.2],
    ]);
    // 14.2 kW is 12.70/19.05 in J-IVL Table B — and "B > A → A": never larger than the main
    expect(section(t, "B1")).toMatchObject({ liquidMm: 9.52, gasMm: 15.88 });
    const uncapped: DataPack = {
      ...pack,
      vrf_pipe_tables: pack.vrf_pipe_tables.map((x) => (x.series === "J-IVL" ? { ...x, downstream_not_larger: false } : x)),
    };
    const t2 = sizeVrfTree(
      uncapped,
      odu("AJY090LELBH"),
      tree([
        { model: "ASYA24GACH", m: 8 },
        { model: "ASYA24GACH", m: 8 },
        { model: "ASYA24GACH", m: 8 },
      ])
    );
    expect(section(t2, "B1")).toMatchObject({ liquidMm: 12.7, gasMm: 19.05 });
  });

  it("a header by kW and branches", () => {
    const t = sizeVrfTree(
      pack,
      odu("AJY090LELBH"),
      tree(
        [
          { model: "ASYA12GACH", m: 8 },
          { model: "ASYA12GACH", m: 8 },
          { model: "ASYA12GACH", m: 8 },
        ],
        10,
        { header: true }
      )
    );
    expect(t.fittings).toEqual([expect.objectContaining({ kind: "header", part: "UTR-H0906L", downstreamKw: 10.8 })]);
  });

  it("nothing in the book past its last tube says so in kW", () => {
    const small: DataPack = {
      ...pack,
      vrf_pipe_tables: pack.vrf_pipe_tables.map((t) =>
        t.series === "J-IV" ? { ...t, joint_selection: { steps: [{ kw_max: 5, part_ref: "UTP-AX054A" }] } } : t
      ),
    };
    const t = sizeVrfTree(small, odu("AJT054LBLCH"), tree([{ model: "ASYA12GACH", m: 8 }, { model: "ASYA18GACH", m: 8 }]));
    expect(t.findings).toContainEqual(expect.objectContaining({ code: "no-fitting-part", message: "No joint in the book for 9.2 kW" }));
  });
});

describe("the book's conditional sizes", () => {
  const two = (m: number, mainM = 10) => tree([{ model: "ASYA12GACH", m }, { model: "ASYA18GACH", m: 8 }], mainM);

  it("J-IV: farthest ≥ 90 m takes the main's gas to 19.05 on the outdoors named", () => {
    expect(section(sizeVrfTree(pack, odu("AJT054LBLCH"), two(79)), "A").gasMm).toBe(15.88); // 89 m
    expect(section(sizeVrfTree(pack, odu("AJT054LBLCH"), two(80)), "A")).toMatchObject({ gasMm: 19.05, liquidMm: 9.52 }); // 90 m
  });

  /* the cap is against the size ACTUALLY chosen upstream: an upsized main
     lets what follows it take its own size up to the new one (Table C gives
     a 36 9.52/19.05; with the main at 15.88 gas it was held to 15.88) */
  it("J-IV at 100 m: main gas 19.05, and an AUXA36 branch takes its own 19.05", () => {
    const far = (m: number) => tree([{ model: "AUXA36GALH", m }, { model: "ASYA12GACH", m: 8 }]);
    const t = sizeVrfTree(pack, odu("AJT054LBLCH"), far(90));
    expect(section(t, "A")).toMatchObject({ liquidMm: 9.52, gasMm: 19.05 });
    expect(section(t, "b0")).toMatchObject({ liquidMm: 9.52, gasMm: 19.05 });
    expect(section(t, "b1")).toMatchObject({ liquidMm: 6.35, gasMm: 12.7 }); // its own size, never raised
    // under 90 m the main stays 15.88 and the 36 is held to it
    const near = sizeVrfTree(pack, odu("AJT054LBLCH"), far(79));
    expect(section(near, "A").gasMm).toBe(15.88);
    expect(section(near, "b0").gasMm).toBe(15.88);
  });

  it("J-IVL: over 70 m to the first tube, the 10 HP main is 12.70/22.22", () => {
    expect(section(sizeVrfTree(pack, odu("AJY090LELBH"), two(8, 70)), "A")).toMatchObject({ liquidMm: 9.52, gasMm: 15.88 });
    expect(section(sizeVrfTree(pack, odu("AJY090LELBH"), two(8, 71)), "A")).toMatchObject({ liquidMm: 12.7, gasMm: 22.22 });
  });

  it("J-IVL: over 110% connected, the 10 HP main liquid is 12.70", () => {
    // 2 × 18.0 kW on 28.0 kW = 129%
    const big = tree([{ model: "ARXC060GTEH", m: 8 }, { model: "ARXC060GTEH", m: 8 }]);
    expect(section(sizeVrfTree(pack, odu("AJY090LELBH"), big), "A")).toMatchObject({ liquidMm: 12.7, gasMm: 15.88 });
  });

  it("J-IVL: a 07/09 head's own pipe past 20 m takes 12.70 gas; a 12 doesn't", () => {
    const t = sizeVrfTree(pack, odu("AJY090LELBH"), tree([{ model: "ASYA09GACH", m: 21 }, { model: "ASYA12GACH", m: 21 }]));
    expect(section(t, "b0")).toMatchObject({ liquidMm: 6.35, gasMm: 12.7 });
    const short = sizeVrfTree(pack, odu("AJY090LELBH"), tree([{ model: "ASYA07GACH", m: 20 }, { model: "ASYA12GACH", m: 8 }]));
    expect(section(short, "b0").gasMm).toBe(12.7); // Table C's own 12.70 for a 07 — the step-up never lowers it
  });

  it("the shortest pipe the book allows: 5 m to the nearest head, 3 m to the first tube", () => {
    const t = sizeVrfTree(pack, odu("AJT054LBLCH"), tree([{ model: "ASYA12GACH", m: 2 }, { model: "ASYA18GACH", m: 8 }], 2));
    expect(t.findings.filter((f) => f.code === "too-short").map((f) => f.message)).toEqual([
      "The nearest head is 4 m from the outdoor, under the book's 5 m",
      "The first joint is 2 m from the outdoor, under the book's 3 m",
    ]);
  });
});

describe("an outdoor's lineup", () => {
  it("ARXC060 joins the J-IVL, not the J-IV", () => {
    const set = [unit("ARXC060GTEH")];
    expect(checkVrfSet(pack, odu("AJT054LBLCH"), set).map((f) => f.code)).toContain("not-vrf-head");
    expect(checkVrfSet(pack, odu("AJY090LELBH"), set).map((f) => f.code)).not.toContain("not-vrf-head");
  });

  it("an outdoor naming no lineup takes every VRF head", () => {
    const open = { ...odu("AJT054LBLCH"), vrf_head_families: undefined };
    expect(checkVrfSet(pack, open, [unit("ASYA12GACH")]).map((f) => f.code)).not.toContain("not-vrf-head");
  });
});
