import { editDistance } from "@/lib/workboard/note-job";
import { streetOf, suburbOf } from "./street";

/* AN ADDRESS SAID, CHECKED ON THE MAP — pure.

   Isaac, 26 November 2026: he said a site's suburb and the transcriber wrote
   one a letter out ("Sampletin" for Sampleton), and Tiff put it straight into "Make the job
   at … in ServiceM8?". The place is now looked up first (lib/address/
   places-proxy's `checkPlace`) and she offers the place the map gives, in
   the map's own spelling. Google's first answer isn't always the place:
   "2/28" comes back "28/2" before it, and a street said in one suburb comes
   back from another state. So a found place counts only when it is the
   said unit and number, on a street named the same or a letter or two out,
   in the suburb said or one a letter or two out. A line with no suburb is
   checked by nothing: every state has its Hill St. */

/** What the map said of an address. */
export type PlaceCheck =
  /** the place, as the map writes it */
  | { kind: "found"; address: string }
  /** nowhere the map knows */
  | { kind: "none" }
  /** the map wasn't asked: no key, or it didn't answer */
  | { kind: "off" };

const near = (a: string, b: string) => {
  if (a === b) return true;
  const x = a.replace(/[^a-z]/g, "");
  const y = b.replace(/[^a-z]/g, "");
  const allowed = Math.min(x.length, y.length) >= 8 ? 2 : Math.min(x.length, y.length) >= 4 ? 1 : 0;
  return x === y || (allowed > 0 && editDistance(x, y) <= allowed);
};

/** Whether the place the map found is the place said. */
export function placeFits(said: string, found: string): boolean {
  const a = streetOf(said);
  const b = streetOf(found);
  if (!a || !b) return false;
  if (a.unit !== b.unit || a.number !== b.number) return false;
  if (!near(a.name, b.name)) return false;
  const sa = suburbOf(said);
  const sb = suburbOf(found);
  return !!sa && !!sb && near(sa, sb);
}

/** The map's line without the country, and without the "unit" Google puts
    before a 2/28 of its own: "2/28 Lorem St, Sampleton NSW 2088". */
export const placeLine = (formatted: string): string =>
  formatted
    .replace(/,?\s*Australia\s*$/i, "")
    .replace(/^unit\s+(?=\d+[a-z]?\/)/i, "")
    .trim();
