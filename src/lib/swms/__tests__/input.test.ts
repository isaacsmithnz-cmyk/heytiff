import { DEFAULT_ANSWERS, STEP_KEYS } from "../library";
import { normaliseAnswers, normaliseOutsiders, signatureSvg } from "../input";

/* What a browser sends is a claim. A version is legal paperwork frozen
   forever, so these tests are about requests the wizard would never make. */

describe("normaliseAnswers", () => {
  it("reads nothing as the library's defaults", () => {
    for (const raw of [undefined, null, 7, "answers", []]) {
      expect(normaliseAnswers(raw)).toEqual({ ...DEFAULT_ANSWERS, steps: Object.fromEntries(STEP_KEYS.map((k) => [k, false])) });
    }
  });

  it("keeps every known choice as it was made", () => {
    const made = {
      ...DEFAULT_ANSWERS,
      kind: "service",
      jurisdiction: "QLD",
      site: { pre1990: true, powerlines: true, traffic: false, builder: true },
      extraCategories: [6],
      fall: "harness",
      anchor: "Roof anchor on the rear ridge",
      qldFallReason: "No access for an EWP past the side gate",
      lift: "crane",
      dust: "extract",
      silica: "low",
      silicaWhy: "Drilling timber cladding, no brick",
      roofPower: "rcd",
      isolation: "Main switchboard, garage wall",
      refrigerant: "R290",
      siteNotes: "Two dogs kept inside",
      hospital: "Sutherland Hospital, Caringbah",
      extinguisher: "site",
      riskAppendix: true,
    };
    expect(normaliseAnswers(made)).toEqual(made);
  });

  it("puts an unknown value back to the default instead of storing it", () => {
    const a = normaliseAnswers({ kind: "demolish", jurisdiction: "VIC", fall: "rope", lift: 3, refrigerant: "R22", extinguisher: null });
    expect(a.kind).toBe(DEFAULT_ANSWERS.kind);
    expect(a.jurisdiction).toBe(DEFAULT_ANSWERS.jurisdiction);
    expect(a.fall).toBe(DEFAULT_ANSWERS.fall);
    expect(a.lift).toBe(DEFAULT_ANSWERS.lift);
    expect(a.refrigerant).toBe("R32");
    expect(a.extinguisher).toBe(DEFAULT_ANSWERS.extinguisher);
  });

  it("drops keys the library doesn't know", () => {
    const a = normaliseAnswers({ ...DEFAULT_ANSWERS, content: { steps: [] }, site: { pre1990: true, asbestos: "none" } }) as Record<string, unknown>;
    expect(a.content).toBeUndefined();
    expect(a.site).toEqual({ pre1990: true, powerlines: false, traffic: false, builder: false });
  });

  it("counts only a real true as ticked", () => {
    const a = normaliseAnswers({ steps: { roof: "yes", lift: 1, drill: true }, site: { pre1990: "true" }, riskAppendix: "on" });
    expect(a.steps.roof).toBe(false);
    expect(a.steps.lift).toBe(false);
    expect(a.steps.drill).toBe(true);
    expect(a.site.pre1990).toBe(false);
    expect(a.riskAppendix).toBe(false);
  });

  it("keeps extra categories that exist, once each, in number order", () => {
    expect(normaliseAnswers({ extraCategories: [17, 0, 6, "4", 6, 19, 2.5] }).extraCategories).toEqual([6, 17]);
  });

  it("trims and caps what was typed", () => {
    const a = normaliseAnswers({ anchor: `  ${"a".repeat(500)}  `, siteNotes: "x".repeat(5000), hospital: "  Sutherland  " });
    expect(a.anchor).toHaveLength(200);
    expect(a.siteNotes).toHaveLength(1200);
    expect(a.hospital).toBe("Sutherland");
  });
});

describe("normaliseOutsiders", () => {
  it("keeps a name and a company, and a blank company as none", () => {
    expect(normaliseOutsiders([{ name: " Kai Lindqvist ", company: "Lindqvist Plumbing" }, { name: "Ana", company: "  " }])).toEqual([
      { name: "Kai Lindqvist", company: "Lindqvist Plumbing" },
      { name: "Ana", company: null },
    ]);
  });

  it("drops a row with no name, and anything that isn't a row", () => {
    expect(normaliseOutsiders([{ name: "  ", company: "Ghost Pty Ltd" }, "Kai", null, { company: "x" }])).toEqual([]);
    expect(normaliseOutsiders("Kai")).toEqual([]);
  });

  /* a name is all that identifies someone with no staff card: twice on the
     list is two people on the document, and one signature carried onto both */
  it("keeps one row per name", () => {
    expect(
      normaliseOutsiders([
        { name: "Kai Lindqvist", company: "Lindqvist Plumbing" },
        { name: " kai lindqvist ", company: "Someone else" },
        { name: "Ana" },
      ])
    ).toEqual([
      { name: "Kai Lindqvist", company: "Lindqvist Plumbing" },
      { name: "Ana", company: null },
    ]);
  });

  it("holds at twenty people", () => {
    expect(normaliseOutsiders(Array.from({ length: 30 }, (_, i) => ({ name: `Helper ${i}` })))).toHaveLength(20);
  });
});

describe("signatureSvg", () => {
  const drawn = "M10 20 L30 40 L50 35 L80 60";

  it("wraps a drawn path in an SVG written here", () => {
    const svg = signatureSvg(drawn)!;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200">')).toBe(true);
    expect(svg).toContain(`d="${drawn}"`);
  });

  it("refuses markup, even inside something that looks like a path", () => {
    expect(signatureSvg('M10 20 L30 40"/><script>alert(1)</script><path d="M0 0 L1 1')).toBeNull();
    expect(signatureSvg("<svg><path d='M0 0 L1 1 L2 2'/></svg>")).toBeNull();
    expect(signatureSvg("M10 20 C30 40 50 60 70 80 L1 1 L2 2")).toBeNull();
  });

  it("refuses a dot, an empty pad and a path past the cap", () => {
    expect(signatureSvg("M10 20 L10 20")).toBeNull();
    expect(signatureSvg("")).toBeNull();
    expect(signatureSvg(42)).toBeNull();
    expect(signatureSvg(`M0 0${" L1 1".repeat(5000)}`)).toBeNull();
  });
});
