import { streetOf } from "@/lib/address/street";

/* A SITE, OUT OF SERVICEM8'S FREE-TEXT ADDRESS (docs/migrations/site_notes.sql).

   Site notes are kept on the building, so every job there shows them, and on
   a unit within it, so only that unit's jobs do (Isaac, 11 November 2026: "if
   it's Unit 10 of 106 … notes would come up specific to that unit as well").
   There is no table of sites: a job's address is what was typed, so the
   building is a key worked out from it, the same way every time:

     the street number   "106", "196-202", "60a"
     the street          its name, and its type in Australia Post's short form,
                         so "Avenue", "Ave" and "Av" are one (lib/address/street)
     the suburb          as typed after the street, else ServiceM8's geocoded
                         city, lower case

   The unit, the state and the postcode are left off the building: "2/106
   Kirribilli Avenue\nKirribilli NSW 2061" and "106 Kirribilli Avenue\n
   Kirribilli,  2061" are one building, and the first is its Unit 2.

   Pure: the job page's read and the old notes' list both ask it. */

export type Site = {
  /** "106|kirribilli|ave|kirribilli": what site_notes.building_key holds */
  key: string;
  /** "2", "1a", "b308": the unit, or null for an address with none */
  unit: string | null;
};

const STATES = /^(nsw|vic|qld|sa|wa|tas|nt|act|new south wales|victoria|queensland|south australia|western australia|tasmania|northern territory|australian capital territory|australia)$/;

/** "b308/87 Bay St": a unit with a letter before its number, which the
    street reader doesn't take. */
const LETTER_UNIT = /^\s*([a-tv-z][0-9]+[a-z]?)\s*\/\s*/i;

/** The part of a line that holds the street: a number, then a word. */
const STREET_PART = /^\s*(?:[a-z]?\d+[a-z]?\s*\/\s*)?\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?\s+[a-z]/i;

/** The suburb as typed: the line after the street, or what follows the
    street's comma on one line, without the state, the postcode or the
    country. Empty when the address gives none. */
export function typedSuburb(address: string | null | undefined): string {
  const text = (address ?? "").replace(/\r/g, "");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  /* on one line, what follows the part holding the street ("Unit 2, 106
     Kirribilli Ave, Kirribilli": not the "106 Kirribilli Ave" after the unit) */
  const parts = (lines[0] ?? "").split(",");
  const at = parts.findIndex((p) => STREET_PART.test(p));
  const after = lines.length > 1 ? lines.slice(1) : parts.slice(at >= 0 ? at + 1 : 1);
  for (const part of after.flatMap((l) => l.split(","))) {
    const words = part
      .toLowerCase()
      .replace(/[^a-z0-9' -]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      // "Kirribilli NSW 2061": the state and the postcode at its end
      .replace(/\s*\b\d{4}$/, "")
      .replace(/\s+(nsw|vic|qld|sa|wa|tas|nt|act)$/, "")
      .trim();
    if (!words || STATES.test(words) || /^\d+$/.test(words)) continue;
    return words;
  }
  return "";
}

/** The building and unit an address names, or null when it doesn't give a
    street number, a street and a suburb: without all three it isn't a place
    to keep a note on. */
export function siteOf(address: string | null | undefined, geoCity?: string | null): Site | null {
  const raw = (address ?? "").trim();
  if (!raw) return null;
  let letterUnit: string | null = null;
  let line = raw;
  const lu = raw.match(LETTER_UNIT);
  if (lu) {
    letterUnit = lu[1]!.toLowerCase();
    line = raw.slice(lu[0].length);
  }
  const street = streetOf(line);
  if (!street) return null;
  const suburb =
    typedSuburb(raw) ||
    (geoCity ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9' -]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  if (!suburb) return null;
  const unit = letterUnit ?? (street.unit || null);
  return { key: [street.number, street.name, street.type, suburb].join("|"), unit };
}

/** How a unit is named on the page: "Unit 2", "Unit 1A", "Unit B308". */
export function unitWords(unit: string): string {
  return `Unit ${unit.toUpperCase()}`;
}

/** What a database looks for first, before siteOf decides: the street
    number's digits and the street name's longest word, each somewhere in a
    job's address. */
export function siteSearch(key: string): { number: string; word: string } | null {
  const [number, name] = key.split("|");
  const digits = number?.match(/^\d+/)?.[0];
  const word = (name ?? "").split(" ").reduce((a, w) => (w.length > a.length ? w : a), "");
  return digits && word ? { number: digits, word } : null;
}
