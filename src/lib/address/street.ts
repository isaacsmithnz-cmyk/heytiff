/* A street address's first line, read into what two spellings of one place
   share: "6/40 Raglan Street, Mosman NSW 2088" and "6/40 Raglan St\nMosman
   NSW 2088" are one place, and so is "Unit 6, 40 Raglan St". The unit, the
   number, the street's name and its type, the type in Australia Post's short
   form. It says two places are the same, never that they are near: a unit
   is only ever its own unit, and 3/40 is not 6/40 (Isaac, 10 November 2026:
   an email for 6/40 Raglan St missed job 3488 on "Street" for "St"). */

/** Australia Post's street types, long and short, each to its short form. */
const TYPES: Record<string, string> = {
  street: "st", st: "st", str: "st",
  road: "rd", rd: "rd",
  avenue: "ave", ave: "ave", av: "ave",
  parade: "pde", pde: "pde",
  place: "pl", pl: "pl",
  drive: "dr", dr: "dr", drv: "dr",
  crescent: "cres", cres: "cres", cr: "cres", crs: "cres",
  lane: "ln", ln: "ln",
  terrace: "tce", tce: "tce", terr: "tce",
  highway: "hwy", hwy: "hwy",
  close: "cl", cl: "cl",
  court: "ct", ct: "ct", crt: "ct",
  boulevard: "bvd", boulevarde: "bvd", bvd: "bvd", blvd: "bvd",
  circuit: "cct", cct: "cct",
  grove: "gr", gr: "gr", gve: "gr",
  square: "sq", sq: "sq",
  esplanade: "esp", esp: "esp",
  promenade: "prom", prom: "prom",
  circle: "cir", cir: "cir",
  parkway: "pwy", pwy: "pwy",
  way: "way",
  walk: "walk",
  rise: "rise",
  row: "row",
  mews: "mews",
};

/** Where a line's street ends: the state, or a postcode. */
const STATES = new Set(["nsw", "vic", "qld", "sa", "wa", "tas", "nt", "act"]);

/** "Unit 6, ", "U6/", "Suite 2 ": a unit written before the number. */
const UNIT_FIRST = /^(?:unit|u|apartment|apt|flat|suite|shop|villa|townhouse)\s*([0-9]+[a-z]?)\s*[,/]?\s*/;
/** "Level 4, ": a floor, which is no part of the place's name. */
const LEVEL_FIRST = /^(?:level|lvl|floor|l)\s*[0-9]+\s*,?\s*/;
/** "6/40 ", "40 ", "60a ", "12-14 ": the unit and number before the street. */
const NUMBERED = /^(?:([0-9]+[a-z]?)\s*\/\s*)?([0-9]+[a-z]?(?:\s*-\s*[0-9]+[a-z]?)?)\s*,?\s+(.+)$/;

export type Street = {
  /** "6" of 6/40; "" for a place with no unit */
  unit: string;
  /** "40", "60a", "12-14" */
  number: string;
  /** "raglan", "st johns": the name's words, lower case */
  name: string;
  /** "st", "rd": "" when the line gives none */
  type: string;
};

/** The street an address's first line gives, or null when it gives no number
    and street name: without both it isn't a place worth matching. */
export function streetOf(address: string | null | undefined): Street | null {
  let rest = (address ?? "")
    .split("\n")[0]!
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let unit = "";
  for (let i = 0; i < 2; i++) {
    const u = rest.match(UNIT_FIRST);
    if (u) {
      unit = u[1]!;
      rest = rest.slice(u[0].length);
      continue;
    }
    const l = rest.match(LEVEL_FIRST);
    if (l) rest = rest.slice(l[0].length);
  }
  const m = rest.match(NUMBERED);
  if (!m) return null;
  if (m[1]) unit = m[1];
  const number = m[2]!.replace(/\s+/g, "");
  const words: string[] = [];
  for (const w of m[3]!.split(",")[0]!.replace(/[^a-z0-9]+/g, " ").trim().split(" ")) {
    if (!w || STATES.has(w) || /^\d{4}$/.test(w)) break;
    words.push(w);
  }
  /* the type is the first type word after the name has begun: "St Johns Rd"
     is St Johns, a road */
  const at = words.findIndex((w, i) => i > 0 && TYPES[w] !== undefined);
  const name = (at > 0 ? words.slice(0, at) : words).join(" ");
  if (name.replace(/[^a-z]/g, "").length < 3) return null;
  return { unit, number, name, type: at > 0 ? TYPES[words[at]!]! : "" };
}

/** Whether two streets are one place: the same unit, number and name, and
    the same type when both give one. */
export function sameStreet(a: Street | null, b: Street | null): boolean {
  if (!a || !b) return false;
  return a.unit === b.unit && a.number === b.number && a.name === b.name && (a.type === b.type || !a.type || !b.type);
}

/** What a database looks for first, before sameStreet decides: the number's
    digits and the name's longest word, each somewhere in the address. */
export function streetSearch(s: Street): { number: string; word: string } {
  const word = s.name.split(" ").reduce((a, w) => (w.length > a.length ? w : a), "");
  return { number: s.number.match(/^\d+/)![0], word };
}
