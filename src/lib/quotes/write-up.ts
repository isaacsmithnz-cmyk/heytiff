/* THE JOB, WRITTEN OUT FIRST (Isaac, 2026-10-10: the chat "was accurate
   almost every time with minimal effort"; the mock of the proposed change):
   before a line goes on, Tiff writes the job out the way the chat did on
   3377 (what she read, the sizing, the work, the visits and their crews,
   what she can't price, what she's assuming) and builds every line from it.
   The Scope face draws the newest one under the proposal's words (Isaac's
   mock of 30 October 2026, on 3423): what it's priced on, and what's to
   check on site.

   Kept on her tool's own event, as the building list is (build-progress.ts):
   the newest write-up is the one that counts. Pure. */

export type WriteUpKey = "read" | "sizing" | "work" | "visits" | "unpriced" | "assuming";
export const WRITE_UP_SECTIONS: Record<WriteUpKey, string> = {
  read: "What I read",
  sizing: "Sizing",
  work: "The work",
  visits: "Visits",
  unpriced: "Not priced yet",
  assuming: "Assuming",
};
export const WRITE_UP_KEYS = Object.keys(WRITE_UP_SECTIONS) as WriteUpKey[];
/** A row of the Scope face's Priced on or To check on site: "Labour", "Option 1 is 12 h". */
export type WriteUpRow = { what: string; said: string };
export type WriteUp = Record<WriteUpKey, string[]> & { pricedOn: WriteUpRow[]; toCheck: WriteUpRow[] };

const MAX_ITEMS = 12;
const MAX_ITEM = 300;

/** A write-up as Tiff gives it, made safe; null when it says nothing. */
export function writeUpOf(raw: unknown): WriteUp | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as WriteUp;
  let any = false;
  /* her tool says priced_on and to_check; the stored event, pricedOn and toCheck */
  const rows = (v: unknown): WriteUpRow[] =>
    (Array.isArray(v) ? (v as unknown[]) : [])
      .map((x) => {
        const r = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
        const line = (t: unknown) => (typeof t === "string" ? t.replace(/\s+/g, " ").trim().slice(0, MAX_ITEM) : "");
        return { what: line(r.what), said: line(r.said) };
      })
      .filter((r) => r.said)
      .slice(0, MAX_ITEMS);
  out.pricedOn = rows(o.priced_on ?? o.pricedOn);
  out.toCheck = rows(o.to_check ?? o.toCheck);
  if (out.pricedOn.length || out.toCheck.length) any = true;
  for (const k of WRITE_UP_KEYS) {
    const list = (Array.isArray(o[k]) ? (o[k] as unknown[]) : [])
      .map((x) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, MAX_ITEM) : ""))
      .filter(Boolean)
      .slice(0, MAX_ITEMS);
    out[k] = list;
    if (list.length) any = true;
  }
  return any ? out : null;
}

/** What the quote is priced on. A write-up from before priced_on keeps its
    visits and what it assumed, as plain rows, so nothing it said drops off. */
export const pricedOnOf = (w: WriteUp): WriteUpRow[] => (w.pricedOn.length ? w.pricedOn : [...w.visits, ...w.assuming].map((said) => ({ what: "", said })));

/** What's still to price; she has written "Nothing unpriced." as an item. */
export const notPricedOf = (w: WriteUp): string[] => w.unpriced.filter((t) => !/^nothing\b/i.test(t));

/** Her write-up's own sections, by the names her tool and the kept event use. */
const GIVEN_AS: Record<string, keyof WriteUp> = { ...Object.fromEntries(WRITE_UP_KEYS.map((k) => [k, k])), priced_on: "pricedOn", pricedOn: "pricedOn", to_check: "toCheck", toCheck: "toCheck" };

/** The write-up once she's changed it: each section she gave replaces that
    section whole, and every one she left out stays as it was (Isaac, 13
    November 2026, "Tiff is quite slow between turns": on an answer she wrote
    the whole of it again, about 2,600 characters, nine seconds of an
    eleven-second turn, for one changed figure). With nothing before it, it is
    what she gave. Null when the result says nothing. */
export function mergedWriteUp(was: WriteUp | null, raw: unknown): { writeUp: WriteUp; changed: (keyof WriteUp)[] } | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const given = [...new Set(Object.keys(o).flatMap((k) => (GIVEN_AS[k] && Array.isArray(o[k]) ? [GIVEN_AS[k]!] : [])))];
  const now = writeUpOf(raw);
  const empty: WriteUp = { read: [], sizing: [], work: [], visits: [], unpriced: [], assuming: [], pricedOn: [], toCheck: [] };
  const base = was ?? empty;
  const out = { ...base } as WriteUp;
  for (const k of given) (out as Record<string, unknown>)[k] = now ? now[k] : [];
  const says = WRITE_UP_KEYS.some((k) => out[k].length) || out.pricedOn.length > 0 || out.toCheck.length > 0;
  return says ? { writeUp: out, changed: given } : null;
}

