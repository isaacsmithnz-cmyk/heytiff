/**
 * @jest-environment node
 */
/* TALKING TIFF THROUGH A JOB (Isaac, 2026-10-09: "she should be asking
   questions that you are answering… when labour's an issue… you can talk
   back to it and say, I'm not sure if that's right. We need to do X, Y, and
   Z to get to this many hours of labour. Like I have been doing to you in
   the chat"). One turn a run: the first takes the case's brief, each after
   it the message written for her in talk/<job>-<n>.txt; the conversation
   and the quote are kept in talk/<job>.json between runs, so a person (or
   Claude, answering as the business did) reads her quote and her questions
   and replies. Spends money; off without BENCH17_DIR, BENCH_TALK_JOB and a
   key. */
jest.mock("server-only", () => ({}));
import fs from "node:fs";
import path from "node:path";
import { memoryStore } from "../session-bench";
import { openingMessage, sessionSystemPrompt } from "../../session/prompt";
import { SESSION_TOOLS } from "../../session/tools";
import { makeTools } from "../../session/tools-run";
import { runTurn, type EventDraft, type SessionState } from "../../session/turn";
import { priceLines } from "../../lines-price";
import type { QuoteLine } from "../../lines";

const DIR = process.env.BENCH17_DIR ?? "";
const JOB = process.env.BENCH_TALK_JOB ?? "";
const ON = !!DIR && !!JOB && !!process.env.QUOTE_SESSION_MODEL && !!process.env.ANTHROPIC_API_KEY;
const ORG = "91e33ca2-4847-408d-8ec5-c7cc0fa7a576";
/* the bench scores the price, not the proposal's words: asked for neither them nor a parts plan, to spend less */
const PRICE_ONLY = "Quote this job. Price it only: no proposal words and no parts plan.";
const FRESH = process.env.BENCH17_FRESH === "1";
/* how hard she thinks: the app's medium, or high to test it */
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const EFFORT = EFFORTS.find((e) => e === process.env.BENCH_EFFORT) ?? "medium";

type Case = { job: string; brief: string };
type Talk = { state: SessionState; lines: QuoteLine[]; turns: { said: string; usd: number; ended: string; totals: number[] }[] };

(ON ? describe : describe.skip)("talking Tiff through a job (spends money)", () => {
  jest.setTimeout(30 * 60_000);
  it("takes one turn of the conversation", async () => {
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
    const [book, settings, day, ranges] = await Promise.all([bookProducts(ORG), readQuoteSettings(ORG), readOrgDay(ORG), readRangeOffers(ORG)]);
    const built = buildSettingsOf(settings, day);
    if (!built.ok) throw new Error("settings unset");
    const products = FRESH ? book.map((p) => ({ ...p, preferred: null, quotes: 0 })) : book;
    /* one folder a run of the conversation: the same replies, another model or effort */
    const dir = path.join(DIR, process.env.BENCH_TALK_DIR ?? "talk");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${JOB}.json`);
    const talk: Talk | null = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    const c = (JSON.parse(fs.readFileSync(path.join(DIR, process.env.BENCH17_CASES ?? "cases-all.json"), "utf8")) as Case[]).find((x) => x.job === JOB);
    if (!c) throw new Error(`no case ${JOB}`);

    const store = memoryStore({
      products,
      settings: built.settings,
      hourCostCents: hourCostOf(built.settings.chargeOutCents, settings.profitTargetPct, settings.labourCostCents),
      allowances: { consumables: settings.allowances.consumables, flush: settings.allowances.flush, recovery: settings.allowances.recovery },
      taskHours: FRESH ? undefined : settings.taskHours,
      lookup: lookupUnit,
      kitPrefs: FRESH ? null : { ranges, components: settings.preferred },
      seed: talk?.lines ?? [],
    });
    const n = talk ? talk.turns.length : 0;
    let message: string;
    if (!talk) {
      const read = c.brief.startsWith("From the job in ServiceM8");
      message = read ? openingMessage(c.brief.replace(/^From the job in ServiceM8 \(read the job\):\n/, ""), PRICE_ONLY) : `${c.brief}\n\n${PRICE_ONLY}`;
    } else message = fs.readFileSync(path.join(dir, `${JOB}-${n}.txt`), "utf8").trim();

    const events: EventDraft[] = [];
    const end = await runTurn(talk?.state ?? { messages: [], summary: "" }, message, {
      model: anthropicModel(),
      modelName: process.env.QUOTE_SESSION_MODEL!,
      system: sessionSystemPrompt(),
      tools: SESSION_TOOLS,
      effort: EFFORT,
      runTool: makeTools(store),
      save: async (_s, ev) => {
        events.push(...ev);
        return true;
      },
    });
    /* a turn that failed keeps nothing: the next run tries it again */
    if (end.ended === "error") throw new Error(`turn ${n} failed; nothing kept`);
    const lines = store.lines();
    const totals = priceLines(lines, [], built.settings, { pct: settings.profitTargetPct, labourCostCents: settings.labourCostCents }).map((o) => o.build.exGstCents);
    fs.writeFileSync(file, JSON.stringify({ state: end.state, lines, turns: [...(talk?.turns ?? []), { said: message, usd: end.spentUsd, ended: end.ended, totals }] }));
    /* what a person reads back: her words, her questions, her labour, the totals */
    const said = events.filter((e) => e.kind === "reply").map((e) => String((e.body as { text?: string }).text ?? "")).join("\n\n");
    const asked = events.filter((e) => e.kind === "question").map((e) => (e.body as { question?: string; answers?: { label: string }[] }));
    const labour = lines.filter((l) => l.kind === "labour").map((l) => `option ${l.optionIndex + 1}: ${l.name}, ${l.qty} h — ${l.why}`);
    const unknown = lines.filter((l) => l.source === "unknown" && l.costCents <= 0 && l.sellCents == null).map((l) => `option ${l.optionIndex + 1}: ${l.name}`);
    fs.writeFileSync(
      path.join(dir, `${JOB}-${n}.out.txt`),
      [`TURN ${n} (${end.ended}, $${end.spentUsd.toFixed(2)})`, `TOTALS ex GST: ${totals.map((t) => `$${(t / 100).toFixed(2)}`).join(" / ")}`, "", "SHE SAID:", said, "", "SHE ASKED:", ...asked.map((q) => `- ${q.question} [${(q.answers ?? []).map((a) => a.label).join(" | ")}]`), "", "LABOUR:", ...labour, "", "STILL TO PRICE:", ...unknown].join("\n")
    );
  });
});
