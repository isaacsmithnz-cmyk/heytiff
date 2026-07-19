/* PUMY-SP / PUMY-P (M-P0860) — the first production data to use the
   `index_ratio_band` compatibility method, so this suite exercises that path
   against the real shipped pack: the family loads and validates, every outdoor
   is multi-ready, the band is enforced in BOTH directions, and the branch-box
   parts referenced by every rule resolve.

   The over-index case here is a regression guard: `checkBlock`'s ratio-band arm
   used to skip the per-unit index bounds that `iduEligibleForRule` enforces, so
   a hand-picked out-of-range unit passed silently. It had no production data
   until this family arrived. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { validatePack } from "../packs/validate";
import { outdoorReadiness } from "../packs/ready";
import { checkMultiCompatibility, multiCapableIdus } from "../multi";

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

it("pack still validates with the PUMY family", () => {
  const r = validatePack(pack);
  expect(r.errors).toEqual([]);
});

it("every PUMY outdoor is multi-ready", () => {
  const pumy = pack.outdoor_units.filter((o) => o.model.startsWith("PUMY-"));
  expect(pumy).toHaveLength(11);
  for (const o of pumy) {
    expect(outdoorReadiness(pack, o).roles.multi).toBe(true);
  }
});

it("SP80 accepts an in-band City Multi set and rejects an over-index one", () => {
  const odu = pack.outdoor_units.find((o) => o.model === "PUMY-SP80VKMD2-A")!;
  const rule = pack.multi_rules.find((r) => r.odu_model_ref === odu.model)!;
  const idu = (m: string) => pack.indoor_units.find((u) => u.model === m)!;
  // SP80 band is index 10-100; 9.0 kW outdoor, so 2 x P40 = index 80 -> 80/80
  const ok = checkMultiCompatibility(rule, odu, [idu("PEFY-P40VMHS-E"), idu("PEFY-P40VMX-E")]);
  expect(ok.filter((f) => f.severity === "red")).toEqual([]);
  // P125 is index 125, outside SP80's 10-100 band
  const bad = checkMultiCompatibility(rule, odu, [idu("PEFY-P125VMHS-E")]);
  expect(bad.some((f) => f.code === "outside-index-band")).toBe(true);
});

it("branch boxes exist as parts and every rule's refs resolve", () => {
  const models = new Set(pack.parts.map((p) => p.model));
  expect(models.has("PAC-MK34BC")).toBe(true);
  expect(models.has("PAC-MK54BC")).toBe(true);
  for (const r of pack.multi_rules)
    for (const ref of r.branch_box_refs ?? []) expect(models.has(ref)).toBe(true);
});

it("City Multi indoors are now multi-capable", () => {
  const models = multiCapableIdus(pack).map((u) => u.model);
  expect(models).toContain("PEFY-P40VMHS-E");
  expect(models).toContain("PLFY-P32VEM-A");
});
