/* Tiff on the bench (slice 4.3): a case's brief through the app's own
   session and tools, against a quote in memory, scored against the lines a
   person built. Recorded runs (bench/recordings/<job>.json, made once with
   the real model and his OK) replay here free; BENCH_REPORT=1 prints them. */
import fs from "node:fs";
import path from "node:path";
import { BRIEF_CASES } from "../cases";
import { benchReport, scoreOption, type BenchRow } from "../score";
import { benchSession, caseBook, memoryStore } from "../session-bench";
import { replaying, scripted, type Recording } from "../../session/model";

const book = caseBook(BRIEF_CASES);
const c75 = BRIEF_CASES.find((c) => c.job === "3375")!;
const use = (id: string, name: string, input: Record<string, unknown>) => ({ type: "tool_use" as const, id, name, input });

describe("the bench's own quote", () => {
  it("holds lines by the app's rules: a change against an old version is refused", async () => {
    const s = memoryStore({ products: book, settings: c75.settings, hourCostCents: 11200 });
    const a = await s.addLine({ optionIndex: 0, group: "Pipe", name: "Rubber feet", qty: 1, costCents: 1372, source: "assumed", why: "w" }, "w");
    expect(a.ok && a.line?.id).toBe("m1");
    expect((await s.changeLine("m1", 1, { qty: 2, source: "assumed" }, "w")).ok).toBe(true);
    expect(await s.changeLine("m1", 1, { qty: 3 }, "w")).toMatchObject({ ok: false, stale: true });
    expect((await s.totals()).ok).toBe(true);
  });

  it("books every part a person built a case with, allowances aside", () => {
    expect(book.some((p) => p.name === "Rubber feet")).toBe(true);
    expect(book.some((p) => p.name === "TPS 2.5 mm²")).toBe(true);
    expect(book.some((p) => /contingency/i.test(p.name))).toBe(false);
  });
});

describe("a case through the session", () => {
  it("scores the quote she leaves against the one a person built, with no call to the API", async () => {
    const feet = book.find((p) => p.name === "Rubber feet")!.offers[0]!.code;
    const model = scripted([
      { content: [use("t1", "search_book", { text: "feet" })], stopReason: "tool_use" },
      {
        content: [
          use("t2", "add_lines", {
            lines: [
              { option: 0, system: "Split system", group: "Pipe, power and controls", name: "Rubber feet", code: feet, kind: "material", qty: 1, source: "assumed", why: "on the parapet" },
              { option: 0, group: "Labour", name: "Install: 4 people, a full day", kind: "labour", qty: 32, source: "said", why: "“Four people, a full day”" },
            ],
          }),
        ],
        stopReason: "tool_use",
      },
      { content: [{ type: "text", text: "Feet and the labour; the rest to come." }], stopReason: "end_turn" },
    ]);
    const run = await benchSession(c75, { model, modelName: "claude-opus-5-5", products: book, hourCostCents: 11200 });
    expect(run.ended).toBe("done");
    expect(model.calls[0]!.messages[0]!.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Client supplies MSZ-AP60VGD2") });
    const s = scoreOption(c75.options[0]!, run.lines[0]!, c75.settings);
    expect(s.found).toBe(2);
    expect(s.missing).toContain("Pair coil 1/4 + 1/2, 20 m roll");
  });
});

/* the recorded runs, replayed free */
const DIR = path.join(__dirname, "..", "recordings");
const recorded = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".json")) : [];

describe("Tiff's recorded runs", () => {
  it("are kept as one file a case", () => {
    for (const f of recorded) expect(BRIEF_CASES.some((c) => `${c.job}.json` === f)).toBe(true);
  });

  for (const f of recorded) {
    it(`replays ${f} against today's prompt and tools`, async () => {
      const { modelName, hourCostCents, replies } = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as { modelName: string; hourCostCents: number | null; replies: Recording };
      const c = BRIEF_CASES.find((x) => `${x.job}.json` === f)!;
      const run = await benchSession(c, { model: replaying(replies), modelName, products: book, hourCostCents });
      expect(run.ended).not.toBe("error");
      const rows: BenchRow[] = c.options.map((o, i) => ({ job: c.job, option: o.name, score: run.lines[i] ? scoreOption(o, run.lines[i]!, c.settings) : null }));
      if (process.env.BENCH_REPORT) console.log(benchReport(rows));
    });
  }
});
