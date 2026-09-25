/**
 * @jest-environment node
 */

/* THE HISTORY AHEAD OF THE QUESTION. The Tiff modal asks in a conversation,
   and "and the one at Smith St?" means nothing without the turn before it.
   What the loop sends first is a pure function, pinned below; and the loop
   is run once, against the network rather than the SDK (the house rule: no
   test mocks `@anthropic-ai/sdk`), to show it sends exactly that. */

// the tools registry reaches Supabase at import; nothing here calls a tool
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { askMessages, streamBrainAnswer, type AskBrainEvent } from "../ask";
import type { BrainTool } from "../tools";

const text = (m: { content: { text: string }[] }) => m.content.map((c) => c.text);

describe("askMessages", () => {
  it("is the question alone, cache-marked, with no history", () => {
    expect(askMessages("what's open?")).toEqual([
      { role: "user", content: [{ type: "text", text: "what's open?", cache_control: { type: "ephemeral" } }] },
    ]);
  });

  it("puts the history ahead of the question, you as the user and Tiff as the assistant", () => {
    const m = askMessages("and the one at Smith St?", [
      { who: "you", text: "what's open at Meridian?" },
      { who: "tiff", text: "Two open tasks, oldest from Monday." },
    ]);
    expect(m.map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    expect(m.map(text)).toEqual([
      ["what's open at Meridian?"],
      ["Two open tasks, oldest from Monday."],
      ["and the one at Smith St?"],
    ]);
    // the marker stays on the question, so the history ahead of it is cached with it
    expect(m[0].content[0]).not.toHaveProperty("cache_control");
    expect(m[2].content[0]).toHaveProperty("cache_control", { type: "ephemeral" });
  });

  it("opens on the person, alternates, and joins a question to a turn of their own", () => {
    const m = askMessages("which one?", [
      { who: "tiff", text: "Done. A task for Luke." },
      { who: "you", text: "thanks" },
      { who: "you", text: "and the filters" },
      { who: "tiff", text: "  " },
    ]);
    expect(m.map((x) => x.role)).toEqual(["user"]);
    expect(text(m[0])).toEqual(["thanks", "and the filters", "which one?"]);
  });
});

describe("streamBrainAnswer", () => {
  /* The real SDK, and a network that answers every request with a refusal:
     nothing leaves the machine, and the request the loop built is read off
     the wire exactly as the API would have received it. */
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const realFetch = globalThis.fetch;
  const realKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    sent.length = 0;
    process.env.ANTHROPIC_API_KEY = "test-key";
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(
        JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "not in tests" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realKey;
  });

  const tool: BrainTool = {
    name: "job_history",
    description: "A job's history.",
    label: "Reading the job's history",
    capability: "workboard",
    inputSchema: { type: "object", properties: {} },
    run: async () => ({}),
  };

  async function ask(history?: { who: "you" | "tiff"; text: string }[]) {
    const events: AskBrainEvent[] = [];
    for await (const e of streamBrainAnswer({
      orgId: "org-1",
      question: "and the one at Smith St?",
      tools: [tool],
      todayISO: "2026-09-25",
      history,
    })) {
      events.push(e);
    }
    return events;
  }

  it("sends the history ahead of the question, which keeps the cache marker", async () => {
    const events = await ask([
      { who: "you", text: "what's open at Meridian?" },
      { who: "tiff", text: "Two open tasks, oldest from Monday." },
    ]);
    // the refusal ends as a sentence, never a stream that just stops
    expect(events).toEqual([{ type: "error", message: "The assistant errored — try again." }]);

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toMatch(/\/v1\/messages/);
    expect(sent[0].body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "what's open at Meridian?" }] },
      { role: "assistant", content: [{ type: "text", text: "Two open tasks, oldest from Monday." }] },
      {
        role: "user",
        content: [{ type: "text", text: "and the one at Smith St?", cache_control: { type: "ephemeral" } }],
      },
    ]);
  });

  it("sends the question alone when there is no history", async () => {
    await ask();
    expect(sent[0].body.messages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "and the one at Smith St?", cache_control: { type: "ephemeral" } }],
      },
    ]);
  });
});
