/* Tag colours and category accents — assigned ONCE at creation, stored on
   the row, never recomputed (B2's fix: the prototype derived tag colour
   from list position, so adding one tag re-coloured every other).

   The palettes deliberately exclude green and red: on this board those are
   the semantic ok/danger pair and mean STATE — a tag wearing them would
   read as a verdict. Pink stays for categories (C3: the handover ordered
   the pink token deleted while its own rotation spec required it — it
   lives, renamed out of the gate family). */

export const TAG_TONES = ["violet", "blue", "cyan", "pink", "amber", "slate"] as const;
export type TagTone = (typeof TAG_TONES)[number];

export const CATEGORY_ACCENTS = ["violet", "blue", "pink", "slate"] as const;
export type CategoryAccent = (typeof CATEGORY_ACCENTS)[number];

export function isTagTone(v: unknown): v is TagTone {
  return typeof v === "string" && (TAG_TONES as readonly string[]).includes(v);
}

export function isCategoryAccent(v: unknown): v is CategoryAccent {
  return typeof v === "string" && (CATEGORY_ACCENTS as readonly string[]).includes(v);
}

/** Deterministic tone for a new tag: hash the name once, store the answer.
    Renaming or adding OTHER tags can never change it — the stored colour is
    the truth and this function only ever runs at creation. */
export function tagToneFor(name: string): TagTone {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return TAG_TONES[h % TAG_TONES.length];
}

/** Categories rotate through the accent band in creation order — stored at
    creation like tag tones, so the rotation is history, not a formula that
    reshuffles live rows. */
export function nextCategoryAccent(existingCount: number): CategoryAccent {
  return CATEGORY_ACCENTS[existingCount % CATEGORY_ACCENTS.length];
}
