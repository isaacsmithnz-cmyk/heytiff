/* THE COMPONENTS A QUOTE PRICES — the generic parts a scope line needs
   ("7 m of 1/4 + 1/2 pair coil", "a 20 A isolator"), each priced from ONE
   price-book item the business prefers.

   A price book holds the same part many times over: 1/4 + 1/2 pair coil
   comes as a 20 m roll, a 5 m roll and an old item with no length at all,
   and a second supplier (Reece) will bring its own brand. So a component
   names what it is and how it is counted, and the Quoting page picks which
   item prices it. Tiff's shortlist for each is the price-book items whose
   names match, ranked by how often the business's own jobs used them, then
   by what they cost per metre or each.

   Everything here is pure: the page, the quote's build-up and the tests all
   read the same words and the same sums. */

export type ComponentUnit = "m" | "each";

export type QuoteComponent = {
  label: string;
  unit: ComponentUnit;
  /** every pattern must match an item's name for it to be on the shortlist */
  match: readonly RegExp[];
  /** an item whose name matches any of these is left off */
  not?: readonly RegExp[];
};

const COIL = /pair(ed)?\s*-?\s*coil|paircoil/i;
const coil = (a: string, b: string) => new RegExp(`${a}\\s*(?:"|in)?\\s*[+&x]?\\s*${b}(?!\\d)`, "i");

export const QUOTE_COMPONENTS = {
  pair_coil_14_38: { label: "Pair coil 1/4 + 3/8", unit: "m", match: [COIL, coil("1/4", "3/8")] },
  pair_coil_14_12: { label: "Pair coil 1/4 + 1/2", unit: "m", match: [COIL, coil("1/4", "1/2")] },
  pair_coil_14_58: { label: "Pair coil 1/4 + 5/8", unit: "m", match: [COIL, coil("1/4", "5/8")] },
  pair_coil_38_58: { label: "Pair coil 3/8 + 5/8", unit: "m", match: [COIL, coil("3/8", "5/8")] },
  pair_coil_38_34: { label: "Pair coil 3/8 + 3/4", unit: "m", match: [COIL, coil("3/8", "3/4")] },
  power_cable: {
    label: "Power cable, 2.5 mm² TPS",
    unit: "m",
    match: [/2\.5\s*mm/i, /tps|t\s*&\s*e|twin|core|cable/i],
    not: [/angle|conduit|gland/i],
  },
  drain_hose: { label: "Drain hose", unit: "m", match: [/drain/i, /hose/i] },
  pipe_cover: {
    label: "Pipe covering, one length",
    unit: "each",
    match: [/trunk|pipe\s*cover|slim\s*duct|smart\s*duct|line\s*hide|duct\s*cover/i],
    not: [/tape|glue|clip|joint|bend|elbow|coupl|corner|reducer|\bcap\b|\btee\b|socket|flexi/i],
  },
  isolator: { label: "Isolator", unit: "each", match: [/isolat/i], not: [/bracket|lock\s*off/i] },
  wall_bracket: { label: "Outdoor unit wall bracket", unit: "each", match: [/wall\s*bracket/i] },
  condensate_pump: {
    label: "Condensate pump",
    unit: "each",
    match: [/condensate\s*pump/i],
    not: [/adaptor|adapter|sensor|kit|tube|spare/i],
  },
} as const satisfies Record<string, QuoteComponent>;

export type ComponentKey = keyof typeof QUOTE_COMPONENTS;
export const COMPONENT_KEYS = Object.keys(QUOTE_COMPONENTS) as ComponentKey[];

export function matchesComponent(key: ComponentKey, name: string | null | undefined): boolean {
  if (!name) return false;
  const c: QuoteComponent = QUOTE_COMPONENTS[key];
  return c.match.every((re) => re.test(name)) && !(c.not ?? []).some((re) => re.test(name));
}

/** The roll length an item's name states, in metres: "X20M" → 20,
    "100M" → 100, "Per Meter" → 1. Null when the name doesn't say — "9mm"
    and "48mm" are sizes, not lengths. */
export function rollMetresOf(name: string | null | undefined): number | null {
  if (!name) return null;
  if (/per\s*met(er|re)|\/\s*m\b|per\s*m\b/i.test(name)) return 1;
  const found = [...name.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:m(?![m²a-z0-9])|mtrs?\b|metres?\b|meters?\b)/gi)];
  const last = found.at(-1);
  if (!last) return null;
  const n = Number(last[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** A price-book amount as it is mirrored ("187.18"), in cents. Null for an
    empty or unreadable one; zero stays zero, and a zero-priced item is still
    shown, because it is the business's own item that has no price yet. */
export function amountCents(v: string | null | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** What one metre, or one of it, costs to buy: the item's price over its
    roll when it's sold by the metre. Null when a metre can't be worked out. */
export function buyPerUnitCents(
  unit: ComponentUnit,
  priceCents: number | null,
  rollM: number | null
): number | null {
  if (priceCents == null) return null;
  if (unit === "each") return priceCents;
  if (!rollM) return null;
  return Math.round(priceCents / rollM);
}

/** Buy price plus markup. 40 → ×1.4. */
export function sellCents(buyCents: number, markupPct: number): number {
  return Math.round(buyCents * (1 + markupPct / 100));
}

/** The share of the sell price that is profit, for a markup: 20 → 16.7. */
export function profitSharePct(markupPct: number): number {
  if (!(markupPct > -100)) return 0;
  return Math.round((markupPct / (100 + markupPct)) * 1000) / 10;
}
