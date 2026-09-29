/* The proposal draft's gate and the words drawn around its fields.

   The laws worth their tests: nothing a model hands back reaches the table
   without passing normaliseDraft (the numbering it adds is taken off, a
   note key it invents is dropped, a draft with no option is no draft), and
   the text each Copy puts on the clipboard is the Proposals' own shape. */

import {
  EXTRA_NOTES,
  MAX_OPTIONS,
  draftText,
  normaliseDraft,
  notesText,
  optionHeading,
  optionText,
  pricingLines,
  proposalTitle,
  type ProposalDraft,
} from "../proposal";

const sample = (over: Partial<ProposalDraft> = {}): ProposalDraft => ({
  intro: "Hi Neil,\nBased on the site visit, here are the options.",
  options: [
    {
      name: "Mitsubishi Electric 7 kW",
      lines: ["Installation of a 7 kW Mitsubishi Electric split system. (MSZ-AP71VGD)", "Drain will be run to a suitable point."],
      pros: [],
      cons: [],
    },
    { name: "Alternate outdoor unit location", lines: ["As above, but the outdoor unit on the left side of the house."], pros: [], cons: [] },
  ],
  pricingMode: "multiple_choice",
  notes: [],
  questions: [],
  ...over,
});

describe("normaliseDraft", () => {
  it("takes the writer's snake_case pricing mode and keeps what is real", () => {
    const d = normaliseDraft({
      intro: "  Hi Tim,  ",
      options: [{ name: "Repair", lines: ["- Replacement of compressor.", "  ", "• Replacement of R22 refrigerant"], pros: ["Cheaper"], cons: [] }],
      pricing_mode: "optional",
      notes: ["roof_access"],
      questions: ["Which model is it?"],
    });
    expect(d).toEqual({
      intro: "Hi Tim,",
      options: [
        { name: "Repair", lines: ["Replacement of compressor.", "Replacement of R22 refrigerant"], pros: ["Cheaper"], cons: [] },
      ],
      pricingMode: "optional",
      notes: ["roof_access"],
      questions: ["Which model is it?"],
    });
  });

  it("strips the number a writer put on an option name, so it isn't numbered twice", () => {
    const d = normaliseDraft({ intro: "", options: [{ name: "Option 2: Replace (Daikin).", lines: ["x"] }] });
    expect(d?.options[0].name).toBe("Replace (Daikin)");
  });

  it("drops note keys that aren't in the library, and repeats", () => {
    const d = normaliseDraft({ intro: "", options: [{ name: "A", lines: ["x"] }], notes: ["strata", "invented", "strata"] });
    expect(d?.notes).toEqual(["strata"]);
  });

  it("is no draft without an option, and caps the options", () => {
    expect(normaliseDraft({ intro: "Hi", options: [] })).toBeNull();
    expect(normaliseDraft({ intro: "Hi", options: [{ name: "", lines: [] }] })).toBeNull();
    expect(normaliseDraft("not a draft")).toBeNull();
    const many = normaliseDraft({ intro: "", options: Array.from({ length: 9 }, (_, i) => ({ name: `O${i}`, lines: ["x"] })) });
    expect(many?.options).toHaveLength(MAX_OPTIONS);
  });

  it("defaults the pricing to the client picking one", () => {
    expect(normaliseDraft({ intro: "", options: [{ name: "A", lines: ["x"] }], pricingMode: "whatever" })?.pricingMode).toBe(
      "multiple_choice"
    );
  });
});

describe("the words around the fields", () => {
  it("builds one title pattern from the address, without state and postcode", () => {
    expect(proposalTitle("37 Taleeban Rd\nRiverview NSW 2066")).toBe("Air Conditioning Scope – 37 Taleeban Rd, Riverview");
    expect(proposalTitle("54 Shellcove Road, Kurraba Point NSW 2089")).toBe(
      "Air Conditioning Scope – 54 Shellcove Road, Kurraba Point"
    );
    expect(proposalTitle(null)).toBe("Air Conditioning Scope");
  });

  it("numbers options the client picks from, and names areas they tick", () => {
    expect(optionHeading(sample(), 1)).toBe("Option 2: Alternate outdoor unit location");
    const areas = sample({ pricingMode: "optional", options: [{ name: "Downstairs", lines: ["x"], pros: [], cons: [] }] });
    expect(optionHeading(areas, 0)).toBe("Downstairs");
    expect(pricingLines(sample())).toEqual(["Option 1: Mitsubishi Electric 7 kW", "Option 2: Alternate outdoor unit location"]);
  });

  it("sets an option the way the Proposals do: dash bullets, then Pros and Cons", () => {
    expect(optionText({ name: "Repair", lines: ["Replacement of compressor."], pros: ["Cheaper"], cons: ["System is old."] })).toBe(
      "- Replacement of compressor.\n\nPros:\n- Cheaper\n\nCons:\n- System is old."
    );
    expect(optionText({ name: "Repair", lines: ["One."], pros: [], cons: [] })).toBe("- One.");
  });

  it("draws extra notes from the library's own words", () => {
    expect(notesText(["strata"])).toBe(`Strata approval:\n${EXTRA_NOTES.strata.lines.map((l) => `- ${l}`).join("\n")}`);
  });

  it("puts every block in the Proposal's order for Copy all", () => {
    const text = draftText(sample({ notes: ["roof_access"] }), "Air Conditioning Scope – 37 Taleeban Rd, Riverview");
    const order = ["Air Conditioning Scope", "Intro:", "Option 1:", "Option 2:", "Pricing:", "Notes:", "Roof access:"].map((w) =>
      text.indexOf(w)
    );
    expect(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]))).toBe(true);
  });
});
