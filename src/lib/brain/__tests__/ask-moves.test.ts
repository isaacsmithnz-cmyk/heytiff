/**
 * @jest-environment node
 */

/* A MOVE ENDS THE TURN (universal Tiff 1B). The real SDK, and a network that
   streams back one tool call — no test mocks `@anthropic-ai/sdk` (the house
   rule) — so what is measured is what the loop really does: one request for
   a move, her own line never doubled, and nothing run after the move. */

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

import { streamBrainAnswer, type AskBrainEvent } from "../ask";
import type { TiffTool, Viewer } from "@/lib/tiff/registry";

const viewer: Viewer = {
  orgId: "org-1",
  userId: "auth0|u1",
  staffId: null,
  role: "owner",
  caps: new Set(["workboard"]),
  tz: "Australia/Sydney",
  today: "2026-09-27",
};

const ran: string[] = [];
const openScreen: TiffTool = {
  name: "open_screen",
  label: "Opening the screen",
  risk: "screen",
  gate: { open: true },
  description: "Open a screen.",
  inputSchema: { type: "object", properties: {} },
  run: async () => {
    ran.push("open_screen");
    return { kind: "screen", href: "/dashboard/workboard", label: "Workboard", line: "Opening the Workboard." };
  },
};
const issueLog: TiffTool = {
  name: "issue_log",
  label: "Scanning recurring issues",
  risk: "read",
  gate: { capability: "workboard" },
  description: "Recurring issues.",
  inputSchema: { type: "object", properties: {} },
  run: async () => {
    ran.push("issue_log");
    return { kind: "result", value: [] };
  },
};

type Block = { text: string } | { tool: string; id: string };

/** The SSE stream the API sends for one assistant message. */
function sse(blocks: Block[]): string {
  const ev = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev("message_start", {
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1 },
    },
  });
  blocks.forEach((b, index) => {
    if ("text" in b) {
      out += ev("content_block_start", { index, content_block: { type: "text", text: "" } });
      out += ev("content_block_delta", { index, delta: { type: "text_delta", text: b.text } });
    } else {
      out += ev("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.tool, input: {} } });
      out += ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: "{}" } });
    }
    out += ev("content_block_stop", { index });
  });
  out += ev("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 20 } });
  out += ev("message_stop", {});
  return out;
}

let requests = 0;
let reply: Block[] = [];
const realFetch = globalThis.fetch;
const realKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  requests = 0;
  ran.length = 0;
  process.env.ANTHROPIC_API_KEY = "test-key";
  globalThis.fetch = (async () => {
    requests += 1;
    return new Response(sse(reply), { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = realKey;
});

async function ask(): Promise<AskBrainEvent[]> {
  const events: AskBrainEvent[] = [];
  for await (const e of streamBrainAnswer({
    viewer,
    question: "Can you bring me to the workboard screen?",
    tools: [openScreen, issueLog],
    todayISO: viewer.today,
  })) {
    events.push(e);
  }
  return events;
}

describe("a move", () => {
  it("ends the turn in one request, with her line built from where she's going", async () => {
    reply = [{ tool: "open_screen", id: "toolu_1" }];
    expect(await ask()).toEqual([
      { type: "tool", name: "open_screen", label: "Opening the screen" },
      { type: "delta", text: "Opening the Workboard." },
      { type: "screen", href: "/dashboard/workboard", label: "Workboard" },
      { type: "done" },
    ]);
    expect(requests).toBe(1);
  });

  it("never doubles her own words: when she said something, no line is added", async () => {
    reply = [{ text: "Taking you there." }, { tool: "open_screen", id: "toolu_1" }];
    const events = await ask();
    expect(events.filter((e) => e.type === "delta")).toEqual([{ type: "delta", text: "Taking you there." }]);
    expect(events.at(-2)).toEqual({ type: "screen", href: "/dashboard/workboard", label: "Workboard" });
    expect(requests).toBe(1);
  });

  it("runs nothing after the move in the same round", async () => {
    reply = [
      { tool: "open_screen", id: "toolu_1" },
      { tool: "issue_log", id: "toolu_2" },
    ];
    await ask();
    expect(ran).toEqual(["open_screen"]);
    expect(requests).toBe(1);
  });
});

/* A CHANGE FOR THE PAGE DOESN'T END THE TURN (Isaac, 20 October 2026: she
   revises the 3D from the chat). The tool writes nothing; its result goes
   to the page open as an `apply` event, she is told it was applied with
   what changed, and she goes on to say so in her own words. */
describe("a change for the page", () => {
  const revise: TiffTool = {
    name: "revise_design_3d",
    label: "Reading the drawings again",
    risk: "read",
    gate: { open: true },
    description: "Correct the 3D.",
    inputSchema: { type: "object", properties: {} },
    run: async () => ({ kind: "apply", target: "design-roof", designId: "d1", roof: { parts: [] }, said: "Made it a hip roof at 25°." }),
  };

  it("goes to the page as an apply event, and her answer follows", async () => {
    const replies: Block[][] = [[{ tool: "revise_design_3d", id: "toolu_1" }], [{ text: "It's a hip roof at 25° now." }]];
    const sentBodies: string[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      requests += 1;
      sentBodies.push(String(init?.body ?? ""));
      return new Response(sse(replies.shift() ?? []), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const events: AskBrainEvent[] = [];
    for await (const e of streamBrainAnswer({ viewer, question: "make it a hip roof at 25", tools: [revise], todayISO: viewer.today })) events.push(e);
    expect(events).toContainEqual({ type: "apply", target: "design-roof", designId: "d1", roof: { parts: [] } });
    expect(events.filter((e) => e.type === "delta")).toEqual([{ type: "delta", text: "It's a hip roof at 25° now." }]);
    expect(requests).toBe(2);
    expect(sentBodies[1]).toContain(JSON.stringify(JSON.stringify({ applied: true, said: "Made it a hip roof at 25°." })).slice(1, -1));
  });
});

/* Her words across two rounds ran together ("…preset.Roughly $2,395",
   21 October): a space goes between where neither has one. */
it("puts a space between one round's words and the next", async () => {
  const replies: Block[][] = [[{ text: "Checking the book." }, { tool: "issue_log", id: "toolu_1" }], [{ text: "Roughly $2,395 inc GST." }]];
  globalThis.fetch = (async () => {
    requests += 1;
    return new Response(sse(replies.shift() ?? []), { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const said: string[] = [];
  for await (const e of streamBrainAnswer({ viewer, question: "how much for a zone kit", tools: [issueLog], todayISO: viewer.today })) if (e.type === "delta") said.push(e.text);
  expect(said.join("")).toBe("Checking the book. Roughly $2,395 inc GST.");
});
