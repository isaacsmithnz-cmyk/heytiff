import {
  emptyPack,
  type DataPack,
  type IndoorUnit,
  type PackMeta,
} from "@/lib/studio/packs/schema";
import {
  packWatchSignals,
  unextractedSources,
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
  });
});
