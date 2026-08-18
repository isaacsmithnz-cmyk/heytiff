/* Selector-overhaul lock gate: capacity as a RANKING (nothing hidden), form-
   factor grouping, fit filters, sorts, and IDU-first grouping with ODU sub-
   choices — all against the real shipped Mitsubishi pack (so data drift fails
   here). */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { unitOptions, formFactorSummary, pairFit, FIT_RANK, OVERSIZE_CAP } from "../select";

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

describe("capacity ranking", () => {
  it("a load hides nothing — the whole catalogue comes back, labelled", () => {
    const all = unitOptions(pack, { loadKw: null, basis: "worst-of-both", formFactor: null });
    const loaded = unitOptions(pack, { loadKw: 2.9, basis: "worst-of-both", formFactor: null });
    expect(loaded).toHaveLength(all.length);
    expect(loaded.map((o) => o.idu.model).sort()).toEqual(all.map((o) => o.idu.model).sort());
  });

  it("fit labels follow the load and the cap", () => {
    const opts = unitOptions(pack, { loadKw: 2.9, basis: "worst-of-both", formFactor: null });
    for (const o of opts) {
      const cap = o.defaultPair.capacityKw;
      if (o.fit === "fits") {
        expect(cap).toBeGreaterThanOrEqual(2.9);
        expect(cap).toBeLessThanOrEqual(2.9 * OVERSIZE_CAP);
      } else if (o.fit === "oversized") {
        expect(cap).toBeGreaterThan(2.9 * OVERSIZE_CAP);
      } else {
        expect(cap).toBeLessThan(2.9);
      }
    }
    // a mid-range load exercises all three buckets
    expect(new Set(opts.map((o) => o.fit))).toEqual(
      new Set(["fits", "oversized", "undersized"])
    );
  });

  it("null load = full catalogue (69 split IDUs), no best fit", () => {
    const opts = unitOptions(pack, { loadKw: null, basis: "worst-of-both", formFactor: null });
    expect(opts).toHaveLength(69);
    expect(opts.some((o) => o.bestFit)).toBe(false);
    expect(opts.every((o) => o.fit === "fits")).toBe(true);
  });

  it("exactly one best fit under a load, and it's the smallest FITTING one", () => {
    const opts = unitOptions(pack, { loadKw: 2.9, basis: "worst-of-both", formFactor: "wall" });
    expect(opts.filter((o) => o.bestFit)).toHaveLength(1);
    const rec = opts.find((o) => o.bestFit)!;
    expect(rec.fit).toBe("fits");
    for (const o of opts.filter((o) => o.fit === "fits"))
      expect(rec.defaultPair.capacityKw).toBeLessThanOrEqual(o.defaultPair.capacityKw);
  });

  it("a load nothing can cover leaves every row undersized and no best fit", () => {
    const opts = unitOptions(pack, { loadKw: 999, basis: "worst-of-both", formFactor: "wall" });
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every((o) => o.fit === "undersized")).toBe(true);
    expect(opts.some((o) => o.bestFit)).toBe(false);
  });

  it("a model is judged on its best pairing, not its first in the book", () => {
    const opts = unitOptions(pack, { loadKw: 2.9, basis: "worst-of-both", formFactor: null });
    for (const o of opts.filter((x) => x.pairs.length > 1)) {
      // no pairing sizes better than the one the row speaks for
      const best = FIT_RANK[o.fit];
      for (const p of o.pairs) expect(FIT_RANK[pairFit(p, 2.9)]).toBeGreaterThanOrEqual(best);
      expect(o.pairs[0]).toBe(o.defaultPair);
    }
  });
});

describe("form factors", () => {
  /* 69 units, 7 factors since the SEZ-M-DA range was reclassified ducted →
     bulkhead: the split catalogue's ducted tab drops 21 → 16 and the five SEZ
     rows become a tab of their own. (VMX/VMS1 also moved but are vrf-only, so
     they never appeared in this split-pair catalogue.) */
  it("summary counts the full catalogue correctly (69 across 7 factors)", () => {
    const sum = formFactorSummary(pack, null, "worst-of-both");
    const byF = Object.fromEntries(sum.map((s) => [s.formFactor, s.count]));
    expect(byF).toEqual({
      wall: 25,
      ducted: 16,
      bulkhead: 5,
      "cassette-4way": 8,
      "cassette-1way": 3,
      "under-ceiling": 7,
      "floor-console": 5,
    });
  });

  it("tab filter returns only that factor; every ducted option has airflow", () => {
    const ducted = unitOptions(pack, { loadKw: null, basis: "worst-of-both", formFactor: "ducted" });
    expect(ducted).toHaveLength(16);
    for (const o of ducted) {
      expect(o.idu.form_factor).toBe("ducted");
      expect(o.idu.airflow_ls).toBeGreaterThan(0);
    }
  });

  /* Bulkhead is a duct-airway form (DUCT_AIRWAY_FORMS), so the ducted design
     flow will offer these units and then ask them for a duct. Airflow is what
     makes that legal — assert it here, or a reclassification could quietly
     move a range into the ducted flow without the data the flow needs. */
  it("every bulkhead option carries airflow, same as ducted", () => {
    const bulk = unitOptions(pack, { loadKw: null, basis: "worst-of-both", formFactor: "bulkhead" });
    expect(bulk).toHaveLength(5);
    for (const o of bulk) {
      expect(o.idu.form_factor).toBe("bulkhead");
      expect(o.idu.airflow_ls).toBeGreaterThan(0);
    }
  });
});

describe("fit filters", () => {
  it("max height 250 on ducted keeps only low-profile units", () => {
    const opts = unitOptions(pack, {
      loadKw: null,
      basis: "worst-of-both",
      formFactor: "ducted",
      filters: { maxHeightMm: 250 },
    });
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.length).toBeLessThan(21);
    for (const o of opts) expect(o.idu.height_mm).toBeLessThanOrEqual(250);
  });

  it("min airflow filters ducted units", () => {
    const opts = unitOptions(pack, {
      loadKw: null,
      basis: "worst-of-both",
      formFactor: "ducted",
      filters: { minAirflowLs: 400 },
    });
    for (const o of opts) expect(o.idu.airflow_ls!).toBeGreaterThanOrEqual(400);
  });

  it("width/depth filters apply", () => {
    const opts = unitOptions(pack, {
      loadKw: null,
      basis: "worst-of-both",
      formFactor: "wall",
      filters: { maxWidthMm: 800, maxDepthMm: 250 },
    });
    for (const o of opts) {
      expect(o.idu.width_mm).toBeLessThanOrEqual(800);
      expect(o.idu.depth_mm).toBeLessThanOrEqual(250);
    }
  });
});

describe("sorts", () => {
  const crit = { loadKw: null, basis: "worst-of-both" as const, formFactor: "ducted" as const };

  it("height ascending", () => {
    const opts = unitOptions(pack, { ...crit, sort: "height" });
    for (let i = 1; i < opts.length; i++)
      expect(opts[i].idu.height_mm).toBeGreaterThanOrEqual(opts[i - 1].idu.height_mm);
  });

  it("width ascending", () => {
    const opts = unitOptions(pack, { ...crit, sort: "width" });
    for (let i = 1; i < opts.length; i++)
      expect(opts[i].idu.width_mm).toBeGreaterThanOrEqual(opts[i - 1].idu.width_mm);
  });

  it("airflow descending", () => {
    const opts = unitOptions(pack, { ...crit, sort: "airflow" });
    for (let i = 1; i < opts.length; i++)
      expect(opts[i].idu.airflow_ls!).toBeLessThanOrEqual(opts[i - 1].idu.airflow_ls!);
  });

  it("capacity ascending is the default", () => {
    const opts = unitOptions(pack, crit);
    for (let i = 1; i < opts.length; i++)
      expect(opts[i].defaultPair.capacityKw).toBeGreaterThanOrEqual(
        opts[i - 1].defaultPair.capacityKw
      );
  });
});

describe("IDU-first grouping with ODU sub-choice", () => {
  it("PLA-M100EA2-A groups its 3 outdoor pairings, deterministic default", () => {
    const opts = unitOptions(pack, {
      loadKw: null,
      basis: "cooling",
      formFactor: "cassette-4way",
    });
    const m100 = opts.find((o) => o.idu.model === "PLA-M100EA2-A");
    expect(m100).toBeDefined();
    expect(m100!.pairs).toHaveLength(3);
    expect(m100!.defaultPair).toBe(m100!.pairs[0]);
    expect(m100!.pairs.map((p) => p.odu.model)).toEqual([
      "PUZ-M100VKA-A",
      "PUZ-ZM100VKA2-A",
      "PUZ-ZM100YKA3-A",
    ]);
  });

  it("pairings sort best-fit first — the short one is kept, just not the default", () => {
    // PCA-M125KA2 pairs rate 11.5 (M) and 12.5 (ZM) — at load 12.0 only ZM covers
    const opts = unitOptions(pack, {
      loadKw: 12.0,
      basis: "cooling",
      formFactor: "under-ceiling",
    });
    const m125 = opts.find((o) => o.idu.model === "PCA-M125KA2")!;
    expect(m125).toBeDefined();
    // the undersized 11.5 pairing is still offered...
    expect(m125.pairs.some((p) => p.odu.model === "PUZ-M125VKA-A")).toBe(true);
    // ...but it sorts last, and the row speaks for a pairing that covers
    expect(m125.pairs[m125.pairs.length - 1].odu.model).toBe("PUZ-M125VKA-A");
    expect(m125.defaultPair.capacityKw).toBeGreaterThanOrEqual(12.0);
    expect(m125.fit).not.toBe("undersized");
  });
});

describe("phase filter", () => {
  const ducted = (phase: "1" | "3" | null) =>
    unitOptions(pack, { loadKw: null, basis: "worst-of-both", formFactor: "ducted", phase });

  it("the same ducted IDU keeps only pairings of the chosen phase (PEAD-M100)", () => {
    const all = ducted(null).find((o) => o.idu.model === "PEAD-M100JAA(D)")!;
    expect(all.pairs.map((p) => p.odu.model)).toEqual([
      "PUZ-M100VKA-A",
      "PUZ-ZM100VKA2-A",
      "PUZ-ZM100YKA3-A",
    ]);

    const single = ducted("1").find((o) => o.idu.model === "PEAD-M100JAA(D)")!;
    expect(single.pairs.map((p) => p.odu.model)).toEqual([
      "PUZ-M100VKA-A",
      "PUZ-ZM100VKA2-A",
    ]);
    for (const p of single.pairs) expect(p.odu.phase).toBe("1");

    const three = ducted("3").find((o) => o.idu.model === "PEAD-M100JAA(D)")!;
    expect(three.pairs.map((p) => p.odu.model)).toEqual(["PUZ-ZM100YKA3-A"]);
    expect(three.defaultPair.odu.model).toBe("PUZ-ZM100YKA3-A");
  });

  it("an IDU whose pairings are all single-phase disappears under a 3φ filter", () => {
    // PEAD-M50JAA(D) pairs only with the 1φ SUZ-M50VAD-A
    expect(ducted(null).some((o) => o.idu.model === "PEAD-M50JAA(D)")).toBe(true);
    expect(ducted("3").some((o) => o.idu.model === "PEAD-M50JAA(D)")).toBe(false);
    for (const o of ducted("3"))
      for (const p of o.pairs) expect(p.odu.phase).toBe("3");
  });

  it("tab counts agree with the filtered option list (count-consistency lock)", () => {
    for (const phase of ["1", "3"] as const) {
      const sum = formFactorSummary(pack, null, "worst-of-both", phase);
      const dCount = sum.find((s) => s.formFactor === "ducted")?.count ?? 0;
      expect(dCount).toBe(ducted(phase).length);
    }
  });

  it("exactly one best fit under load + phase, and it satisfies both", () => {
    const opts = unitOptions(pack, {
      loadKw: 9.5,
      basis: "cooling",
      formFactor: "ducted",
      phase: "3",
    });
    const rec = opts.filter((o) => o.bestFit);
    expect(rec).toHaveLength(1);
    expect(rec[0].defaultPair.odu.phase).toBe("3");
    expect(rec[0].defaultPair.capacityKw).toBeGreaterThanOrEqual(9.5);
  });
});

describe("form-factor tab counts", () => {
  it("a load never empties a tab — only the fit count moves", () => {
    const bare = formFactorSummary(pack, null, "worst-of-both");
    const loaded = formFactorSummary(pack, 2.9, "worst-of-both");
    expect(loaded.map((s) => [s.formFactor, s.count])).toEqual(
      bare.map((s) => [s.formFactor, s.count])
    );
    for (const s of loaded) expect(s.fitCount).toBeLessThanOrEqual(s.count);
    expect(loaded.some((s) => s.fitCount > 0)).toBe(true);
  });

  it("a tab where nothing suits still reports its full catalogue", () => {
    const sum = formFactorSummary(pack, 999, "worst-of-both");
    expect(sum.length).toBeGreaterThan(0);
    for (const s of sum) {
      expect(s.count).toBeGreaterThan(0);
      expect(s.fitCount).toBe(0);
    }
  });

  it("fitCount agrees with the option list it labels", () => {
    for (const s of formFactorSummary(pack, 2.9, "worst-of-both")) {
      const opts = unitOptions(pack, {
        loadKw: 2.9,
        basis: "worst-of-both",
        formFactor: s.formFactor,
      });
      expect(opts).toHaveLength(s.count);
      expect(opts.filter((o) => o.fit === "fits")).toHaveLength(s.fitCount);
    }
  });
});

describe("representative sound/electrical data (PEAD range — drift lock)", () => {
  const PEADS = [
    "PEAD-M50JAA(D)",
    "PEAD-M60JAA(D)",
    "PEAD-M71JAA(D)",
    "PEAD-M100JAA(D)",
    "PEAD-M125JAA(D)",
    "PEAD-M140JAA(D)",
  ];

  it("every PEAD indoor unit carries a full sound range", () => {
    for (const model of PEADS) {
      const u = pack.indoor_units.find((x) => x.model === model)!;
      expect(u).toBeDefined();
      expect(u.sound_low_dba).toBeGreaterThan(0);
      expect(u.sound_high_dba).toBeGreaterThanOrEqual(u.sound_low_dba!);
    }
  });

  it("every PEAD outdoor partner carries sound + power supply, wording matches its phase", () => {
    const partnerModels = new Set(
      pack.pair_tables.filter((p) => PEADS.includes(p.idu_model)).map((p) => p.odu_model)
    );
    expect(partnerModels.size).toBe(13);
    for (const model of partnerModels) {
      const o = pack.outdoor_units.find((x) => x.model === model)!;
      expect(o.sound_high_dba).toBeGreaterThan(0);
      expect(o.power_supply).toBeTruthy();
      expect(o.power_supply).toContain(o.phase === "3" ? "Three-phase" : "Single-phase");
    }
  });
});
