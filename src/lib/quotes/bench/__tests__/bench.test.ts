/* The bench, run (slices 0.1–0.3). BENCH_REPORT=1 prints the table.

   The hand engine hands back each case's own lines, so it must find every
   part and land on the quoted total: that holds the cases and the pricing
   to each other. An engine that drops a part or prices off the book shows
   up here first. Ratchets: tighten, never loosen. */
import { BRIEF_CASES } from "../cases";
import { benchReport, partKey, priceCaseLines, runBench, scoreOption, type CaseLine, type Engine } from "../score";

const hand: Engine = (c) => c.options.map((o) => o.lines);
const rows = runBench(BRIEF_CASES, hand);
if (process.env.BENCH_REPORT) console.log(benchReport(rows));

describe("the brief cases", () => {
  it("are 3377, 3384's three options and 3375, the accepted one", () => {
    expect(rows.map((r) => `${r.job} ${r.option}`)).toEqual([
      "3377 Two ducted systems",
      "3384 Ducted upstairs, Cora 7.1 kW downstairs",
      "3384 With a zone for each bedroom",
      "3384 With a 9.5 kW unit downstairs",
      "3375 Install the client's split",
    ]);
  });

  it("price to what was quoted, from their own lines, within a few cents of rounding", () => {
    for (const r of rows) {
      expect(r.score!.found).toBe(r.score!.of);
      expect(Math.abs(r.score!.exGstCents - r.score!.quotedExGstCents!)).toBeLessThanOrEqual(5);
    }
  });

  it("3375, accepted by the client, to the cent", () => {
    const r = rows.find((x) => x.job === "3375")!;
    expect(r.score!.exGstCents).toBe(497689);
  });
});

describe("the score", () => {
  const want = BRIEF_CASES.find((c) => c.job === "3375")!;
  const lines = want.options[0]!.lines;

  it("names the parts an engine missed, the ones it added, and where its quantities differ", () => {
    const got: CaseLine[] = [
      ...lines.filter((l) => l.name !== "Rubber feet").map((l) => (l.name === "TPS 2.5 mm²" ? { ...l, qty: 20 } : l)),
      { system: "Split system", group: "Pipe, power and controls", name: "Wall bracket", code: "CWB180", kind: "material", qty: 1, costCents: 3079 },
    ];
    const s = scoreOption(want.options[0]!, got, want.settings);
    expect(s.missing).toEqual(["Rubber feet"]);
    expect(s.extra).toEqual(["Wall bracket"]);
    expect(s.qtyOff).toEqual([{ key: "name:tps 2 5 mm", name: "TPS 2.5 mm²", want: 25, got: 20 }]);
    expect(s.found).toBe(s.of - 1);
    expect(s.gapPct).not.toBe(0);
  });

  it("knows a part by its code, else by its name", () => {
    expect(partKey({ code: "pc1412", name: "anything" })).toBe("code:PC1412");
    expect(partKey({ name: "TPS 2.5 mm²" })).toBe("name:tps 2 5 mm");
  });

  it("leaves a part nobody has priced out of the total", () => {
    const c77 = BRIEF_CASES[0]!;
    const unknown = c77.options[0]!.lines.filter((l) => l.source === "unknown");
    expect(unknown.map((l) => l.name)).toEqual(["Core hole 200 mm through sandstone, to the rear living", "Core holes to the rear kitchen"]);
    expect(priceCaseLines(unknown, c77.settings).exGstCents).toBe(0);
  });

  it("an engine that can't run a case says so, rather than scoring nothing as zero", () => {
    expect(runBench(BRIEF_CASES, () => null).every((r) => r.score === null)).toBe(true);
  });
});
