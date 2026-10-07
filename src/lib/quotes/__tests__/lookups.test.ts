import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import type { Product } from "../families";
import { findInBook, pickItem, unitSpecs } from "../lookups";

/* What a quote looks things up in (slice 1.1): the business's book, ranked
   the way it buys, and the maker's data pack for what a unit is. */

const SEED = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
const shipped = (): DataPack => {
  const meta = JSON.parse(readFileSync(join(SEED, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(SEED, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
};

const offer = (code: string, name: string, netCents: number) => ({ supplierKey: "aad", supplierName: "AAD", code, name, netCents });
const product = (code: string, name: string, cents: number, o: Partial<Product> = {}): Product => {
  const of = offer(code, name, cents);
  return { key: `aad|${code}`, name, category: "ductwork" as Product["category"], offers: [of], cheapest: of, preferred: null, brand: null, quotes: 0, ...o };
};

/* 3384's five bags of flex: every 250 in the book */
const vb250 = product("VB250", "VORTEX FLEXIBLE DUCT R1.0 250MM X 6M", 3045, { quotes: 12 });
const vh250 = product("VH250", "VORTEX ACOUSTIC FLEX R1.0 250MM X 6M", 2921);
const vf250 = product("VF250", "VORTEX FLEX R0.6 250MM X 6M", 2495);
const vs250 = product("VS250", "VORTEX SUPERIOR FLEX R2.0 250MM X 6M", 5979);
const vb300 = product("VB300", "VORTEX FLEXIBLE DUCT R1.0 300MM X 6M", 3564, { quotes: 20 });
const book = [vs250, vf250, vh250, vb250, vb300];

describe("the book, as the business buys", () => {
  it("finds a size, most-quoted first, then the cheapest, and says why", () => {
    const hits = findInBook(book, { text: "vortex", sizeMm: 250 });
    expect(hits.map((h) => [h.product.offers[0]!.code, h.why])).toEqual([
      ["VB250", "On your quotes"],
      ["VF250", "Cheapest"],
      ["VH250", "In your book"],
      ["VS250", "In your book"],
    ]);
  });

  it("puts the business's preferred item first, whatever else is used more", () => {
    const pref = { ...vh250, preferred: vh250.offers[0]! };
    const hits = findInBook([vb250, pref, vf250], { text: "flex", sizeMm: 250 });
    expect(hits[0]).toMatchObject({ why: "Your preferred", buyCents: 2921 });
  });

  it("matches every word in the code or the name", () => {
    expect(findInBook(book, { text: "acoustic 250" }).map((h) => h.product.name)).toEqual(["VORTEX ACOUSTIC FLEX R1.0 250MM X 6M"]);
    expect(findInBook(book, { text: "vh250" })).toHaveLength(1);
    expect(findInBook(book, { text: "nothing like it" })).toEqual([]);
  });

  it("stops at the limit", () => {
    expect(findInBook(book, { text: "vortex", limit: 2 })).toHaveLength(2);
  });
});

describe("which item, which supplier", () => {
  it("takes the business's preferred, else the most quoted, at its cheapest supplier", () => {
    const two = { ...vb250, offers: [offer("VB250", vb250.name, 3045), { ...offer("VB250", vb250.name, 3300), supplierKey: "jz", supplierName: "J&Z" }] };
    expect(pickItem([vf250, two], { text: "flex", sizeMm: 250 })).toMatchObject({ product: { key: "aad|VB250" }, offer: { supplierKey: "aad", netCents: 3045 }, why: "On your quotes" });
    const pref = { ...vf250, preferred: vf250.offers[0]! };
    expect(pickItem([two, pref], { text: "flex", sizeMm: 250 })).toMatchObject({ offer: { code: "VF250" }, why: "Your preferred" });
  });
  it("is nothing when the book has nothing that fits", () => {
    expect(pickItem(book, { text: "ergovent" })).toBeNull();
  });
});

describe("a unit, from its maker's data pack", () => {
  const packs = { "mitsubishi-electric": shipped() };

  it("reads an outdoor unit's size, weight, sound, phase and current, and its pipe", () => {
    const r = unitSpecs(packs, "mitsubishi-electric", "PUZ-ZM125VKA2");
    expect(r.found).toBe(true);
    if (!r.found) return;
    expect(r.specs.role).toBe("outdoor");
    expect(r.specs.coolKw).toBeGreaterThan(10);
    expect(r.specs.phase).toBeTruthy();
    expect(r.specs.pipeMm!.liquid).toBeGreaterThan(0);
  });

  it("reads an indoor unit", () => {
    const r = unitSpecs(packs, "mitsubishi-electric", "MSZ-AP80VGD2");
    expect(r).toMatchObject({ found: true, specs: { role: "indoor" } });
    if (r.found) expect(r.specs.coolKw).toBe(7.8);
  });

  it("says a brand has no data pack, rather than guessing", () => {
    expect(unitSpecs(packs, "daikin", "FTXV71WVMA")).toEqual({ found: false, reason: "no data pack" });
  });

  it("says a model isn't in its brand's pack", () => {
    expect(unitSpecs(packs, "mitsubishi-electric", "NOT-A-MODEL-123")).toEqual({ found: false, reason: "not in the pack" });
  });
});
