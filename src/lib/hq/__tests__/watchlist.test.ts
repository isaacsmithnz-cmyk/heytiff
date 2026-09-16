import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import {
  PACK_SECTIONS,
  emptyPack,
  type DataPack,
  type IndoorUnit,
  type PackMeta,
} from "@/lib/studio/packs/schema";
import {
  packWatchSignals,
  unextractedSources,
  unboundedMultiRules,
  unmatchedRuleReferences,
} from "../watchlist";

// fresh meta per pack — emptyPack() keeps the reference, and one test mutates
// meta.sources, so a shared const would leak between tests
function meta(): PackMeta {
  return {
    brand: "test",
    version: "1.0",
    packSchemaVersion: 1,
    name: "Test",
    sources: [
      { title: "M-P Series Data Book", edition: "M-P0922 (2024)" },
      { title: "PUMY-SP Data Book", edition: "M-P0860 (Oct 2022)" },
    ],
  };
}

function idu(model: string): IndoorUnit {
  return {
    model,
    brand: "test",
    series: "MSZ-AP",
    form_factor: "wall",
    capacity_cool_kw: 2.5,
    capacity_heat_kw: 3.2,
    conn_liquid_mm: 6.35,
    conn_gas_mm: 9.52,
    default_plane: "room",
    allowed_planes: ["room"],
    system_roles: ["split-pair"],
    refrigerant: "R32",
    width_mm: 800,
    depth_mm: 230,
    height_mm: 300,
    provenance: { kind: "extracted", source: "M-P Series Data Book", page: "B-4" },
  };
}

function pack(): DataPack {
  const p = emptyPack(meta());
  p.indoor_units = [idu("MSZ-AP25VGK")];
  p.multi_rules = [
    {
      odu_model_ref: "MXZ-2F52VF",
      port_pipe_sizes: [{ liquid_mm: 6.35, gas_mm: 9.52 }],
      compatibility: [
        {
          method: "family_whitelist_with_limits",
          families: ["MSZ-AP", "MFXZ-KW"], // MFXZ-KW matches nothing (extraction typo?)
          max_count: 2,
        },
      ],
      max_total_pipe_m: 30,
      max_per_branch_m: 20,
      max_lift_m: 10,
      additional_charge: { method: "none_required" },
      branch_box_refs: ["PAC-MKA30BC"], // no such part row extracted yet
      provenance: { kind: "extracted", source: "M-P Series Data Book", page: "C-2" },
    },
  ];
  return p;
}

describe("unextractedSources", () => {
  it("flags declared sources that zero rows cite (the PUMY case)", () => {
    const signals = unextractedSources(pack());
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe("unextracted-source");
    expect(signals[0].title).toBe("PUMY-SP Data Book");
    expect(signals[0].detail).toContain("M-P0860");
  });

  it("is silent when every declared source is cited", () => {
    const p = pack();
    p.meta.sources = [{ title: "M-P Series Data Book" }];
    expect(unextractedSources(p)).toEqual([]);
  });
});

describe("unmatchedRuleReferences", () => {
  it("flags whitelist families that match no indoor model, engine-consistently", () => {
    const signals = unmatchedRuleReferences(pack());
    const fam = signals.find((s) => s.kind === "unmatched-family");
    expect(fam?.title).toBe("MFXZ-KW"); // MSZ-AP matched via startsWith and is NOT flagged
    expect(fam?.detail).toContain("MXZ-2F52VF");
    expect(fam?.detail).toContain("p.C-2"); // points at the book page to verify against
  });

  it("flags branch-box refs that resolve to no part row", () => {
    const signals = unmatchedRuleReferences(pack());
    const ref = signals.find((s) => s.kind === "dangling-part-ref");
    expect(ref?.title).toBe("PAC-MKA30BC");
  });

  it("dedupes repeated references across rules", () => {
    const p = pack();
    p.multi_rules.push({ ...p.multi_rules[0], odu_model_ref: "MXZ-3F54VGD" });
    const fams = unmatchedRuleReferences(p).filter((s) => s.kind === "unmatched-family");
    expect(fams).toHaveLength(1);
  });
});

describe("packWatchSignals", () => {
  it("combines source and reference signals", () => {
    const kinds = packWatchSignals(pack()).map((s) => s.kind);
    expect(kinds).toContain("unextracted-source");
    expect(kinds).toContain("unmatched-family");
    expect(kinds).toContain("dangling-part-ref");
    expect(kinds).toContain("no-combination-rule");
  });
});

describe("unboundedMultiRules", () => {
  it("flags a rule whose blocks bound each unit but never the set", () => {
    const signals = unboundedMultiRules(pack());
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe("no-combination-rule");
    expect(signals[0].title).toBe("MXZ-2F52VF");
    expect(signals[0].detail).toContain("p.C-2"); // the page to go back to
  });

  it("counts max_count as no bound at all — a count is not a capacity", () => {
    const p = pack();
    // the fixture already carries max_count: 2. Six 3.5 kW heads under a
    // count of 6 is 175% connected, which is what the table exists to answer.
    expect(p.multi_rules[0].compatibility[0]).toMatchObject({ max_count: 2 });
    expect(unboundedMultiRules(p)).toHaveLength(1);
  });

  it("is silent when a combination table is present", () => {
    const p = pack();
    p.multi_rules[0].compatibility.push({
      method: "explicit_combination_table",
      combos: [["MSZ-AP25VGK", "MSZ-AP25VGK"]],
    });
    expect(unboundedMultiRules(p)).toEqual([]);
  });

  it("is silent when a ratio band is present instead", () => {
    const p = pack();
    p.multi_rules[0].compatibility = [
      { method: "index_ratio_band", ratio_min_pct: 50, ratio_max_pct: 130, max_idus: 9 },
    ];
    expect(unboundedMultiRules(p)).toEqual([]);
  });

  it("leaves an empty compatibility to the validator", () => {
    const p = pack();
    p.multi_rules[0].compatibility = [];
    expect(unboundedMultiRules(p)).toEqual([]);
  });
});

/* ── against the real shipped pack, so data drift fails here ── */
describe("unboundedMultiRules — the shipped Mitsubishi pack", () => {
  function realPack(): DataPack {
    const dir = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
    const m = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as PackMeta;
    const sections: PackSource["sections"] = {};
    for (const s of PACK_SECTIONS) {
      const f = join(dir, `${s}.json`);
      if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
    }
    return assemblePack({ meta: m, sections });
  }

  const signals = unboundedMultiRules(realPack());

  it("never flags a rule that does bound its set", () => {
    const p = realPack();
    for (const s of signals) {
      const rule = p.multi_rules.find((r) => r.odu_model_ref === s.title)!;
      expect(
        rule.compatibility.some(
          (b) =>
            b.method === "explicit_combination_table" || b.method === "index_ratio_band"
        )
      ).toBe(false);
    }
  });

  it("is silent on every PUMY rule — they carry a ratio band", () => {
    expect(signals.filter((s) => s.title.startsWith("PUMY"))).toEqual([]);
  });

  it("is silent on the whole pack — every multi rule bounds its set", () => {
    // the 7 MXZ rules were the gap this signal was written for (#726); their
    // combination tables landed, so the shipped pack is now clean. A rule
    // added without a combination table or a ratio band lands back here.
    expect(signals).toEqual([]);
  });
});

describe("unextractedSources — provenance carried on a rule block", () => {
  it("counts a book cited only by a compatibility block as mined", () => {
    const p = pack();
    p.meta.sources = [
      ...(p.meta.sources ?? []),
      { title: "Multi Split Guide 2021-01" },
    ];
    expect(unextractedSources(p).map((s) => s.title)).toContain(
      "Multi Split Guide 2021-01"
    );

    p.multi_rules[0].compatibility.push({
      method: "capacity_combination_table",
      combos: [[25, 35]],
      provenance: {
        kind: "extracted",
        source: "Multi Split Guide 2021-01",
        page: "18",
      },
    });
    expect(unextractedSources(p).map((s) => s.title)).not.toContain(
      "Multi Split Guide 2021-01"
    );
  });
});
