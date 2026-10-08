import { isText, isToolUse, replyCost, type Block, type Effort, type MediaBlock, type ModelCall, type Msg, type ToolDef, type ToolResultBlock } from "./model";

/* ONE TURN OF TIFF'S SESSION (slice 4.1) — a person says something, she
   works until she's answered: reading, looking things up, changing lines,
   asking. The loop is the ask loop's shape (lib/brain/ask.ts) with three
   differences that make it a session rather than a question:

   SAVED EVERY ROUND. After each round the conversation goes to `save`, at a
   point the API will accept back (a reply, or her tool calls with their
   results), so a reload, a closed tab or a deploy mid-turn loses at most the
   round in flight; the next turn carries on from the last one saved.

   THE THREAD IS KEPT APART. What a person reads (her words, what she did,
   what it cost) goes out as events beside each save, so the page shows the
   work as it happens and never reads the model's transcript.

   LONG SESSIONS ARE FOLDED. A quote lives for months; before a turn, the
   oldest whole turns are folded into a summary in her own words once the
   conversation passes its budget. The person still sees every turn.

   It never throws: a failure ends the turn with an error event, and what
   was saved stays saved. Pure, given its deps. */

export type EventDraft =
  | { kind: "reply"; author: "tiff"; body: { text: string } }
  | { kind: "tool"; author: "tiff"; body: { name: string; label: string; ok: boolean; said?: string } }
  | { kind: "usage"; author: "tiff"; body: { usd: number | null; rounds: number; models: string[] } }
  | { kind: "error"; author: "tiff"; body: { message: string } }
  | { kind: "question"; author: "tiff"; body: Record<string, unknown> };

export type SessionState = { messages: Msg[]; summary: string };

/** What a tool did: its answer for the model, and what the thread says. */
export type ToolOutcome =
  | { ok: true; value: unknown; label: string; said?: string; event?: EventDraft; media?: MediaBlock[] }
  | { ok: false; error: string; label: string };

export type TurnDeps = {
  model: ModelCall;
  modelName: string;
  system: string;
  tools: ToolDef[];
  runTool: (name: string, input: Record<string, unknown>) => Promise<ToolOutcome>;
  /** Keeps the conversation and the round's events; false: the turn has
      lost its hold on the session (another took it), so it stops. */
  save: (state: SessionState, events: EventDraft[], spentUsd: number) => Promise<boolean>;
  effort?: Effort;
  signal?: AbortSignal;
};

/** Rounds of tools before she's told to answer with what she has. A quote
    takes many more reads and writes than a question. */
export const MAX_ROUNDS = 24;
export const MAX_TOKENS = 16_000;
/** The conversation's budget before the oldest turns are folded, characters. */
export const FOLD_AT = 160_000;
/** What's kept unfolded, the newest turns, characters. */
export const KEEP = 60_000;
/** A tool's answer, at most, characters. */
const MAX_RESULT = 20_000;

const FAILED = "Tiff couldn't finish that. What she'd done is kept: say carry on.";

/** The person's words onto the conversation: a message after one of their
    own (a turn that died before she answered) joins it. */
export function withMessage(messages: readonly Msg[], text: string): Msg[] {
  const last = messages[messages.length - 1];
  if (last?.role === "user") return [...messages.slice(0, -1), { role: "user", content: [...last.content, { type: "text", text }] }];
  return [...messages, { role: "user", content: [{ type: "text", text }] }];
}

/** Where a turn begins: a person's message, not a tool's answer. */
const startsTurn = (m: Msg) => m.role === "user" && m.content.some(isText) && !m.content.some((b) => b.type === "tool_result");

const sizeOf = (m: Msg) => JSON.stringify(m.content).length;

/** Where to fold: the index of the first message kept, at the start of a
    turn, so the newest `keep` characters (at least the last turn) stay
    whole. 0: nothing to fold. Pure. */
export function foldPoint(messages: readonly Msg[], foldAt = FOLD_AT, keep = KEEP): number {
  const total = messages.reduce((n, m) => n + sizeOf(m), 0);
  if (total <= foldAt) return 0;
  let kept = 0;
  let at = messages.length;
  for (let i = messages.length - 1; i > 0; i--) {
    kept += sizeOf(messages[i]!);
    if (startsTurn(messages[i]!)) {
      at = i;
      if (kept >= keep) break;
    }
  }
  return at >= messages.length ? 0 : at;
}

const FOLD_SYSTEM = [
  "You are Tiff, keeping your own notes on a quote you are working on with the business.",
  "Fold the earlier part of the conversation below into notes you will read in place of it:",
  "what the job is, what was said and by whom, what you assumed and why, what was asked and",
  "answered, what changed on the quote and why, and anything still open. Keep every figure,",
  "model and measurement exactly as given. Plain sentences, no headings. Nothing else.",
].join(" ");

/** A tool's answer in words, its pictures said as what they were. */
const resultWords = (b: ToolResultBlock) =>
  typeof b.content === "string" ? b.content : b.content.map((c) => (c.type === "text" ? c.text : c.type === "image" ? "[a picture]" : "[a document]")).join(" ");

/** The earlier conversation folded into the summary, by one model call. */
async function fold(deps: TurnDeps, state: SessionState, at: number): Promise<{ state: SessionState; usd: number | null; model: string }> {
  const old = state.messages.slice(0, at);
  const words = old
    .map((m) =>
      m.content
        .map((b) =>
          isText(b) ? `${m.role === "user" ? "Them" : "You"}: ${b.text}` : isToolUse(b) ? `You used ${b.name}: ${JSON.stringify(b.input)}` : b.type === "tool_result" ? `It answered: ${resultWords(b as ToolResultBlock).slice(0, 2000)}` : ""
        )
        .filter(Boolean)
        .join("\n")
    )
    .join("\n");
  const reply = await deps.model(
    {
      model: deps.modelName,
      system: FOLD_SYSTEM,
      tools: [],
      messages: [{ role: "user", content: [{ type: "text", text: `${state.summary ? `Your notes so far:\n${state.summary}\n\n` : ""}The conversation to fold in:\n${words}` }] }],
      effort: "low",
      maxTokens: 4000,
    },
    deps.signal
  );
  const summary = reply.content.filter(isText).map((b) => b.text).join("\n").trim();
  return { state: { summary: summary || state.summary, messages: state.messages.slice(at) }, usd: replyCost(reply), model: reply.model };
}

/** The messages as the model is sent them: the summary, when there is one,
    ahead of the first turn kept. */
export function sentMessages(state: SessionState): Msg[] {
  if (!state.summary) return state.messages;
  const notes: Block = { type: "text", text: `<your-notes-on-earlier-turns>\n${state.summary}\n</your-notes-on-earlier-turns>` };
  const [first, ...rest] = state.messages;
  if (!first) return [{ role: "user", content: [notes] }];
  return first.role === "user" ? [{ role: "user", content: [notes, ...first.content] }, ...rest] : [{ role: "user", content: [notes] }, ...state.messages];
}

/** The conversation at a point the API takes back: tool calls left with
    no answers (a round that died between the two) come off. */
export function settled(state: SessionState): SessionState {
  const last = state.messages[state.messages.length - 1];
  return last?.role === "assistant" && last.content.some(isToolUse) ? { ...state, messages: state.messages.slice(0, -1) } : state;
}

export type TurnEnd = { state: SessionState; spentUsd: number; ended: "done" | "cap" | "error" | "lost" };

export async function runTurn(start: SessionState, message: string, deps: TurnDeps): Promise<TurnEnd> {
  let state: SessionState = { ...start, messages: withMessage(start.messages, message) };
  let spent = 0;
  let priced = true;
  const models = new Set<string>();
  let rounds = 0;
  const add = (usd: number | null, model: string) => {
    models.add(model);
    if (usd == null) priced = false;
    else spent += usd;
  };
  const usage = (): EventDraft => ({ kind: "usage", author: "tiff", body: { usd: priced ? Math.round(spent * 10000) / 10000 : null, rounds, models: [...models] } });

  try {
    const at = foldPoint(state.messages);
    if (at > 0) {
      const f = await fold(deps, state, at);
      state = f.state;
      add(f.usd, f.model);
    }
    if (!(await deps.save(state, [], spent))) return { state, spentUsd: spent, ended: "lost" };

    for (let round = 0; round <= MAX_ROUNDS; round++) {
      if (deps.signal?.aborted) return { state, spentUsd: spent, ended: "error" };
      const atCap = round === MAX_ROUNDS;
      rounds++;
      const reply = await deps.model(
        { model: deps.modelName, system: deps.system, tools: atCap ? [] : deps.tools, messages: sentMessages(state), effort: deps.effort ?? "medium", maxTokens: MAX_TOKENS },
        deps.signal
      );
      add(replyCost(reply), reply.model);
      const events: EventDraft[] = [];
      const said = reply.content.filter(isText).map((b) => b.text).join("").trim();
      if (said) events.push({ kind: "reply", author: "tiff", body: { text: said } });
      const calls = reply.content.filter(isToolUse);
      state = { ...state, messages: [...state.messages, { role: "assistant", content: reply.content }] };

      if (reply.stopReason !== "tool_use" || calls.length === 0) {
        events.push(usage());
        await deps.save(state, events, spent);
        return { state, spentUsd: spent, ended: atCap ? "cap" : "done" };
      }

      /* her calls, each run through the same checks a person's edit is;
         a failure goes back to her as words, to say or put right */
      const results: ToolResultBlock[] = [];
      for (const call of calls) {
        const out = await deps.runTool(call.name, call.input ?? {}).catch((): ToolOutcome => ({ ok: false, error: "That couldn't be done just now.", label: call.name }));
        events.push({ kind: "tool", author: "tiff", body: { name: call.name, label: out.label, ok: out.ok, ...(out.ok && out.said ? { said: out.said } : {}) } });
        if (out.ok && out.event) events.push(out.event);
        const words = out.ok ? JSON.stringify(out.value ?? null).slice(0, MAX_RESULT) : out.error;
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          /* a picture or a document she asked to look at rides with its words */
          content: out.ok && out.media?.length ? [...out.media, { type: "text", text: words }] : words,
          ...(out.ok ? {} : { is_error: true }),
        });
      }
      state = { ...state, messages: [...state.messages, { role: "user", content: results }] };
      if (!(await deps.save(state, events, spent))) return { state, spentUsd: spent, ended: "lost" };
    }
    return { state, spentUsd: spent, ended: "cap" };
  } catch (err) {
    console.error("[quote-session] turn failed:", err);
    state = settled(state);
    await deps.save(state, [{ kind: "error", author: "tiff", body: { message: FAILED } }, usage()], spent).catch(() => false);
    return { state, spentUsd: spent, ended: "error" };
  }
}
