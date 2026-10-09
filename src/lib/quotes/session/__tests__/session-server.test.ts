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
jest.mock("../store-server", () => ({
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
