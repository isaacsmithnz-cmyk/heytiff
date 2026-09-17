import {
  buildSwms,
  categoriesOf,
  DEFAULT_ANSWERS,
  HRCW,
  issueProblemList,
  issueProblems,
  jurisdictionFromAddress,
  kindFromCategory,
  refrigerantClass,
  riskLevel,
  SERVICE_STEPS,
  startingAnswers,
  STEP_KEYS,
  stepsFor,
  vagueWords,
  type SwmsAnswers,
} from "../library";

const ctx = { work: "Supply and install a split system", electricianName: "Sam Ikpeba", firstAiderName: "Troy Porter" };
const answers = (over: Partial<SwmsAnswers> = {}): SwmsAnswers => ({
  ...DEFAULT_ANSWERS,
  hospital: "Sutherland Hospital, Caringbah",
  isolation: "Main switchboard, garage wall",
  ...over,
  site: { ...DEFAULT_ANSWERS.site, ...(over.site ?? {}) },
  steps: { ...DEFAULT_ANSWERS.steps, ...(over.steps ?? {}) },
});
const nums = (a: SwmsAnswers) => categoriesOf(a).map((c) => c.n);
const text = (a: SwmsAnswers) =>
  buildSwms(a, ctx).steps.flatMap((s) => s.controls.map((c) => c.text)).join("\n");
const facts = { people: 3, responsibleChosen: true, electricianChosen: true, siteChecked: true };

describe("the 18 categories", () => {
  it("each has the regulation's words for paper and plain words for the screen", () => {
    for (const c of HRCW) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.plain.length).toBeGreaterThan(0);
    }
    expect(HRCW.find((c) => c.n === 16)).toMatchObject({
      label: "In an area with artificial extremes of temperature",
      plain: "Extreme heat or cold, like a roof space",
    });
  });

  it("are the regulation's 18, numbered once each", () => {
    expect(HRCW.map((c) => c.n)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });
});

describe("what the answers switch on", () => {
  it("a split install on a roof, through a ceiling, drilled and charged: falls, refrigerant lines, live electrical, roof-cavity heat", () => {
    expect(nums(answers())).toEqual([1, 10, 11, 16]);
  });

  it("every category says why it applies", () => {
    for (const c of categoriesOf(answers({ site: { pre1990: true, powerlines: true, traffic: true, builder: true } }))) {
      expect(c.reason.length).toBeGreaterThan(10);
    }
  });

  it("refrigerant lines come from charging, not from every install", () => {
    expect(nums(answers({ steps: { ...DEFAULT_ANSWERS.steps, charge: false } }))).not.toContain(10);
  });

  it("drilling a pre-1990 building adds asbestos; not drilling it doesn't", () => {
    expect(nums(answers({ site: { ...DEFAULT_ANSWERS.site, pre1990: true } }))).toContain(4);
    expect(
      nums(answers({ site: { ...DEFAULT_ANSWERS.site, pre1990: true }, steps: { ...DEFAULT_ANSWERS.steps, drill: false } }))
    ).not.toContain(4);
  });

  it("Queensland treats silica from drilling as a contaminated atmosphere; NSW doesn't add it", () => {
    expect(nums(answers({ jurisdiction: "QLD" }))).toContain(12);
    expect(nums(answers({ jurisdiction: "NSW" }))).not.toContain(12);
  });

  it("a crane or an EWP brings powered mobile plant; a rope hoist doesn't", () => {
    expect(nums(answers({ lift: "crane" }))).toContain(15);
    expect(nums(answers({ fall: "ewp" }))).toContain(15);
    expect(nums(answers())).not.toContain(15);
  });

  it("powerlines and traffic come from the site questions alone", () => {
    const none = Object.fromEntries(STEP_KEYS.map((k) => [k, false])) as SwmsAnswers["steps"];
    expect(nums(answers({ steps: none, site: { ...DEFAULT_ANSWERS.site, powerlines: true, traffic: true } }))).toEqual([11, 14]);
  });

  it("a category ticked on site is added with its reason, and a number that isn't a category is ignored", () => {
    const got = categoriesOf(answers({ extraCategories: [17, 99] }));
    expect(got.find((c) => c.n === 17)?.reason).toBe("Ticked on site");
    expect(got.some((c) => c.n === 99)).toBe(false);
  });
});

describe("the document", () => {
  it("writes the steps in the order the work happens", () => {
    expect(buildSwms(answers(), ctx).steps.map((s) => s.key)).toEqual([...STEP_KEYS]);
  });

  it("leaves out a step that isn't happening", () => {
    const keys = buildSwms(answers({ steps: { ...DEFAULT_ANSWERS.steps, lift: false } }), ctx).steps.map((s) => s.key);
    expect(keys).not.toContain("lift");
  });

  it("gives every control its level in the hierarchy", () => {
    for (const s of buildSwms(answers(), ctx).steps) {
      expect(s.controls.length).toBeGreaterThan(0);
      for (const c of s.controls) expect(c.level).toBeTruthy();
    }
  });

  it("prints the fall control chosen on site", () => {
    expect(text(answers({ fall: "edge" }))).toMatch(/top rail 900–1100 mm/);
    expect(text(answers({ fall: "scaffold" }))).toMatch(/licensed scaffolder/);
    expect(text(answers({ fall: "ewp" }))).toMatch(/elevating work platform/);
    expect(text(answers({ fall: "harness", anchor: "Roof anchor on the rear ridge" }))).toMatch(/clipped to Roof anchor on the rear ridge/);
  });

  it("in Queensland a harness prints the reason typed on site for not using a higher control, and nothing invented", () => {
    const qld = text(answers({ jurisdiction: "QLD", fall: "harness", anchor: "Ridge anchor", qldFallReason: "the roof edge is on the boundary" }));
    expect(qld).toMatch(/s 299\(4\)\): the roof edge is on the boundary/);
    expect(text(answers({ jurisdiction: "NSW", fall: "harness", anchor: "Ridge anchor" }))).not.toMatch(/299\(4\)/);
  });

  it("keeps copper pipe 4.0 m from a service line in NSW and 3.0 m in Queensland", () => {
    const lines = { ...DEFAULT_ANSWERS.site, powerlines: true };
    expect(text(answers({ site: lines }))).toMatch(/4\.0 m from the overhead service line/);
    expect(text(answers({ site: lines, jurisdiction: "QLD" }))).toMatch(/3\.0 m from the uninsulated/);
  });

  it("turns the mains off for a Queensland roof space and cites the regulation, whatever was chosen", () => {
    const qld = text(answers({ jurisdiction: "QLD", roofPower: "rcd" }));
    expect(qld).toMatch(/Electrical Safety Regulation 2026/);
    expect(qld).not.toMatch(/RCD-protected socket circuit left on/);
    expect(text(answers({ jurisdiction: "NSW", roofPower: "rcd" }))).toMatch(/RCD-protected socket circuit left on/);
  });

  it("writes the silica assessment either way, with the reason typed when it isn't high risk", () => {
    expect(text(answers({ silica: "high" }))).toMatch(/silica risk control plan/);
    expect(text(answers({ silica: "low", silicaWhy: "one 25 mm hole, hand drill, outdoors" }))).toMatch(/not high risk — one 25 mm hole/);
  });

  it("names the electrician, and in Queensland says a restricted licence doesn't cover the wiring", () => {
    expect(text(answers())).toMatch(/licensed electrician — Sam Ikpeba/);
    expect(text(answers({ jurisdiction: "QLD" }))).toMatch(/restricted electrical licence doesn't cover it/);
  });

  it("treats R32 as flammable and R410A as not", () => {
    expect(text(answers({ refrigerant: "R32" }))).toMatch(/temporary flammable zone/);
    expect(text(answers({ refrigerant: "R410A" }))).not.toMatch(/flammable zone/);
  });

  it("asks a Queensland worker for a gas work licence only for a hydrocarbon refrigerant", () => {
    expect(text(answers({ refrigerant: "R290", jurisdiction: "QLD" }))).toMatch(/gas work licence/);
    expect(text(answers({ refrigerant: "R290", jurisdiction: "NSW" }))).not.toMatch(/gas work licence/);
    expect(text(answers({ refrigerant: "R32", jurisdiction: "QLD" }))).not.toMatch(/gas work licence/);
  });

  it("asks for a hot work permit only when a builder runs the site", () => {
    expect(text(answers({ site: { ...DEFAULT_ANSWERS.site, builder: true } }))).toMatch(/Hot work permit/);
    expect(text(answers())).not.toMatch(/Hot work permit/);
  });

  it("carries the emergency facts and the licence note", () => {
    const doc = buildSwms(answers({ jurisdiction: "QLD" }), ctx);
    expect(doc.emergency).toEqual({ firstAider: "Troy Porter", hospital: "Sutherland Hospital, Caringbah", extinguisher: "In the van" });
    expect(doc.licenceNote).toMatch(/refrigerant trading authorisation/);
    expect(doc.licenceNote).toMatch(/restricted electrical licence/);
  });
});

describe("the risk score appendix", () => {
  it("is absent unless asked for", () => {
    expect(buildSwms(answers(), ctx).riskScores).toBeNull();
  });

  it("scores every step it prints, before and after its controls", () => {
    const scores = buildSwms(answers({ riskAppendix: true, steps: { ...DEFAULT_ANSWERS.steps, braze: false } }), ctx).riskScores!;
    expect(scores.map((s) => s.key)).toEqual(STEP_KEYS.filter((k) => k !== "braze"));
    for (const s of scores) {
      expect(s.after.likelihood * s.after.consequence).toBeLessThanOrEqual(s.before.likelihood * s.before.consequence);
    }
  });

  it("bands a score the same way at every boundary", () => {
    const band = (score: number) => riskLevel({ likelihood: score, consequence: 1 });
    expect([1, 4].map(band)).toEqual(["Low", "Low"]);
    expect([5].map(band)).toEqual(["Medium"]);
    expect(riskLevel({ likelihood: 3, consequence: 3 })).toBe("Medium");
    expect(riskLevel({ likelihood: 2, consequence: 5 })).toBe("High");
    expect(riskLevel({ likelihood: 4, consequence: 4 })).toBe("High");
    expect(riskLevel({ likelihood: 4, consequence: 5 })).toBe("Extreme");
    expect(riskLevel({ likelihood: 5, consequence: 5 })).toBe("Extreme");
  });
});

describe("refrigerants and addresses", () => {
  it("classes the refrigerants a design can hold", () => {
    expect(["R32", "R454B", "R290", "R410A", "R32/R410A"].map(refrigerantClass)).toEqual(["A2L", "A2L", "A3", "A1", "A2L"]);
  });

  it("reads NSW or Queensland off an address, and nothing else", () => {
    expect(jurisdictionFromAddress("14 Attunga Road, Miranda NSW 2228")).toBe("NSW");
    expect(jurisdictionFromAddress("Coorparoo QLD 4151")).toBe("QLD");
    expect(jurisdictionFromAddress("Brunswick VIC 3056")).toBeNull();
    expect(jurisdictionFromAddress(null)).toBeNull();
  });
});

describe("vague words", () => {
  it("catches controls that leave the decision to the worker", () => {
    expect(vagueWords("Wear appropriate PPE")).toEqual(["appropriate"]);
    expect(vagueWords("Isolate as required and be careful")).toEqual(["as required", "be careful"]);
  });

  it("doesn't catch a word that only contains one", () => {
    expect(vagueWords("An inappropriate anchor was replaced")).toEqual([]);
  });

  it("finds none in anything the library can write, across every combination of answers", () => {
    const falls = ["edge", "scaffold", "ewp", "harness"] as const;
    let written = 0;
    for (const jurisdiction of ["NSW", "QLD"] as const)
      for (const fall of falls)
        for (const lift of ["hoist", "crane"] as const)
          for (const dust of ["wet", "extract"] as const)
            for (const silica of ["high", "low"] as const)
              for (const refrigerant of ["R32", "R410A", "R290"])
                for (const flag of [false, true]) {
                  const a = answers({
                    jurisdiction, fall, lift, dust, silica, refrigerant,
                    anchor: "Ridge anchor", qldFallReason: "the edge is on the boundary", silicaWhy: "one small hole",
                    site: { pre1990: flag, powerlines: flag, traffic: flag, builder: flag },
                    riskAppendix: flag,
                  });
                  const doc = buildSwms(a, ctx);
                  const all = [...doc.steps.flatMap((s) => [s.hazards, ...s.controls.map((c) => c.text)]), ...doc.plant, ...doc.ppe];
                  for (const line of all) expect(vagueWords(line)).toEqual([]);
                  written += 1;
                }
    expect(written).toBe(2 * 4 * 2 * 2 * 2 * 3 * 2);
  });
});

describe("before version 1 can be issued", () => {
  it("nothing stands in the way of a complete set of answers", () => {
    expect(issueProblems(answers(), facts)).toEqual([]);
  });

  it("names each missing piece", () => {
    expect(issueProblems(answers({ fall: "harness" }), facts)).toContain("Name the roof anchor the harness clips to.");
    expect(issueProblems(answers({ jurisdiction: "QLD", fall: "harness", anchor: "Ridge anchor" }), facts)[0]).toMatch(/Queensland requires it/);
    expect(issueProblems(answers({ silica: "low" }), facts)).toContain("Say why the drilling isn't high-risk silica work.");
    expect(issueProblems(answers({ isolation: "" }), facts)).toContain("Name the isolation point.");
    expect(issueProblems(answers({ hospital: "" }), facts)).toContain("Name the nearest hospital.");
    expect(issueProblems(answers(), { ...facts, people: 0 })).toContain("Choose who this SWMS covers.");
    expect(issueProblems(answers(), { ...facts, responsibleChosen: false })).toContain("Choose who's in charge on site.");
    expect(issueProblems(answers(), { ...facts, electricianChosen: false })).toContain("Choose the electrician doing the connection.");
    expect(issueProblems(answers(), { ...facts, siteChecked: false })).toContain("Confirm you've walked the site and this SWMS matches it.");
  });

  it("won't take power left on in a Queensland roof space", () => {
    expect(issueProblems(answers({ jurisdiction: "QLD", roofPower: "rcd" }), facts)).toContain(
      "In Queensland the mains must be off before anyone enters a house roof space."
    );
  });

  it("sends a service with no high-risk work to something shorter", () => {
    const none = Object.fromEntries(STEP_KEYS.map((k) => [k, false])) as SwmsAnswers["steps"];
    const got = issueProblems(answers({ kind: "service", steps: { ...none, braze: true } }), { ...facts, electricianChosen: true });
    expect(got).toContain("A service or repair with no high-risk work doesn't need a SWMS.");
  });

  it("rejects a vague word typed on site, and says where", () => {
    expect(issueProblems(answers({ siteNotes: "Use appropriate care on the tiles" }), facts)).toContain(
      'Replace "appropriate" in the site notes with the exact item, number or person.'
    );
  });
});

describe("where a new SWMS starts", () => {
  it("an install starts with the steps every install has, and nothing that depends on the site", () => {
    const a = startingAnswers("install", "QLD");
    expect(STEP_KEYS.filter((k) => a.steps[k])).toEqual(["braze", "test", "power", "charge"]);
    expect(a.jurisdiction).toBe("QLD");
    /* nothing is claimed about the roof, lifting, drilling or the roof space */
    expect(nums(a).filter((n) => n === 1 || n === 16)).toEqual([]);
  });

  it("a service starts with nothing ticked", () => {
    const a = startingAnswers("service", "NSW");
    expect(STEP_KEYS.filter((k) => a.steps[k])).toEqual([]);
    expect(a.kind).toBe("service");
  });

  it("reads install or service off the job's category, and says nothing when it can't tell", () => {
    expect(kindFromCategory("Install")).toBe("install");
    expect(kindFromCategory("Supply and Install")).toBe("install");
    expect(kindFromCategory("Service")).toBe("service");
    expect(kindFromCategory("Breakdown Repair")).toBe("service");
    expect(kindFromCategory("Quote")).toBeNull();
    expect(kindFromCategory(null)).toBeNull();
  });
});

describe("a service or repair", () => {
  it("is only offered the steps whose controls hold for it", () => {
    expect(stepsFor("install")).toEqual(STEP_KEYS);
    expect(SERVICE_STEPS).toEqual(["roof", "ceiling", "braze", "test", "charge"]);
  });

  it("never writes an install-only step, even if one is ticked", () => {
    const a = answers({ kind: "service" });
    const keys = buildSwms(a, ctx).steps.map((st) => st.key);
    expect(keys).not.toContain("lift");
    expect(keys).not.toContain("drill");
    expect(keys).not.toContain("power");
    expect(keys).toContain("roof");
    /* and the categories follow what is written, not what was ticked */
    expect(categoriesOf(answers({ kind: "service", steps: { ...DEFAULT_ANSWERS.steps, roof: false, ceiling: false, charge: false } })).map((c) => c.n)).toEqual([]);
  });
});

describe("a problem knows which answer it is about", () => {
  it("names the field for every problem, in the order the wizard asks", () => {
    const got = issueProblemList(
      answers({ fall: "harness", isolation: "", hospital: "", siteNotes: "as required" }),
      { people: 0, responsibleChosen: false, electricianChosen: false, siteChecked: false }
    ).map((p) => p.field);
    expect(got).toEqual(["anchor", "isolation", "electrician", "hospital", "people", "responsible", "siteNotes", "siteChecked"]);
  });

  it("says the same words as issueProblems", () => {
    const a = answers({ silica: "low", hospital: "" });
    expect(issueProblemList(a, facts).map((p) => p.text)).toEqual(issueProblems(a, facts));
  });
});
