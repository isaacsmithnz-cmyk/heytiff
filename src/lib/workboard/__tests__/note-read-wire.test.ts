/**
 * @jest-environment node
 */

/* WHAT THE ROUTER SENDS, ON THE WIRE. The Tiff modal asks for a line Tiff
   says back (`say`), and asking for it changed what the review card routed:
   a real-notes check (2026-09-26) found the card asking questions it never
   used to and, on a German note, asking them in German. So a read that does
   not turn `speak` on goes out as the card's always did — no `say` in the
   prompt, a schema without it — and only a read that turns it on asks for
   the line. The card went with the old capture UI (2026-09-27), and every
   read the app makes turns it on; the option stays the router's, and so
   does what it means.

   Since 17 November 2026 (Isaac: "Do option 1") the lanes are tools, one
   each, and a note calls only the ones it needs: the form they replaced
   grew past what Opus 5.5 would compile (bug 9).

   Run against the network rather than the SDK (the house rule: no test mocks
   `@anthropic-ai/sdk`): `fetch` is replaced and each request body read. */

import {
  NOTE_SCHEMA,
  noteTools,
  rawFromCalls,
  readNote,
  sayBlock,
  systemBlocks,
  systemPrompt,
  type NoteContext,
} from "../note-brain";

const STAFF = [
  { id: "s-me", fullName: "Isaac Smith" },
  { id: "s-lyle", fullName: "Lyle Nguyen" },
  { id: "s-lyle-t", fullName: "Lyle Tran" },
];
/* A read with none of the modal's options: what the old review card sent. */
const card: NoteContext = {
  staff: STAFF,
  author: STAFF[0],
  todayISO: "2026-09-26",
  targetLabel: "#1042 — Smith St",
  history: { issues: [], flags: [], recentNotes: [] },
};
/* The modal's: the same, with what only it turns on. */
const modal: NoteContext = { ...card, askWho: true, speak: true, room: "tasks" };

type Body = {
  model: string;
  fallbacks?: { model: string }[];
  system: { type: "text"; text: string; cache_control?: { type: "ephemeral"; ttl?: string } }[];
  messages: { role: string; content: string }[];
  tools: { name: string; input_schema: unknown; strict?: boolean }[];
  output_config: { effort: string; format?: unknown };
};

const sent: Body[] = [];
const realFetch = globalThis.fetch;
const realKey = process.env.ANTHROPIC_API_KEY;
type Call = { name: string; input: unknown };
/** What the next request is answered with: the tools the model called, or
    a refusal of the request when null. */
let reply: Call[] | null = null;

const answer = (model: string, calls: readonly Call[], stop = calls.length ? "tool_use" : "end_turn") =>
  new Response(
    JSON.stringify({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model,
      content: calls.length
        ? calls.map((c, i) => ({ type: "tool_use", id: `toolu_${i}`, name: c.name, input: c.input }))
        : [{ type: "text", text: "That's a lookup, not a note." }],
      stop_reason: stop,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

beforeEach(() => {
  sent.length = 0;
  reply = null;
  process.env.ANTHROPIC_API_KEY = "test-key";
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body ?? "{}")));
    if (!reply) {
      return new Response(
        JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "not in tests" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    return answer("claude-opus-5-5", reply);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = realKey;
});

const grilles: Call = {
  name: "tasks",
  input: { items: [{ title: "Order the grilles", detail: "", assignee_hint: "Lyle", due_hint: "", due_date: "", remind_time: "", remind_kind: "at" }] },
};

describe("a read without `speak`", () => {
  it("asks for no `say`: the card's prompt and the tools without it", async () => {
    await readNote("  tell Lyle to order the grilles  ", card);
    expect(sent).toHaveLength(1);
    const body = sent[0];
    expect(body.system).toEqual(systemBlocks(card));
    const system = body.system.map((b) => b.text).join("");
    expect(system).toBe(systemPrompt(card));
    expect(system).not.toContain(sayBlock());
    expect(system).not.toMatch(/`say`/);
    expect(body.tools).toEqual(noteTools(false));
    expect(body.tools.map((t) => t.name)).not.toContain("say");
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.messages).toEqual([{ role: "user", content: "Note:\ntell Lyle to order the grilles" }]);
  });

  /* Opus 5.5 screens for biology, and site notes talk about legionella and
     mould: a false decline goes to the fallback rather than losing the read. */
  it("goes to Opus 5.5 with the refusal fallback", async () => {
    await readNote("cooling tower legionella test came back clear", card);
    expect(sent[0].model).toBe("claude-opus-5-5");
    expect(sent[0].fallbacks).toEqual([{ model: "claude-opus-4-8" }]);
  });

  it("comes back with no line from Tiff, even when the app asks which Lyle", async () => {
    reply = [grilles];
    const read = await readNote("tell Lyle to order the grilles", card);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.proposal.tasks.map((t) => t.title)).toEqual(["Order the grilles"]);
    expect(read.proposal.clarify?.question).toBe("Which Lyle did you mean?");
    expect(read.proposal.say).toBe("");
  });
});

describe("the Tiff modal's read", () => {
  it("asks for `say`: the block in the prompt and a tool for it", async () => {
    await readNote("tell Lyle to order the grilles", modal);
    const body = sent[0];
    expect(body.system).toEqual(systemBlocks(modal));
    expect(body.system.map((b) => b.text).join("")).toContain(sayBlock());
    expect(body.tools).toEqual(noteTools(true));
    expect(body.tools.at(-1)?.name).toBe("say");
  });

  it("reads back only the question the app had to ask, not a line written without it", async () => {
    reply = [grilles, { name: "say", input: { text: "A task to order the grilles." } }];
    const read = await readNote("tell Lyle to order the grilles", modal);
    expect(read.ok && read.proposal.say).toBe("Which Lyle did you mean?");
  });

  it("files what it said, every lane in one turn", async () => {
    reply = [
      { name: "progress_bullets", input: { items: ["Pipes done."] } },
      { name: "flags", input: { items: [{ message: "Bed 2 hatch cracked", severity: "warn" }] } },
      { name: "job_note", input: { text: "Pipes are done. Bed 2 hatch is cracked." } },
      { name: "say", input: { text: "I'll log the pipes and flag the hatch." } },
    ];
    const read = await readNote("pipes are done, bed 2 hatch is cracked", modal);
    expect(sent).toHaveLength(1);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.proposal).toMatchObject({
      progressBullets: ["Pipes done."],
      flags: [{ message: "Bed 2 hatch cracked", severity: "warn" }],
      jobNote: "Pipes are done. Bed 2 hatch is cracked.",
      say: "I'll log the pipes and flag the hatch.",
      tasks: [],
      clarify: null,
    });
  });

  it("files nothing for a lookup, which calls no tool", async () => {
    reply = [];
    const read = await readNote("feet spacing for a PUMY 140", modal);
    expect(read.ok && read.proposal).toMatchObject({ jobNote: "", plainNote: "", tasks: [], say: "" });
  });
});

/* Every lane the model may fill reaches it as a tool holding the lane's own
   schema, and comes back into the lane it left. */
describe("the lanes as tools", () => {
  it("has a tool for every lane of the schema, and none strict", () => {
    const tools = noteTools(true);
    const names = tools.map((t) => t.name);
    const lanes = Object.fromEntries(Object.entries(NOTE_SCHEMA.properties).filter(([k]) => !k.startsWith("clarify_")));
    for (const [lane, schema] of Object.entries(lanes)) {
      expect(names).toContain(lane);
      const tool = tools.find((t) => t.name === lane)!;
      if (lane === "plain_note" || lane === "job_note") continue;
      expect((tool.input_schema as { properties: { items: unknown } }).properties.items).toBe(schema);
    }
    expect(names).toEqual(expect.arrayContaining(["clarify", "say"]));
    expect(tools.some((t) => "strict" in t)).toBe(false);
  });

  it("puts the calls back into the form's shape", () => {
    expect(
      rawFromCalls([
        { name: "bring_items", input: { items: ["ladder"] } },
        { name: "bring_items", input: { items: ["coil"] } },
        { name: "job_note", input: { text: "first" } },
        { name: "job_note", input: { text: "second" } },
        { name: "clarify", input: { question: "Which Lyle?", options: ["Lyle Nguyen", "Lyle Tran"] } },
        { name: "made_up", input: { items: ["x"] } },
      ]),
    ).toEqual({
      bring_items: ["ladder", "coil"],
      job_note: "second",
      clarify_needed: true,
      clarify_question: "Which Lyle?",
      clarify_options: ["Lyle Nguyen", "Lyle Tran"],
    });
  });
});

/* The prompt cache is a byte-exact prefix. A name or a day slipping into the
   marked block would make every note write the cache and none read it, and
   nothing would say so but the bill. */
describe("the cached head of the router's prompt", () => {
  it("is the same bytes for every person, day and room, and carries the only mark", () => {
    const other: NoteContext = {
      ...modal,
      staff: [{ id: "x", fullName: "Someone Else" }],
      author: { id: "x", fullName: "Someone Else" },
      todayISO: "2031-01-01",
      room: "diary",
      targetLabel: "Smith St",
    };
    const [head, tail] = systemBlocks(modal);
    expect(head.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(tail.cache_control).toBeUndefined();
    expect(systemBlocks(card)[0]).toEqual(head);
    expect(systemBlocks(other)[0]).toEqual(head);
    for (const name of ["Isaac Smith", "Lyle Nguyen", "Someone Else"]) expect(head.text).not.toContain(name);
    expect(head.text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

/* Bug 9 (Isaac, 17 November 2026: "She didn't sort out my note"): a read
   that didn't finish gets a second go, and every failure says why in the
   logs. */
describe("a read that fails", () => {
  it("is tried once more, and says why each time", async () => {
    const said = jest.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body ?? "{}")));
      calls++;
      return calls === 1 ? answer("claude-opus-5-5", [grilles], "max_tokens") : answer("claude-opus-5-5", [grilles]);
    }) as typeof fetch;
    const read = await readNote("tell Lyle to order the grilles", card);
    expect(read.ok).toBe(true);
    expect(sent).toHaveLength(2);
    expect(said.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringMatching(/^\[note-read\] attempt 1 failed .*ran out of room/)]);
    said.mockRestore();
  });

  it("isn't tried again when the API itself said no, and says why", async () => {
    const said = jest.spyOn(console, "error").mockImplementation(() => {});
    const read = await readNote("tell Lyle to order the grilles", card);
    expect(read.ok).toBe(false);
    expect(sent).toHaveLength(1);
    expect(String(said.mock.calls[0]?.[0])).toMatch(/^\[note-read\] attempt 1 failed .* 400/);
    said.mockRestore();
  });
});

/* Bug 9's cause (17 November 2026): Opus 5.5 refused the old form as a
   grammar too large to compile. The tools compile nothing, but should the
   API ever say it again the read goes to the fallback's model, and says so. */
describe("a request the model won't compile", () => {
  it("is read on the fallback's model instead", async () => {
    const said = jest.spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      sent.push(body);
      if (body.model === "claude-opus-5-5") {
        return new Response(
          JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools." } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return answer(body.model, [grilles]);
    }) as typeof fetch;
    const read = await readNote("tell Lyle to order the grilles", modal);
    expect(read.ok).toBe(true);
    expect(sent.map((b) => b.model)).toEqual(["claude-opus-5-5", "claude-opus-4-8"]);
    expect(sent[1]!.fallbacks).toBeUndefined();
    expect(String(said.mock.calls[0]?.[0])).toMatch(/grammar is too large/);
    said.mockRestore();
  });
});
