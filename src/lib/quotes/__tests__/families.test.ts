/* The price book sorted: a shelf's parts into families by their name with
   the sizes taken out, sizes in order, the business's preferred and most
   used first. Names are the suppliers' own, as their files send them. */
import { BUILT_IN_SUPPLIERS, type Supplier } from "../price-book";
import { countsOf, familyOf, organise, productsFrom, sizesOf, viewOf, type ShelfItem } from "../families";

const SUPPLIERS: Supplier[] = [
  ...BUILT_IN_SUPPLIERS,
  { key: "go_electrical", name: "Go Electrical", pricing: "net", file: "xlsx", format: "headed", discountPct: 0, rules: [] },
];
const item = (supplierKey: string, code: string, name: string, cents: number, timesBought: number | null = null): ShelfItem => ({
  supplierKey,
  code,
  name,
  cents,
  pricedOn: null,
  timesBought,
});

const BOOK: ShelfItem[] = [
  item("aad", "PC1458", "PAIRED COIL 1/4+5/8X20M (6.35-15.88) 9mm(R.61/.49)", 26251),
  item("aad", "PC1412", "PAIRED COIL 1/4+1/2X20M (6.35-12.7) 9mm (R.61/.52)", 19100),
  item("aad", "PC51438", "PAIRED COIL 1/4 + 3/8 X 5M 9mm(R.61/.55)", 4289),
  item("aad", "PC1438", "PAIRED COIL 1/4+3/8X20M (6.35-9.52) 9mm (R.61/.55)", 15747),
  item("reece", "9800006-1", 'ARDENT PR CU 1/4" X 1/2" R410A 20M (COIL)', 18000),
  item("reece", "1313216-1", "AIRFORM FULLCONE ROUND DIFFUSER 200MM (EA)", 2024),
  item("reece", "1313215-1", "AIRFORM FULLCONE ROUND DIFFUSER 150MM (EA)", 1716),
  item("reece", "2704973-1", "WEATHERPROOF ISOLATOR 1 POLE 35 AMPS (EA)", 2611),
  item("reece", "8028304-1", "WEATHERPROOF ISOLATOR 2 POLE 20 AMPS (EA)", 1828),
  item("go_electrical", "CBL2.5TE", "Flat Twin 2C +E 2.5mm PVC/ PVC White 450- 750V per metre", 173, 53),
  item("aad", "CMADJ", "NEOPRENE COND MOUNT ADJUSTABLE NSW", 1450),
];

it("takes the sizes out of a name to find its family", () => {
  expect(familyOf("PAIRED COIL 1/4+1/2X20M (6.35-12.7) 9mm (R.61/.52)")).toEqual({ key: "PAIRED COIL", label: "Paired coil" });
  expect(familyOf("PAIRED COIL 1/4 + 3/8 X 5M 9mm(R.61/.55)").key).toBe("PAIRED COIL");
  expect(familyOf("AIRFORM FULLCONE ROUND DIFFUSER 150MM (EA)").label).toBe("Airform fullcone round diffuser");
  expect(familyOf("WEATHERPROOF ISOLATOR 1 POLE 35 AMPS (EA)").key).toBe(familyOf("WEATHERPROOF ISOLATOR 2 POLE 20 AMPS (EA)").key);
  /* a name in its own case keeps it */
  expect(familyOf("'Clip-in' motorised damper 250 dia").label).toBe("Clip-in motorised damper");
  /* a short trade word stays in capitals */
  expect(familyOf("JET DIFFUSER GLOSS ABS 150").label).toBe("Jet diffuser gloss ABS");
});

it("sorts a family by its sizes, a fraction by its value", () => {
  expect(sizesOf("PAIRED COIL 1/4+3/8X20M (6.35-9.52)")).toEqual([0.25, 0.375, 20]);
  const coil = organise(productsFrom(BOOK, SUPPLIERS, [], new Set(), new Map())).find((f) => f.key === "PAIRED COIL")!;
  expect(coil.products.map((p) => p.offers[0]!.code)).toEqual(["PC51438", "PC1438", "PC1412", "PC1458"]);
});

it("makes one part of one item at two suppliers, priced at each", () => {
  const products = productsFrom(BOOK, SUPPLIERS, [["aad|PC1412", "reece|9800006-1"]], new Set(), new Map());
  const coil = products.find((p) => p.offers.some((o) => o.code === "PC1412"))!;
  expect(coil.offers.map((o) => [o.supplierKey, o.netCents])).toEqual([
    ["reece", 18000],
    ["aad", 19100],
  ]);
  expect(coil.cheapest?.supplierKey).toBe("reece");
});

it("puts the preferred part and its family first, then the most quoted", () => {
  const products = productsFrom(BOOK, SUPPLIERS, [], new Set(["reece|2704973-1"]), new Map([["CMADJ", 42], ["CBL2.5TE", 3]]));
  const families = organise(products);
  expect(families[0]!.label).toBe("Weatherproof isolator");
  expect(families[0]!.products[0]!.preferred?.code).toBe("2704973-1");
  /* then by quotes: the mount on 42, the cable on 3 */
  expect(families.slice(1, 3).map((f) => f.label)).toEqual(["Neoprene cond mount adjustable NSW", "Flat Twin E PVC PVC White"]);
});

/* Isaac, 2026-10-05: "the most used should come from quotes" — not what
   was bought on invoices, however often */
it("counts most used by quotes alone, never by what invoices say was bought", () => {
  const products = productsFrom(BOOK, SUPPLIERS, [], new Set(), new Map([["CMADJ", 42]]));
  expect(countsOf(products).used).toBe(1);
  expect(viewOf(products, "used", "").sections.flatMap((s) => s.families.flatMap((f) => f.products.map((p) => [p.offers[0]!.code, p.quotes])))).toEqual([["CMADJ", 42]]);
});

it("lists the most used by shelf, the preferred, a shelf in families, and a search of the whole book", () => {
  const products = productsFrom(BOOK, SUPPLIERS, [], new Set(["aad|PC1412"]), new Map([["CMADJ", 42], ["CBL2.5TE", 3]]));
  const used = viewOf(products, "used", "");
  expect(countsOf(products)).toMatchObject({ used: 2, preferred: 1 });
  expect(used.sections.map((s) => s.label)).toEqual(["Mounting and covering", "Electrical"]);

  expect(viewOf(products, "preferred", "").sections[0]!.families[0]!.products[0]!.preferred?.code).toBe("PC1412");

  const pipe = viewOf(products, "pipe", "");
  expect(pipe.sections).toHaveLength(1);
  expect(pipe.sections[0]!.families.map((f) => [f.label, f.products.length])).toEqual([
    ["Paired coil", 4],
    ["Ardent PR CU", 1],
  ]);

  expect(viewOf(products, "all", "").total).toBe(0);
  expect(viewOf(products, "all", "diffuser 200").sections[0]!.families[0]!.products[0]!.offers[0]!.code).toBe("1313216-1");
});

it("sorts units by maker, then by type and part, each in kW order", () => {
  const units = [
    item("aad", "FTXZ50", "DAIKIN ZENA HWS IND 5KW R32", 150000),
    item("aad", "FTXZ25", "DAIKIN ZENA HWS IND 2.5KW R32", 100000),
    item("aad", "FDYA125", "DAIKIN PREM DUCT OUT 12.5KW R32 1P", 300000),
    item("aad", "ASTG09KMTC", "FUJITSU LIFESTYLE R/C HWS IND 2.5KW", 22248),
    item("reece", "3102341-1", "FUJITSU WALL MOUNTED AC ASTG09KMTC 2.5KW (EA)", 85170),
    item("mitsubishi", "MSZ-AP25VGD2-A1", "Indoor Unit - wireless R/C", 90000),
    item("aad", "MYSTERY1", "INDOOR UNIT 2.5KW R32", 50000),
  ];
  const products = productsFrom(units, SUPPLIERS, [], new Set(), new Map());
  const shelf = viewOf(products, "units", "");
  expect(shelf.sections.map((s) => s.label)).toEqual(["Daikin", "Fujitsu", "Mitsubishi Electric", "Other makes"]);
  const daikin = shelf.sections[0]!;
  expect(daikin.families.map((f) => f.label)).toEqual(["Wall split indoor", "Ducted outdoor"]);
  expect(daikin.families[0]!.products.map((p) => p.offers[0]!.code)).toEqual(["FTXZ25", "FTXZ50"]);
  /* the head and the whole system are two families, never one */
  expect(shelf.sections[1]!.families.map((f) => f.label)).toEqual(["Wall split system", "Wall split indoor"]);
});

it("takes the maker's words off a family under its heading on a shelf sorted by maker", () => {
  const products = productsFrom(
    [item("aad", "DZC4", "DAI 4 ZONE CONTROLLER 24V", 30000), item("aad", "DZC8", "DAI 8 ZONE CONTROLLER 24V", 40000)],
    SUPPLIERS,
    [],
    new Set(),
    new Map()
  );
  const shelf = viewOf(products, "controls", "");
  expect(shelf.sections.map((s) => s.label)).toEqual(["Daikin"]);
  expect(shelf.sections[0]!.families.map((f) => [f.label, f.products.length])).toEqual([["Zone controller", 2]]);
});

it("draws every family on a shelf, however big; only a list of parts is capped", () => {
  const many = Array.from({ length: 320 }, (_, i) => item("aad", `DAI${i}`, `DAIKIN ZENA HWS IND ${(i % 9) + 2}KW R32 V${i}`, 1000 + i));
  const more = [item("aad", "FUJ1", "FUJITSU LIFESTYLE R/C HWS IND 2.5KW", 22248)];
  const products = productsFrom([...many, ...more], SUPPLIERS, [], new Set(), new Map());
  const shelf = viewOf(products, "units", "");
  expect(shelf.sections.map((s) => s.label)).toEqual(["Daikin", "Fujitsu"]);
  expect(shelf.shown).toBe(321);
  expect(viewOf(products, "all", "daikin").shown).toBeLessThanOrEqual(320);
});
