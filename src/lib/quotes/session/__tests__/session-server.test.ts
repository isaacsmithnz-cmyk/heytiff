/**
 * @jest-environment node
 */
/* A person's message to Tiff (slice 4.1): off until her model is chosen, so
   nothing is spent; only on a quote built on its lines; one turn at a time;
   the turn let go however it ends. */
jest.mock("server-only", () => ({}));
const readEngine = jest.fn(async () => "lines");
jest.mock("../../lines-server", () => ({ readEngine: () => readEngine() }));
const beginTurn = jest.fn();
const addEvents = jest.fn(async () => undefined);
const saveRound = jest.fn(async () => true);
const endTurn = jest.fn(async () => undefined);
const takeAnswers = jest.fn(async () => [] as { question: string; answer: string }[]);
const readOpenQuestions = jest.fn(async () => [] as { id: number; question: string; put: string }[]);
jest.mock("../store-server", () => ({
  readOpenQuestions: (...a: unknown[]) => (readOpenQuestions as jest.Mock)(...a),
  beginTurn: (...a: unknown[]) => beginTurn(...a),
  addEvents: (...a: unknown[]) => (addEvents as jest.Mock)(...a),
  saveRound: (...a: unknown[]) => (saveRound as jest.Mock)(...a),
  endTurn: (...a: unknown[]) => (endTurn as jest.Mock)(...a),
  takeAnswers: (...a: unknown[]) => (takeAnswers as jest.Mock)(...a),
}));
jest.mock("../tools-server", () => ({ sessionTools: () => async () => ({ ok: true, value: null, label: "x" }) }));
jest.mock("../model-server", () => ({
  sessionModelFor: () => process.env.QUOTE_SESSION_MODEL ?? null,
  chosenEffort: () => "medium",
  writeUpFirst: () => false,
  anthropicModel: () => {
    throw new Error("the real model is never reached in a test");
  },
}));

import { scripted } from "../model";
import { SESSION_OFF, startTurn } from "../session-server";

const session = { id: "s1", messages: [], summary: "", spentUsd: 1.5, turnId: null, turnSince: null };

beforeEach(() => {
  delete process.env.QUOTE_SESSION_MODEL;
  readEngine.mockResolvedValue("lines");
  beginTurn.mockReset().mockResolvedValue({ ok: true, session, turnId: "t1" });
  saveRound.mockClear();
  endTurn.mockClear();
  addEvents.mockClear();
});

it("is off, and spends nothing, until a model is chosen", async () => {
  expect(await startTurn("org", "job", "u1", "Quote a split")).toEqual({ ok: false, reason: SESSION_OFF, status: 409 });
  expect(beginTurn).not.toHaveBeenCalled();
});

it("works only on a quote built on its lines", async () => {
  readEngine.mockResolvedValue("old");
  expect(await startTurn("org", "job", "u1", "Quote a split", { modelName: "m" })).toMatchObject({ ok: false, status: 409 });
});

it("takes one turn at a time", async () => {
  beginTurn.mockResolvedValue({ ok: false, reason: "Tiff is still working on the last one." });
  expect(await startTurn("org", "job", "u1", "And another", { modelName: "m" })).toEqual({ ok: false, reason: "Tiff is still working on the last one.", status: 409 });
});

it("puts the person's words in the thread at once, opens with the job's, and runs the turn after", async () => {
  const model = scripted([{ content: [{ type: "text", text: "On it." }], stopReason: "end_turn" }]);
  const started = await startTurn("org", "job", "u1", "Quote this", { modelName: "claude-opus-5-5", model, brief: "Split in the main bedroom, 3.5 kW." });
  expect(started.ok).toBe(true);
  expect(addEvents).toHaveBeenCalledWith("org", "s1", "t1", [{ kind: "message", author: "u1", body: { text: "Quote this", read: true } }]);
  expect(model.calls).toHaveLength(0);
  const end = await (started as Extract<typeof started, { ok: true }>).run();
  expect(end.ended).toBe("done");
  expect(model.calls[0]!.messages[0]!.content[0]).toEqual({ type: "text", text: "<the-job>\nSplit in the main bedroom, 3.5 kW.\n</the-job>\n\nQuote this" });
  /* the session's cost runs on from what it had spent */
  expect(saveRound).toHaveBeenLastCalledWith("org", "s1", "t1", expect.anything(), 1.5, expect.anything());
  expect(endTurn).toHaveBeenCalledWith("s1", "t1");
});

it("lets the turn go when it fails", async () => {
  const model = scripted([]);
  const started = await startTurn("org", "job", "u1", "Quote this", { modelName: "m", model });
  await (started as Extract<typeof started, { ok: true }>).run();
  expect(endTurn).toHaveBeenCalledWith("s1", "t1");
});

it("tells her what was answered since her last turn, already on the quote", async () => {
  beginTurn.mockResolvedValue({ ok: true, session: { ...session, messages: [{ role: "user", content: [{ type: "text", text: "Quote a split" }] }, { role: "assistant", content: [{ type: "text", text: "Done." }] }] }, turnId: "t2" });
  takeAnswers.mockResolvedValueOnce([{ question: "Single or three phase?", answer: "Three phase" }]);
  const model = scripted([{ content: [{ type: "text", text: "Noted." }], stopReason: "end_turn" }]);
  const started = await startTurn("org", "job", "u1", "Carry on", { modelName: "m", model });
  await (started as Extract<typeof started, { ok: true }>).run();
  expect(model.calls[0]!.messages.at(-1)!.content).toEqual([{ type: "text", text: "They answered, and the quote was changed to match:\n- Single or three phase? Three phase\n\nCarry on" }]);
});

/* Isaac, 2026-10-11: "however I gave you the answers I should be able to do the same" */
it("puts her open questions before the person's own words, by number, to settle what they answer", async () => {
  beginTurn.mockResolvedValue({ ok: true, session: { ...session, messages: [{ role: "user", content: [{ type: "text", text: "Quote a split" }] }, { role: "assistant", content: [{ type: "text", text: "Done." }] }] }, turnId: "t3" });
  readOpenQuestions.mockResolvedValueOnce([
    { id: 41, question: "How long is the pipe run, indoor to outdoor?", put: "10 m" },
    { id: 42, question: "Does the pipe need cover up the rear wall?", put: "" },
  ]);
  const model = scripted([{ content: [{ type: "text", text: "Done." }], stopReason: "end_turn" }]);
  const started = await startTurn("org", "job", "u1", "Pipe run is 14 m and 2 lengths of cover", { modelName: "m", model });
  await (started as Extract<typeof started, { ok: true }>).run();
  expect(model.calls[0]!.messages.at(-1)!.content).toEqual([
    {
      type: "text",
      text: "Your questions still open, numbered as you asked them:\n1. How long is the pipe run, indoor to outdoor? (the quote has 10 m) [id 41]\n2. Does the pipe need cover up the rear wall? [id 42]\nWhere their words answer one, change the lines to match, then settle it by its id. To them, call each by its number, never its id.\n\nPipe run is 14 m and 2 lengths of cover",
    },
  ]);
});

/* Isaac, 2026-10-12: a tech quotes too, its money hidden */
it("tells her the person doesn't see prices, before their words", async () => {
  const model = scripted([{ content: [{ type: "text", text: "Done." }], stopReason: "end_turn" }]);
  const started = await startTurn("org", "job", "u-tech", "Pipe run is 14 m", { modelName: "m", model, noMoney: true });
  await (started as Extract<typeof started, { ok: true }>).run();
  const text = (model.calls[0]!.messages.at(-1)!.content as { text: string }[])[0]!.text;
  expect(text).toMatch(/doesn't see prices/);
  expect(text.endsWith("Pipe run is 14 m")).toBe(true);
});

/* a tech's no-prices rule stays in the thread: the office, speaking next,
   is told it sees prices again, once */
it("tells her when someone who sees prices speaks after a tech", async () => {
  const tech = [{ role: "user", content: [{ type: "text", text: `(The person you're talking with doesn't see prices: in what you say to them, give no price, cost, total or difference in dollars; talk about the work. A person with money access reviews the pricing.)\n\nPipe run is 14 m` }] }, { role: "assistant", content: [{ type: "text", text: "Done." }] }];
  beginTurn.mockResolvedValueOnce({ ok: true, session: { ...session, messages: tech }, turnId: "t5" });
  const model = scripted([{ content: [{ type: "text", text: "Done." }], stopReason: "end_turn" }]);
  const started = await startTurn("org", "job", "u1", "What does it come to?", { modelName: "m", model });
  await (started as Extract<typeof started, { ok: true }>).run();
  const text = (model.calls[0]!.messages.at(-1)!.content as { text: string }[])[0]!.text;
  expect(text).toBe("(The person you're talking with now sees prices: give them as you normally would.)\n\nWhat does it come to?");

  /* said once: after it, nothing more */
  const said = [...tech, { role: "user", content: [{ type: "text", text }] }, { role: "assistant", content: [{ type: "text", text: "$14,199.35 ex GST." }] }];
  beginTurn.mockResolvedValueOnce({ ok: true, session: { ...session, messages: said }, turnId: "t6" });
  const again = scripted([{ content: [{ type: "text", text: "Done." }], stopReason: "end_turn" }]);
  const next = await startTurn("org", "job", "u1", "And inc GST?", { modelName: "m", model: again });
  await (next as Extract<typeof next, { ok: true }>).run();
  expect((again.calls[0]!.messages.at(-1)!.content as { text: string }[])[0]!.text).toBe("And inc GST?");
});

/* Isaac's production test, 2026-10-12: a tapped "Research them on the web"
   sat until he typed; an answer that leaves her work starts her with it */
it("starts her on a tapped answer that leaves her work, with no words of the person's", async () => {
  beginTurn.mockResolvedValue({ ok: true, session: { ...session, messages: [{ role: "user", content: [{ type: "text", text: "Quote a split" }] }, { role: "assistant", content: [{ type: "text", text: "Done." }] }] }, turnId: "t4" });
  takeAnswers.mockResolvedValueOnce([{ question: "Web prices or allowances?", answer: "Research them on the web" }]);
  const model = scripted([{ content: [{ type: "text", text: "Looking." }], stopReason: "end_turn" }]);
  expect(await startTurn("org", "job", "u1", "", { modelName: "m", model })).toMatchObject({ ok: false, reason: "Say what the job is." });
  const started = await startTurn("org", "job", "u1", "", { modelName: "m", model, answered: true });
  await (started as Extract<typeof started, { ok: true }>).run();
  expect(model.calls[0]!.messages.at(-1)!.content).toEqual([
    { type: "text", text: "They answered, and the quote was changed to match:\n- Web prices or allowances? Research them on the web\n\nDo what that answer leaves you to do." },
  ]);
  /* the answer is in the thread already: no second message */
  expect(addEvents).not.toHaveBeenCalledWith("org", "s1", "t4", expect.anything());
});
