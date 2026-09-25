/**
 * @jest-environment node
 */

/* WHAT THE ROUTER SENDS, ON THE WIRE. The Tiff modal asks for a line Tiff
   says back (`say`), and asking for it changed what the review card routed:
   a real-notes check (2026-09-26) found the card asking questions it never
   used to and, on a German note, asking them in German. So the card's reads
   go out as they always did — no `say` in the prompt, a schema without it,
   the answer to its question in the words the box always used — and only a
   read that turns `speak` on asks for the line.

   Run against the network rather than the SDK (the house rule: no test mocks
   `@anthropic-ai/sdk`): `fetch` is replaced and each request body read. */

import {
  NOTE_SCHEMA,
  TIFF_NOTE_SCHEMA,
  readNote,
  sayBlock,
  systemPrompt,
  type NoteContext,
} from "../note-brain";

const STAFF = [
  { id: "s-me", fullName: "Isaac Smith" },
  { id: "s-luke", fullName: "Luke Nguyen" },
  { id: "s-luke-t", fullName: "Luke Tran" },
];
/* The context the review card's door builds: routingContext with no extras. */
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
  system: string;
  messages: { role: string; content: string }[];
  output_config: { format: { type: string; schema: unknown } };
};

const sent: Body[] = [];
const realFetch = globalThis.fetch;
const realKey = process.env.ANTHROPIC_API_KEY;
/** What the next request is answered with: the model's JSON, or a refusal
    of the request when null. */
let reply: Record<string, unknown> | null = null;

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
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "text", text: JSON.stringify(reply) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = realKey;
});

const lanes = {
  tasks: [
    { title: "Order the grilles", detail: "", assignee_hint: "Luke", due_hint: "", due_date: "", remind_time: "", remind_kind: "at" },
  ],
  bring_items: [],
  flags: [],
  progress_bullets: [],
  commissioning_entries: [],
  issue_entries: [],
  kb_entries: [],
  plain_note: "",
  clarify_needed: false,
  clarify_question: "",
  clarify_options: [],
};

describe("the review card's read", () => {
  it("asks for no `say`: the card's prompt and the schema without it", async () => {
    await readNote("  tell Luke to order the grilles  ", card);
    expect(sent).toHaveLength(1);
    const body = sent[0];
    expect(body.system).toBe(systemPrompt(card));
    expect(body.system).not.toContain(sayBlock());
    expect(body.system).not.toMatch(/`say`/);
    expect(body.output_config.format).toEqual({ type: "json_schema", schema: NOTE_SCHEMA });
    expect(JSON.stringify(body.output_config.format.schema)).not.toContain('"say"');
    expect(body.messages).toEqual([{ role: "user", content: "Note:\ntell Luke to order the grilles" }]);
  });

  it("sends the answer to its question in the words the box always used", async () => {
    await readNote("tell Luke to order the grilles", card, { question: "Which Luke?", answer: "Luke Tran" });
    const body = sent[0];
    expect(body.messages).toEqual([
      {
        role: "user",
        content:
          "Note:\ntell Luke to order the grilles\n\nYou asked: Which Luke?\nThey answered: Luke Tran\n\nRoute the note using that answer. Do not ask again.",
      },
    ]);
    expect(body.system).toBe(systemPrompt(card));
    expect(body.output_config.format.schema).toEqual(NOTE_SCHEMA);
  });

  it("comes back with no line from Tiff, even when the app asks which Luke", async () => {
    reply = lanes;
    const read = await readNote("tell Luke to order the grilles", card);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.proposal.clarify?.question).toBe("Which Luke did you mean?");
    expect(read.proposal.say).toBe("");
  });
});

describe("the Tiff modal's read", () => {
  it("asks for `say`: the block in the prompt and the schema with it", async () => {
    await readNote("tell Luke to order the grilles", modal);
    const body = sent[0];
    expect(body.system).toBe(systemPrompt(modal));
    expect(body.system).toContain(sayBlock());
    expect(body.output_config.format).toEqual({ type: "json_schema", schema: TIFF_NOTE_SCHEMA });
  });

  it("reads Tiff's line back, ending with the question she had to ask", async () => {
    reply = { ...lanes, say: "A task to order the grilles." };
    const read = await readNote("tell Luke to order the grilles", modal);
    expect(read.ok && read.proposal.say).toBe("A task to order the grilles. Which Luke did you mean?");
  });
});
