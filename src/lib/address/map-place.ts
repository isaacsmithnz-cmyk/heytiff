/* Google's address components → the four boxes HeyTiff actually has.

   PURE, AND DELIBERATELY SO. Nothing in here touches fetch, the API key or the
   session: it is a shape translation, which means it can be tested against real
   Australian addresses without a single network call. The proxy route
   (app/api/address/route.ts) is the only thing that talks to Google.

   THE COMPONENT LIST IS NOT ORDERED and not guaranteed to be complete. A rural
   property has no street_number; a Melbourne apartment has a subpremise; the
   territories answer administrative_area_level_1 with things that are not
   states. So every rule here is "find the type, or leave the box empty" —
   never "take the third element". A missing part is an empty string the person
   fills in themselves, never a guess.

   Why SHORT text for state: the form's State select holds VIC, not "Victoria",
   and a value the select can't show is worse than no value. It is checked
   against the same eight-item list the select is built from, so an
   `administrative_area_level_1` of "Bay of Plenty" (a mis-typed lookup that
   escaped the AU region filter) lands as "" rather than poisoning the field
   that also picks the public-holiday calendar. */

/** One entry of Google's Places `addressComponents`. Every field optional —
    this is somebody else's JSON, arriving over the wire. */
export type PlaceComponent = {
  longText?: string | null;
  shortText?: string | null;
  types?: string[] | null;
};

/** The four address boxes in this app (org contact card). The staff card uses
    only the joined `formatted` line, but resolves through the same mapper. */
export type AddressParts = {
  /** street line — "5/12 Trade St" */
  address: string;
  suburb: string;
  /** one of AU_STATES, or "" */
  state: string;
  postcode: string;
};

/** One row of the dropdown. The lean shape the proxy hands back — a place id
    to resolve with, and the line to show. Nothing else off Google's response
    crosses to the browser. */
export type AddressSuggestion = { placeId: string; text: string };

export const AU_STATE_CODES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"] as const;

export const EMPTY_PARTS: AddressParts = { address: "", suburb: "", state: "", postcode: "" };

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/* The FIRST component of this type that actually says something.

   Not `.find(...)` then read the text off it: a component carrying the right
   type and an empty string would then shadow the real one and blank the field.
   Google's own responses are tidy, but this is somebody else's JSON and the
   failure is silent — a street that quietly loses its name. Long/short fall
   back to each other for the same reason: half an answer beats none. */
function pick(
  components: readonly PlaceComponent[],
  type: string,
  which: "longText" | "shortText"
): string {
  const other = which === "longText" ? "shortText" : "longText";
  for (const c of components) {
    if (!Array.isArray(c.types) || !c.types.includes(type)) continue;
    const found = text(c[which]) || text(c[other]);
    if (found) return found;
  }
  return "";
}

/** Google's address components, reduced to the fields the forms hold. */
export function mapPlaceToParts(components: readonly PlaceComponent[] | null | undefined): AddressParts {
  if (!Array.isArray(components) || components.length === 0) return { ...EMPTY_PARTS };

  const subpremise = pick(components, "subpremise", "shortText");
  const streetNumber = pick(components, "street_number", "shortText");
  // "Trade St", not "Trade Street": the short form is how the address is
  // written on an invoice, and it is what fits a one-line field.
  const route = pick(components, "route", "shortText");

  /* 5/12 Trade St — the Australian way of writing a unit, and the reason the
     subpremise is not dropped. Without it the org's street line for an
     apartment or a factory unit is the building's, not the business's. */
  const number = [subpremise, streetNumber].filter(Boolean).join("/");
  const address = [number, route].filter(Boolean).join(" ");

  // A locality is the suburb; where Google has none (common inside larger
  // cities) the sublocality is the name a person would actually write.
  const suburb =
    pick(components, "locality", "longText") ||
    pick(components, "sublocality", "longText") ||
    pick(components, "sublocality_level_1", "longText");

  const stateText = pick(components, "administrative_area_level_1", "shortText").toUpperCase();
  const state = (AU_STATE_CODES as readonly string[]).includes(stateText) ? stateText : "";

  return {
    address,
    suburb,
    state,
    postcode: pick(components, "postal_code", "longText"),
  };
}
