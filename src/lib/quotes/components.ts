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

/* "pair coil" at AAD, "PR CU" (paired copper) at Reece */
const COIL = /pair(ed)?\s*-?\s*coil|paircoil|\bPR\s+CU\b/i;
/* fire-rated pair coil is its own part, never the standard one */
const NOT_COIL = [/\bFR\b|fire/i];
const coil = (a: string, b: string) => new RegExp(`${a}\\s*(?:"|in)?\\s*[+&x]?\\s*${b}(?!\\d)`, "i");
/* twin and earth: "TPS", "T&E", "2C+E" — never single-core building wire
   (SDI), twin active with no earth, flex cord or the clips that hold it
   (Isaac's walk, 2026-10-05: SDI 1 core red priced the circuit), nor
   circular cable, which is two cores and earth but not flat TPS (28 October
   2026: a circular 4 mm² priced the 4 mm² power cable) */
const TWIN_AND_EARTH = /\btps\b|\bt\s*&\s*e\b|\b2\s*c\s*\+\s*e\b|twin\s*(&|and)\s*earth/i;
const NOT_TWIN_AND_EARTH = [/angle|conduit|gland|\bsdi\b|\b1\s*core\b|single|active|flex|clips?\b|\bcirc(ular)?\b/i];

export const QUOTE_COMPONENTS = {
  pair_coil_14_38: { label: "Pair coil 1/4 + 3/8", unit: "m", match: [COIL, coil("1/4", "3/8")], not: NOT_COIL },
  pair_coil_14_12: { label: "Pair coil 1/4 + 1/2", unit: "m", match: [COIL, coil("1/4", "1/2")], not: NOT_COIL },
  pair_coil_14_58: { label: "Pair coil 1/4 + 5/8", unit: "m", match: [COIL, coil("1/4", "5/8")], not: NOT_COIL },
  pair_coil_38_58: { label: "Pair coil 3/8 + 5/8", unit: "m", match: [COIL, coil("3/8", "5/8")], not: NOT_COIL },
  pair_coil_38_34: { label: "Pair coil 3/8 + 3/4", unit: "m", match: [COIL, coil("3/8", "3/4")], not: NOT_COIL },
  power_cable: {
    label: "Power cable, 2.5 mm² TPS",
    unit: "m",
    match: [/2\.5\s*mm/i, TWIN_AND_EARTH],
    not: NOT_TWIN_AND_EARTH,
  },
  /* the bigger circuits: what an outdoor's draw or its maker asks for */
  power_cable_4: { label: "Power cable, 4 mm² TPS", unit: "m", match: [/(?<![\d.])4\s*mm/i, TWIN_AND_EARTH], not: NOT_TWIN_AND_EARTH },
  power_cable_6: { label: "Power cable, 6 mm² TPS", unit: "m", match: [/(?<![\d.])6\s*mm/i, TWIN_AND_EARTH], not: NOT_TWIN_AND_EARTH },
  /* the cable between the indoor and the outdoor: one that says interconnect,
     or three or four cores and earth, at 1.5 or 2.5 mm² where it gives a size.
     Never a smoke alarm "with wired interconnect", nor a power cable of four
     cores at 10 mm² (Isaac's walk, 27 October 2026: a $28.90 smoke alarm
     priced every metre of it) */
  interconnect: {
    label: "Interconnect cable",
    unit: "m",
    match: [/interconnect|intcon|\b[34]\s*c(ore)?\s*\+\s*e\b|\b[34]ce\b/i],
    not: [/alarm|smoke|detector|heat|wireless/i, /(?<![\d.])(?:[3-9]|[1-9]\d+)(?:\.\d+)?\s*mm/i],
  },
  /* a VRF system's shielded pair, never data cable or a heat shield */
  transmission_cable: {
    label: "Transmission cable",
    unit: "m",
    match: [/(?<!un)shield/i],
    not: [/\bcat\s*-?\s*[5-7]|rj\s*-?\s*45|heat\s*shield/i],
  },
  drain_hose: { label: "Drain hose", unit: "m", match: [/drain/i, /hose/i] },
  pipe_cover: {
    label: "Pipe covering, one length",
    unit: "each",
    /* a LENGTH of it ("2.4M"), never a fitting: Smartduct's fast block,
       wall passage and reduction are on the same shelf */
    match: [/trunk|pipe\s*cover|slim\s*duct|smart\s*duct|line\s*hide|duct\s*cover/i, /\d(\.\d+)?\s*M\b/i],
    not: [/tape|glue|clip|joint|bend|elbow|coupl|corner|reduc|\bcap\b|\btee\b|socket|flexi|block|passage|wall\s*pass/i],
  },
  /* the switch, not an anti-vibration "isolation" mount */
  isolator: { label: "Isolator", unit: "each", match: [/isolator/i], not: [/bracket|lock\s*off|mount|vib|pad|box|plate/i] },
  wall_bracket: { label: "Outdoor unit wall bracket", unit: "each", match: [/wall\s*bracket/i] },
  /* what an outdoor sits on when it isn't on the wall: a pad, a stand, a
     pair of rubber mounts — never the wall bracket */
  ground_mount: {
    label: "Outdoor unit ground mount",
    unit: "each",
    match: [
      /\b(ground|floor)\s*(mount|pad|stand)\b|\bcond(enser)?\.?\s*mount|\bmount(ing)?\s*blocks?\b|\b(unit|outdoor)\s*stand\b|\bstand\s*for\s*(outdoor|condenser)|\banti[-\s]?vib(ration)?\s*(pad|mount|feet)|\brubber\s*(cond(enser)?\s*)?mounts?\b/i,
    ],
    /* an electrician's mounting block (1G, surface, 40 A 500 V, 34 mm), a
       fan's feet and a floor-standing indoor are not what an outdoor sits on */
    not: [/wall\s*bracket|\b1G\b|surface|switch|\bgpo\b|\d+\s*A\s+\d+\s*V|axial|\bfans?\b|wireless|r\/c|standing|mounting\s*block\s*\d{1,2}\s*mm\b/i],
  },

  /* a ducted indoor hung in the roof: the hanging kit or bracket — never a
     flex duct's strap or a lone purlin hanger */
  hanging_kit: {
    label: "Indoor unit hanging kit",
    unit: "each",
    match: [/\bhanging\s*(kit|bracket)\b|\bindoor\s*hanging\b|\bgripple\b.*\bkit\b/i],
    not: [/strap|flex[-\s]*duct/i],
  },
  /* a ducted indoor's condensate: rigid PVC by the length, never a fitting */
  condensate_drain: {
    label: "Condensate drain pipe, one length",
    unit: "each",
    match: [/\bpvc\b/i, /\b(19|20|25)\s*mm\b/i, /\d(\.\d+)?\s*m\b/i],
    /* electrical conduit and tape are PVC by the length too (Isaac's walk,
       2026-10-05: 20 mm flex conduit priced the drain) */
    not: [/clamp|elbow|saddle|clip|bush|socket|trap|fit|tee|valve|cement|glue|pan|conduit|tape|insulation|flex/i],
  },
  /* a zone damper's cable, one a damper — never a joiner or a controller's own cable */
  zone_cable: {
    label: "Zone damper cable",
    unit: "each",
    match: [/\bzone\b.*\bcable\b|\bdamper\b.*\bcable\b/i],
    not: [/barrel|joiner|bridge|cpu|cat\s*5|nova\s*kit/i],
  },
  condensate_pump: {
    label: "Condensate pump",
    unit: "each",
    match: [/condensate\s*pump/i],
    not: [/adaptor|adapter|sensor|kit|tube|spare/i],
  },
  /* a ducted system's return: the box behind its grille ("MTL R/A BX", AAD's
     metal return air box), never the grille alone or a supply plenum */
  return_box: {
    label: "Return air box",
    unit: "each",
    match: [/\breturn\b|\br\/a\b|\br\/air\b/i, /\bbox\b|\bbx\b/i],
    not: [/grille|filter|plenum|damper/i],
  },
  /* the indoor's own wired controller, never a zone controller or a remote's
     spares: not the plate or grille it mounts on, a sensor, a wireless
     handset and its receiver, a central controller for many units, nor a
     fan's speed, defrost or temperature controller (Isaac's walk, 27 October
     2026: the $28 wall plate for Mitsubishi's controller priced it) */
  wall_controller: {
    label: "Wall controller",
    unit: "each",
    match: [/controller|\bcontrol\s*panel\b|\bwired\s*remote\b/i],
    not: [
      /zone|airtouch|damper|cable|bracket|cover|wifi|wi-fi|interface|batt(ery)?\b|holder|dock/i,
      /plate|mount|grille|sensor|receiver|wireless|\bw\/l(ess)?\b|\bIR\b|central|variable\s*speed|potentiometer|defrost|temperature\s*controller|universal\s*controller/i,
    ],
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
  /* sold by the metre: "per metre", "/m", and a supplier's unit tag "(MTR)",
     which a "50MT" roll size in the same name must not override */
  if (/per\s*met(er|re)|\/\s*m\b|per\s*m\b|\((?:mtr|mtrs|m|lm)\)/i.test(name)) return 1;
  const found = [...name.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:m(?![m²a-z0-9])|mt\b|mtrs?\b|metres?\b|meters?\b)/gi)];
  const last = found.at(-1);
  if (!last) return null;
  const n = Number(last[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
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

/* COLOURS a part comes in — the Colorbond names trunking is sold by, and
   the plain ones. The same part in twelve colours is one item on a quote,
   its colour a choice beside it (the checklist's covering colour). */
const COLOURS = [
  "surfmist", "surf mist", "paperbark", "monument", "woodland grey", "manor red", "classic cream", "cream", "cottage green",
  "blue ocean", "deep ocean", "dune", "galvanised", "jasper", "pale eucalyptus", "night sky", "basalt",
  "evening haze", "shale grey", "windspray", "ironstone", "wallaby", "gully", "mangrove", "bushland",
  "terrain", "white", "black", "beige", "grey",
];
const COLOUR_RE = new RegExp(`\\b(${COLOURS.map((c) => c.replace(/ /g, "\\s+")).join("|")})\\b`, "i");

/** The colour a part's name gives, in title case, or null. */
export function colourOf(name: string): string | null {
  const m = COLOUR_RE.exec(name);
  return m ? m[1]!.toLowerCase().replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

/** The name with its colour taken out, for grouping one part's colours. */
export function withoutColour(name: string): string {
  return name.replace(COLOUR_RE, " ").replace(/\s+/g, " ").trim();
}

