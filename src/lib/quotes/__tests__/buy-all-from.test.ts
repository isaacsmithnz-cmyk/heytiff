/* Buy all from (Isaac, 28 October 2026: "select Voltex and all ductwork will
   be quoted at Voltex… blue interconnect cable… use Voltex 2.5"): a group of
   the common install items bought from one supplier, a part chosen on its
   own still its own. */
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
jest.mock("server-only", () => ({}));

import type { Product } from "../families";
import { expandKit, type KitPreferences } from "../kits";
import { pickFor, type ComponentGroup, type ComponentOffer } from "../settings-query";
import { normaliseQuoteSettings, quoteSettingsRow, DEFAULT_QUOTE_SETTINGS } from "../settings";

const offer = (supplierKey: string, code: string, perUnitCents: number): ComponentOffer => ({ supplierKey, supplierName: supplierKey.toUpperCase(), code, pack: null, buyCents: perUnitCents, perUnitCents });
const group = (code: string, ...offers: ComponentOffer[]): ComponentGroup => ({ code, name: code, rollM: null, uses: 0, offers });

describe("what prices a part", () => {
  /* ranked lowest first, as the shortlist hands them over */
  const groups = [group("GE2.5", offer("go", "GE2.5", 173)), group("RX2.5", offer("rexel", "RX2.5", 198)), group("VX2.5", offer("voltex", "VX2.5", 216))];
  const voltex = { key: "voltex", name: "Voltex" };

  it("is the group's supplier's lowest, over the lowest anywhere", () => {
    expect(pickFor(groups, undefined, new Set(), null)).toMatchObject({ offer: { code: "GE2.5" }, overridden: false });
    expect(pickFor(groups, undefined, new Set(), voltex)).toMatchObject({ offer: { code: "VX2.5" }, fromGroup: true });
  });

  it("is a part chosen on its own, whatever its group's supplier", () => {
    expect(pickFor(groups, { supplierKey: "rexel", code: "RX2.5" }, new Set(), voltex)).toMatchObject({ offer: { code: "RX2.5" }, overridden: true });
  });

  it("says so where the group's supplier doesn't sell it, and takes the lowest elsewhere", () => {
    /* ranked lowest first, as the shortlist hands them over */
    const six = [group("RX6", offer("rexel", "RX6", 475)), group("GE6", offer("go", "GE6", 530))];
    expect(pickFor(six, undefined, new Set(), voltex)).toMatchObject({ offer: { code: "RX6" }, notAt: "Voltex" });
  });
});

it("keeps a group's supplier in the settings, a known group's only", () => {
  const s = normaliseQuoteSettings({ group_suppliers: { ductwork: "aad", cable: " voltex ", nonsense: "x", pipe: 3 } });
  expect(s.groupSuppliers).toEqual({ ductwork: "aad", cable: "voltex" });
  expect(quoteSettingsRow(s).group_suppliers).toEqual({ ductwork: "aad", cable: "voltex" });
  expect(normaliseQuoteSettings({}).groupSuppliers).toEqual(DEFAULT_QUOTE_SETTINGS.groupSuppliers);
});

describe("a kit, bought by group", () => {
  let n = 0;
  const product = (supplierKey: string, name: string, cents: number): Product => {
    const code = `${supplierKey}-${n++}`;
    const o = { supplierKey, supplierName: supplierKey, code, name, netCents: cents };
    return { key: `${supplierKey}|${code}`, name, category: "parts" as Product["category"], offers: [o], cheapest: o, preferred: null, brand: null, quotes: 0 };
  };
  const goTwin = product("go", "Flat Twin 2C +E 2.5mm PVC per metre", 173);
  const vxTwin = product("voltex", "2.5mm TPS Twin and Earth Flat Cable per metre", 216);
  const goInter = product("go", "Flat TPS 3C +E A/C 1.5mm Blue per metre", 180);
  const vxInter = product("voltex", "Interconnect 3C+E 1.5mm Grey per metre", 175);
  const books = [goTwin, vxTwin, goInter, vxInter];
  const facts = { pipe: null, pipeM: 10, powerM: 20, amps: 18, mount: "ground" as const, trunkingM: 0, drainM: 0 };
  const at = { optionIndex: 0, system: "Split system" };
  const prefs = (over: Partial<KitPreferences> = {}): KitPreferences => ({ ranges: new Map(), components: {}, suppliers: { cable: "voltex" }, ...over });
  const line = (lines: ReturnType<typeof expandKit>, re: RegExp) => lines.find((l) => re.test(l.name ?? ""))?.name;

  it("buys its cable and power at the group's supplier", () => {
    expect(line(expandKit("split", facts, books, at, null, null, null), /2\.5mm/)).toBe(goTwin.name);
    expect(line(expandKit("split", facts, books, at, null, null, prefs()), /2\.5mm/)).toBe(vxTwin.name);
  });

  it("keeps the interconnect a business chose, and the job's own supplier over the group's", () => {
    const chose = prefs({ components: { interconnect: { supplierKey: "go", code: goInter.offers[0]!.code, rollM: null } } });
    expect(line(expandKit("split", facts, books, at, null, null, chose), /3C/)).toBe(goInter.name);
    expect(line(expandKit("split", facts, books, at, null, "go", prefs()), /2\.5mm/)).toBe(goTwin.name);
  });
});
