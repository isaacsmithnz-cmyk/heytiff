/* Tags on a document — the rules, the palette, and the starter set.

   Pure. Nothing in here reads the database or knows an org exists; the server
   half is lib/tiff/tags-query.ts and the writes are app/actions/kb-tags.ts.
   Both sides validate through this module so a direct POST and a click land on
   the same answer.

   WHAT A TAG IS FOR. `category` says what kind of document this is — five
   answers, product structure, fixed. It cannot say whose gear it covers or
   which system type, which is what a tech narrows by: a Daikin VRV service
   manual and a Fujitsu ducted service manual are the same category and nothing
   alike. Category is the shelf, a tag is what's on the spine.

   SLUG IS THE IDENTITY, LABEL IS THE PRINT. "daikin", "Daikin" and " DAIKIN "
   are one tag. Re-typing an existing tag with different capitals must find the
   one that's there rather than making a second — the database's unique index
   is on the slug for exactly that reason, and `kbTagSlug` is what it agrees
   with. */

import { normaliseFilename, TRADE_CAPS } from "./guess";

export type KbTagKind = "brand" | "system" | "topic";

export const KB_TAG_KINDS: readonly KbTagKind[] = ["brand", "system", "topic"];

/** What the picker calls each group. Plural, because it heads a list. */
export const KB_TAG_KIND_LABELS: Record<KbTagKind, string> = {
  brand: "Manufacturers",
  system: "System types",
  topic: "Topics",
};

export function asKbTagKind(value: unknown): KbTagKind | null {
  return KB_TAG_KINDS.includes(value as KbTagKind) ? (value as KbTagKind) : null;
}

/** A tag as every screen sees it. No org_id: by the time one of these exists,
    the org has already been decided by the read that produced it. */
export type KbTagRef = {
  id: string;
  label: string;
  slug: string;
  color: string;
  kind: KbTagKind;
};

/* ── limits ──────────────────────────────────────────────────────────────── */

/** Long enough for "Mitsubishi Heavy Industries", short enough to stay a chip. */
export const KB_TAG_LABEL_MAX = 40;

/** Past a dozen the row is a wall of colour and the tags stop meaning anything
    — and a document that is genuinely about twelve things is really a document
    that hasn't been categorised. */
export const KB_TAGS_PER_DOC_MAX = 12;

/** A free-text field with no ceiling becomes a junk drawer nobody prunes. */
export const KB_TAGS_PER_ORG_MAX = 200;

/** How many tags a document row shows before it collapses the rest into "+N". */
export const KB_TAG_PILLS_SHOWN = 3;

/* ── the palette ─────────────────────────────────────────────────────────── */

/* Decoration, never state.

   #00A389 and #e0264f are "ok" and "danger" everywhere in this app, so neither
   is in here: a tag that happened to be that teal would read as a status on a
   row whose whole job is to report status honestly. The five category colours
   are also avoided — a tag chip sitting beside a category chip in the same
   green would claim a relationship that doesn't exist. */
export const KB_TAG_COLORS: readonly string[] = [
  "#2563eb", // blue
  "#7c3aed", // violet
  "#db2777", // pink
  "#ea580c", // orange
  "#ca8a04", // mustard
  "#0891b2", // cyan
  "#4f46e5", // indigo
  "#be123c", // wine
  "#15803d", // forest
  "#475569", // slate
];

export const KB_TAG_COLOR_DEFAULT = KB_TAG_COLORS[9];

const COLOR_RE = /^#[0-9a-f]{6}$/;

/** A colour safe to store — normalised to lower case, or null if it isn't one.
    Any six-digit hex is accepted, not only the palette: the palette is what the
    picker OFFERS, and refusing a colour that already exists on a row would make
    an old tag uneditable the day the palette changes. */
export function asKbTagColor(value: unknown): string | null {
  const v = String(value ?? "").trim().toLowerCase();
  return COLOR_RE.test(v) ? v : null;
}

/** A stable colour for a label, so the seed set isn't ten shades of one hue and
    a tag created without a choice still gets something of its own. */
export function kbTagColorFor(label: string): string {
  let hash = 0;
  for (const ch of String(label ?? "")) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return KB_TAG_COLORS[hash % KB_TAG_COLORS.length];
}

/* ── label and slug ──────────────────────────────────────────────────────── */

/** The dedupe key: lower case, punctuation collapsed to single hyphens, no
    leading or trailing ones. "Mitsubishi Electric" → `mitsubishi-electric`. */
export function kbTagSlug(label: string): string {
  return String(label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, KB_TAG_LABEL_MAX);
}

/* What gets shown. Trimmed, collapsed, capped — and trade acronyms put back
   into capitals, because "vrf" typed into a box is VRF and a chip reading
   "Vrf" beside a citation reading "VRF" is one word in two spellings.

   ONLY WHOLE-LOWERCASE WORDS ARE TOUCHED. Anything with a capital in it was
   typed deliberately: "ActronAir" is not "Actronair", and a manager who wrote
   "daikin VRV" gets "Daikin VRV" rather than having their own capitals
   rewritten.

   EVERY WORD IS CAPITALISED, not just the first. Most tags are proper nouns —
   two thirds of the starter set is manufacturers — and "Mitsubishi electric"
   is not a company. Sentence case would read better on the handful of topic
   tags and get every lower-case brand wrong, which is the worse half to lose. */
export function kbTagLabel(raw: string): string {
  const clean = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, KB_TAG_LABEL_MAX);
  if (!clean) return "";

  return clean
    .split(" ")
    .map((word) => {
      const trade = TRADE_CAPS[word.toLowerCase()];
      if (trade) return trade;
      if (word !== word.toLowerCase()) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export type KbTagInput = { label: string; slug: string };

/** Clean a typed label into something storable, or say why not. */
export function checkKbTagLabel(raw: string): { ok: true; value: KbTagInput } | { ok: false; error: string } {
  const label = kbTagLabel(raw);
  if (!label) return { ok: false, error: "Give the tag a name." };

  const slug = kbTagSlug(label);
  /* A label of nothing but punctuation ("---", "??") cleans to a label but
     slugs to an empty string, and an empty slug would collide with the next
     one. There is no name in it to store. */
  if (!slug) return { ok: false, error: "That tag name has no letters or numbers in it." };

  return { ok: true, value: { label, slug } };
}

/* ── the starter set ─────────────────────────────────────────────────────── */

export type KbTagSeed = { label: string; kind: KbTagKind };

/* What an org's library starts with, materialised the first time it asks for
   its tags (lib/tiff/tags-query.ts::ensureKbSeedTags).

   IN TS RATHER THAN THE MIGRATION so a workspace created next month gets them
   too, without org creation having to import a trade vocabulary. They are
   ordinary rows once they exist: renameable, recolourable, deletable. Nothing
   downstream treats a seed as special, and nothing puts a deleted one back.

   AUSTRALIAN MARKET. This is the gear that turns up on a job here — the list
   is opinionated on purpose, because a picker offering nothing is a picker
   nobody uses, and an unhelpful preset costs one click to delete. */
export const KB_TAG_SEEDS: readonly KbTagSeed[] = [
  // manufacturers
  { label: "Daikin", kind: "brand" },
  { label: "Mitsubishi Electric", kind: "brand" },
  { label: "Mitsubishi Heavy Industries", kind: "brand" },
  { label: "Fujitsu", kind: "brand" },
  { label: "Panasonic", kind: "brand" },
  { label: "Toshiba", kind: "brand" },
  { label: "Hitachi", kind: "brand" },
  { label: "LG", kind: "brand" },
  { label: "Samsung", kind: "brand" },
  { label: "Carrier", kind: "brand" },
  { label: "Temperzone", kind: "brand" },
  { label: "ActronAir", kind: "brand" },
  { label: "Braemar", kind: "brand" },
  { label: "Brivis", kind: "brand" },
  { label: "Bonaire", kind: "brand" },
  { label: "Rinnai", kind: "brand" },
  { label: "Gree", kind: "brand" },
  { label: "Midea", kind: "brand" },
  { label: "Haier", kind: "brand" },
  { label: "Bosch", kind: "brand" },

  // system types
  { label: "VRV", kind: "system" },
  { label: "VRF", kind: "system" },
  { label: "Ducted", kind: "system" },
  { label: "Split", kind: "system" },
  { label: "Multi-split", kind: "system" },
  { label: "Cassette", kind: "system" },
  { label: "Bulkhead", kind: "system" },
  { label: "Floor Console", kind: "system" },
  { label: "Rooftop Package", kind: "system" },
  { label: "Chiller", kind: "system" },
  { label: "AHU", kind: "system" },
  { label: "FCU", kind: "system" },
  { label: "Heat Pump", kind: "system" },
  { label: "Hydronic", kind: "system" },
  { label: "Evaporative", kind: "system" },
  { label: "Gas Ducted", kind: "system" },
  { label: "ERV", kind: "system" },
  { label: "HRV", kind: "system" },
  { label: "Ventilation", kind: "system" },
  { label: "Zoning", kind: "system" },

  // topics
  { label: "Controls", kind: "topic" },
  { label: "BMS", kind: "topic" },
  { label: "Wiring", kind: "topic" },
  { label: "Refrigerant Piping", kind: "topic" },
  { label: "R32", kind: "topic" },
  { label: "R410A", kind: "topic" },
  { label: "Commissioning Data", kind: "topic" },
  { label: "Warranty", kind: "topic" },
  { label: "Compliance", kind: "topic" },
];

/* ── the drawer's opening offer ──────────────────────────────────────────── */

/** How many tags a filename is allowed to tick on its own. A guess that fills
    the row is a guess somebody has to undo one chip at a time. */
export const KB_TAG_GUESS_MAX = 4;

/* Tags the filename itself names — "daikin-vrv-service-manual.pdf" arrives
   with Daikin and VRV already on.

   A GUESS, NEVER A DECISION, exactly like guessKbCategory beside it: this
   prefills a control the uploader can clear before anything is stored, and the
   server re-checks every id it is eventually handed.

   THE LONGEST MATCH WINS ITS OVERLAP. "multi-split-manual" contains both
   "multi split" and "split", and ticking both says the same thing twice with
   the vaguer one last. A phrase wholly inside another matched phrase is
   dropped. */
export function guessKbTags<T extends { id: string; slug: string }>(
  filename: string,
  tags: readonly T[]
): string[] {
  const hay = ` ${normaliseFilename(filename)} `;
  if (hay.trim() === "") return [];

  const hits: { id: string; phrase: string; at: number }[] = [];
  for (const tag of tags) {
    const phrase = String(tag.slug ?? "").replace(/-/g, " ").trim();
    // a one-character tag matches half the alphabet in a model number
    if (phrase.length < 2) continue;
    const at = hay.indexOf(` ${phrase} `);
    if (at === -1) continue;
    hits.push({ id: tag.id, phrase, at });
  }

  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.phrase.includes(h.phrase)));

  // in the order the filename says them, which is the order whoever named the
  // file thought mattered
  return kept.sort((a, b) => a.at - b.at).slice(0, KB_TAG_GUESS_MAX).map((h) => h.id);
}

/* ── filtering ───────────────────────────────────────────────────────────── */

/* Documents carrying EVERY selected tag.

   AND, NOT OR. Picking Daikin and then VRV is somebody narrowing — the second
   chip is "…and VRV", not "…or VRV" — and it has to compose with the category
   chip above it, which also narrows. An OR would mean the list grew every time
   you added a filter, one row below a chip that shrinks it. */
export function filterByTags<T extends { tags?: readonly { id: string }[] }>(
  docs: readonly T[],
  tagIds: readonly string[]
): T[] {
  if (tagIds.length === 0) return [...docs];
  return docs.filter((d) => {
    const on = new Set((d.tags ?? []).map((t) => t.id));
    return tagIds.every((id) => on.has(id));
  });
}

/** Clean a list of tag ids arriving from a client: deduped, capped, and with
    anything that isn't one of the org's real tags dropped. */
export function sanitiseTagIds(raw: unknown, known: readonly { id: string }[]): string[] {
  if (!Array.isArray(raw)) return [];
  const real = new Set(known.map((t) => t.id));
  return [...new Set(raw.map((v) => String(v)))].filter((id) => real.has(id)).slice(0, KB_TAGS_PER_DOC_MAX);
}
