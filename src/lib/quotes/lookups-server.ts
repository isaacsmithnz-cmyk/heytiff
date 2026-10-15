import "server-only";
import { installedPacks, latestInstalledPack, loadInstalledPack } from "@/lib/studio/packs/server";
import type { DataPack, ZoningController } from "@/lib/studio/packs/schema";
import { brandNames } from "@/lib/hq/packs";
import { bookProducts } from "./book-view-server";
import { findInBook, unitSpecs, type BookHit, type BookQuery, type UnitLookup } from "./lookups";

/* The lookups (lookups.ts), read for one business: its own book, and the
   installed data packs, which every business shares. The callers gate on
   workboard_manage and financials: a book hit carries what it costs. */

export async function lookupBook(orgId: string, q: BookQuery): Promise<BookHit[]> {
  return findInBook(await bookProducts(orgId), q);
}

/** A brand's installed pack, or null when the brand has none. */
async function packFor(brand: string): Promise<DataPack | null> {
  const ref = await latestInstalledPack(brand.toLowerCase());
  return ref ? (await loadInstalledPack(ref.brand, ref.version)).pack : null;
}

/** A brand's zone system from its pack: the one made for it, else none. */
export async function zoningFor(brand: string): Promise<ZoningController | null> {
  const pack = await packFor(brand).catch(() => null);
  const key = brand.toLowerCase();
  return pack?.zoning_controllers.find((z) => !z.compatible_brands || z.compatible_brands.includes(key)) ?? null;
}

/** Every maker with a data pack installed (data/packs/<brand>@<version>),
    by the key a lookup reads it by and in words: what a kit's unit can be
    read off. None is anyone's default (2026-10-15: the kit form offered
    Mitsubishi Electric or nothing, and started every business on it). */
export async function packMakers(baseDir?: string): Promise<{ key: string; name: string }[]> {
  /* in the words its own pack gives it (brands.json): a key title-cased
     would make an "lg" pack "Lg" */
  const [refs, names] = await Promise.all([installedPacks(baseDir).catch(() => []), brandNames(baseDir).catch(() => new Map<string, string>())]);
  return [...new Set(refs.map((r) => r.brand))].map((key) => ({ key, name: names.get(key) ?? key.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") }));
}

export async function lookupUnit(brand: string, model: string): Promise<UnitLookup> {
  const key = brand.toLowerCase();
  return unitSpecs({ [key]: await packFor(key) }, key, model);
}
