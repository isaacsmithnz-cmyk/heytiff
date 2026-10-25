import { isModelCode, rowOf, summaryFromQuote, summaryFromText } from "../job-summary-rows";

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
  it("keeps a description's own Heading: lines over its lines, where it has no bullets", () => {
    expect(summaryFromText("Next visit:\n3x round 250 grill\n1x 400x400 return air\n\nOn site:\nScissor lift")).toEqual([
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

/* JOB 3385'S OWN DESCRIPTION, as ServiceM8 holds it (the walk of 25 October
   2026: live, every line was a plain row, "Pick List" and the headings
   among them, the codes stuck in the words) */
const PICK_LIST =
  'Pick List\nUpstairs Unit 7.1kw Slimline Ducted\n* Mitsubishi 7.1kW ducted indoor unit PEAD-m71jaad\t\n* Mitsubishi 7.1kW outdoor unit SUZ-m71vad2-a\n* Wall controller - 41maam\n* Plenum box (3 x 10" Henry)\n* 3 of Round supply grilles x 250mm\t\n* Return air grille / filter frame 400 x 400\n* R1 Insulated flex duct (size to grilles) 250mm x 3 bags\n* Spigots / collars, duct tape, cable ties, strapping\t1 lot\n* Copper 3/8" liquid + 5/8"\n* Control cable (comms)\t\n* Power cable and isolator (roof-side)\n* Condensate drain: 20mm PVC / flex, fittings, glue\n* Condensate pump (if there is no gravity fall)\n* Roof stand / frame for outdoor unit\n* Anti-vibration pad\n* Iso Brackets\n* Hangers and threaded rod for indoor unit\t1 set\n* Pipe/cable cover or UV-rated conduit for the roof run\t\n* Roof penetration sealing (sealant, flashing if required)\n* RCBO to suit\n\n\nDownstairs: Mitsubishi 2.5kW high wall\n* MSZ-AP25VGKD2-A2 indoor \n* MUZ-AP25VGD2-A2 outdoor\n* Copper 1/4" liquid + 3/8" gas, insulated\t\n* Comms/power cable\t\n* Wall bracket or outdoor mounting feet (warehouse) or roof stand\n* Drain line to kitchen sink: PVC, fittings, trap/connector\t\n* Pipe duct, trunking, end caps and clips\t\n* Isolator\t\n* RCBO to suit\n\nPlant and tools\n**Scissor lift / 12m EWP to be dropped direct to site\n* Vacuum pump, gauges, nitrogen regulator\n* Ladders and harness for the roof work\n';

describe("a pick list, as the office writes one", () => {
  const groups = summaryFromText(PICK_LIST);

  it("makes each line without a bullet a heading, and drops one with nothing under it", () => {
    expect(groups.map((g) => [g.title, g.rows.length])).toEqual([
      ["Upstairs Unit 7.1kw Slimline Ducted", 20],
      ["Downstairs: Mitsubishi 2.5kW high wall", 9],
      ["Plant and tools", 3],
    ]);
  });

  it("moves each model code to the right in capitals, and leaves the words", () => {
    expect(groups[0]!.rows.slice(0, 4).map(({ thing, detail }) => [thing, detail])).toEqual([
      ["Mitsubishi 7.1kW ducted indoor unit", "PEAD-M71JAAD"],
      ["Mitsubishi 7.1kW outdoor unit", "SUZ-M71VAD2-A"],
      ["Wall controller", "41MAAM"],
      ['Plenum box (3 x 10" Henry)', ""],
    ]);
    expect(groups[1]!.rows.slice(0, 3).map(({ thing, detail }) => [thing, detail])).toEqual([
      ["Indoor", "MSZ-AP25VGKD2-A2"],
      ["Outdoor", "MUZ-AP25VGD2-A2"],
      ['Copper 1/4" liquid + 3/8" gas, insulated', ""],
    ]);
  });

  it("strips the bullets, a double one too, and the tabs", () => {
    expect(groups[2]!.rows[0]!.thing).toBe("Scissor lift / 12m EWP to be dropped direct to site");
    expect(groups[0]!.rows.find((r) => r.thing.startsWith("Spigots"))!.thing).toBe("Spigots / collars, duct tape, cable ties, strapping 1 lot");
    expect(groups.flatMap((g) => g.rows).every((r) => !/[\t*]/.test(r.thing) && !r.detail.includes("\t"))).toBe(true);
  });

  it("never takes a size, a rating or a length for a code", () => {
    const rows = groups.flatMap((g) => g.rows);
    for (const start of ["3 of Round supply grilles x 250mm", "R1 Insulated flex duct", "Condensate drain: 20mm", 'Copper 3/8"', "Return air grille / filter frame 400 x 400", "Scissor lift / 12m EWP"]) {
      expect(rows.find((r) => r.thing.startsWith(start))?.detail).toBe("");
    }
  });
});

describe("a model code", () => {
  it("is five or more letters and digits, as makers write them", () => {
    for (const c of ["PEAD-m71jaad", "SUZ-m71vad2-a", "41maam", "MSZ-AP25VGKD2-A2", "RXV71WVMA"]) expect(isModelCode(c)).toBe(true);
  });
  it("is never a size, a range, a refrigerant or a word", () => {
    for (const c of ["250mm", "20mm", "12m", '3/8"', "7.1kW", "2.5kW", "10-20mm", "R410a", "R32", "2-way", "3-phase", "RCBO", "Henry)"]) expect(isModelCode(c)).toBe(false);
  });
  it("leaves the separator it stood behind", () => {
    expect(rowOf("Wall controller - 41maam")).toEqual({ thing: "Wall controller", detail: "41MAAM" });
    expect(rowOf("MSZ-AP25VGKD2-A2 indoor ")).toEqual({ thing: "Indoor", detail: "MSZ-AP25VGKD2-A2" });
  });
});
