/* THE ASK LOOP — the brain answering, with its hands. Server only.

   The same engine shape as Claude Code over a repo: a model, a registry of
   read-only tools, and a loop that runs until the model stops asking for
   them. The tools are lib/brain/tools; the loop is here; the wire is
   /api/brain/ask. Nothing in this file writes anything, ever — the tool
   registry is read-only by hard rule, and this loop holds no other way to
   touch the database.

   STREAMING IS THE POINT, AND IT IS HONEST. Text deltas are forwarded the
   moment the model says them — including the sentence it says before
   reaching for a tool ("Let me check the job's history"), which is real
   narration of real work, followed by a `tool` event the UI renders as a
   chip. This is the same anti-fake-progress rule the sorting skeleton obeys:
   we show what IS happening, and never a bar pretending to know more.

   THE ROUNDS ARE CAPPED. A loop that keeps reaching for tools is spending
   the org's money on its own indecision; at the cap it is told to answer
   with what it has. Every failure — a tool erroring, the vendor declining,
   the socket dying — ends as an `error` event with a sentence, never a
   stream that just stops (the same contract as tiff/answer.ts).

   Capability filtering happens at the ROUTE (toolsFor), not here: this
   module trusts the tool list it is handed, and the route decides what the
   viewer may reach. The same read behind a screen gate must not be
   reachable by asking. */

import Anthropic from "@anthropic-ai/sdk";
import { REPLY_IN_KIND } from "@/lib/lang/policy";
import { logUsage } from "@/lib/tiff/usage";
import { runTool, toolDefs, type BrainTool } from "./tools";

const MODEL = "claude-opus-5";
const MAX_TOKENS = 16_000;

/* One conversational answer over a handful of tool reads is not a research
   task. Same reasoning, same setting, as tiff/answer.ts and the router. */
const EFFORT = "medium" as const;

/** Reaches for tools this many times, then answers with what it has. Five is
    generous: a real question is one or two reads; a model that needs six is
    circling. */
const MAX_ROUNDS = 5;

/* PROMPT CACHING. This loop resends the whole conversation every round, so
   without a cache round five re-pays full price for rounds one through four —
   the cost of an ask grows with the square of its rounds. A cached prefix is
   read back at about a tenth of the price, which turns that curve back into a
   line.

   Caching is a prefix match: the rendered order is tools, then system, then
   messages, and a marker caches everything before it. Three markers, against a
   ceiling of four per request:

     1. the last tool definition — the tool list is identical for every ask by
        every viewer holding the same capabilities, so this entry is read
        across sessions, not just across rounds;
     2. the question — the base of the conversation, and with it the system
        prompt, which carries the viewer's target and the org's date and so is
        steady within an ask but not between two;
     3. a rolling marker on the newest tool result, stripped from where it sat
        the round before so the count stays put. This is the one that earns
        the money: it is what lets each round read the round before it.

   The cap round pays full freight by construction — withdrawing the tools
   changes the prefix from its first byte, and there is nothing to read. It is
   the last of at most six requests and only happens when the loop was already
   circling, so it is left alone rather than paid for with a `tool_choice`
   that would leave the model staring at hands it can't use. */
const EPHEMERAL = { type: "ephemeral" } as const;

export type AskBrainEvent =
  | { type: "delta"; text: string }
  /** The loop picked up a tool — `label` is the human line for the chip. */
  | { type: "tool"; name: string; label: string }
  | { type: "error"; message: string }
  | { type: "done" };

export type AskBrainInput = {
  orgId: string;
  question: string;
  /** The tools THIS viewer may reach — already capability-filtered. */
  tools: readonly BrainTool[];
  /** "Meridian Data · CRACs" and its target — when the token was standing on
      a job, the loop should start there rather than searching for it. */
  targetLabel?: string;
  targetRef?: { kind: string; id: string };
  todayISO: string;
  signal?: AbortSignal;
};

const NO_KEY = "Asking isn't switched on yet.";
const FAILED = "That couldn't be answered just now. Try again.";

/* The same four-branch ladder as every model call in the app. */
function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return NO_KEY;
  if (err instanceof Anthropic.RateLimitError) return "Too busy right now — try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the assistant.";
  if (err instanceof Anthropic.APIError) return "The assistant errored — try again.";
  return FAILED;
}

export function askSystemPrompt(input: Pick<AskBrainInput, "targetLabel" | "targetRef" | "todayISO">): string {
  return [
    "You are Tiff, the assistant inside an Australian HVAC business's own",
    "workspace, answering a colleague's question about their jobs, tasks,",
    "issues and knowledge base. You have read-only tools; everything you can",
    "know about this workspace comes from them.",
    "",
    "Use the tools rather than guessing — one or two reads usually answer",
    "the question. Say what you're doing in a short clause when you reach",
    "for one ('checking the job's history'), not a paragraph. If a tool",
    "fails or returns nothing, say plainly what you couldn't check — never",
    "fill a gap with something that sounds right.",
    "",
    REPLY_IN_KIND,
    "",
    "Answer in plain conversational prose, short enough to read on a phone",
    "in a roof space. No headings, no bullet lists unless the answer is",
    "genuinely a list, no markdown markers. Lead with the answer; follow",
    "with what it rests on ('3 open tasks, oldest from Monday'). Numbers",
    "and names beat adjectives.",
    "",
    "You cannot create, change or complete anything — you only read. If the",
    "question asks you to DO something, say that saving it as a note is how",
    "things get done here, and answer whatever part is answerable.",
    "",
    `Today is ${input.todayISO}. When a tool needs today's date, use it.`,
    input.targetLabel && input.targetRef
      ? `\nThe person is looking at: ${input.targetLabel} (${input.targetRef.kind} ${input.targetRef.id}). ` +
        "Questions about 'this job' or 'here' mean that one — call job_history with it directly."
      : "",
  ].join("\n");
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

/** Ask, with hands. Never throws; an abort ends the generator silently —
    the reader has gone, so there is nobody to tell. */
export async function* streamBrainAnswer(input: AskBrainInput): AsyncGenerator<AskBrainEvent> {
  const question = input.question.trim();
  if (!question) return;
  if (!process.env.ANTHROPIC_API_KEY) {
    yield { type: "error", message: NO_KEY };
    return;
  }
  if (input.tools.length === 0) {
    yield { type: "error", message: "There's nothing you have access to ask about yet." };
    return;
  }

  const client = new Anthropic();
  const system = askSystemPrompt(input);
  /* The SDK wants input_schema branded `type: "object"` literally; the
     registry stores plain JSON schemas. The shapes agree — the cast bridges
     the nominal gap, same as the messages array below. The last definition
     carries the cache marker; see the note by MAX_ROUNDS. */
  const defs = toolDefs(input.tools);
  const tools = defs.map((def, i) =>
    i === defs.length - 1 ? { ...def, cache_control: EPHEMERAL } : def
  ) as Anthropic.Beta.BetaTool[];

  /* The running conversation: the question, then each round's assistant
     blocks and tool results. Plain message objects — the SDK's own types for
     tool_result content are looser than ours need to be. The question is a
     block rather than a bare string only so it has somewhere to hang its
     cache marker. */
  const messages: { role: "user" | "assistant"; content: unknown }[] = [
    { role: "user", content: [{ type: "text", text: question, cache_control: EPHEMERAL }] },
  ];

  /* Where the rolling marker sits right now, so the next round can take it
     back off — three markers is the budget, and one per round would blow the
     ceiling of four by the third read. */
  let rolling: Record<string, unknown> | null = null;

  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const atCap = round === MAX_ROUNDS;

    let stream: ReturnType<typeof client.beta.messages.stream>;
    try {
      stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        /* Same server-side fallback as tiff/answer.ts, same reason: HVAC
           questions brush classifier strings often enough to care. */
        betas: ["server-side-fallback-2026-06-01"],
        fallbacks: [{ model: "claude-opus-4-8" }],
        output_config: { effort: EFFORT },
        system,
        /* At the cap the tools are withdrawn, so the only thing left to do
           is answer — stated in the message rather than left as a mystery
           about why its hands stopped working. */
        tools: atCap ? [] : tools,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages as any,
      });
    } catch (err) {
      yield { type: "error", message: reasonFor(err) };
      return;
    }

    const abort = () => stream.controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });

    try {
      for await (const event of stream) {
        if (input.signal?.aborted) return;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "delta", text: event.delta.text };
        }
      }

      const final = await stream.finalMessage();
      /* Per round, not per ask: the whole point is watching `cache(r=…)`
         climb from the second round on, which an aggregate would hide.
         `final.model` rather than MODEL — a request the fallback rescued was
         answered, and billed, by the other one. */
      logUsage(`ask:${round}`, final.model, final.usage);
      const blocks = final.content as ContentBlock[];
      const calls = blocks.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");

      if (final.stop_reason !== "tool_use" || calls.length === 0) {
        yield { type: "done" };
        return;
      }

      /* Tool round: run every call it made (usually one), tell the UI, and
         hand the results back. Failures go back to the MODEL as error text —
         it was told to say what it couldn't check, and that beats this loop
         deciding the whole answer is dead. */
      messages.push({ role: "assistant", content: blocks });
      const results: unknown[] = [];
      for (const call of calls) {
        const tool = input.tools.find((t) => t.name === call.name);
        yield { type: "tool", name: call.name, label: tool?.label ?? call.name };
        const res = await runTool(input.orgId, call.name, call.input ?? {}, input.tools);
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: res.ok ? JSON.stringify(res.result).slice(0, 20_000) : res.error,
          is_error: !res.ok,
        });
      }

      /* Move the rolling marker to the end of this round's results: the next
         round reads everything up to here — this round's narration, its tool
         calls, and whatever those reads returned — instead of paying for it
         again. */
      if (rolling) delete rolling.cache_control;
      rolling = results[results.length - 1] as Record<string, unknown>;
      rolling.cache_control = EPHEMERAL;

      messages.push({ role: "user", content: results });
    } catch (err) {
      if (input.signal?.aborted) return;
      yield { type: "error", message: reasonFor(err) };
      return;
    } finally {
      input.signal?.removeEventListener("abort", abort);
    }
  }

  /* Unreachable in practice — the cap round carries no tools, so it must
     stop with an answer — but a loop should never fall out of its own
     bottom in silence. */
  yield { type: "done" };
}
