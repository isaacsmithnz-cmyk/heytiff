import type { Product } from "../families";
import type { Offer } from "../price-book";
import { priceQuick, roughRange, zoneKitParts } from "../quick-price";

/* A quick price (Isaac, 21 October 2026: "how much would it cost to
   upgrade? … a one-line answer. Then you could have that as add to quote"). */

const offer = (code: string, name: string, cents: number): Offer => ({ supplierKey: "s1", supplierName: "Supplier", code, name, netCents: cents }) as Offer;
const product = (code: string, name: string, cents: number, category = "controls"): Product =>
  ({ key: `s1|${code}`, name, category, offers: [offer(code, name, cents)], cheapest: offer(code, name, cents), preferred: null, brand: "Mitsubishi Electric", quotes: 0 }) as unknown as Product;

const BOOK = [
  product("PAC-ZC04L240C-A", "ZONE INTERFACE 4 ZONE TEMP", 60000),
  product("PAR-ZM01A-A", "ZONE CONTROLLER", 30000),
  product("PAR-ZR01R-A", "WIRELESS RECEIVER", 10000),
  product("PAR-ZR01S-A", "WIRELESS SENSOR", 8000),
];
const SETTINGS = { unitMarkupPct: 30, materialMarkupPct: 50, chargeOutCents: 12000, dayHours: 8, contingency: null };

it("prices the parts from the book at the business's markup, and the hours at its rate", () => {
  const q = priceQuick(
    zoneKitParts({ zones: 4, control: "temperature", interface: "PAC-ZC04L240C-A", mainController: "PAR-ZM01A-A", receiver: "PAR-ZR01R-A", sensor: "PAR-ZR01S-A", wifi: null, from: "" }),
    6,
    BOOK,
    SETTINGS,
  );
  expect(q.lines.map((l) => [l.code, l.qty])).toEqual([
    ["PAC-ZC04L240C-A", 1],
    ["PAR-ZM01A-A", 1],
    ["PAR-ZR01R-A", 1],
    ["PAR-ZR01S-A", 4],
  ]);
  // parts: (600 + 300 + 100 + 4 x 80) x 1.5 = 1,980; labour 6 h x 120 = 720
  expect(q.exGstCents).toBe(198000 + 72000);
  expect(q.incGstCents).toBe(Math.round(270000 * 1.1));
  expect(q.missing).toEqual([]);
});

it("says what the book doesn't hold rather than guessing it", () => {
  const q = priceQuick([{ words: "linear slot diffuser", qty: 2, code: "LSD-1200" }], 0, BOOK, SETTINGS);
  expect(q.lines).toEqual([]);
  expect(q.missing).toEqual(["linear slot diffuser (LSD-1200)"]);
});

it("gives a person without the figures a rounded range, inc GST", () => {
  expect(roughRange(297000)).toEqual({ lowCents: 275000, highCents: 320000 });
});
