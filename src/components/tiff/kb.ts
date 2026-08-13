/* Structure for the Library. The four categories are product structure (they
   drive the Library's rail and the /dashboard/tiff/library page); the library is empty until real uploads land (Documents/storage
   track), and every screen renders a per-category empty state until then. */

export type KbCategoryKey = "install" | "faults" | "specs" | "sops" | "field";

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
/* THE LABEL NAMES THE DOCUMENT, NOT THE TOPIC. "Install procedures" and "Fault
   codes" described what you'd ask about; what you actually FILE is a manual.
   Somebody holding a service manual that happens to contain a fault-code table
   had two cards it could go in and no rule for choosing. "Installation
   documents" and "Service documents" each have exactly one answer, and the
   blurb carries the topics that used to be in the name. */
export const KB_CATEGORIES: KbCategory[] = [
  { key: "install", label: "Installation documents", icon: "wrench", color: "#00E5C0", blurb: "Installation & commissioning manuals" },
  // the gauge, not the warning triangle: this card is servicing, not an alarm
  { key: "faults", label: "Service documents", icon: "gauge", color: "#2E68FF", blurb: "Service manuals, fault codes & diagnosis" },
  { key: "specs", label: "Manufacturer specs", icon: "file", color: "#f59e0b", blurb: "Datasheets, capacities & connections" },
  { key: "sops", label: "Company SOPs", icon: "shield", color: "#8A2BE2", blurb: "How we do things here" },
  /* Written by the crew from the note widget, never uploaded — which is the
     blurb's whole job to say. Board cyan, not a new colour.

     THE PEN, NOT THE SPARKLE. This is the one category on the shelf with no
     machine anywhere near it: a person on a roof wrote down what they learned.
     It wore the ✨ — the badge the rest of this surface just gave up — which
     claimed the exact opposite, on the only documents here that are purely
     human.

     `note` was the obvious replacement and it is WRONG, which a five-card
     harness showed and a code review would not have: `note` and `file` are the
     same page-with-a-folded-corner silhouette, and `file` is Manufacturer
     specs one card away — at 26px in a coloured chip they separate only by
     three hairlines. The pen shares its shape with nothing on the rail and
     says the true thing about where these come from. */
  { key: "field", label: "Field notes", icon: "edit", color: "#007FA8", blurb: "What the crew learned on the job" },
];

/* The preview-era `KbDoc` shape and its `kbCounts` helper are GONE. A document
   is now a `KbDocRow` from lib/tiff/query.ts — a real row with a status and a
   page count — and the per-category counts are a database read
   (`kbCategoryCounts`) rather than a tally of an array the client was handed.
   The last caller was the staged assistant screen, which no longer exists.

   Case-insensitive match on title, source OR FILENAME (the library page's
   search box).

   THE FILENAME IS HALF THE POINT OF THE BOX. `source` is the optional "Brand
   or author" the uploader types and it is usually blank, so a two-field search
   was in practice a title search — while the thing people actually remember
   about a document is the file they dragged in. It had nowhere to be matched
   because it was never stored; `file_name` is that gap closed.

   AND THE TAGS, which is the fourth thing and the only one a person CHOSE.
   Typing "daikin" has to find the Daikin-tagged manuals whether or not the
   word is in the title, or the tag rail becomes the only way to use tags at
   all — and somebody who has just tagged fourteen documents will type the tag
   name into the box in front of them before they look for a chip.

   Generic over the row, because the library's real rows come from the database
   (lib/tiff/query.ts) where both are nullable — the search is the same search
   either way, and duplicating it for the second shape is how the two drift
   apart. */
export function filterKbDocs<
  T extends {
    title: string;
    source?: string | null;
    fileName?: string | null;
    tags?: readonly { label: string }[];
  },
>(docs: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return docs;
  return docs.filter(
    (d) =>
      d.title.toLowerCase().includes(q) ||
      (d.source ?? "").toLowerCase().includes(q) ||
      (d.fileName ?? "").toLowerCase().includes(q) ||
      (d.tags ?? []).some((t) => t.label.toLowerCase().includes(q))
  );
}
