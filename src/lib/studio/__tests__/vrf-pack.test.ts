/* PUHY-P200–500YNW-A1 (MEES21K029) — the VRF facts the engine will read,
   checked against the real shipped pack. The charge case is the book's own
   worked example (p.144): golden set D starts here, so the evaluator is
   judged by the book, never by a number worked out for the test. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type AdditionalChargeRule, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { validatePack } from "../packs/validate";
import { outdoorReadiness } from "../packs/ready";
import { evaluateVrfCharge } from "../materials";

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
const table = pack.vrf_pipe_tables.find((t) => t.series === "PUHY-P200-500YNW-A1")!;
const charge = table.additional_charge as Extract<
  AdditionalChargeRule,
  { method: "per_meter_by_liquid_size_by_farthest" }
>;

it("the pack validates and every PUHY outdoor is VRF-ready", () => {
  expect(validatePack(pack).errors).toEqual([]);
  const puhy = pack.outdoor_units.filter((o) => o.model.startsWith("PUHY-"));
  expect(puhy).toHaveLength(7);
  for (const o of puhy) expect(outdoorReadiness(pack, o).roles["vrf-odu"]).toBe(true);
});

it("every PUHY outdoor has a bend length, a direct header and a charge row", () => {
  const puhy = pack.outdoor_units.filter((o) => o.model.startsWith("PUHY-")).map((o) => o.model);
  const bends = table.limits.bend_equiv_m_by_odu ?? {};
  const direct = new Set((table.header_selection?.steps ?? []).flatMap((s) => s.direct_odus ?? []));
  for (const m of puhy) {
    expect(bends[m]).toBeGreaterThan(0);
    expect(direct.has(m)).toBe(true);
    expect(charge.plus_by_odu?.[m]).toBe(0);
  }
});

describe("additional charge (MEES21K029 p.143-144)", () => {
  it("the book's worked example: PUHY-P350 with P125/P100/P40/P32/P63 is 12.5 kg", () => {
    // A 40 m of 12.7 + e 10 m of 12.7; B C D a b d of 9.52; c 10 m of 6.35.
    // Farthest is past 30.5 m (A alone is 40), so the longer band's rates apply.
    const g = evaluateVrfCharge(charge, {
      liquidM: { "12.7": 50, "9.52": 60, "6.35": 10 },
      farthestM: 40 + 10 + 10,
      connectedIndex: 125 + 100 + 40 + 32 + 63,
      oduModel: "PUHY-P350YNW-A1",
      iduModels: [],
    });
    expect(g).toBe(12500);
  });

  it("a network within 30.5 m uses the shorter band's rates", () => {
    const g = evaluateVrfCharge(charge, {
      liquidM: { "9.52": 10 },
      farthestM: 30.5,
      connectedIndex: 80,
      oduModel: "PUHY-P200YNW-A1",
      iduModels: [],
    });
    expect(g).toBe(10 * 60 + 2000);
  });

  it("a named indoor unit adds its own charge", () => {
    const base = { liquidM: {}, farthestM: 10, connectedIndex: 20, oduModel: "PUHY-P200YNW-A1" };
    expect(evaluateVrfCharge(charge, { ...base, iduModels: ["PEFY-P20VMA3-E"] })).toBe(2600); // 2000 + 540, rounded up to the next 100 g
  });

  it("a liquid size the book gives no rate for is no figure at all", () => {
    expect(
      evaluateVrfCharge(charge, {
        liquidM: { "22.2": 5 },
        farthestM: 10,
        connectedIndex: 80,
        oduModel: "PUHY-P200YNW-A1",
        iduModels: [],
      })
    ).toBeNull();
  });
});
