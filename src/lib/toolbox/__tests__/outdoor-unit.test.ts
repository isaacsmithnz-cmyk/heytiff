/* Outdoor Unit Placement — rule applicability, the verdict, and the mapping
   from answers to the drawing. */

import {
  DEFAULT_PLACEMENT,
  RULES,
  check,
  marksFor,
  ruleApplies,
  rulesFor,
  type Answers,
  type Placement,
} from "../outdoor-unit";

const at = (over: Partial<Placement> = {}): Placement => ({ ...DEFAULT_PLACEMENT, ...over });

const answerAll = (p: Placement, a: "yes" | "no"): Answers =>
  Object.fromEntries(rulesFor(p).map((r) => [r.id, a]));

const ruleOf = (id: string) => RULES.find((r) => r.id === id)!;

describe("rule content", () => {
  it("every rule is complete and uniquely identified", () => {
    const ids = new Set<string>();
    for (const r of RULES) {
      expect(r.label).toBeTruthy();
      expect(r.detail).toBeTruthy();
      expect(ids.has(r.id)).toBe(false);
      ids.add(r.id);
    }
  });

  /* The whole point of the rewrite was to strip planning jargon out of the
     reader-facing text. Keep it out. */
  it("keeps planning jargon out of the labels and details", () => {
    const banned = [
      "exempt development",
      "development consent",
      "primary road",
      "habitable room",
      "lot boundary",
      "SEPP",
      "POEO",
      "BCA",
      "fire-resistance level",
      "ground level (existing)",
    ];
    for (const r of RULES) {
      const text = (r.label + " " + r.detail).toLowerCase();
      for (const term of banned) {
        expect(text).not.toContain(term.toLowerCase());
      }
    }
  });
});

describe("which rules apply", () => {
  /* Verified against Codes SEPP cl 2.6 on 2026-07-19: the 1.8 m cap reads "if
     located on the ground floor", and an amendment in force 29 Nov 2024 lifted
     it for units above the ground floor. */
  it("caps height on the ground floor only", () => {
    expect(ruleApplies(ruleOf("height"), at({ floor: "ground" }))).toBe(true);
    expect(ruleApplies(ruleOf("height"), at({ floor: "above" }))).toBe(false);
  });

  it("swaps the home setback for the bigger business one", () => {
    const home = rulesFor(at({ property: "home" })).map((r) => r.id);
    expect(home).toContain("boundary");
    expect(home).not.toContain("business-setback");

    const biz = rulesFor(at({ property: "business" })).map((r) => r.id);
    expect(biz).toContain("business-setback");
    expect(biz).not.toContain("boundary");
  });

  /* cl 2.6(1)(g) requires ground mounting only for a heritage ITEM; (h) requires
     the rear building line for an item OR a conservation area. Conflating them
     over-restricts every home inside an HCA. */
  it("asks less of a conservation area than of a listed item", () => {
    expect(rulesFor(at()).map((r) => r.id)).not.toContain("heritage-ground");

    const area = rulesFor(at({ heritage: "area" })).map((r) => r.id);
    expect(area).toContain("heritage-rear");
    expect(area).not.toContain("heritage-ground");

    const item = rulesFor(at({ heritage: "item" })).map((r) => r.id);
    expect(item).toContain("heritage-rear");
    expect(item).toContain("heritage-ground");
  });

  it("uses the non-residential heritage duties for a business", () => {
    const item = rulesFor(at({ property: "business", heritage: "item" })).map((r) => r.id);
    expect(item).toContain("biz-heritage-wall");
    expect(item).not.toContain("heritage-ground");

    const area = rulesFor(at({ property: "business", heritage: "area" })).map((r) => r.id);
    expect(area).toContain("biz-heritage-line");
    expect(area).not.toContain("biz-heritage-wall");
  });

  /* 2.6(1A) is NOT 2.6(1) renumbered — it has no boundary setback, no bedroom
     rule, no height cap and no wall/ground-only restriction. */
  it("does not apply the residential-only paragraphs to a business", () => {
    const biz = rulesFor(at({ property: "business" })).map((r) => r.id);
    for (const residentialOnly of ["boundary", "bedroom", "height", "mounting"]) {
      expect(biz).not.toContain(residentialOnly);
    }
  });

  it("always asks about the street, the building and both noise limits", () => {
    for (const p of [
      at(),
      at({ floor: "above" }),
      at({ property: "business" }),
      at({ heritage: "item" }),
      at({ property: "business", heritage: "area" }),
    ]) {
      const ids = rulesFor(p).map((r) => r.id);
      for (const always of ["street", "building", "noise-peak", "noise-offpeak"]) {
        expect(ids).toContain(always);
      }
    }
  });
});

describe("the verdict", () => {
  it("starts unanswered, not failed", () => {
    const r = check(at(), {});
    expect(r.verdict).toBe("unanswered");
    expect(r.failed).toEqual([]);
    expect(r.unanswered).toHaveLength(r.total);
  });

  it("clears only when every applicable line passes", () => {
    expect(check(at(), answerAll(at(), "yes")).verdict).toBe("clear");
  });

  it("one miss settles it, even with the rest blank", () => {
    const r = check(at(), { bedroom: "no" });
    expect(r.verdict).toBe("approval");
    expect(r.failed).toEqual(["bedroom"]);
    expect(r.unanswered.length).toBeGreaterThan(0);
  });

  it("ignores answers for rules that no longer apply", () => {
    const ground = answerAll(at({ floor: "ground" }), "yes");
    expect(ground.height).toBe("yes");

    const upstairs = check(at({ floor: "above" }), ground);
    expect(upstairs.met).not.toContain("height");
    expect(upstairs.total).toBe(rulesFor(at({ floor: "above" })).length);
    expect(upstairs.verdict).toBe("clear");
  });

  it("a stale miss on an inapplicable rule does not force approval", () => {
    const r = check(at({ floor: "above" }), {
      ...answerAll(at({ floor: "above" }), "yes"),
      height: "no",
    });
    expect(r.verdict).toBe("clear");
  });
});

describe("the drawing", () => {
  /* elevation, so it shows the three MEASURED rules — the two setbacks and the
     mounting height. "Not facing the street" is plan-view only. */
  it("maps exactly the three rules it shows", () => {
    expect(
      marksFor(at(), { boundary: "yes", bedroom: "no", height: "yes", street: "no", building: "no" })
    ).toEqual({ boundary: "ok", bedroom: "bad", height: "ok" });
  });

  it("drops the height mark upstairs, where the 1.8 m cap does not apply", () => {
    expect(marksFor(at({ floor: "above" }), { height: "yes" }).height).toBeUndefined();
  });

  it("leaves unanswered rules unmarked", () => {
    expect(marksFor(at(), {})).toEqual({});
  });

  it("drops the boundary mark when the home setback does not apply", () => {
    expect(marksFor(at({ property: "business" }), { boundary: "yes" }).boundary).toBeUndefined();
  });
});
