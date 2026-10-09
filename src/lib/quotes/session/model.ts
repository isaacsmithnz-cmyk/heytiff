import { costOf, type TokenUsage } from "@/lib/tiff/usage";

/* TIFF'S MODEL, BEHIND ONE DOOR (slice 4.1) — the session never calls the
   API itself: it is handed a `ModelCall`, so the same turn runs against the
   real model, a recording of one, or a script in a test. Nothing here spends
   money until a route hands the session the real model, and the route does
   that only once a model has been chosen (QUOTE_SESSION_MODEL).

   RECORDED RUNS REPLAY FREE (slice 4.3): a recorder keeps every reply under
   a key made from exactly what was asked; a replay answers from those keys
   and refuses anything it wasn't asked before, so a change to the prompt,
   the tools or a lookup's answer shows up as "not recorded", never as a
   quiet stale answer. Pure. */

export type TextBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
/** What a tool can hand back besides words: a picture or a document she looks at (4.6). */
export type MediaBlock =
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string | (TextBlock | MediaBlock)[];
  is_error?: boolean;
  cache_control?: { type: "ephemeral" };
};
/** Thinking and anything else the model returns: kept as it came, and sent
    back as it came, as the API asks of a tool loop. */
export type OtherBlock = { type: string; [k: string]: unknown };
export type Block = TextBlock | ToolUseBlock | ToolResultBlock | OtherBlock;

export type Msg = { role: "user" | "assistant"; content: Block[] };

export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> };

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type ModelRequest = {
  model: string;
  system: string;
  tools: ToolDef[];
  messages: Msg[];
  effort: Effort;
  maxTokens: number;
};

export type ModelReply = {
  /** the model that answered: a fallback bills as itself */
  model: string;
  content: Block[];
  stopReason: string;
  usage: TokenUsage;
};

export type ModelCall = (req: ModelRequest, signal?: AbortSignal) => Promise<ModelReply>;

export const isText = (b: Block): b is TextBlock => b.type === "text" && typeof (b as TextBlock).text === "string";
export const isToolUse = (b: Block): b is ToolUseBlock => b.type === "tool_use";

/** What a reply cost, US dollars; null for a model with no price on file. */
export const replyCost = (r: ModelReply) => costOf(r.model, r.usage);

/* ── caching ──
   The session resends the whole conversation every round, so the prefix is
   cached: the tools (the same for every quote), the system prompt, and a
   rolling marker on the newest message, so each round reads the one before
   it at a tenth of the price. Three markers, under the API's four. */
const EPHEMERAL = { type: "ephemeral" } as const;

/** The request with its cache markers, the conversation itself untouched. */
export function withCache(req: ModelRequest): ModelRequest & { tools: (ToolDef & { cache_control?: typeof EPHEMERAL })[] } {
  const tools = req.tools.map((t, i) => (i === req.tools.length - 1 ? { ...t, cache_control: EPHEMERAL } : t));
  const messages = req.messages.map((m, i) => {
    if (i !== req.messages.length - 1 || m.content.length === 0) return m;
    const content = m.content.map((b, j) => (j === m.content.length - 1 && (b.type === "text" || b.type === "tool_result") ? { ...b, cache_control: EPHEMERAL } : b));
    return { ...m, content };
  });
  return { ...req, tools, messages };
}

/* ── recordings ── */

/** The key a reply is kept under: everything that was asked, nothing else. */
export function requestKey(req: ModelRequest): string {
  const text = JSON.stringify([req.model, req.effort, req.system, req.tools, req.messages]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${h.toString(36)}`;
}

export type Recording = Record<string, ModelReply>;

/** The model, with every reply kept in `into` under its request's key. */
export function recording(inner: ModelCall, into: Recording): ModelCall {
  return async (req, signal) => {
    const reply = await inner(req, signal);
    into[requestKey(req)] = reply;
    return reply;
  };
}

export class NotRecorded extends Error {
  constructor(readonly key: string) {
    super(`Not recorded: ${key}`);
  }
}

/** A model that answers only from a recording, and costs nothing. */
export function replaying(from: Recording): ModelCall {
  return async (req) => {
    const key = requestKey(req);
    const reply = from[key];
    if (!reply) throw new NotRecorded(key);
    return reply;
  };
}

/** A model that says what a test scripts, one reply a call, in order. */
export function scripted(replies: readonly (Omit<ModelReply, "model" | "usage"> & Partial<Pick<ModelReply, "model" | "usage">>)[]): ModelCall & { calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  const fn = (async (req: ModelRequest) => {
    calls.push(req);
    const r = replies[calls.length - 1];
    if (!r) throw new Error("The script has no more replies");
    return { model: r.model ?? req.model, usage: r.usage ?? { input_tokens: 0, output_tokens: 0 }, content: r.content, stopReason: r.stopReason };
  }) as ModelCall & { calls: ModelRequest[] };
  fn.calls = calls;
  return fn;
}
