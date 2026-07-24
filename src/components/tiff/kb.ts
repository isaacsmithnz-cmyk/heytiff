/* Knowledge-base structure for Tiff AI. The four categories are product
   structure (they drive the Tiff sidebar and the /dashboard/tiff/knowledge
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

export const KB_CATEGORIES: KbCategory[] = [
  { key: "install", label: "Install procedures", icon: "wrench", color: "#00E5C0", blurb: "Step-by-step installs & commissioning" },
  { key: "faults", label: "Fault code library", icon: "alert", color: "#2E68FF", blurb: "Error codes & diagnosis by brand" },
  { key: "specs", label: "Manufacturer specs", icon: "file", color: "#f59e0b", blurb: "Datasheets, capacities & connections" },
  { key: "sops", label: "Company SOPs", icon: "shield", color: "#8A2BE2", blurb: "How we do things here" },
];

export type KbDoc = {
  id: string;
  category: KbCategoryKey;
  title: string;
  kind: "PDF" | "Doc" | "Sheet";
  source: string;
  updated: string;
};

/** Documents per category key (categories with no docs still get a 0). */
export function kbCounts(docs: KbDoc[]): Record<KbCategoryKey, number> {
  const counts = { install: 0, faults: 0, specs: 0, sops: 0 } as Record<KbCategoryKey, number>;
  for (const d of docs) counts[d.category] += 1;
  return counts;
}

/** Case-insensitive match on title or source (for the KB page search box). */
export function filterKbDocs(docs: KbDoc[], query: string): KbDoc[] {
  const q = query.trim().toLowerCase();
  if (!q) return docs;
  return docs.filter(
    (d) => d.title.toLowerCase().includes(q) || d.source.toLowerCase().includes(q)
  );
}
