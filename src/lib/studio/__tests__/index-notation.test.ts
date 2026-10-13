/* A capacity index reads the way the brand's books print it. Mitsubishi
   Electric's books write "P50" (the P-number) and its brands.json row says
   so; Daikin's write "Capacity index 50" and MHI's KX books give the number
   as the unit's capacity, with no notation of their own, so they and every
   other brand read "index 50". No finding asks which brand it is: the
   notation is data. */

import { installedPacks, loadInstalledPack } from "../packs/server";
import {
  DEFAULT_INDEX_NOTATION,
  indexNotation,
  indexPairText,
  indexRangeText,
  indexText,
  type CompatibilityRule,
  type IndoorUnit,
  type OutdoorUnit,
} from "../packs/schema";
import { checkBlock } from "../multi";

describe("the notation helpers", () => {
  it("write ME's mark on every number, and the plain word once", () => {
    expect(indexText("P{n}", 50)).toBe("P50");
    expect(indexRangeText("P{n}", 10, 100)).toBe("P10–P100");
    expect(indexPairText("P{n}", 250, 200, " of ")).toBe("P250 of P200");

    expect(indexText(DEFAULT_INDEX_NOTATION, 31.25)).toBe("index 31.25");
    expect(indexRangeText(DEFAULT_INDEX_NOTATION, 10, 100)).toBe("index 10–100");
    expect(indexPairText(DEFAULT_INDEX_NOTATION, 250, 200, " of ")).toBe("index 250 of 200");
  });

  it("says 'or more' for a band with no top, never P∞", () => {
    expect(indexRangeText("P{n}", 15, undefined)).toBe("P15 or more");
    expect(indexRangeText(DEFAULT_INDEX_NOTATION, null, null)).toBe("index 0 or more");
  });

  it("takes the brand's own notation from its row, and the plain one without", () => {
    const pack = {
      brands: [
        { id: "me", name: "ME", capacity_index_notation: "P{n}" },
        { id: "dk", name: "DK" },
        { id: "bad", name: "Bad", capacity_index_notation: "P" }, // no {n}: not a notation
      ],
    };
    expect(indexNotation(pack, "me")).toBe("P{n}");
    expect(indexNotation(pack, "dk")).toBe(DEFAULT_INDEX_NOTATION);
    expect(indexNotation(pack, "bad")).toBe(DEFAULT_INDEX_NOTATION);
    expect(indexNotation(pack, "nobody")).toBe(DEFAULT_INDEX_NOTATION);
  });
});

describe("the shipped packs", () => {
  it("give only Mitsubishi Electric the P-number", async () => {
    const seen: Record<string, string> = {};
    for (const ref of await installedPacks()) {
      const { pack } = await loadInstalledPack(ref.brand, ref.version);
      seen[ref.brand] = indexNotation(pack, ref.brand);
    }
    expect(seen["mitsubishi-electric"]).toBe("P{n}");
    for (const [brand, notation] of Object.entries(seen))
      if (brand !== "mitsubishi-electric") expect({ brand, notation }).toEqual({ brand, notation: DEFAULT_INDEX_NOTATION });
  });
});

describe("a finding outside the index band", () => {
  const band: CompatibilityRule = { method: "index_ratio_band", ratio_min_pct: 50, ratio_max_pct: 130, max_idus: 8, index_min: 15, index_max: 100 };
  const head = { model: "HEAD-125", capacity_index: 125, capacity_cool_kw: 14 } as IndoorUnit;
  const odu = (brand: string) => ({ model: "VRF-1", brand, capacity_cool_kw: 14, capacity_index: 125 }) as OutdoorUnit;
  const message = (notation?: string) =>
    checkBlock(band, odu("x"), [head], undefined, notation).find((f) => f.code === "outside-index-band")?.message;

  it("reads in P-numbers for a brand whose books print them", () => {
    expect(message("P{n}")).toBe("HEAD-125 is P125, and VRF-1 takes P15–P100");
  });

  it("reads as a plain index for every other brand, and by default", () => {
    expect(message(DEFAULT_INDEX_NOTATION)).toBe("HEAD-125 is index 125, and VRF-1 takes index 15–100");
    expect(message()).toBe("HEAD-125 is index 125, and VRF-1 takes index 15–100");
  });
});
