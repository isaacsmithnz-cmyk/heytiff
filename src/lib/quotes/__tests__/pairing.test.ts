/* Whether an outdoor takes the indoors on a quote, by its maker's book (the
   bench, 15 October: a VRF ducted head went on a multi outdoor, and nothing
   could check it). Read off the Mitsubishi Electric pack as installed. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { pairingOf } from "../pairing";

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

describe("whether an outdoor takes its indoors", () => {
  it("refuses a VRF ducted head on a multi outdoor, in the book's words", () => {
    const p = pairingOf(pack, "MXZ-6F120VGD", ["PEFY-P63VMA-E4", "PEFY-P63VMA-E4"]);
    expect(p).toMatchObject({ found: true, system: "multi", connects: false });
    expect(p.found && p.said.join(" ")).toMatch(/PEFY-P63VMA-E4/);
  });

  it("takes a set of wall heads the multi's book allows", () => {
    expect(pairingOf(pack, "MXZ-4F80VGD", ["MSZ-AP25VGD2", "MSZ-AP25VGD2", "MSZ-AP25VGD2"])).toMatchObject({ found: true, system: "multi", connects: true });
  });

  it("takes a split's own pair, at the pair's rated capacity", () => {
    expect(pairingOf(pack, "PUZ-M100VKA-A", ["PEA-M100HAA"])).toMatchObject({ found: true, system: "split", connects: true, rated: { coolKw: 10, heatKw: 12.5 } });
  });

  it("refuses an indoor that isn't the split's pair, saying what it does pair with", () => {
    const p = pairingOf(pack, "PUZ-M100VKA-A", ["MSZ-AP35VGD2"]);
    expect(p).toMatchObject({ found: true, system: "split", connects: false });
    expect(p.found && p.pairsWith).toContain("PEA-M100HAA");
    expect(pairingOf(pack, "PUZ-M100VKA-A", ["PEA-M100HAA", "PEA-M100HAA"])).toMatchObject({ connects: false });
  });

  /* Isaac, 2026-10-16: the book's AP order codes, linked on the Quoting page */
  it("reads order codes the pack doesn't name through the business's confirmed links, saying so", () => {
    const links = [
      { model: "MSZ-AP35VGD2", code: "MSZ-AP35VGKD2-A2" },
      { model: "MUZ-AP35VG2", code: "MUZ-AP35VGD2-A2" },
    ];
    expect(pairingOf(pack, "MUZ-AP35VGD2-A2", ["MSZ-AP35VGKD2-A2"])).toMatchObject({ found: false, reason: "not in the pack" });
    const p = pairingOf(pack, "MUZ-AP35VGD2-A2", ["MSZ-AP35VGKD2-A2"], links);
    expect(p).toMatchObject({ found: true, system: "split", connects: true });
    expect(p.found && p.said).toEqual(expect.arrayContaining(["MUZ-AP35VGD2-A2 read as MUZ-AP35VG2, your confirmed link", "MSZ-AP35VGKD2-A2 read as MSZ-AP35VGD2, your confirmed link"]));
  });

  it("says when a model isn't in the pack, or there's no pack", () => {
    expect(pairingOf(pack, "PUZ-M100VKA2-A", ["PEA-M100HAA"])).toEqual({ found: false, reason: "not in the pack", model: "PUZ-M100VKA2-A" });
    expect(pairingOf(pack, "PUZ-M100VKA-A", ["XYZ-123456"])).toEqual({ found: false, reason: "not in the pack", model: "XYZ-123456" });
    expect(pairingOf(null, "PUZ-M100VKA-A", ["PEA-M100HAA"])).toEqual({ found: false, reason: "no data pack" });
  });
});
