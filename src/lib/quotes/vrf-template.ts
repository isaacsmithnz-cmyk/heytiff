import type { BuildLine } from "./buildup";
import type { PriceOf } from "./ducted-template";
import type { ComponentKey } from "./components";
import { QUOTE_COMPONENTS, rollMetresOf } from "./components";
import type { Preferred } from "./settings";
import type { DataPack } from "@/lib/studio/packs/schema";
import { provisionalVrfTree, sizeVrfTree } from "@/lib/studio/vrf-tree";
import { isBoxHead } from "@/lib/studio/multi";
import { isVrfHead } from "@/lib/studio/vrf";

/* A VRF OR PUMY SYSTEM, PRICED FROM THE MANUFACTURER'S BOOK AND THE
   BUSINESS'S OWN CHOICES (Isaac, 2026-10-04: #1352, a PUMY with a branch box
   and five heads, priced as a wall multi with no box and no main line; and
   "whatever you build has to be usable universally by a completely new org…
   data pack from studio is usable by all").

   Two sources and no third:
   - THE DATA PACK (shared by every business): the outdoor, the heads, how
     they connect (City Multi heads on joints, the others on branch boxes),
     every section's pipe size and every joint and box — the Studio's own
     sizer (vrf-tree), so a quote and a design never disagree;
   - THE BUSINESS (its own): what each of those costs from its own price book
     (`priceOf`), and the install kit — pair coil, isolator, wall bracket,
     pump — through the items IT chose on the Quoting page (`kit`, by
     component). A part it hasn't chosen is said, never filled in.

   And nothing guessed: no labour (brief-labour, labour-history), and no pipe
   length the job didn't give — a length not known is said. Pure. */

export type VrfHeadIn = {
  /** the head's model in the data pack */
  model: string;
  /** the code it's bought under, when the price book spells it otherwise
      (the pack's MSZ-AP71VGD2 is bought as MSZ-AP71VGKD2-A2) */
  code?: string;
  /** needs a condensate pump */
  pump?: boolean;
};

export type VrfFacts = {
  outdoor: string;
  heads: VrfHeadIn[];
  /** metres: outdoor to the first joint or box, and each head's own run */
  lengths?: { main?: number | null; perHead?: number | null };
  mount?: "ground" | "wall";
};

export type VrfResult = { lines: BuildLine[]; missing: string[]; findings: string[] };

/* the pair coil component for a liquid + gas pair, where the business has
   one; a VRF's bigger sizes are bought as straight lengths and are said */
const PAIR: Record<string, ComponentKey> = {
  "6.35+9.52": "pair_coil_14_38",
  "6.35+12.7": "pair_coil_14_12",
  "6.35+15.88": "pair_coil_14_58",
  "9.52+15.88": "pair_coil_38_58",
  "9.52+19.05": "pair_coil_38_34",
};
const inch: Record<string, string> = { "6.35": "1/4", "9.52": "3/8", "12.7": "1/2", "15.88": "5/8", "19.05": "3/4", "22.2": "7/8", "25.4": "1", "28.58": "1 1/8" };
const sizeWords = (l: number, g: number) => `${inch[String(l)] ?? l} + ${inch[String(g)] ?? g}`;

export function vrfLines(pack: DataPack, f: VrfFacts, priceOf: PriceOf, kit: Partial<Record<ComponentKey, Preferred>>): VrfResult {
  const lines: BuildLine[] = [];
  const missing: string[] = [];
  const findings: string[] = [];
  const odu = pack.outdoor_units.find((o) => o.model === f.outdoor);
  if (!odu) return { lines, missing: [`${f.outdoor} isn't in the data pack`], findings };

  const unit = (key: string, code: string) => {
    const p = priceOf(code);
    if (!p) return void missing.push(code);
    lines.push({ key, group: "Units", name: p.name, code, supplierKey: p.supplierKey, qty: 1, unitBuyCents: p.buyCents, kind: "unit" });
  };
  /* one of the business's own chosen items for a component, per metre or each */
  const chosen = (key: string, group: string, component: ComponentKey, qty: number, extra: Partial<BuildLine> = {}) => {
    const c = QUOTE_COMPONENTS[component];
    const pick = kit[component];
    if (!pick) return void missing.push(`Choose your ${c.label.toLowerCase()} in Quoting`);
    const p = priceOf(pick.code);
    if (!p) return void missing.push(pick.code);
    const perUnit = c.unit === "m" ? p.buyCents / (pick.rollM ?? rollMetresOf(p.name) ?? 1) : p.buyCents;
    lines.push({ key, group, name: p.name, code: pick.code, supplierKey: p.supplierKey, qty, unitBuyCents: perUnit, kind: "material", ...extra });
  };

  unit("outdoor", odu.model);
  const heads = f.heads.map((h, i) => ({ ...h, id: `h:${i + 1}`, unit: pack.indoor_units.find((u) => u.model === h.model) ?? null }));
  for (const h of heads) {
    if (!h.unit) {
      missing.push(`${h.model} isn't in the data pack`);
      continue;
    }
    unit(`head-${h.id}`, h.code ?? h.model);
  }
  const known = heads.filter((h): h is typeof h & { unit: NonNullable<typeof h.unit> } => !!h.unit);
  /* City Multi heads go on joints; the others on the outdoor's branch boxes */
  const boxed = new Set(known.filter((h) => !isVrfHead(pack, h.unit) && isBoxHead(pack, odu, h.unit)).map((h) => h.id));
  const ports = Math.max(1, ...pack.parts.filter((p) => p.part_type === "branch-box").map((p) => p.ports ?? 0));
  const tree = provisionalVrfTree("odu", known.map((h) => ({ id: h.id, model: h.model })), boxed, ports);
  const sized = sizeVrfTree(pack, odu, tree);
  for (const x of sized.findings) if (x.severity === "red") findings.push(x.code);

  sized.fittings.forEach((fit, i) => {
    if (!fit.part) return void missing.push(`No ${fit.kind} in the book for this system`);
    unit(`${fit.kind}-${i + 1}`, fit.part);
  });

  /* each section, at its size and the length the job gave */
  for (const s of sized.sections) {
    const m = s.role === "main" || s.role === "between" ? f.lengths?.main : f.lengths?.perHead;
    const words = sizeWords(s.liquidMm, s.gasMm);
    const component = PAIR[`${s.liquidMm}+${s.gasMm}`];
    if (!component) {
      missing.push(`${words} pipe (${s.role}): bought as straight lengths`);
      continue;
    }
    if (m == null || !(m > 0)) {
      missing.push(`Pipe length not known: ${words}, ${s.role === "main" ? "outdoor to the first fitting" : "to a head"}`);
      continue;
    }
    chosen(`pipe-${s.id}`, "Pipe and power", component, m, {
      name: `${QUOTE_COMPONENTS[component].label}, ${m} m (${s.role === "main" ? "main line" : s.role === "box" ? "box to a head" : "to a head"})`,
    });
  }

  chosen("isolator", "Pipe and power", "isolator", 1);
  if (f.mount === "wall") chosen("bracket", "Mounting, drain, sundries", "wall_bracket", 1);
  heads.forEach((h) => {
    if (h.pump) chosen(`pump-${h.id}`, "Mounting, drain, sundries", "condensate_pump", 1);
  });

  return { lines, missing, findings };
}
