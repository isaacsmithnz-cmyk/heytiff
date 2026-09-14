/* The start screen's library: what it lists is what the engine offers, and
   what it calls new is what this browser has not seen. Pointed at the real
   shipped pack, like installed-packs.test.ts, so a listing that drifts from
   the engine's gates fails on the data people quote off. */

import { installedPacks, loadInstalledPack } from "../server";
import { proposePairs } from "../../split";
import { proposeMultiOdus, multiCapableIdus } from "../../multi";
import { indoorReadiness, outdoorReadiness } from "../ready";
import { FORM_FACTORS } from "../schema";
import {
  indoorByForm,
  libraryChanges,
  libraryManifest,
  librarySnapshot,
  modelKey,
  type LibraryManifest,
} from "../library";

async function shipped() {
  const refs = await installedPacks();
  const loaded = [];
  for (const r of refs) loaded.push(await loadInstalledPack(r.brand, r.version));
  return loaded;
}

describe("the library manifest", () => {
  it("names the brand from its own row, not the pack's long title", async () => {
    const m = libraryManifest(await shipped());
    const me = m.brands.find((b) => b.id === "mitsubishi-electric");
    expect(me?.name).toBe("Mitsubishi Electric");
    expect(me?.version).toMatch(/^\d{4}\.\d+$/);
    expect(me?.systems.map((s) => s.label)).toEqual(["Split systems", "Multi-split", "VRF"]);
  });

  it("lists under split exactly the indoor and outdoor units a pair would propose", async () => {
    const packs = await shipped();
    const m = libraryManifest(packs);
    for (const { meta, pack } of packs) {
      const brand = m.brands.find((b) => b.id === meta.brand)!;
      const split = brand.systems.find((s) => s.system === "split")!;
      const pairs = proposePairs(pack, null, "worst-of-both");
      const idu = new Set(pairs.map((p) => p.idu.model));
      const odu = new Set(pairs.map((p) => p.odu.model));
      const listedIdu = split.series.filter((s) => s.side === "indoor").flatMap((s) => s.models);
      const listedOdu = split.series.filter((s) => s.side === "outdoor").flatMap((s) => s.models);
      expect(new Set(listedIdu)).toEqual(idu);
      expect(new Set(listedOdu)).toEqual(odu);
      expect(listedIdu.length).toBeGreaterThan(0);
    }
  });

  it("lists under multi the outdoors the engine proposes and the indoors their rules accept", async () => {
    const packs = await shipped();
    const m = libraryManifest(packs);
    for (const { meta, pack } of packs) {
      const brand = m.brands.find((b) => b.id === meta.brand)!;
      const multi = brand.systems.find((s) => s.system === "multi")!;
      const odus = proposeMultiOdus(pack, [], "worst-of-both").map((p) => p.odu.model);
      const rules = pack.multi_rules.filter((r) => odus.includes(r.odu_model_ref));
      const idus = multiCapableIdus(pack, rules).map((u) => u.model);
      expect(new Set(multi.series.filter((s) => s.side === "outdoor").flatMap((s) => s.models))).toEqual(new Set(odus));
      expect(new Set(multi.series.filter((s) => s.side === "indoor").flatMap((s) => s.models))).toEqual(new Set(idus));
    }
  });

  it("lists under vrf each side's own readiness, and never an unready row anywhere", async () => {
    const packs = await shipped();
    const m = libraryManifest(packs);
    for (const { meta, pack } of packs) {
      const brand = m.brands.find((b) => b.id === meta.brand)!;
      const vrf = brand.systems.find((s) => s.system === "vrf")!;
      const readyIdu = pack.indoor_units.filter((u) => indoorReadiness(pack, u).roles["vrf-idu"]).map((u) => u.model);
      const readyOdu = pack.outdoor_units.filter((o) => outdoorReadiness(pack, o).roles["vrf-odu"]).map((o) => o.model);
      expect(new Set(vrf.series.filter((s) => s.side === "indoor").flatMap((s) => s.models))).toEqual(new Set(readyIdu));
      expect(new Set(vrf.series.filter((s) => s.side === "outdoor").flatMap((s) => s.models))).toEqual(new Set(readyOdu));
      /* and every indoor model listed in any group is placeable — the floor
         under every role — so nothing on the start screen fails to land on
         the canvas */
      for (const g of brand.systems)
        for (const s of g.series.filter((x) => x.side === "indoor"))
          for (const model of s.models) {
            const u = pack.indoor_units.find((x) => x.model === model)!;
            expect(indoorReadiness(pack, u).roles.placeable).toBe(true);
          }
    }
  });

  it("gives every indoor series its form factor and its name, and outdoor series neither", async () => {
    const m = libraryManifest(await shipped());
    for (const b of m.brands)
      for (const g of b.systems)
        for (const s of g.series) {
          if (s.side === "indoor") {
            expect(s.form).toMatch(/^[A-Z0-9]/);
            expect(FORM_FACTORS).toContain(s.formFactor);
          } else {
            expect(s.form).toBeNull();
            expect(s.formFactor).toBeNull();
          }
          expect(s.models.length).toBeGreaterThan(0);
        }
    const split = m.brands[0].systems[0];
    expect(split.series.find((s) => s.series === "MSZ-AP")?.form).toBe("Wall-mounted");
    /* indoor before outdoor; indoor in the schema's form order (wall first,
       bulkhead last), by name within a form */
    const sides = split.series.map((s) => s.side);
    expect(sides.indexOf("outdoor")).toBe(sides.lastIndexOf("indoor") + 1);
    const ranks = split.series.filter((s) => s.side === "indoor").map((s) => FORM_FACTORS.indexOf(s.formFactor!));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(split.series[0].formFactor).toBe("wall");
  });

  it("lines the indoor series up by form, in that order, for the start screen", async () => {
    const m = libraryManifest(await shipped());
    const split = m.brands[0].systems[0];
    const lineup = indoorByForm(split.series);
    expect(lineup[0].form).toBe("Wall-mounted");
    expect(lineup[0].series.map((s) => s.series)).toEqual(
      expect.arrayContaining(["MSZ-AP", "MSZ-EF", "MSZ-GS", "MSZ-LN"])
    );
    expect(lineup.map((f) => f.form)).toEqual([...new Set(lineup.map((f) => f.form))]);
    /* the outdoor units are not in it */
    expect(lineup.flatMap((f) => f.series).every((s) => s.side === "indoor")).toBe(true);
  });
});

/* a small manifest to diff against, so the cases read at a glance */
function manifest(version: string, split: Record<string, string[]>, vrf: Record<string, string[]> = {}): LibraryManifest {
  const series = (rows: Record<string, string[]>, side: "indoor" | "outdoor") =>
    Object.entries(rows).map(([s, models]) => ({
      series: s,
      side,
      form: side === "indoor" ? "Wall-mounted" : null,
      formFactor: side === "indoor" ? ("wall" as const) : null,
      models,
    }));
  return {
    brands: [
      {
        id: "me",
        name: "Mitsubishi Electric",
        version,
        systems: [
          { system: "split", label: "Split systems", series: series(split, "indoor") },
          { system: "multi", label: "Multi-split", series: [] },
          { system: "vrf", label: "VRF", series: series(vrf, "indoor") },
        ],
      },
    ],
  };
}

describe("what changed since this browser last looked", () => {
  const v1 = manifest("2026.1", { "MSZ-AP": ["MSZ-AP25", "MSZ-AP35"], "MSZ-LN": ["MSZ-LN25"] });

  it("says nothing without a snapshot to compare with", () => {
    expect(libraryChanges(v1, null)).toEqual([]);
  });

  it("says nothing when nothing differs", () => {
    expect(libraryChanges(v1, librarySnapshot(v1))).toEqual([]);
  });

  it("reports a new version even when the models are the same", () => {
    const v2 = manifest("2026.2", { "MSZ-AP": ["MSZ-AP25", "MSZ-AP35"], "MSZ-LN": ["MSZ-LN25"] });
    const [c] = libraryChanges(v2, librarySnapshot(v1));
    expect(c).toMatchObject({ brand: "me", from: "2026.1", to: "2026.2", added: [], removed: [] });
  });

  it("lists what was added, by series, and tells a whole new series from a grown one", () => {
    const grown = manifest("2026.1", {
      "MSZ-AP": ["MSZ-AP25", "MSZ-AP35", "MSZ-AP50"],
      "MSZ-LN": ["MSZ-LN25"],
      "MSZ-EF": ["MSZ-EF25", "MSZ-EF35"],
    });
    const [c] = libraryChanges(grown, librarySnapshot(v1));
    expect(c.added).toEqual([
      { series: "MSZ-AP", side: "indoor", form: "Wall-mounted", models: ["MSZ-AP50"], whole: false },
      { series: "MSZ-EF", side: "indoor", form: "Wall-mounted", models: ["MSZ-EF25", "MSZ-EF35"], whole: true },
    ]);
    expect(c.newKeys).toEqual(["indoor:MSZ-AP50", "indoor:MSZ-EF25", "indoor:MSZ-EF35"]);
    expect(c.removed).toEqual([]);
  });

  it("counts a model offered in two groups once", () => {
    const both = manifest("2026.1", { "MSZ-AP": ["MSZ-AP25", "MSZ-AP35"], "MSZ-LN": ["MSZ-LN25"] }, { "MSZ-AP": ["MSZ-AP25", "MSZ-AP35", "MSZ-AP50"] });
    const [c] = libraryChanges(both, librarySnapshot(v1));
    /* AP50 is new in vrf; the split listing of AP is unchanged, so the one
       addition is reported once, from the group that carries the new code */
    expect(c.added).toEqual([{ series: "MSZ-AP", side: "indoor", form: "Wall-mounted", models: ["MSZ-AP50"], whole: false }]);
    expect(librarySnapshot(both).brands.me.models).toEqual(["indoor:MSZ-AP25", "indoor:MSZ-AP35", "indoor:MSZ-AP50", "indoor:MSZ-LN25"]);
  });

  it("reports a model no longer offered", () => {
    const less = manifest("2026.1", { "MSZ-AP": ["MSZ-AP25"], "MSZ-LN": ["MSZ-LN25"] });
    const [c] = libraryChanges(less, librarySnapshot(v1));
    expect(c.removed).toEqual([modelKey("indoor", "MSZ-AP35")]);
    expect(c.added).toEqual([]);
  });

  it("treats a brand this browser has never seen as arriving whole", () => {
    const snap = librarySnapshot(v1);
    const other: LibraryManifest = { brands: [...v1.brands, { ...v1.brands[0], id: "daikin", name: "Daikin" }] };
    const changes = libraryChanges(other, snap);
    expect(changes.map((c) => c.brand)).toEqual(["daikin"]);
    expect(changes[0]).toMatchObject({ from: null, to: "2026.1" });
    expect(changes[0].added.every((a) => a.whole)).toBe(true);
  });
});
