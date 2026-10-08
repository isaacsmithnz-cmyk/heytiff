/**
 * @jest-environment node
 */
/* RECORDING TIFF'S BENCH RUN — this one spends money. It runs only when
   TIFF_BENCH_RECORD=1 and QUOTE_SESSION_MODEL are set, locally, with the
   API key, after Isaac's OK on the model and the cost (slice 4.3: about
   $20 to $40 for the brief cases). It writes bench/recordings/<job>.json,
   which session-bench.test.ts then replays free on every change. CI has no
   key and never sets the flag, so there it's skipped. */
jest.mock("server-only", () => ({}));
import fs from "node:fs";
import path from "node:path";
import { BRIEF_CASES } from "../cases";
import { benchReport, scoreOption } from "../score";
import { benchSession, caseBook } from "../session-bench";
import { recording, type Recording } from "../../session/model";

const ON = process.env.TIFF_BENCH_RECORD === "1" && !!process.env.QUOTE_SESSION_MODEL && !!process.env.ANTHROPIC_API_KEY;
const ONLY = (process.env.TIFF_BENCH_ONLY ?? "").split(",").filter(Boolean);

(ON ? describe : describe.skip)("recording Tiff's bench run (spends money)", () => {
  jest.setTimeout(30 * 60_000);
  it("runs each brief case once with the real model and keeps every reply", async () => {
    const { anthropicModel } = await import("../../session/model-server");
    const modelName = process.env.QUOTE_SESSION_MODEL!;
    const book = caseBook(BRIEF_CASES);
    const hourCostCents = 11200;
    let total = 0;
    for (const c of BRIEF_CASES.filter((x) => ONLY.length === 0 || ONLY.includes(x.job))) {
      const replies: Recording = {};
      const run = await benchSession(c, { model: recording(anthropicModel(), replies), modelName, products: book, hourCostCents });
      total += run.spentUsd;
      fs.writeFileSync(path.join(__dirname, "..", "recordings", `${c.job}.json`), JSON.stringify({ modelName, hourCostCents, replies }, null, 1));
      console.log(`${c.job}: ${run.ended}, $${run.spentUsd.toFixed(2)}`);
      console.log(benchReport(c.options.map((o, i) => ({ job: c.job, option: o.name, score: run.lines[i] ? scoreOption(o, run.lines[i]!, c.settings) : null }))));
    }
    console.log(`Spent $${total.toFixed(2)}`);
  });
});
