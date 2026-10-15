import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { installedPacks, latestInstalledPack, loadInstalledPack } from "@/lib/studio/packs/server";
import type { DataPack, ZoningController } from "@/lib/studio/packs/schema";
import { brandNames } from "@/lib/hq/packs";
import { bookProducts } from "./book-view-server";
import { findInBook, unitSpecs, type BookHit, type BookQuery, type ConfirmedLink, type UnitLookup } from "./lookups";
import { pairingOf, type Pairing } from "./pairing";

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

/** The pack links a business has confirmed on the Quoting page: an order
    code and the pack model it is. None without a business. */
export async function confirmedLinks(orgId: string | null | undefined): Promise<ConfirmedLink[]> {
  if (!orgId) return [];
  const { data } = await supabaseAdmin.from("quote_code_links").select("model, code").eq("org_id", orgId).eq("decision", "confirmed");
  return (data ?? []) as ConfirmedLink[];
}

/** A unit's specs off its maker's pack; an order code the pack doesn't
    name, through the business's confirmed links when it's given. */
export async function lookupUnit(brand: string, model: string, orgId?: string | null): Promise<UnitLookup> {
  const key = brand.toLowerCase();
  const [pack, links] = await Promise.all([packFor(key), confirmedLinks(orgId)]);
  return unitSpecs({ [key]: pack }, key, model, links);
}

/** Whether an outdoor takes the indoors given, by its maker's book (pairing.ts). */
export async function lookupPairing(brand: string, outdoor: string, indoors: string[], orgId?: string | null): Promise<Pairing> {
  const [pack, links] = await Promise.all([packFor(brand.toLowerCase()).catch(() => null), confirmedLinks(orgId)]);
  return pairingOf(pack, outdoor, indoors, links);
}
