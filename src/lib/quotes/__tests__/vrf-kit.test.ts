/* A VRF's run by its maker's table, for a kit (Isaac, 2026-10-24: "ok" to
   the VRF kit). The Studio's own sizing on the chain of joints it starts a
   VRF with, read off the Mitsubishi Electric pack as installed. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { vrfPlanOf, type VrfAsk } from "../vrf-kit";

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
const ask = (outdoor: string, heads: string[], o: Partial<VrfAsk> = {}): VrfAsk => ({ outdoor, heads: heads.map((model) => ({ model })), mainM: 10, betweenM: 3, branchM: 5, ...o });

it("sizes 27 Milroy's upstairs PUMY as the book does: a CMY-Y62 joint at each split, the run at 3/8 + 5/8 and the branches at 1/4 + 1/2", () => {
  const p = vrfPlanOf(pack, ask("PUMY-SP140VKMD2-A", ["PEFY-P20VMX-E", "PEFY-P20VMX-E", "PEFY-P20VMX-E", "PEFY-P15VMX-E"]));
  if (!p.ok) throw new Error(p.why);
  expect(p).toMatchObject({ outdoor: "PUMY-SP140VKMD2-A", heads: 4, vrfHeads: 4, totalM: 36 });
  expect(p.pipes).toEqual([
    { liquidMm: 9.52, gasMm: 15.88, m: 16, sections: 3 },
    { liquidMm: 6.35, gasMm: 12.7, m: 20, sections: 4 },
  ]);
  expect(p.fittings).toEqual([{ part: "CMY-Y62-G-E", kind: "joint", qty: 3, index: [75, 55, 35] }]);
  expect(p.from).toContain("M-P0860");
});

it("puts a head the outdoor takes on a branch box there, with its own pipe, and gives it no wall controller", () => {
  const p = vrfPlanOf(pack, ask("PUMY-SP112VKMD2-A", ["MSZ-AP25VGD2", "MSZ-AP35VGD2", "PEFY-P20VMX-E"]));
  if (!p.ok) throw new Error(p.why);
  expect(p.vrfHeads).toBe(1);
  expect(p.fittings).toEqual([
    { part: "PAC-MK34BC", kind: "box", qty: 1, index: [60] },
    { part: "CMY-Y62-G-E", kind: "joint", qty: 1, index: [80] },
  ]);
});

it("picks a City Multi outdoor's joints by the index after each", () => {
  const p = vrfPlanOf(pack, ask("PUHY-P250YNW-A1", ["PEFY-P63VMX-E", "PEFY-P63VMX-E", "PEFY-P71VMA-E4", "PLFY-P32VEM-A"], { mainM: 20, branchM: 8 }));
  if (!p.ok) throw new Error(p.why);
  expect(p.fittings).toEqual([
    { part: "CMY-Y102LS-G2", kind: "joint", qty: 1, index: [229] },
    { part: "CMY-Y102SS-G2", kind: "joint", qty: 2, index: [166, 103] },
  ]);
  expect(p.pipes[0]).toMatchObject({ liquidMm: 9.52, gasMm: 22.2, m: 20 });
});

it("leaves a size's metres not known when a length isn't given, and says what it can't size", () => {
  const p = vrfPlanOf(pack, ask("PUMY-P200YKMD2-A", ["PEFY-P63VMX-E", "PEFY-P63VMX-E", "PEFY-P71VMA-E4"], { betweenM: null }));
  if (!p.ok) throw new Error(p.why);
  expect(p.totalM).toBeNull();
  expect(p.pipes.find((x) => x.gasMm === 15.88)!.m).toBeNull();
  expect(vrfPlanOf(pack, ask("PUMY-SP140VKMD2-A", ["XYZ-123456"]))).toEqual({ ok: false, why: "XYZ-123456 isn't in the data pack" });
  expect(vrfPlanOf(pack, ask("MUZ-AP25VG2", ["MSZ-AP25VGD2"]))).toEqual({ ok: false, why: "MUZ-AP25VG2 isn't a VRF outdoor: its own kit is the split's" });
  expect(vrfPlanOf(pack, ask("PUMY-SP140VKMD2-A", []))).toEqual({ ok: false, why: "Needs the heads" });
  expect(vrfPlanOf(null, ask("PUMY-SP140VKMD2-A", ["PEFY-P20VMX-E"]))).toEqual({ ok: false, why: "No data pack for this maker" });
});

it("reads an order code the pack doesn't name through the business's confirmed link", () => {
  const p = vrfPlanOf(pack, ask("PUMY-SP140VKMD2-A.TH", ["PEFY-P20VMX-A1"]), [{ code: "PEFY-P20VMX-A1", model: "PEFY-P20VMX-E" }]);
  expect(p.ok).toBe(true);
});
