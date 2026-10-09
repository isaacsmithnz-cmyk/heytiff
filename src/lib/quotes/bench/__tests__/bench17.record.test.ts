/**
 * @jest-environment node
 */
/* THE SEVENTEEN, LIVE (Isaac, 2026-10-08: "use these to test out the
   engine… Use Opus 5.5, go ahead and run all 17") — this one spends money.
   Each job's first brief as he gave it in the chat, read as the app reads
   it, then the corrections he gave as a second turn; against Diamond Air's
   real book, data packs, settings and kit preferences, the quote held in
   memory. Runs only with BENCH17_DIR (the cases and where to write),
   QUOTE_SESSION_MODEL and an API key; CI never sets them. */
jest.mock("server-only", () => ({}));
import fs from "node:fs";
import path from "node:path";
import { memoryStore } from "../session-bench";
import { openingMessage, sessionSystemPrompt } from "../../session/prompt";
import { SESSION_TOOLS } from "../../session/tools";
import { makeTools } from "../../session/tools-run";
import { runTurn, type EventDraft } from "../../session/turn";
import { recording, type Recording } from "../../session/model";
import { priceLines } from "../../lines-price";
import type { QuoteLine } from "../../lines";

const DIR = process.env.BENCH17_DIR ?? "";
const ON = !!DIR && !!process.env.QUOTE_SESSION_MODEL && !!process.env.ANTHROPIC_API_KEY;
const ORG = "91e33ca2-4847-408d-8ec5-c7cc0fa7a576";
const CAP_USD = Number(process.env.BENCH17_CAP ?? 60);
const ONLY = (process.env.BENCH17_ONLY ?? "").split(",").filter(Boolean);
/* which cases, and which run they're written as */
const CASES = process.env.BENCH17_CASES ?? "cases.json";
const RUN = path.join(DIR, process.env.BENCH17_RUN ?? "");
/* as a business that has just started: its suppliers' lists and nothing it
   has learned (no preferred items, no ranges, no quotes, no task hours) */
const FRESH = process.env.BENCH17_FRESH === "1";

type Case = { job: string; title: string; brief: string; followUp: string | null };

(ON ? describe : describe.skip)("the seventeen, live (spends money)", () => {
  jest.setTimeout(170 * 60_000);
  it("runs each case's brief, then its corrections, and keeps everything", async () => {
    const [{ anthropicModel }, { bookProducts }, { lookupUnit }, { readQuoteSettings }, { readOrgDay }, { readRangeOffers }, { buildSettingsOf }, { hourCostOf }] = await Promise.all([
      import("../../session/model-server"),
      import("../../book-view-server"),
      import("../../lookups-server"),
      import("../../settings-query"),
      import("../../org-day-server"),
      import("../../kits-server"),
      import("../../build-settings"),
      import("../../profit"),
    ]);
    const modelName = process.env.QUOTE_SESSION_MODEL!;
    const [book, settings, day, ranges] = await Promise.all([bookProducts(ORG), readQuoteSettings(ORG), readOrgDay(ORG), readRangeOffers(ORG)]);
    const products = FRESH ? book.map((p) => ({ ...p, preferred: null, quotes: 0 })) : book;
    const built = buildSettingsOf(settings, day);
    if (!built.ok) throw new Error(`settings unset: ${built.unset.join(", ")}`);
    const hourCostCents = hourCostOf(built.settings.chargeOutCents, settings.profitTargetPct, settings.labourCostCents);
    console.log(`book ${products.length} products; hour cost ${hourCostCents}; settings ${JSON.stringify(built.settings)}`);
    const totals = (ls: QuoteLine[]) =>
      priceLines(ls, [], built.settings, { pct: settings.profitTargetPct, labourCostCents: settings.labourCostCents }).map((o) => ({
        exGstCents: o.build.exGstCents,
        profit: o.profit,
        unpriced: o.unpriced.length,
      }));

    const cases = (JSON.parse(fs.readFileSync(path.join(DIR, CASES), "utf8")) as Case[]).filter((c) => ONLY.length === 0 || ONLY.includes(c.job));
    fs.mkdirSync(path.join(RUN, "rec"), { recursive: true });
    fs.mkdirSync(path.join(RUN, "out"), { recursive: true });
    let spent = 0;

    const one = async (c: Case) => {
      if (spent > CAP_USD) return console.log(`${c.job}: skipped, over the $${CAP_USD} cap`);
      const replies: Recording = {};
      const model = recording(anthropicModel(), replies);
      const store = memoryStore({
        products,
        settings: built.settings,
        hourCostCents,
        allowances: { consumables: settings.allowances.consumables, flush: settings.allowances.flush, recovery: settings.allowances.recovery },
        taskHours: FRESH ? undefined : settings.taskHours,
        lookup: lookupUnit,
        kitPrefs: FRESH ? null : { ranges, components: settings.preferred },
      });
      const events: EventDraft[] = [];
      const deps = {
        model,
        modelName,
        system: sessionSystemPrompt(),
        tools: SESSION_TOOLS,
        runTool: makeTools(store),
        save: async (_s: unknown, ev: EventDraft[]) => {
          events.push(...ev);
          return true;
        },
      };
      /* read the job, as the app does, or the person's own words */
      const read = c.brief.startsWith("From the job in ServiceM8");
      const first = read ? openingMessage(c.brief.replace(/^From the job in ServiceM8 \(read the job\):\n/, ""), "") : c.brief;
      const t1 = await runTurn({ messages: [], summary: "" }, first, deps);
      const turn1 = { ended: t1.ended, spentUsd: t1.spentUsd, events: [...events], lines: store.lines(), totals: totals(store.lines()) };
      events.length = 0;
      let turn2 = null;
      if (c.followUp) {
        const t2 = await runTurn(t1.state, c.followUp, deps);
        turn2 = { ended: t2.ended, spentUsd: t2.spentUsd, events: [...events], lines: store.lines(), totals: totals(store.lines()) };
      }
      const usd = t1.spentUsd + (turn2?.spentUsd ?? 0);
      spent += usd;
      fs.writeFileSync(path.join(RUN, "rec", `${c.job}.json`), JSON.stringify({ modelName, replies }));
      fs.writeFileSync(path.join(RUN, "out", `${c.job}.json`), JSON.stringify({ job: c.job, usd, turn1, turn2 }, null, 1));
      console.log(`${c.job}: turn 1 ${t1.ended} $${t1.spentUsd.toFixed(2)} → ${turn1.totals.map((t) => (t.exGstCents / 100).toFixed(2)).join(" / ")}${turn2 ? `; turn 2 ${turn2.ended} $${turn2.spentUsd.toFixed(2)} → ${turn2.totals.map((t) => (t.exGstCents / 100).toFixed(2)).join(" / ")}` : ""}. Spent so far $${spent.toFixed(2)}`);
    };

    /* four at a time */
    const queue = [...cases];
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (let c = queue.shift(); c; c = queue.shift()) {
          await one(c).catch((e) => console.log(`${c!.job}: failed, ${String(e).slice(0, 300)}`));
        }
      })
    );
    console.log(`Spent $${spent.toFixed(2)}`);
  });
});
