import { SELF_EDITABLE_SECTIONS, buildPatch } from "../profile";
import { ADMIN_SECTIONS, buildAdminPatch } from "../admin-sections";
import {
  BOOT_SCALES,
  DEFAULT_BOOT_SCALE,
  TOP_SIZES,
  UNIFORM_COLUMNS,
  bootLadder,
  bootLabel,
  uniformSummary,
  uniformValues,
} from "../uniform";
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
  boot_scale: null,
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
      ["boot_scale", "AU/UK"],
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
        boot_scale: "AU/UK",
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

  /* The one uniform field that ISN'T free text. A boot scale is picked from
     three values, so a submission carrying anything else is dropped rather
     than stored — the number would otherwise claim a system nobody offered. */
  it("drops a boot scale that isn't one of the three", () => {
    const { patch } = buildPatch("personal", [
      ["boot_size", "10"],
      ["boot_scale", "JP"],
    ]);
    expect(patch.boot_size).toBe("10");
    expect(patch).not.toHaveProperty("boot_scale");
  });

  it("keeps each of the three, on both paths", () => {
    for (const scale of BOOT_SCALES) {
      const entries: [string, string][] = [
        ["boot_size", "10"],
        ["boot_scale", scale],
      ];
      expect(buildPatch("personal", entries).patch.boot_scale).toBe(scale);
      expect(buildAdminPatch("personal", entries).patch.boot_scale).toBe(scale);
    }
  });

  /* A SCALE WITH NO NUMBER IS NOT A FACT. The picker always sits on something,
     so a save from someone who owns no boots would otherwise write "AU/UK"
     beside an empty size and assert something nobody said. */
  it("clears the scale when the boot size goes with it", () => {
    const entries: [string, string][] = [
      ["boot_size", "  "],
      ["boot_scale", "EU"],
    ];
    expect(buildPatch("personal", entries).patch).toMatchObject({
      boot_size: null,
      boot_scale: null,
    });
    expect(buildAdminPatch("personal", entries).patch).toMatchObject({
      boot_size: null,
      boot_scale: null,
    });
  });

  it("clears a size that was emptied, rather than storing a blank", () => {
    const { patch } = buildPatch("personal", [["boot_size", "   "]]);
    expect(patch.boot_size).toBeNull();
  });
});

describe("uniformValues", () => {
  it("reads blanks off a card with no sizes, and off no card at all", () => {
    // the scale is the exception: the picker needs a position, and AU/UK is
    // what is printed inside a boot bought here
    const empty = {
      shirt_size: "",
      jacket_size: "",
      trousers_size: "",
      boot_size: "",
      boot_scale: DEFAULT_BOOT_SCALE,
    };
    expect(uniformValues(blank)).toEqual(empty);
    expect(uniformValues(null)).toEqual(empty);
  });

  it("keeps the scale someone chose", () => {
    expect(uniformValues({ ...blank, boot_scale: "US" }).boot_scale).toBe("US");
  });
});

describe("the ladders", () => {
  /* Both answers, because a crew holds both: the bloke who says "large" and
     the one who reads 102 off the tag are describing the same shirt. */
  it("suggests alpha AND chest on the top half", () => {
    expect(TOP_SIZES).toContain("L");
    expect(TOP_SIZES).toContain("102");
    // alpha first — it is what most people answer with
    expect(TOP_SIZES.indexOf("5XL")).toBeLessThan(TOP_SIZES.indexOf("87"));
  });

  it("gives boots the ladder of the scale they're on", () => {
    expect(bootLadder("AU/UK")).toContain("10.5");
    expect(bootLadder("EU")).toContain("44");
    expect(bootLadder("EU")).not.toContain("10.5");
    expect(bootLadder("US")).toContain("12.5");
  });

  it("falls back to AU/UK rather than emptying itself", () => {
    expect(bootLadder(null)).toEqual(bootLadder(DEFAULT_BOOT_SCALE));
    expect(bootLadder("JP")).toEqual(bootLadder(DEFAULT_BOOT_SCALE));
  });
});

describe("bootLabel", () => {
  it("never shows the number without the system it is quoted on", () => {
    expect(bootLabel({ ...blank, boot_size: "10", boot_scale: "EU" })).toBe("10 EU");
  });

  it("shows the bare number when no scale was recorded", () => {
    expect(bootLabel({ ...blank, boot_size: "10" })).toBe("10");
  });

  it("shows nothing at all when there is no size", () => {
    expect(bootLabel({ ...blank, boot_scale: "US" })).toBe("");
    expect(bootLabel(null)).toBe("");
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
      boot_scale: "AU/UK",
    };
    expect(uniformSummary(p)).toBe("Shirt L · Jacket XL · Trousers 92 · Boots 10 AU/UK");
  });

  it("carries the boot scale into the line, where the order is read from", () => {
    expect(uniformSummary({ ...blank, boot_size: "44", boot_scale: "EU" })).toBe("Boots 44 EU");
  });

  it("answers with what we hold — a partial answer is still an answer", () => {
    expect(uniformSummary({ ...blank, shirt_size: "M", boot_size: "9" })).toBe("Shirt M · Boots 9");
  });

  it("is null when we hold none, so Summary can show its dash", () => {
    expect(uniformSummary(blank)).toBeNull();
    expect(uniformSummary(null)).toBeNull();
    expect(uniformSummary({ ...blank, shirt_size: "  " })).toBeNull();
    // a scale on its own is not a size — see dropOrphanScale
    expect(uniformSummary({ ...blank, boot_scale: "US" })).toBeNull();
  });
});
