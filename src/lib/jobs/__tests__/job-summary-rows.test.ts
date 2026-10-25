import { summaryFromQuote, summaryFromText } from "../job-summary-rows";

/* THE OVERVIEW'S SUMMARY (Isaac, 25 October 2026, "Yes, build the refined
   Overview A"): the quote's systems where it can say what the job is, else
   the description's own headings and lines, and nothing written for it. */

type L = Parameters<typeof summaryFromQuote>[0][number];
const line = (over: Partial<L>): L => ({ optionIndex: 0, system: "", name: "x", code: null, kind: "material", qty: 1, unit: "", ...over });

describe("from the quote", () => {
  it("groups the lines by the quote's systems, in its order, the code beside each and the labour left on the quote", () => {
    const groups = summaryFromQuote(
      [
        line({ system: "Upstairs", name: "Mitsubishi ducted indoor", code: "PEAD-M71JAAD", kind: "unit" }),
        line({ system: "Upstairs", name: "Round supply grille 250", qty: 3 }),
        line({ system: "Downstairs", name: "Mitsubishi high wall indoor", code: "MSZ-AP25VGKD2-A2", kind: "unit" }),
        line({ system: "Downstairs", name: "Pair coil 1/4 3/8", qty: 6, unit: "m" }),
        line({ system: "", name: "Install, two techs", kind: "labour", qty: 16, unit: "h" }),
        line({ system: "", name: "Scissor lift hire" }),
      ],
      [],
    );
    expect(groups).toEqual([
      {
        key: "q:upstairs",
        title: "Upstairs",
        rows: [
          { key: "q:0", thing: "Mitsubishi ducted indoor", detail: "PEAD-M71JAAD" },
          { key: "q:1", thing: "3 × Round supply grille 250", detail: "" },
        ],
      },
      {
        key: "q:downstairs",
        title: "Downstairs",
        rows: [
          { key: "q:2", thing: "Mitsubishi high wall indoor", detail: "MSZ-AP25VGKD2-A2" },
          { key: "q:3", thing: "Pair coil 1/4 3/8, 6 m", detail: "" },
        ],
      },
      { key: "q:", title: null, rows: [{ key: "q:4", thing: "Scissor lift hire", detail: "" }] },
    ]);
  });

  it("reads the option the client took", () => {
    const groups = summaryFromQuote(
      [line({ optionIndex: 0, system: "A", name: "Seven kW" }), line({ optionIndex: 1, system: "B", name: "Ten kW" })],
      [1],
    );
    expect(groups?.map((g) => g.title)).toEqual(["B"]);
  });

  it("says nothing for several options none of which is taken, or a quote with only labour", () => {
    expect(summaryFromQuote([line({ optionIndex: 0 }), line({ optionIndex: 1 })], [])).toBeNull();
    expect(summaryFromQuote([line({ kind: "labour" })], [])).toBeNull();
    expect(summaryFromQuote([], [])).toBeNull();
  });
});

describe("from the description", () => {
  it("keeps the description's own headings, each over its lines", () => {
    expect(summaryFromText("Next visit:\n3x round 250 grill\n- 1x 400x400 return air\n\nOn site:\nScissor lift")).toEqual([
      { key: "d:0", title: "Next visit", rows: [
        { key: "d:1", thing: "3x round 250 grill", detail: "" },
        { key: "d:2", thing: "1x 400x400 return air", detail: "" },
      ] },
      { key: "d:3", title: "On site", rows: [{ key: "d:4", thing: "Scissor lift", detail: "" }] },
    ]);
  });

  it("is plain rows under no heading where the description has none", () => {
    expect(summaryFromText("mitsubishi 7kw ducted for upstairs\nwill require 2 x site visits")).toEqual([
      { key: "d:0", title: null, rows: [
        { key: "d:0", thing: "mitsubishi 7kw ducted for upstairs", detail: "" },
        { key: "d:1", thing: "will require 2 x site visits", detail: "" },
      ] },
    ]);
  });

  it("is nothing for no words, and drops a heading with nothing under it", () => {
    expect(summaryFromText("")).toEqual([]);
    expect(summaryFromText(null)).toEqual([]);
    expect(summaryFromText("Notes:")).toEqual([]);
  });
});
