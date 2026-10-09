import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { withCache, type Block, type Effort, type ModelCall } from "./model";

/* THE REAL MODEL (model.ts says why it sits behind a door). Only a route
   that found a chosen model reaches this; every test and every replayed
   bench run uses another door. */

/** The model Tiff's session runs on, as chosen for the deployment; null:
    not chosen, so the session is off and nothing is spent. */
export function chosenModel(): string | null {
  const m = (process.env.QUOTE_SESSION_MODEL ?? "").trim();
  return /^claude-[a-z0-9-]+$/.test(m) ? m : null;
}

/** Whether Tiff's session is on for a business: a model chosen, and the
    business one she's switched on for (QUOTE_SESSION_ORGS, its ids, comma
    separated: Isaac's business first, slice 4.4). Unlisted: off, and
    nothing is spent for it. */
export function sessionModelFor(orgId: string): string | null {
  const model = chosenModel();
  if (!model) return null;
  const orgs = (process.env.QUOTE_SESSION_ORGS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return orgs.includes(orgId) ? model : null;
}

/** How hard she thinks on a quote, as chosen for the deployment
    (QUOTE_SESSION_EFFORT). The bench of 9 October, five jobs talked through
    with the business's own answers: medium 5.5% from the hand-built price at
    $0.64 a job, high 4.7% at $1.01, xhigh 7.2% at $1.75. Unset: medium. */
export function chosenEffort(): Effort {
  const e = (process.env.QUOTE_SESSION_EFFORT ?? "").trim();
  return (["low", "medium", "high", "xhigh", "max"] as const).find((x) => x === e) ?? "medium";
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
