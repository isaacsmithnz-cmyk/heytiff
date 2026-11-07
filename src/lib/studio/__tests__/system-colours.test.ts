/* A system's colour is the palette's (docs/design.md, rule 18a): the values a
   job's card wears, handed out green, pink, purple, yellow, then blue, and a
   design saved before 7 November 2026 takes them when it opens. */

import { createDesign, type DesignDocument, type DesignSystem } from "../document";
import { migrateDesign, normalizeDesign } from "../migrations";
import {
  SYSTEM_COLOURS,
  nextSystemColour,
  systemColoursOnPalette,
  systemWordColour,
} from "../modules";

const sys = (id: string, colour: string): DesignSystem => ({
  id,
  type: "split",
  brand: "Mitsubishi Electric",
  colour,
  name: id,
  settings: {},
});

/** the 19 and the three a job's card adds (rule 15) */
const PALETTE = new Set([
  "#EF4444", "#BE123C", "#F97316", "#B45309", "#FACC15", "#A16207", "#22C55E", "#15803D",
  "#2563EB", "#A855F7", "#7E22CE", "#EC4899", "#9D174D", "#9CA3AF", "#5F6A79", "#050505", "#FFFFFF",
  "#EA580C", "#EAB308", "#DB2777",
]);

describe("the system colours", () => {
  it("are the palette's, none of them red, orange or grey", () => {
    for (const c of SYSTEM_COLOURS) expect(PALETTE.has(c)).toBe(true);
    for (const c of ["#EF4444", "#BE123C", "#F97316", "#B45309", "#EA580C", "#9CA3AF", "#5F6A79"]) {
      expect(SYSTEM_COLOURS).not.toContain(c);
    }
  });

  it("go out green, pink, purple, yellow, then blue, and round again", () => {
    const made: DesignSystem[] = [];
    for (let i = 0; i < 6; i++) made.push(sys(`s${i}`, nextSystemColour(made)));
    expect(made.map((s) => s.colour)).toEqual(["#15803D", "#DB2777", "#7E22CE", "#EAB308", "#2563EB", "#15803D"]);
  });

  it("write words in the hue's word value", () => {
    expect(systemWordColour("#DB2777")).toBe("#9D174D");
    expect(systemWordColour("#eab308")).toBe("#A16207");
    expect(systemWordColour("#15803D")).toBe("#15803D");
    expect(systemWordColour("#123456")).toBe("#123456");
  });
});

describe("a design's systems onto the palette", () => {
  it("gives the old first and second systems green and pink", () => {
    const out = systemColoursOnPalette([sys("a", "#2E68FF"), sys("b", "#17A398")]);
    expect(out.map((s) => s.colour)).toEqual(["#15803D", "#DB2777"]);
  });

  it("moves each old colour to its place in the new list", () => {
    const old = ["#2E68FF", "#17A398", "#9B5DE5", "#D63384", "#1F8A4C"];
    const out = systemColoursOnPalette(old.map((c, i) => sys(`s${i}`, c)));
    expect(out.map((s) => s.colour)).toEqual(SYSTEM_COLOURS);
  });

  it("hands back the same array when every colour is on the palette, a shared one too", () => {
    const systems = [sys("a", "#15803D"), sys("b", "#15803D"), sys("c", "#7e22ce")];
    expect(systemColoursOnPalette(systems)).toBe(systems);
  });

  it("gives an old colour whose new one is taken the first colour free", () => {
    const out = systemColoursOnPalette([sys("a", "#15803D"), sys("b", "#2E68FF")]);
    expect(out.map((s) => s.colour)).toEqual(["#15803D", "#DB2777"]);
  });

  it("takes any other colour by its hue, an orange to pink, a grey to the first free", () => {
    const out = systemColoursOnPalette([sys("a", "#E4572E"), sys("b", "#888888"), sys("c", "#4F46E5")]);
    expect(out.map((s) => s.colour)).toEqual(["#DB2777", "#15803D", "#2563EB"]);
  });

  it("gives a system saved with no colour the first one free", () => {
    const bare = { ...sys("b", "#15803D"), colour: undefined } as unknown as DesignSystem;
    const out = systemColoursOnPalette([sys("a", "#15803D"), bare]);
    expect(out.map((s) => s.colour)).toEqual(["#15803D", "#DB2777"]);
  });

  it("keeps everything else about a system", () => {
    const [moved] = systemColoursOnPalette([{ ...sys("a", "#17A398"), name: "System 2", settings: { pairIdu: "X" } }]);
    expect(moved).toEqual({ ...sys("a", "#DB2777"), name: "System 2", settings: { pairIdu: "X" } });
  });
});

describe("opening a design", () => {
  const withSystems = (systems: DesignSystem[]): DesignDocument => ({
    ...createDesign({ name: "Cutler", mode: "plan" }),
    systems,
  });

  it("puts a design saved with the old colours onto the palette", () => {
    const saved = JSON.parse(JSON.stringify(withSystems([sys("a", "#2E68FF"), sys("b", "#17A398")])));
    const { doc } = migrateDesign(saved);
    expect(doc.systems.map((s) => s.colour)).toEqual(["#15803D", "#DB2777"]);
  });

  it("leaves a design already on the palette as it is", () => {
    const doc = withSystems([sys("a", "#15803D"), sys("b", "#DB2777")]);
    expect(normalizeDesign(doc)).toBe(doc);
  });
});
