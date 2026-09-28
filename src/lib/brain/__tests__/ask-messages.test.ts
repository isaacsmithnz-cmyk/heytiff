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

import { askMessages, askSystemPrompt, pageBlock, streamBrainAnswer, type AskBrainEvent } from "../ask";
import type { TiffTool, Viewer } from "@/lib/tiff/registry";

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
      { who: "tiff", text: "Done. A task for Lyle." },
      { who: "you", text: "thanks" },
      { who: "you", text: "and the filters" },
      { who: "tiff", text: "  " },
    ]);
    expect(m.map((x) => x.role)).toEqual(["user"]);
    expect(text(m[0])).toEqual(["thanks", "and the filters", "which one?"]);
  });
});

describe("where they are (universal Tiff 1D)", () => {
  const page = { screen: "Workboard", target: { kind: "job", id: "sm8-uuid-3323", label: "#3323 — Meridian Data" } };

  it("is one delimited sentence, with the id whole", () => {
    expect(pageBlock(page)).toBe(
      "<where-they-are>On the Workboard, looking at #3323 — Meridian Data (job sm8-uuid-3323).</where-they-are>"
    );
    expect(pageBlock(undefined)).toBeNull();
  });

  it("rides in the question's own message, just before the question, with or without history", () => {
    const alone = askMessages("what's wrong with this job?", [], page);
    expect(alone).toHaveLength(1);
    expect(text(alone[0])).toEqual([pageBlock(page), "what's wrong with this job?"]);

    const after = askMessages("and this one?", [
      { who: "you", text: "what's open?" },
      { who: "tiff", text: "Two tasks." },
    ], page);
    expect(text(after[0])).toEqual(["what's open?"]);
    expect(text(after[2])).toEqual([pageBlock(page), "and this one?"]);
    expect(after[2].content[1]).toHaveProperty("cache_control");
  });

  it("never reaches the system prompt", () => {
    expect(askSystemPrompt({ todayISO: "2026-09-27" })).not.toMatch(/Meridian|sm8-uuid/);
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

  const tool: TiffTool = {
    name: "job_history",
    description: "A job's history.",
    label: "Reading the job's history",
    risk: "read",
    gate: { capability: "workboard" },
    inputSchema: { type: "object", properties: {} },
    run: async () => ({ kind: "result", value: {} }),
  };
  const viewer: Viewer = {
    orgId: "org-1",
    userId: "auth0|u1",
    staffId: null,
    role: "owner",
    caps: new Set(["workboard"]),
    tz: "Australia/Sydney",
    today: "2026-09-25",
  };

  async function ask(history?: { who: "you" | "tiff"; text: string }[]) {
    const events: AskBrainEvent[] = [];
    for await (const e of streamBrainAnswer({
      viewer,
      question: "and the one at Smith St?",
      tools: [tool],
      todayISO: "2026-09-25",
      history,
    })) {
      events.push(e);
    }
    return events;
  }

  it("sends where they are in the message and never in the system prompt", async () => {
    for await (const e of streamBrainAnswer({
      viewer,
      question: "what's wrong with this job?",
      tools: [tool],
      todayISO: "2026-09-25",
      page: { screen: "Workboard", target: { kind: "job", id: "sm8-uuid-3323", label: "#3323 — Meridian Data" } },
    })) {
      void e;
    }
    const body = sent[0].body as { system: unknown; messages: { content: { text: string }[] }[] };
    expect(JSON.stringify(body.system)).not.toMatch(/Meridian|sm8-uuid/);
    expect(body.messages.at(-1)!.content[0].text).toContain("(job sm8-uuid-3323)");
  });

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
