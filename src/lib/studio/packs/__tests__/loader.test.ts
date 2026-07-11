/* Stage-2: the loader is merge-aware from day one (overlay over base). */

import { emptyPack, type DataPack, type OutdoorUnit } from "../schema";
import { assemblePack, mergePacks, resolvePacks } from "../loader";

const prov = { kind: "extracted" as const, source: "book" };
const meta = { brand: "me", version: "1", packSchemaVersion: 1, name: "t" };

function odu(model: string, kw: number): OutdoorUnit {
  return {
    model,
    brand: "me",
    series: "S",
    system_type: "vrf",
    capacity_cool_kw: kw,
    capacity_heat_kw: kw + 2,
    phase: "3",
    conn_liquid_mm: 9.52,
    conn_gas_mm: 22.2,
    refrigerant: "R410A",
    provenance: prov,
  };
}

describe("assemblePack", () => {
  it("defaults absent sections to empty arrays", () => {
    const p = assemblePack({ meta, sections: { outdoor_units: [odu("A", 22.4)] } });
    expect(p.outdoor_units).toHaveLength(1);
    expect(p.indoor_units).toEqual([]);
    expect(p.pair_tables).toEqual([]);
  });
});

describe("mergePacks — overlay over base", () => {
  it("an overlay row with the same key replaces the base row in place", () => {
    const base = emptyPack(meta);
    base.outdoor_units.push(odu("A", 22.4), odu("B", 28));
    const over = emptyPack({ ...meta, version: "1+co" });
    over.outdoor_units.push(odu("A", 99)); // same model, different capacity

    const merged = mergePacks(base, over);
    expect(merged.outdoor_units).toHaveLength(2); // not 3 — A was replaced
    const a = merged.outdoor_units.find((o) => o.model === "A");
    expect(a!.capacity_cool_kw).toBe(99); // overlay wins
    expect(merged.outdoor_units[0].model).toBe("A"); // order preserved
    expect(merged.meta.version).toBe("1+co"); // resolved meta comes from overlay
  });

  it("overlay-only rows append; base is untouched", () => {
    const base = emptyPack(meta);
    base.outdoor_units.push(odu("A", 22.4));
    const over = emptyPack(meta);
    over.outdoor_units.push(odu("C", 33.5));

    const merged = mergePacks(base, over);
    expect(merged.outdoor_units.map((o) => o.model)).toEqual(["A", "C"]);
    expect(base.outdoor_units).toHaveLength(1); // base not mutated
  });

  it("resolvePacks folds layers left-to-right (later wins)", () => {
    const shared = emptyPack(meta);
    const brand = emptyPack(meta);
    brand.outdoor_units.push(odu("A", 22.4));
    const overlay = emptyPack(meta);
    overlay.outdoor_units.push(odu("A", 50));

    const resolved = resolvePacks([shared, brand, overlay]);
    expect(resolved.outdoor_units).toHaveLength(1);
    expect(resolved.outdoor_units[0].capacity_cool_kw).toBe(50);
  });
});
