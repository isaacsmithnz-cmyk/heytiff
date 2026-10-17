/* The refrigerant a system takes on top of its outdoor's own, by its maker's
   book (3209, 17 October: a whole 10 kg cylinder went on a PUMY-SP112 the
   book puts at about 4 kg on the lengths she'd assumed). Read off the
   Mitsubishi Electric pack as installed. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { chargeOf } from "../charge";

const DIR = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
function loadPack(): DataPack {
  const meta = JSON.parse(readFileSync(join(DIR, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(DIR, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const pack = loadPack();
const heads3209 = ["PEFY-P25VMX-E1", "PEFY-P20VMX-E1", "PEFY-P20VMX-E1", "PEFY-P71VMA-E4"];

describe("the refrigerant to add", () => {
  it("is a VRF network's by the book: liquid metres by size, plus the heads' kW, rounded up", () => {
    const c = chargeOf(pack, { outdoor: "PUMY-SP112VKMD2-A", indoors: heads3209, liquidM: { "9.52": 20, "6.35": 30 }, farthestM: 30 });
    /* 20 × 50 g + 30 × 19 g + 2,500 g for 8–16 kW of heads = 4,070 g, up to the 100 g */
    expect(c).toMatchObject({ found: true, system: "vrf", addKg: 4.1, prechargedKg: 3.5, maxKg: 12.5 });
  });

  it("asks for the run to the farthest head before it gives a VRF figure", () => {
    expect(chargeOf(pack, { outdoor: "PUMY-SP112VKMD2-A", indoors: heads3209, liquidM: { "9.52": 20 } })).toMatchObject({ found: true, addKg: null, said: [expect.stringMatching(/farthest head/)] });
  });

  it("is a split pair's by its own rule", () => {
    const c = chargeOf(pack, { outdoor: "PUZ-M100VKA-A", indoors: ["PEA-M100HAA"], liquidM: { "9.52": 40 } });
    expect(c).toMatchObject({ found: true, system: "split" });
    expect(c.found && c.addKg).toBeGreaterThan(0);
  });

  it("says when a model isn't in the pack, and reads a confirmed link", () => {
    expect(chargeOf(pack, { outdoor: "PUMY-SP112VKMD2-A", indoors: ["XYZ-1"], liquidM: {} })).toEqual({ found: false, reason: "not in the pack", model: "XYZ-1" });
    expect(chargeOf(null, { outdoor: "PUMY-SP112VKMD2-A", indoors: [], liquidM: {} })).toEqual({ found: false, reason: "no data pack" });
    const links = [{ model: "MSZ-AP35VGD2", code: "MSZ-AP35VGKD2-A2" }, { model: "MUZ-AP35VG2", code: "MUZ-AP35VGD2-A2" }];
    expect(chargeOf(pack, { outdoor: "MUZ-AP35VGD2-A2", indoors: ["MSZ-AP35VGKD2-A2"], liquidM: { "6.35": 5 } }, links)).toMatchObject({ found: true, system: "split" });
  });
});
