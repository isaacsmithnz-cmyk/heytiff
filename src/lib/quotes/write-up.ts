/* THE JOB, WRITTEN OUT FIRST (Isaac, 2026-10-10: the chat "was accurate
   almost every time with minimal effort"; the mock of the proposed change):
   before a line goes on, Tiff writes the job out the way the chat did on
   3377 (what she read, the sizing, the work, the visits and their crews,
   what she can't price, what she's assuming) and builds every line from it.
   It stays at the top of her panel, kept current: what changed since the
   last one says so, and what's settled is struck through once.

   Kept on her tool's own event, as the building list is (build-progress.ts):
   the newest write-up is the card, the one before it is what it changed
   from. Pure. */

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
export type WriteUp = Record<WriteUpKey, string[]>;

const MAX_ITEMS = 12;
const MAX_ITEM = 300;

/** A write-up as Tiff gives it, made safe; null when it says nothing. */
export function writeUpOf(raw: unknown): WriteUp | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as WriteUp;
  let any = false;
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

export type WriteUpItem = { text: string; state: "same" | "changed" | "gone" };

/** Each section's items against the write-up before: an item that's new
    says it changed; one that's gone is shown struck through, this once. */
export function writeUpAgainst(now: WriteUp, before: WriteUp | null): Record<WriteUpKey, WriteUpItem[]> {
  const out = {} as Record<WriteUpKey, WriteUpItem[]>;
  for (const k of WRITE_UP_KEYS) {
    const was = new Set(before?.[k] ?? []);
    const is = new Set(now[k]);
    out[k] = [
      ...now[k].map((text) => ({ text, state: (before && !was.has(text) ? "changed" : "same") as WriteUpItem["state"] })),
      ...(before?.[k] ?? []).filter((t) => !is.has(t)).map((text) => ({ text, state: "gone" as const })),
    ];
  }
  return out;
}
