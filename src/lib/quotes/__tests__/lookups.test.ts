import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import type { Product } from "../families";
import { findInBook, linkedModel, pickItem, unitSpecs } from "../lookups";

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

  it("finds a word as a supplier writes it: no punctuation, its first letters, the trade's short forms", () => {
    const trunk = product("TCAPSG", "TRUNK CAP 2.4M SHALE GREY NSW", 3030);
    const wifi = product("MAC-588IF-E", "Wi-Fi Interface", 6650);
    const ctrl = product("BRC1E63", "DAI WIRED 7 DAY PROG CONTROL", 10101);
    const inter = product("ELCAC7504", "Flat TPS 3C +E A/ C 7/0. 5 1.5mm PVC/ PVC Blue 450/ 750V per metre", 180);
    const rag = product("ECF6040", "EGGCRATE W/FILTER 600X400 ALUM", 4862);
    const all = [...book, trunk, wifi, ctrl, inter, rag];
    const codes = (text: string) => findInBook(all, { text }).map((h) => h.product.offers[0]!.code);
    expect(codes("shale grey trunking")).toEqual(["TCAPSG"]);
    expect(codes("wifi")).toEqual(["MAC-588IF-E"]);
    expect(codes("wired controller")).toEqual(["BRC1E63"]);
    expect(codes("interconnect")).toEqual(["ELCAC7504"]);
    expect(codes("return grille filter")).toEqual(["ECF6040"]);
    /* what has every word as typed still comes first, and alone */
    expect(codes("acoustic 250")).toEqual(["VH250"]);
  });

  it("for a person's search, the items with most of the words when none has them all", () => {
    const rag = product("ECF6040", "EGGCRATE W/FILTER 600X400 ALUM", 4862);
    const hits = findInBook([...book, rag], { text: "filtered return air grille", loose: true });
    expect(hits[0]!.product.offers[0]!.code).toBe("ECF6040");
    /* a kit's pick stays strict */
    expect(findInBook([...book, rag], { text: "filtered return air grille" })).toEqual([]);
    expect(findInBook(book, { text: "nothing like it", loose: true })).toEqual([]);
  });

  /* Isaac, 2026-10-11: "Just do fuzzy book now" */
  it("finds a word typed a letter out, the nearest first, for a person's search or Tiff's; never for a kit's pick or a code", () => {
    expect(findInBook(book, { text: "acoustc flex", loose: true })[0]!.product.offers[0]!.code).toBe("VH250");
    const cone = product("CD200", "CONE DIFFUSER PLASTIC 200", 1289);
    const reducer = product("CR200", "CONE REDUCER 200", 1500);
    expect(findInBook([reducer, cone], { text: "cone difuser 200", loose: true }).map((h) => h.product.offers[0]!.code)).toEqual(["CD200", "CR200"]);
    expect(findInBook([reducer, cone], { text: "difuser", loose: true }).map((h) => h.product.offers[0]!.code)).toEqual(["CD200"]);
    /* a kit's pick stays strict */
    expect(findInBook([reducer, cone], { text: "difuser" })).toEqual([]);
    /* a code a digit out is another part */
    expect(findInBook(book, { text: "vh251", loose: true })).toEqual([]);
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

  /* Isaac, 2026-10-16: the book's order codes for the AP range aren't the
     pack's names, and Diamond Air had linked them on the Quoting page */
  const links = [
    { model: "MSZ-AP35VGD2", code: "MSZ-AP35VGKD2-A2" },
    { model: "MUZ-AP35VG2", code: "MUZ-AP35VGD2-A2" },
  ];
  it("reads an order code the pack doesn't name through the business's confirmed link, saying so", () => {
    expect(unitSpecs(packs, "mitsubishi-electric", "MSZ-AP35VGKD2-A2")).toEqual({ found: false, reason: "not in the pack" });
    expect(unitSpecs(packs, "mitsubishi-electric", "MSZ-AP35VGKD2-A2", links)).toMatchObject({ found: true, linkedFrom: "MSZ-AP35VGKD2-A2", specs: { role: "indoor", model: "MSZ-AP35VGD2" } });
    expect(unitSpecs(packs, "mitsubishi-electric", "MUZ-AP35VGD2-A2", links)).toMatchObject({ found: true, specs: { role: "outdoor", model: "MUZ-AP35VG2" } });
    /* the link holds whatever revision tag the code is written with */
    expect(linkedModel(links, "MSZ-AP35VGKD2")).toBe("MSZ-AP35VGD2");
    expect(linkedModel(links, "MSZ-AP50VGKD2-A2")).toBeNull();
  });

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

  /* 2026-10-15: the pack had a ducted unit's airflow and static pressure,
     and she was never given them */
  it("reads a ducted indoor's airflow and the static pressure it's rated for", () => {
    const r = unitSpecs(packs, "mitsubishi-electric", "PEA-M100HAA");
    expect(r).toMatchObject({ found: true, specs: { role: "indoor", airflowLs: 700, staticPa: 150 } });
    /* a wall split has neither in its data book: nothing said rather than a guess */
    const wall = unitSpecs(packs, "mitsubishi-electric", "MSZ-AP80VGD2");
    if (wall.found) expect(wall.specs.staticPa ?? null).toBeNull();
  });

  it("says a brand has no data pack, rather than guessing", () => {
    expect(unitSpecs(packs, "daikin", "FTXV71WVMA")).toEqual({ found: false, reason: "no data pack" });
  });

  it("says a model isn't in its brand's pack", () => {
    expect(unitSpecs(packs, "mitsubishi-electric", "NOT-A-MODEL-123")).toEqual({ found: false, reason: "not in the pack" });
  });
});
