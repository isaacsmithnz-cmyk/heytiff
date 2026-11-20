import type { DesignDocument } from "../document";
import { emptyPack, PACK_SCHEMA_VERSION, type DataPack } from "./schema";
import { resolvePacks } from "./loader";

/* EVERY BRAND A DESIGN NAMES, AS ONE PACK (Isaac, 20 November 2026, on the
   Studio panel: "by default always selects Mitsubishi Electric. That
   shouldn't be on there"). A system is one brand, the one the person chose;
   a design may hold systems of several. The engines that read the whole
   design (the plan, coverage, the sim, the summary, the paper) look a unit
   up by its model, and a model is unique across the installed packs, so they
   read one pack made of every brand the design names. What a system OFFERS
   (its units, its outdoors, its kit) is that system's brand alone:
   `brandOnly` below. */

/** No brand's pack: what a system with no brand yet is offered, which is
    nothing until the person chooses one. */
export const NO_PACK: DataPack = emptyPack({ brand: "", version: "", packSchemaVersion: PACK_SCHEMA_VERSION, name: "" });

/** The brands a design's systems name, in the order the systems were made.
    A system with no brand yet names none. */
export function designBrands(doc: Pick<DesignDocument, "systems">): string[] {
  const out: string[] = [];
  for (const s of doc.systems) if (s.brand && !out.includes(s.brand)) out.push(s.brand);
  return out;
}

/** Several brands' packs as one (loader.ts resolvePacks; a model is unique
    across brands, so no brand's row stands over another's). Its brand is the
    one brand when there is one and empty when there are several, so nothing
    reads a brand off a pack that holds more than one. */
export function joinPacks(packs: readonly DataPack[]): DataPack | null {
  if (packs.length === 0) return null;
  if (packs.length === 1) return packs[0];
  const joined = resolvePacks([...packs]);
  return { ...joined, meta: { ...joined.meta, brand: "" } };
}

/** A pack cut to one brand: its units, parts and accessories of that brand,
    its zoning ranges that take it, and every rule (rules are keyed by an
    outdoor's model, so another brand's never matches). Its meta names the
    brand. A pack already of one brand comes back as it is. */
export function brandOnly(pack: DataPack, brand: string): DataPack {
  if (pack.meta.brand === brand) return pack;
  const mine = <T extends { brand?: string }>(rows: readonly T[] | undefined): T[] =>
    (rows ?? []).filter((r) => !r.brand || r.brand === brand);
  return {
    ...pack,
    meta: { ...pack.meta, brand },
    brands: pack.brands.filter((b) => b.id === brand),
    indoor_units: mine(pack.indoor_units),
    outdoor_units: mine(pack.outdoor_units),
    parts: mine(pack.parts),
    accessories: mine(pack.accessories as { brand?: string }[]) as DataPack["accessories"],
    zoning_controllers: (pack.zoning_controllers ?? []).filter(
      (c) => !c.compatible_brands?.length || c.compatible_brands.includes(brand)
    ),
  };
}
