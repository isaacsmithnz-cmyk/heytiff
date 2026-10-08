import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { withCache, type Block, type ModelCall } from "./model";

/* THE REAL MODEL (model.ts says why it sits behind a door). Only a route
   that found a chosen model reaches this; every test and every replayed
   bench run uses another door. */

/** The model Tiff's session runs on, as chosen for the deployment; null:
    not chosen, so the session is off and nothing is spent. */
export function chosenModel(): string | null {
  const m = (process.env.QUOTE_SESSION_MODEL ?? "").trim();
  return /^claude-[a-z0-9-]+$/.test(m) ? m : null;
}

export function anthropicModel(): ModelCall {
  const client = new Anthropic();
  return async (req, signal) => {
    const r = withCache(req);
    const reply = await client.beta.messages.create(
      {
        model: r.model,
        max_tokens: r.maxTokens,
        output_config: { effort: r.effort },
        system: [{ type: "text", text: r.system, cache_control: { type: "ephemeral" } }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: r.tools as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: r.messages as any,
      },
      { signal }
    );
    return { model: reply.model, content: reply.content as unknown as Block[], stopReason: reply.stop_reason ?? "end_turn", usage: reply.usage };
  };
}
