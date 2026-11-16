import path from "node:path";
import { installedPacks, loadInstalledPack } from "@/lib/studio/packs/server";
import type { DataPack } from "@/lib/studio/packs/schema";
import { combine, compareRows, filterUnits, packBrands, packKinds, packUnits, sortUnits, type PackUnit } from "../data-pack";

/* Against the real packs, so a figure here is one the Studio designs with:
   the figures on the approved board (https://claude.ai/artifact/2Jvc2mQkhQscbykt7abwhM). */
const BASE = path.join(process.cwd(), "data/packs");

let packs: DataPack[];
let units: PackUnit[];
beforeAll(async () => {
  const refs = await installedPacks(BASE);
  packs = await Promise.all(refs.map((r) => loadInstalledPack(r.brand, r.version, BASE).then((p) => p.pack)));
  units = packUnits(packs);
});

const at = (model: string) => units.find((u) => u.model === model)!;

describe("Data pack", () => {
  it("lists every unit of every brand, indoor and outdoor", () => {
    expect(packBrands(units).map((b) => b.name)).toEqual([
      "Actron Air",
      "Daikin",
      "Fujitsu",
      "Mitsubishi Electric",
      "Mitsubishi Heavy Industries",
      "Panasonic",
    ]);
    expect(units.length).toBeGreaterThan(1100);
    expect(packKinds(units).map((k) => k.name)).toContain("Ducted");
    expect(packKinds(units).at(-1)?.name).toBe("Outdoor");
  });

  it("reads a ducted unit's openings, airflow and static as the book prints them", () => {
    expect(at("PEAD-M71JAA(D)")).toMatchObject({
      kindName: "Ducted",
      brandName: "Mitsubishi Electric",
      coolKw: 7.1,
      airflow: 417,
      staticPa: 125,
      supply: "1060 x 178",
      return: "1058 x 210",
      size: "1100 x 732 x 250",
      pipes: "9.52 / 15.88",
    });
    expect(at("PEAD-M71JAA(D)").systems).toContain("split");
  });

  it("filters by kind, cooling, brand and system, and by words", () => {
    const ducted = filterUnits(units, { kind: "ducted", coolFrom: 6.5, coolTo: 8 });
    expect(ducted.map((u) => u.model)).toContain("PEAD-M71JAA(D)");
    expect(ducted.every((u) => u.kind === "ducted" && u.coolKw >= 6.5 && u.coolKw <= 8)).toBe(true);
    const me = filterUnits(ducted, { brands: ["mitsubishi-electric"], systems: ["vrf"] });
    expect(me.length).toBeGreaterThan(0);
    expect(me.every((u) => u.brand === "mitsubishi-electric" && u.systems.includes("vrf"))).toBe(true);
    const said = filterUnits(units, { q: "7.1 ducted mitsubishi" });
    expect(said.map((u) => u.model)).toContain("PEAD-M71JAA(D)");
    expect(filterUnits(units, { q: "pead-m71" }).map((u) => u.model)).toContain("PEAD-M71JAA(D)");
    const sorted = sortUnits(ducted);
    expect(sorted[0].coolKw).toBeLessThanOrEqual(sorted.at(-1)!.coolKw);
  });

  it("compares side by side, and a row where they all match is the same", () => {
    const rows = compareRows([at("PEAD-M71JAA(D)"), at("FBA71BVMA")]);
    const row = (l: string) => rows.find((r) => r.label === l)!;
    expect(row("Cooling")).toMatchObject({ values: ["7.1 kW", "7.1 kW"], same: true });
    expect(row("Supply opening")).toMatchObject({ values: ["1060 x 178 mm", "792 x 176 mm"], same: false });
    expect(rows.some((r) => r.label === "Pipe run")).toBe(false);
  });

  it("combines a multi as the system builder does: its table, its ports, its limits", () => {
    const odu = at("MXZ-4F71VGD");
    expect(odu.combinable).toBe(true);
    const ap = units.find((u) => u.model.startsWith("MSZ-AP25VGD"))!;
    const pead = at("PEAD-M50JAA(D)");
    const c = combine(packs, units, odu.key, [ap.key, ap.key, pead.key])!;
    expect(c.offered).toContain(pead.key);
    expect(c.offered).not.toContain(at("PEAD-M71JAA(D)").key);
    expect(c.verdict).toMatchObject({ tone: "good", word: "In the combination table" });
    const fact = (l: string) => c.facts.find((f) => f.label === l)?.value;
    expect(fact("Heads")).toBe("25 + 25 + 50");
    expect(fact("Ports")).toBe("3 of 4 used");
    expect(fact("Pipe")).toBe("60 m in all, 25 m a branch, 10 m lift");
    expect(fact("Extra charge")).toBe("None to 60 m");
    expect(c.ports.map((p) => p.port)).toEqual(["A", "B", "C"]);
    expect(c.ports[0].pipes).toBe("6.35 / 12.7");
  });

  it("says red when the heads are more than the outdoor takes", () => {
    const odu = at("MXZ-4F71VGD");
    const big = at("PEAD-M60JAA(D)");
    const c = combine(packs, units, odu.key, [big.key, big.key, big.key, big.key])!;
    expect(c.verdict?.tone).toBe("bad");
  });

  it("pairs a split with its indoor unit", () => {
    const pair = packs.flatMap((p) => p.pair_tables)[0];
    const odu = units.find((u) => u.side === "outdoor" && u.model === pair.odu_model)!;
    const head = units.find((u) => u.side === "indoor" && u.model === pair.idu_model)!;
    const c = combine(packs, units, odu.key, [head.key])!;
    expect(c.verdict).toMatchObject({ tone: "good", word: "A pair in the data book" });
    expect(c.offered).toContain(head.key);
  });
});
