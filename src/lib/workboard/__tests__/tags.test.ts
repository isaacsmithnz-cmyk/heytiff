/* Identity colours, held still (B2). The prototype derived tag colour from
   list position, so tag #6 re-painted tags #1–5; here colour is a pure
   function of the NAME, computed once at creation and stored. These tests
   pin the palette's semantics as much as the maths: no green, no red —
   state colours stay state. */

import {
  CATEGORY_ACCENTS,
  isCategoryAccent,
  isTagTone,
  nextCategoryAccent,
  TAG_TONES,
  tagToneFor,
} from "../tags";

describe("tag tones", () => {
  it("same name, same tone, forever — and other tags can't move it", () => {
    const first = tagToneFor("Our install");
    expect(tagToneFor("Our install")).toBe(first);
    // creating other tags has no effect by construction: the function only
    // ever sees the one name
    tagToneFor("HACCP site");
    tagToneFor("Key on file");
    expect(tagToneFor("Our install")).toBe(first);
  });

  it("tones come from the palette, which contains no green and no red", () => {
    for (const name of ["Our install", "HACCP", "Warranty", "Strata", "After hours", "x"]) {
      expect(isTagTone(tagToneFor(name))).toBe(true);
    }
    const forbidden = ["green", "ok", "red", "danger"];
    for (const tone of [...TAG_TONES, ...CATEGORY_ACCENTS]) {
      expect(forbidden).not.toContain(tone);
    }
  });
});

describe("category accents", () => {
  it("rotate in creation order and pin at creation — count in, accent out", () => {
    expect(nextCategoryAccent(0)).toBe(CATEGORY_ACCENTS[0]);
    expect(nextCategoryAccent(1)).toBe(CATEGORY_ACCENTS[1]);
    expect(nextCategoryAccent(CATEGORY_ACCENTS.length)).toBe(CATEGORY_ACCENTS[0]);
  });

  it("pink survives, renamed out of the gate family (C3)", () => {
    expect(isCategoryAccent("pink")).toBe(true);
  });
});
