/* Knowledge-base structure for Tiff AI. The four categories are product
   structure (they drive the Tiff sidebar and the /dashboard/tiff/library
   page); the library is empty until real uploads land (Documents/storage
   track), and every screen renders a per-category empty state until then. */

export type KbCategoryKey = "install" | "faults" | "specs" | "sops";

export type KbCategory = {
  key: KbCategoryKey;
  label: string;
  icon: string;
  color: string;
  blurb: string;
};

/* CATEGORY is the word on screen for these — not "shelf", which the animation's
   internals still use for the four cards and which is fine there. Two words for
   one concept on the same screen is how a vocabulary comes apart, and this one
   had four before it was pulled back to `library` + `category`. */
export const KB_CATEGORIES: KbCategory[] = [
  { key: "install", label: "Install procedures", icon: "wrench", color: "#00E5C0", blurb: "Step-by-step installs & commissioning" },
  // not "Fault code library" — a library inside the library
  { key: "faults", label: "Fault codes", icon: "alert", color: "#2E68FF", blurb: "Error codes & diagnosis by brand" },
  { key: "specs", label: "Manufacturer specs", icon: "file", color: "#f59e0b", blurb: "Datasheets, capacities & connections" },
  { key: "sops", label: "Company SOPs", icon: "shield", color: "#8A2BE2", blurb: "How we do things here" },
];

/* The preview-era `KbDoc` shape and its `kbCounts` helper are GONE. A document
   is now a `KbDocRow` from lib/tiff/query.ts — a real row with a status and a
   page count — and the per-category counts are a database read
   (`kbCategoryCounts`) rather than a tally of an array the client was handed.
   The last caller was the staged assistant screen, which no longer exists.

   Case-insensitive match on title or source (the library page's search box).

   Generic over the row, because the library's real rows come from the database
   (lib/tiff/query.ts) where `source` is nullable — the search is the same
   search either way, and duplicating it for the second shape is how the two
   drift apart. */
export function filterKbDocs<T extends { title: string; source?: string | null }>(
  docs: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return docs;
  return docs.filter(
    (d) => d.title.toLowerCase().includes(q) || (d.source ?? "").toLowerCase().includes(q)
  );
}
