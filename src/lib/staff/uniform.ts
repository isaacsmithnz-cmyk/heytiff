/* Uniform sizes — the four garments the business actually orders, and the
   ladders it offers as suggestions.

   ONE LIST, THREE READERS: the Personal card's edit rows, the Summary panel's
   one-line answer, and the allowlists that let either be saved. Kept here so a
   garment added to the card cannot be added without the ladder and the summary
   line following it.

   SUGGESTIONS, NOT OPTIONS. Australian workwear has no single sizing
   vocabulary — shirts run XS–5XL, trousers run either the 72–117 waist ladder
   or S/M/L depending on the brand, women's ranges number differently again,
   and boots come in half sizes and in US/UK conversions. So every field stays
   free text with a datalist behind it: the common answer is one keystroke and
   the uncommon one is still possible. Same reasoning as the org credentials
   field, and the same TextInput `suggestions` prop.

   Pure module: no server imports, so the card, the summary and the tests can
   all read it. */

import type { StaffProfile } from "./profile";

/** Alpha sizing, for anything worn on the top half. */
export const ALPHA_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"] as const;

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

/** AU/UK boot sizes, halves included — safety boots are sized in halves and
    an installer on their feet all day will tell you it matters. */
export const BOOT_SIZES = [
  "6",
  "6.5",
  "7",
  "7.5",
  "8",
  "8.5",
  "9",
  "9.5",
  "10",
  "10.5",
  "11",
  "11.5",
  "12",
  "13",
  "14",
] as const;

export type UniformField = {
  /** the staff_profiles column */
  key: "shirt_size" | "jacket_size" | "trousers_size" | "boot_size";
  /** the row's label on the card */
  label: string;
  /** shorter, for the one-line Summary answer where four labels share a row */
  short: string;
  placeholder: string;
  suggestions: readonly string[];
};

/* Shirt first because it is the one every business orders, boots last because
   they are the one some never do. */
export const UNIFORM_FIELDS: readonly UniformField[] = [
  {
    key: "shirt_size",
    label: "Shirt",
    short: "Shirt",
    placeholder: "e.g. L",
    suggestions: ALPHA_SIZES,
  },
  {
    key: "jacket_size",
    label: "Jacket / jumper",
    short: "Jacket",
    placeholder: "e.g. XL",
    suggestions: ALPHA_SIZES,
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
    suggestions: BOOT_SIZES,
  },
];

/** The columns, in card order — what the allowlists and the column lists
    spell out longhand, so the two can be checked against each other. */
export const UNIFORM_COLUMNS = UNIFORM_FIELDS.map((f) => f.key);

/** The EDIT values, keyed by column. A missing profile reads as four blanks,
    the same as every other card's values builder. */
export function uniformValues(p: StaffProfile | null): Record<string, string> {
  return Object.fromEntries(UNIFORM_FIELDS.map((f) => [f.key, p?.[f.key] ?? ""]));
}

/** "Shirt L · Trousers 92 · Boots 10" — the one-line answer for Summary.

    Labelled, because a bare "L · 92 · 10" is unreadable, and only the sizes we
    hold appear: a partial answer is still an answer, and the blanks have their
    own "+ Add" one tab away. Null when we hold none of them, which is what
    lets the row fall back to Summary's dash rather than printing an empty
    string. */
export function uniformSummary(p: StaffProfile | null): string | null {
  const parts = UNIFORM_FIELDS.flatMap((f) => {
    const v = (p?.[f.key] ?? "").trim();
    return v ? [`${f.short} ${v}`] : [];
  });
  return parts.length ? parts.join(" · ") : null;
}
