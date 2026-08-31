/* Uniform sizes — the four garments the business actually orders, the ladders
   it offers as suggestions, and the scale a boot size is quoted on.

   ONE LIST, THREE READERS: the Personal card's edit rows, the Summary panel's
   one-line answer, and the allowlists that let either be saved. Kept here so a
   garment added to the card cannot be added without the ladder and the summary
   line following it.

   SUGGESTIONS, NOT OPTIONS. Australian workwear has no single sizing
   vocabulary — shirts are labelled XS–5XL on one rack and by CHEST in
   centimetres on the next, trousers run the 72–117 waist ladder, women's
   ranges number differently again. So every garment field stays free text with
   a datalist behind it: the common answer is one keystroke and the uncommon
   one is still possible. Same reasoning as the org credentials field, and the
   same TextInput `suggestions` prop.

   BOOTS ARE THE EXCEPTION, and they earn it. A boot size is not a number, it
   is a number in a SYSTEM: 10 in AU/UK is 44 in EU and 11 in US, and a supply
   order that guesses which one was meant sends back a boot two sizes out. So
   the scale is picked, stored beside the number, and shown with it everywhere
   the number is shown — and the ladder in the datalist follows the scale.

   Pure module: no server imports, so the card, the summary and the tests can
   all read it. */

import type { StaffProfile } from "./profile";

/** Alpha sizing, for anything worn on the top half. */
export const ALPHA_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"] as const;

/** Chest, in centimetres — how the same shirt is labelled on the other rack.
    Offered alongside the alpha ladder rather than instead of it: a crew will
    hold both answers, and a field that takes only one of them makes half of
    them wrong. */
export const CHEST_SIZES = [
  "87",
  "92",
  "97",
  "102",
  "107",
  "112",
  "117",
  "122",
  "127",
  "132",
] as const;

/** What a top-half field suggests: the alpha ladder first, because that is
    what most people answer with, then the chest ladder for the people who
    read it off a tag. */
export const TOP_SIZES = [...ALPHA_SIZES, ...CHEST_SIZES] as const;

/** The AU workwear waist ladder, in centimetres — how trousers are labelled
    here, even where the brand also prints an inch size on the tag. */
export const TROUSER_SIZES = [
  "72",
  "77",
  "82",
  "87",
  "92",
  "97",
  "102",
  "107",
  "112",
  "117",
] as const;

/* ── boots ── */

/** The three scales a boot is quoted on. AU and UK are one entry because AU
    safety boots ARE UK-sized — the yard says "ten" and means both — and
    splitting them would offer a distinction with no difference. */
export const BOOT_SCALES = ["AU/UK", "EU", "US"] as const;
export type BootScale = (typeof BOOT_SCALES)[number];

/** What we take an unqualified boot size to be. Not a presumption written to
    the column — the picker simply starts here, because this is the scale
    printed inside a boot bought in Australia. */
export const DEFAULT_BOOT_SCALE: BootScale = "AU/UK";

/* Halves included on AU/UK and US — safety boots are sold in halves and an
   installer on their feet all day will tell you it matters. EU runs whole
   sizes, which is why that ladder is shorter rather than sparser. */
const BOOT_LADDERS: Record<BootScale, readonly string[]> = {
  "AU/UK": [
    "4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5",
    "10", "10.5", "11", "11.5", "12", "13", "14",
  ],
  EU: [
    "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49",
  ],
  US: [
    "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5",
    "11", "11.5", "12", "12.5", "13", "14", "15",
  ],
};

export function isBootScale(v: unknown): v is BootScale {
  return typeof v === "string" && (BOOT_SCALES as readonly string[]).includes(v);
}

/** The ladder for a scale, falling back to AU/UK for a blank or a junk one —
    a datalist that empties itself is worse than one showing the common case. */
export function bootLadder(scale: string | null | undefined): readonly string[] {
  return BOOT_LADDERS[isBootScale(scale) ? scale : DEFAULT_BOOT_SCALE];
}

/* ── the fields ── */

export type UniformColumn =
  | "shirt_size"
  | "jacket_size"
  | "trousers_size"
  | "boot_size"
  | "boot_scale";

export type UniformField = {
  /** the staff_profiles column */
  key: Exclude<UniformColumn, "boot_scale">;
  /** the row's label on the card */
  label: string;
  /** shorter, for the one-line Summary answer where four sizes share a row */
  short: string;
  placeholder: string;
  suggestions: readonly string[];
  /** the column naming which scale this size is quoted on. Only boots have
      one; everything else is a size, not a measurement in a system. */
  scaleKey?: "boot_scale";
};

/* Shirt first because it is the one every business orders, boots last because
   they are the one some never do. */
export const UNIFORM_FIELDS: readonly UniformField[] = [
  {
    key: "shirt_size",
    label: "Shirt",
    short: "Shirt",
    // both answers in the placeholder, because both are in the datalist
    placeholder: "e.g. L or 102",
    suggestions: TOP_SIZES,
  },
  {
    key: "jacket_size",
    label: "Jacket / jumper",
    short: "Jacket",
    placeholder: "e.g. XL or 107",
    suggestions: TOP_SIZES,
  },
  {
    key: "trousers_size",
    label: "Trousers",
    short: "Trousers",
    placeholder: "e.g. 92",
    suggestions: TROUSER_SIZES,
  },
  {
    key: "boot_size",
    label: "Boots",
    short: "Boots",
    placeholder: "e.g. 10",
    suggestions: BOOT_LADDERS[DEFAULT_BOOT_SCALE],
    scaleKey: "boot_scale",
  },
];

/** The columns, in card order — what the allowlists and the column lists
    spell out longhand, so the two can be checked against each other. */
export const UNIFORM_COLUMNS: readonly UniformColumn[] = [
  ...UNIFORM_FIELDS.map((f) => f.key),
  "boot_scale",
];

/** The EDIT values, keyed by column. A missing profile reads as blanks — the
    same as every other card's values builder — except the boot scale, which
    starts on AU/UK so the picker has a position and the ladder has a rung.
    Nothing is written from that until a size is typed; see dropOrphanScale. */
export function uniformValues(p: StaffProfile | null): Record<string, string> {
  return {
    ...Object.fromEntries(UNIFORM_FIELDS.map((f) => [f.key, p?.[f.key] ?? ""])),
    boot_scale: p?.boot_scale || DEFAULT_BOOT_SCALE,
  };
}

/** A SCALE WITH NO NUMBER IS NOT A FACT. The picker always has a position, so
    a personal save from someone who owns no boots would otherwise write
    "AU/UK" into a column beside an empty size and assert something nobody
    said. Both patch builders run this last: if the submission clears the boot
    size, the scale goes with it. */
export function dropOrphanScale<T extends Record<string, unknown>>(patch: T): T {
  if ("boot_size" in patch && !patch.boot_size && "boot_scale" in patch) {
    (patch as Record<string, unknown>).boot_scale = null;
  }
  return patch;
}

/** "10 AU/UK" — a boot size never reads without the scale it's quoted on, on
    the card or in the summary line. Empty when there is no size, scale or no
    scale. */
export function bootLabel(p: StaffProfile | null): string {
  const size = (p?.boot_size ?? "").trim();
  if (!size) return "";
  const scale = (p?.boot_scale ?? "").trim();
  return scale ? `${size} ${scale}` : size;
}

/** What each row READS as — the stored value for every garment, and the size
    plus its scale for boots. Separate from uniformValues on purpose: that one
    seeds the draft and is submitted back, so it holds the raw columns. */
export function uniformDisplay(p: StaffProfile | null): Record<string, string> {
  return {
    ...Object.fromEntries(UNIFORM_FIELDS.map((f) => [f.key, p?.[f.key] ?? ""])),
    boot_size: bootLabel(p),
  };
}

/** "Shirt L · Trousers 92 · Boots 10 AU/UK" — the one-line answer for Summary.

    Labelled, because a bare "L · 92 · 10" is unreadable, and only the sizes we
    hold appear: a partial answer is still an answer, and the blanks have their
    own "+ Add" one tab away. Null when we hold none of them, which is what
    lets the row fall back to Summary's dash rather than printing an empty
    string. */
export function uniformSummary(p: StaffProfile | null): string | null {
  const display = uniformDisplay(p);
  const parts = UNIFORM_FIELDS.flatMap((f) => {
    const v = (display[f.key] ?? "").trim();
    return v ? [`${f.short} ${v}`] : [];
  });
  return parts.length ? parts.join(" · ") : null;
}
