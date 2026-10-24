import { CATEGORIES, categoryOf, type CategoryKey } from "@/lib/quotes/categories";
import type { Hue } from "@/components/parts/state";

/* A JOB'S MATERIALS, ON THE PRICE BOOK'S OWN SHELVES (Isaac, 25 October
   2026: "you've kind of got random gaps … some sort of grid … to show the
   different sections"). Every row, picked from the book, typed in or
   pushed from a design, goes on the shelf `categoryOf` puts it on, the
   same sort the price book browses by, so a job and the book never file
   one item in two places. Worked out at read, never stored. Pure.

   Each shelf wears one icon in one hue's word value, always the same one
   (his ruling, docs/design.md "His rulings"). Red only means wrong (rule
   16) and blue only means press (rule 17), so the shelves share the other
   six. */

export const SHELF_LOOK = {
  units: { icon: "unit", hue: "purple" },
  controls: { icon: "thermo", hue: "yellow" },
  pipe: { icon: "coil", hue: "green" },
  fittings: { icon: "flame", hue: "orange" },
  electrical: { icon: "zap", hue: "pink" },
  drainage: { icon: "droplet", hue: "purple" },
  grilles: { icon: "grille", hue: "yellow" },
  ducting: { icon: "pipe", hue: "orange" },
  fans: { icon: "wind", hue: "green" },
  mounting: { icon: "mount", hue: "grey" },
  refrigerant: { icon: "gauge", hue: "pink" },
  parts: { icon: "settings", hue: "orange" },
  accessories: { icon: "layers", hue: "purple" },
  filters: { icon: "filter", hue: "yellow" },
  plumbing: { icon: "wrench", hue: "green" },
  heating: { icon: "sun", hue: "orange" },
  refrigeration: { icon: "snowflake", hue: "pink" },
  consumables: { icon: "box", hue: "grey" },
  other: { icon: "tag", hue: "grey" },
} satisfies Record<CategoryKey, { icon: string; hue: Exclude<Hue, "red" | "blue"> }>;

type Listed = { name: string; sub: string; designId?: string | null };

const ONE_WORD = /^\S+$/;

/** The item's code, where the row knows it: a price-book pick keeps "code,
    supplier" in its line, and a design names a unit by its model. */
export function codeOf(row: Listed): string {
  const first = row.sub.split(",")[0]?.trim() ?? "";
  if (first && ONE_WORD.test(first)) return first;
  return ONE_WORD.test(row.name.trim()) ? row.name.trim() : "";
}

/** The shelf a job's row is on. By its name and code first, as the price
    book sorts; a row that says no more than that is read with its line too
    ("4-way cassette indoor unit, 3.2/3.6 kW" is a unit whatever its model),
    and a design's unit it could not describe is still a unit. */
export function shelfOf(row: Listed): CategoryKey {
  const code = codeOf(row);
  const byName = categoryOf(row.name, code);
  if (byName !== "other") return byName;
  if (row.designId && row.sub.trim() === "Unit") return "units";
  return row.sub.trim() ? categoryOf(`${row.name} ${row.sub}`, code) : "other";
}

export type Shelf<T> = { key: CategoryKey; label: string; icon: string; hue: Hue; items: T[] };

/** The rows on their shelves, in the book's order, only the shelves that
    have something on them; each shelf keeps its rows in the list's order. */
export function onShelves<T extends Listed>(rows: readonly T[]): Shelf<T>[] {
  const by = new Map<CategoryKey, T[]>();
  for (const r of rows) {
    const k = shelfOf(r);
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return CATEGORIES.filter((c) => by.has(c.key)).map((c) => ({ ...c, ...SHELF_LOOK[c.key], items: by.get(c.key)! }));
}
