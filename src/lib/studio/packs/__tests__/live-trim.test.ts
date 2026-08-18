/* Public-link pack trim: referenced models survive, the licensed bulk never
   leaks, and every non-unit section ships empty. Runs against the REAL
   shipped pack so the survivors are real rows. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createDesign, type DesignDocument } from "../../document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../schema";
import { assemblePack, type PackSource } from "../loader";
import { referencedModels, trimPackForLive } from "../live-trim";

const SEED_DIR = join(__dirname, "../../../../../data/packs/mitsubishi-electric@2026.1");
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

function fixtureDoc(): DesignDocument {
  const d = createDesign({ name: "Live", mode: "blank", now: "2026-07-19T00:00:00.000Z" });
  d.systems = [
    {
      id: "sys1",
      type: "split",
      brand: "mitsubishi-electric",
      colour: "#2E68FF",
      name: "System 1",
      settings: { pairIdu: "MFZ-KW35VG", pairOdu: "MUFZ-KW35VG" },
    },
    {
      id: "sys2",
      type: "multi-split",
      brand: "mitsubishi-electric",
      colour: "#E4572E",
      name: "System 2",
      settings: { multiIdus: { roomA: "MSZ-EF25VGW" } },
    },
  ];
  d.objects = [
    {
      id: "u1",
      type: "unit",
      systemId: "sys1",
      floorId: "f1",
      geometry: { kind: "point", at: { x: 0, y: 0 } },
      plane: "room",
      props: { role: "idu", model: "MFZ-KW35VG" },
    },
  ];
  return d;
}

describe("referencedModels", () => {
  it("collects placed units, pair picks and per-room multi picks", () => {
    const m = referencedModels(fixtureDoc());
    expect(m.has("MFZ-KW35VG")).toBe(true);
    expect(m.has("MUFZ-KW35VG")).toBe(true);
    expect(m.has("MSZ-EF25VGW")).toBe(true);
    expect(m.size).toBe(3);
  });
});

describe("trimPackForLive", () => {
  it("keeps only referenced units and their joining pair rows", () => {
    const t = trimPackForLive(pack, fixtureDoc());
    expect(t.indoor_units.map((u) => u.model).sort()).toEqual([
      "MFZ-KW35VG",
      "MSZ-EF25VGW",
    ]);
    expect(t.outdoor_units.map((u) => u.model)).toEqual(["MUFZ-KW35VG"]);
    expect(t.pair_tables.length).toBeGreaterThan(0);
    for (const p of t.pair_tables) {
      expect(p.idu_model).toBe("MFZ-KW35VG");
      expect(p.odu_model).toBe("MUFZ-KW35VG");
    }
    // the licensed bulk stays home
    expect(t.indoor_units.length).toBeLessThan(pack.indoor_units.length);
    expect(t.pair_tables.length).toBeLessThan(pack.pair_tables.length);
  });

  it("everything else ships empty", () => {
    const t = trimPackForLive(pack, fixtureDoc());
    expect(t.parts).toEqual([]);
    expect(t.grilles).toEqual([]);
    expect(t.consumables).toEqual([]);
    expect(t.zoning_controllers).toEqual([]);
    expect(t.accessories).toEqual([]);
    expect(t.vrf_pipe_tables).toEqual([]);
  });

  /* THE CUSTOMER READS THE SAME DOCUMENT THE OWNER DOES. A section dropped
     here does not simplify their copy — it makes the two copies disagree. */
  it("keeps the brand's NAME — the sheet said `mitsubishi-electric` without it", () => {
    const t = trimPackForLive(pack, fixtureDoc());
    expect(t.brands.map((b) => b.name)).toEqual(["Mitsubishi Electric"]);
  });

  it("keeps a shared outdoor's charge rule, and only that outdoor's", () => {
    /* without it a multi's refrigerant top-up vanished from the customer's
       materials list while staying on the owner's */
    const d = fixtureDoc();
    const shared = pack.multi_rules[0].odu_model_ref;
    d.systems[1].settings.multiOdu = shared;
    const t = trimPackForLive(pack, d);
    expect(t.multi_rules.map((r) => r.odu_model_ref)).toEqual([shared]);
    expect(t.multi_rules.length).toBeLessThan(pack.multi_rules.length);
  });

  it("a design that shares no outdoor carries no multi rules", () => {
    expect(trimPackForLive(pack, fixtureDoc()).multi_rules).toEqual([]);
  });

  it("an empty design trims to an empty pack", () => {
    const d = createDesign({ name: "E", mode: "blank" });
    const t = trimPackForLive(pack, d);
    expect(t.indoor_units).toEqual([]);
    expect(t.outdoor_units).toEqual([]);
    expect(t.pair_tables).toEqual([]);
    expect(t.brands).toEqual([]);
    expect(t.multi_rules).toEqual([]);
  });
});
