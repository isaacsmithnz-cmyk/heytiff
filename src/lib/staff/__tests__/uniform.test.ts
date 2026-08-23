import { SELF_EDITABLE_SECTIONS, buildPatch } from "../profile";
import { ADMIN_SECTIONS, buildAdminPatch } from "../admin-sections";
import { UNIFORM_COLUMNS, uniformSummary, uniformValues } from "../uniform";
import type { StaffProfile } from "../profile";

/* Uniform sizes — what to order, and who may say so.

   The four columns are on the PERSONAL section of both allowlists, which is
   the whole gate: they reach staff_profiles through the same save every other
   personal field does, with no new capability and no new section key. These
   pin that, and pin the summary line Summary reads them back as. */

const blank = {
  shirt_size: null,
  jacket_size: null,
  trousers_size: null,
  boot_size: null,
} as unknown as StaffProfile;

describe("the allowlists", () => {
  it("lets you set your own sizes — they order a shirt, not a pay run", () => {
    const self = SELF_EDITABLE_SECTIONS.personal as readonly string[];
    for (const col of UNIFORM_COLUMNS) expect(self).toContain(col);
  });

  it("lets an admin set them too, on the same section", () => {
    const admin = ADMIN_SECTIONS.personal.columns as readonly string[];
    for (const col of UNIFORM_COLUMNS) expect(admin).toContain(col);
  });

  it("reaches no other section — a size is a personal fact", () => {
    for (const [section, columns] of Object.entries(SELF_EDITABLE_SECTIONS)) {
      if (section === "personal") continue;
      for (const col of UNIFORM_COLUMNS) expect(columns as readonly string[]).not.toContain(col);
    }
  });
});

describe("saving", () => {
  it("writes what was typed, on both paths", () => {
    const typed: [string, string][] = [
      ["shirt_size", "L"],
      ["jacket_size", "XL"],
      ["trousers_size", "92"],
      ["boot_size", "10.5"],
    ];

    for (const patch of [
      buildPatch("personal", typed).patch,
      buildAdminPatch("personal", typed).patch,
    ]) {
      expect(patch).toMatchObject({
        shirt_size: "L",
        jacket_size: "XL",
        trousers_size: "92",
        boot_size: "10.5",
      });
    }
  });

  /* Free text, deliberately: AU workwear runs XS–5XL, the 72–117 waist ladder
     and half-size boots all at once, and the next supplier will use a scale
     nobody here listed. The card SUGGESTS; the column takes what it's given. */
  it("takes a size that isn't on any ladder we offer", () => {
    const { patch, invalid } = buildPatch("personal", [["shirt_size", "Ladies 14"]]);
    expect(patch.shirt_size).toBe("Ladies 14");
    expect(invalid).toEqual([]);
  });

  it("clears a size that was emptied, rather than storing a blank", () => {
    const { patch } = buildPatch("personal", [["boot_size", "   "]]);
    expect(patch.boot_size).toBeNull();
  });
});

describe("uniformValues", () => {
  it("reads four blanks off a card with no sizes, and off no card at all", () => {
    const empty = { shirt_size: "", jacket_size: "", trousers_size: "", boot_size: "" };
    expect(uniformValues(blank)).toEqual(empty);
    expect(uniformValues(null)).toEqual(empty);
  });
});

describe("uniformSummary", () => {
  it("labels every size — a bare 'L · 92 · 10' says nothing", () => {
    const p = {
      ...blank,
      shirt_size: "L",
      jacket_size: "XL",
      trousers_size: "92",
      boot_size: "10",
    };
    expect(uniformSummary(p)).toBe("Shirt L · Jacket XL · Trousers 92 · Boots 10");
  });

  it("answers with what we hold — a partial answer is still an answer", () => {
    expect(uniformSummary({ ...blank, shirt_size: "M", boot_size: "9" })).toBe("Shirt M · Boots 9");
  });

  it("is null when we hold none, so Summary can show its dash", () => {
    expect(uniformSummary(blank)).toBeNull();
    expect(uniformSummary(null)).toBeNull();
    expect(uniformSummary({ ...blank, shirt_size: "  " })).toBeNull();
  });
});
