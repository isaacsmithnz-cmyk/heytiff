/* One turn of Tiff's session (slice 4.1), against a scripted model: saved
   every round, the thread kept apart, a turn that dies leaving what it had
   done for the next to carry on from, long sessions folded. Nothing here
   calls the API. */
import { recording, replaying, requestKey, scripted, withCache, NotRecorded, type Msg, type ModelRequest } from "../model";
import { foldPoint, runTurn, sentMessages, settled, withMessage, type EventDraft, type SessionState, type ToolOutcome, type TurnDeps } from "../turn";

const use = (id: string, name: string, input: Record<string, unknown> = {}) => ({ type: "tool_use" as const, id, name, input });
const text = (t: string) => ({ type: "text" as const, text: t });

function deps(model: TurnDeps["model"], over: Partial<TurnDeps> = {}) {
  const saves: { state: SessionState; events: EventDraft[]; spent: number }[] = [];
  const ran: string[] = [];
  const d: TurnDeps = {
    model,
    modelName: "claude-opus-5-5",
    system: "You are Tiff.",
    tools: [{ name: "read_quote", description: "", input_schema: { type: "object" } }],
    runTool: async (name): Promise<ToolOutcome> => {
      ran.push(name);
      return { ok: true, value: { lines: [] }, label: name === "read_quote" ? "Read the quote" : name };
    },
    save: async (state, events, spent) => {
      saves.push({ state, events, spent });
      return true;
    },
    ...over,
  };
  return { d, saves, ran };
}

const usage = { input_tokens: 1_000_000, output_tokens: 0 };

describe("a turn", () => {
  it("works through her tools, saving every round, and ends on her reply", async () => {
    const model = scripted([
      { content: [text("Reading the quote."), use("t1", "read_quote")], stopReason: "tool_use", usage },
      { content: [text("It's empty: a split it is.")], stopReason: "end_turn", usage },
    ]);
    const { d, saves, ran } = deps(model);
    const end = await runTurn({ messages: [], summary: "" }, "Quote a 3.5 kW split", d);
    expect(end.ended).toBe("done");
    expect(ran).toEqual(["read_quote"]);
    /* saved before the first call, after the tool round, after the reply */
    expect(saves).toHaveLength(3);
    expect(saves[1]!.state.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(saves[1]!.events.map((e) => e.kind)).toEqual(["reply", "tool"]);
    expect(saves[2]!.events.map((e) => e.kind)).toEqual(["reply", "usage"]);
    /* Opus 5.5 at $4 a million in: two rounds of a million */
    expect(end.spentUsd).toBe(8);
    expect(saves[2]!.events[1]!.body).toEqual({ usd: 8, rounds: 2, models: ["claude-opus-5-5"] });
    expect(model.calls[1]!.messages.at(-1)!.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
  });

  it("hands a tool's refusal back to her as words, marked as an error", async () => {
    const model = scripted([
      { content: [use("t1", "add_lines")], stopReason: "tool_use" },
      { content: [text("That code isn't in your book.")], stopReason: "end_turn" },
    ]);
    const { d } = deps(model, { runTool: async () => ({ ok: false, error: "XYZ isn't in the business's book.", label: "Added lines" }) });
    await runTurn({ messages: [], summary: "" }, "Add XYZ", d);
    expect(model.calls[1]!.messages.at(-1)!.content[0]).toEqual({ type: "tool_result", tool_use_id: "t1", content: "XYZ isn't in the business's book.", is_error: true });
  });

  it("stops when it has lost its hold on the session", async () => {
    const model = scripted([{ content: [use("t1", "read_quote")], stopReason: "tool_use" }]);
    let n = 0;
    const { d } = deps(model, { save: async () => ++n < 2 });
    expect((await runTurn({ messages: [], summary: "" }, "Go", d)).ended).toBe("lost");
    expect(model.calls).toHaveLength(1);
  });

  it("at the cap, her tools are taken away and she answers with what she has", async () => {
    const replies = Array.from({ length: 30 }, (_, i) => ({ content: [use(`t${i}`, "read_quote")], stopReason: "tool_use" }));
    replies[24] = { content: [text("Here's where it stands.")], stopReason: "end_turn" } as never;
    const model = scripted(replies);
    const { d } = deps(model);
    const end = await runTurn({ messages: [], summary: "" }, "Go", d);
    expect(end.ended).toBe("cap");
    expect(model.calls.at(-1)!.tools).toEqual([]);
  });
});

describe("a turn that dies (a deploy, a closed function)", () => {
  it("keeps every round it saved, and the next turn carries on from there", async () => {
    const dying = scripted([{ content: [text("Reading."), use("t1", "read_quote")], stopReason: "tool_use" }]);
    const { d, saves } = deps(dying);
    const end = await runTurn({ messages: [], summary: "" }, "Quote a split", d);
    expect(end.ended).toBe("error");
    expect(saves.at(-1)!.events.map((e) => e.kind)).toEqual(["error", "usage"]);
    const kept = saves.at(-1)!.state;
    expect(kept.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);

    const next = scripted([{ content: [text("Carrying on: the quote is empty.")], stopReason: "end_turn" }]);
    const again = deps(next);
    await runTurn(kept, "Carry on", again.d);
    /* the conversation the API is sent is whole: her call, its answer, then
       the person's words joined to it */
    const sent = next.calls[0]!.messages;
    expect(sent.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(sent[2]!.content.map((b) => b.type)).toEqual(["tool_result", "text"]);
  });

  it("drops tool calls left with no answers", () => {
    const s: SessionState = { summary: "", messages: [{ role: "user", content: [text("Go")] }, { role: "assistant", content: [use("t1", "read_quote")] }] };
    expect(settled(s).messages).toHaveLength(1);
  });

  it("a message after one of the person's own joins it", () => {
    const m = withMessage([{ role: "user", content: [text("Quote a split")] }], "Carry on");
    expect(m).toEqual([{ role: "user", content: [text("Quote a split"), text("Carry on")] }]);
  });
});

describe("a long session", () => {
  const turn = (i: number, size: number): Msg[] => [
    { role: "user", content: [text(`Turn ${i}`)] },
    { role: "assistant", content: [text("x".repeat(size))] },
  ];

  it("folds the oldest whole turns, keeping the newest", () => {
    const messages = [...turn(1, 100), ...turn(2, 100), ...turn(3, 100)];
    expect(foldPoint(messages, 10_000, 100)).toBe(0);
    expect(foldPoint(messages, 300, 150)).toBe(4);
    expect(foldPoint(messages, 300, 250)).toBe(2);
  });

  it("folds them into her notes with one call, and reads the notes ahead of what's kept", async () => {
    const model = scripted([
      { content: [text("Notes: a split in Mosman, 3.5 kW said.")], stopReason: "end_turn" },
      { content: [text("Done.")], stopReason: "end_turn" },
    ]);
    const { d } = deps(model);
    const messages = Array.from({ length: 20 }, (_, i) => turn(i, 10_000)).flat();
    const end = await runTurn({ messages, summary: "" }, "Make it 5 kW", d);
    expect(model.calls[0]!.system).toMatch(/Fold the earlier part/);
    expect(end.state.summary).toBe("Notes: a split in Mosman, 3.5 kW said.");
    expect(end.state.messages.length).toBeLessThan(messages.length);
    expect(model.calls[1]!.messages[0]!.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Notes: a split in Mosman") });
  });

  it("sends the notes alone when nothing follows them", () => {
    expect(sentMessages({ summary: "S", messages: [] })).toEqual([{ role: "user", content: [text("<your-notes-on-earlier-turns>\nS\n</your-notes-on-earlier-turns>")] }]);
  });
});

describe("the model's door", () => {
  const req: ModelRequest = { model: "m", system: "s", tools: [{ name: "a", description: "", input_schema: {} }, { name: "b", description: "", input_schema: {} }], messages: [{ role: "user", content: [text("hi")] }], effort: "medium", maxTokens: 10 };

  it("caches the tools and the newest message, and leaves the conversation as it was", () => {
    const c = withCache(req);
    expect(c.tools.map((t) => "cache_control" in t)).toEqual([false, true]);
    expect(c.messages[0]!.content[0]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(req.messages[0]!.content[0]).not.toHaveProperty("cache_control");
  });

  it("replays a recorded run free, and refuses a request it never saw", async () => {
    const kept = {};
    const live = recording(scripted([{ content: [text("hello")], stopReason: "end_turn" }]), kept);
    await live(req);
    const replay = replaying(kept);
    expect((await replay(req)).content).toEqual([text("hello")]);
    await expect(replay({ ...req, system: "changed" })).rejects.toBeInstanceOf(NotRecorded);
    expect(requestKey(req)).not.toBe(requestKey({ ...req, effort: "low" }));
  });
});

it("counts what a tool spent on a call of its own with hers (12.2)", async () => {
  const model = scripted([
    { content: [use("t1", "research_price", { line_id: "l1", what: "x" })], stopReason: "tool_use", usage },
    { content: [text("$1,300 a hole.")], stopReason: "end_turn", usage },
  ]);
  const { d } = deps(model, { runTool: async () => ({ ok: true, value: {}, label: "Researched a price", cost: { usd: 0.5, model: "claude-opus-5-5" } }) });
  expect((await runTurn({ messages: [], summary: "" }, "Research the core holes", d)).spentUsd).toBe(8.5);
});

describe("what she looks at (4.6)", () => {
  it("hands a tool's picture back to her with its words", async () => {
    const model = scripted([
      { content: [use("t1", "look_at", { id: "plan" })], stopReason: "tool_use" },
      { content: [text("Four bedrooms upstairs.")], stopReason: "end_turn" },
    ]);
    const picture = { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg", data: "AAAA" } };
    const { d } = deps(model, { runTool: async () => ({ ok: true, value: { looking_at: "Plan.pdf" }, label: "Looked at", media: [picture] }) });
    await runTurn({ messages: [], summary: "" }, "What's on the plan?", d);
    expect(model.calls[1]!.messages.at(-1)!.content[0]).toMatchObject({ type: "tool_result", content: [picture, { type: "text", text: '{"looking_at":"Plan.pdf"}' }] });
  });
});
