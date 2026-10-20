import { priceBuildUp, type BuildLine, type BuildSettings } from "./buildup";
import type { ZoneKit } from "./kits";
import type { Product } from "./families";
import { pickItem, sameModel } from "./lookups";

/* A QUICK PRICE (Isaac, 21 October 2026: Luke asked in a job's conversation
   "can you give me a price for mitsubishi elec linear zone kit 4 bedrooms
   wireless sensors" and got a task asking who should price it. "If you're
   on site and you just want to quickly say, how much would it cost to
   upgrade? It should be able to work out the approximate cost of materials
   and labor to give you a one-line answer. Then you could have that as add
   to quote." And: "staff members could potentially give a customer a price
   if they are asking for something while on site").

   The parts priced from the business's own book at its own markups, the
   hours at its own charge-out rate, through the same build-up a quote uses
   (./buildup). Nothing here is anyone's default: a part the book doesn't
   hold is said missing, never guessed. Pure. */

export type QuickPart = { words: string; qty: number; code?: string | null };

export type QuickLine = {
  name: string;
  code: string;
  supplierKey: string;
  kind: "unit" | "material";
  qty: number;
  /** one, to buy */
  unitBuyCents: number;
  buyCents: number;
  sellCents: number;
};

export type QuickPrice = {
  lines: QuickLine[];
  /** parts the book doesn't hold, in the words they were asked for */
  missing: string[];
  hours: number;
  labourSellCents: number;
  exGstCents: number;
  incGstCents: number;
};

/** The book's item for a part: by its model code where one is given, else
    by its words. */
function itemFor(book: Product[], part: QuickPart, supplier: string | null) {
  const code = part.code?.trim();
  if (code) {
    for (const p of book) {
      const offer = p.offers.find((o) => o.netCents > 0 && (o.code.toUpperCase() === code.toUpperCase() || sameModel(o.code, code)));
      if (offer) return { product: p, offer };
    }
    /* a part named by its model is that part or nothing: matched by its
       words instead, a receiver came back as a sensor (21 October) */
    return null;
  }
  const words = part.words.trim();
  if (!words) return null;
  const pick = pickItem(book, { text: words, loose: true }, supplier);
  return pick ? { product: pick.product, offer: pick.offer } : null;
}

export function priceQuick(parts: readonly QuickPart[], hours: number, book: Product[], s: BuildSettings, supplier: string | null = null): QuickPrice {
  const lines: QuickLine[] = [];
  const build: BuildLine[] = [];
  const missing: string[] = [];
  parts.forEach((part, i) => {
    const qty = Math.max(0, part.qty || 0);
    if (qty === 0) return;
    const hit = itemFor(book, part, supplier);
    if (!hit) {
      missing.push(part.code ? `${part.words} (${part.code})` : part.words);
      return;
    }
    const kind = hit.product.category === "units" ? "unit" : "material";
    build.push({
      key: `quick-${i}`,
      group: "Quick price",
      name: hit.offer.name || hit.product.name,
      code: hit.offer.code,
      supplierKey: hit.offer.supplierKey,
      qty,
      unitBuyCents: hit.offer.netCents,
      kind,
    });
  });
  const hrs = Math.max(0, Math.round(hours * 4) / 4);
  const visits = hrs > 0 && s.dayHours > 0 ? [{ stage: "Install" as const, people: 1, days: hrs / s.dayHours }] : [];
  const up = priceBuildUp(build, visits, { ...s, contingency: null });
  for (const g of up.groups)
    for (const l of g.lines)
      lines.push({ name: l.name, code: l.code!, supplierKey: l.supplierKey!, kind: l.kind === "unit" ? "unit" : "material", qty: l.qty, unitBuyCents: l.unitBuyCents, buyCents: l.buyCents, sellCents: l.sellCents });
  return { lines, missing, hours: hrs, labourSellCents: up.labour.sellCents, exGstCents: up.exGstCents, incGstCents: up.incGstCents };
}

/** A maker's zone kit as parts: the interface, its controller, a receiver
    and a sensor a zone where it reads temperature, and Wi-Fi where asked. */
export function zoneKitParts(kit: ZoneKit): QuickPart[] {
  const out: QuickPart[] = [];
  if (kit.interface) out.push({ words: `zone interface, ${kit.zones} zones`, code: kit.interface, qty: 1 });
  if (kit.mainController) out.push({ words: "zone controller", code: kit.mainController, qty: 1 });
  if (kit.receiver) out.push({ words: "wireless receiver", code: kit.receiver, qty: 1 });
  if (kit.sensor) out.push({ words: "wireless temperature sensor", code: kit.sensor, qty: kit.zones });
  if (kit.wifi) out.push({ words: "Wi-Fi interface", code: kit.wifi, qty: 1 });
  return out;
}

/** The rough price a person without the business's figures may say to a
    customer: inc GST, eight percent either way, to the $50. */
export function roughRange(incGstCents: number): { lowCents: number; highCents: number } {
  const to50 = (c: number) => Math.round(c / 5000) * 5000;
  return { lowCents: Math.max(0, to50(incGstCents * 0.92)), highCents: to50(incGstCents * 1.08) };
}

/** A maker as said ("Mitsubishi Electric", "mitsubishi elec", "daikin") to
    its pack's key ("mitsubishi-electric"); null when it names none, or more
    than one ("Mitsubishi" alone is two makers). */
export function makerOf(makers: readonly { key: string; name: string }[], said: string): string | null {
  const words = said.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return null;
  const slug = words.join("-");
  const exact = makers.find((m) => m.key === slug || m.name.toLowerCase() === words.join(" "));
  if (exact) return exact.key;
  /* every word said starts a word of the maker's name: "mitsubishi elec" */
  const fits = makers.filter((m) => {
    const name = m.key.split("-");
    return words.every((w, i) => name[i]?.startsWith(w));
  });
  return fits.length === 1 ? fits[0]!.key : null;
}

/** Dollars as a person says them: "$3,450". */
export const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-AU")}`;
