import path from "node:path";
import { installedPacks, loadInstalledPack } from "@/lib/studio/packs/server";
import type { DataPack } from "@/lib/studio/packs/schema";
import { lookUpModels, modelWords } from "../pack-lookup";

/* Against the real packs: bug 74 (23 November 2026), the RZA60's label and
   Tiff saying she couldn't find its pre-charged length. */
const BASE = path.join(process.cwd(), "data/packs");
let packs: DataPack[];
beforeAll(async () => {
  const refs = await installedPacks(BASE);
  packs = await Promise.all(refs.map((r) => loadInstalledPack(r.brand, r.version, BASE).then((p) => p.pack)));
});

describe("Tiff's data pack lookup", () => {
  it("reads model codes out of what she asks, and nothing else", () => {
    expect(modelWords("Daikin RZA60C2V1 with FDYAN60AV1, pre charged length")).toEqual(["RZA60C2V1", "FDYAN60AV1"]);
    expect(modelWords("pumy-sp140")).toEqual(["PUMYSP140"]);
  });

  it("gives the label's pair, its pre-charged length and the book it's from", () => {
    const found = lookUpModels(packs, "RZA60C2V1 FDYAN60AV1");
    expect(found.units.map((u) => u.model)).toEqual(["RZA60C2V1", "FDYAN60AV1"]);
    expect(found.pairs).toHaveLength(1);
    expect(found.pairs[0]).toMatchObject({
      indoor: "FDYAN60AV1",
      outdoor: "RZA60C2V1",
      pipes: "6.35 liquid, 12.7 gas",
      longestRun: "50 m",
      mostLift: "30 m",
      extraCharge: "None to 30 m, then 350 g to 40 m, 700 g to 50 m on 6.35 liquid",
    });
    expect(found.pairs[0].source).toContain("EDAU282225A");
  });

  it("an outdoor alone brings its pairs", () => {
    const found = lookUpModels(packs, "RZA60C2V1");
    expect(found.pairs.map((p) => p.outdoor)).toContain("RZA60C2V1");
  });

  it("a model no book carries finds nothing", () => {
    expect(lookUpModels(packs, "ZZZ99X9").units).toEqual([]);
  });
});
