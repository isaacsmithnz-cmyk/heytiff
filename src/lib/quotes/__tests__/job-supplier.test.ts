/* One supplier for the whole job (Isaac, 2026-10-08: "select aad to use only
   items from their price book unless something doesn't show up"): its
   offer wherever it sells the item, over the business's preferred; the
   lowest, or the preferred, only where it doesn't. */
import type { Product } from "../families";
import { expandKit } from "../kits";
import { byHandOf, withSupplier } from "../lines-job";
import { offerFor, pickItem } from "../lookups";
import { bookPrice } from "../session/tools";

const offer = (supplierKey: string, code: string, cents: number, name = code) => ({ supplierKey, supplierName: supplierKey.toUpperCase(), code, name, netCents: cents });
const product = (name: string, offers: ReturnType<typeof offer>[], o: Partial<Product> = {}): Product =>
  ({ key: `${offers[0]!.supplierKey}|${offers[0]!.code}`, name, category: "parts", offers, cheapest: [...offers].sort((a, b) => a.netCents - b.netCents)[0]!, preferred: null, brand: null, quotes: 0, ...o }) as Product;

const isoReece = offer("reece", "3421175-1", 2100, "ISOLATOR 20A 2P IP66");
const isoAad = offer("aad", "ALSIPW201", 2279, "ISOLATOR 20A 2P IP66");
const BOOK = [
  product("ISOLATOR 20A 2P IP66", [isoReece, isoAad], { preferred: isoReece }),
  product("RCBO 20A 30MA 1P+N", [offer("rexel", "HAGADC920T", 3886, "RCBO 20A 30MA 1P+N")]),
];

it("buys from the job's supplier where it sells the item, over the preferred and the lowest", () => {
  expect(offerFor(BOOK[0]!)!.supplierKey).toBe("reece");
  expect(offerFor(BOOK[0]!, "aad")!.supplierKey).toBe("aad");
  /* an item it doesn't sell comes from where it does */
  expect(offerFor(BOOK[1]!, "aad")!.supplierKey).toBe("rexel");
  expect(pickItem(BOOK, { text: "isolator" }, "aad")!.offer.code).toBe("ALSIPW201");
});

it("kits and Tiff's lines buy from it too, the same item at its price", () => {
  const lines = expandKit("split", { pipe: null, pipeM: null, powerM: null, amps: 18, mount: "ground", trunkingM: null, drainM: null }, BOOK, { optionIndex: 0, system: "S" }, null, "aad");
  expect(lines.find((l) => /ISOLATOR/.test(l.name ?? ""))).toMatchObject({ code: "ALSIPW201", supplierKey: "aad", costCents: 2279 });
  expect(lines.find((l) => /RCBO/.test(l.name ?? ""))).toMatchObject({ supplierKey: "rexel" });
  expect(bookPrice(BOOK, "3421175-1", "", "aad")).toMatchObject({ code: "ALSIPW201", supplierKey: "aad" });
  expect(bookPrice(BOOK, "3421175-1", "")).toMatchObject({ supplierKey: "reece" });
});

it("is kept with the job, or any", () => {
  expect(byHandOf({}).supplier).toBeNull();
  expect(withSupplier(byHandOf({}), "aad").supplier).toBe("aad");
  expect(withSupplier(byHandOf({ byHand: { supplier: "aad" } }), "").supplier).toBeNull();
});
