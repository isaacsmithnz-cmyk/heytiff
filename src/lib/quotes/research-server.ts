import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { costOf, type TokenUsage } from "@/lib/tiff/usage";
import { RESEARCH_SCHEMA, researchOf, researchPrompt, searchedPages, type Research, type ResearchAsk } from "./research";

/* Research's one call (research.ts says what it may say). Web search and
   nothing else, the way the fleet valuation does it (lib/fleet/valuation.ts):
   a paused turn is resumed by sending it back as it came, capped so a search
   that never settles can't bill for ever. Only reached with a model chosen
   for the business (tools-server.ts); a test hands it a fake `create`. */

const MAX_SEARCHES = 5;
const MAX_RESUMES = 3;

type Reply = { model: string; content: { type: string; [k: string]: unknown }[]; stop_reason: string | null; usage: TokenUsage & { server_tool_use?: { web_search_requests?: number } | null } };
export type Create = (body: Record<string, unknown>) => Promise<Reply>;

const live = (): Create => {
  const client = new Anthropic();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (body) => (await client.messages.create(body as any)) as unknown as Reply;
};

export type ResearchRun =
  | { ok: true; research: Research; usd: number | null; model: string; searches: number }
  | { ok: false; reason: string; usd: number | null; model: string; searches: number };

export async function runResearch(model: string, ask: ResearchAsk, create: Create = live()): Promise<ResearchRun> {
  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: researchPrompt(ask) }];
  let usd: number | null = 0;
  let searches = 0;
  const pages = new Map<string, string>();
  try {
    for (let attempt = 0; attempt <= MAX_RESUMES; attempt++) {
      const reply = await create({
        model,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium", format: { type: "json_schema", schema: RESEARCH_SCHEMA } },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES, user_location: { type: "approximate", country: "AU", timezone: "Australia/Sydney" } }],
        messages,
      });
      const cost = costOf(reply.model, reply.usage);
      usd = usd == null || cost == null ? null : usd + cost;
      searches += reply.usage.server_tool_use?.web_search_requests ?? 0;
      for (const [url, title] of searchedPages(reply.content)) pages.set(url, title);
      if (reply.stop_reason === "refusal") return { ok: false, reason: "The research was declined.", usd, model, searches };
      if (reply.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: reply.content });
        continue;
      }
      const text = reply.content.find((b) => b.type === "text")?.text;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(typeof text === "string" ? text : "");
      } catch {
        return { ok: false, reason: "The research didn't come back in a form that could be read.", usd, model, searches };
      }
      const found = researchOf(parsed, pages);
      return found.ok ? { ok: true, research: found.research, usd, model, searches } : { ok: false, reason: found.reason, usd, model, searches };
    }
    return { ok: false, reason: "The research kept searching without settling on a price.", usd, model, searches };
  } catch {
    return { ok: false, reason: "The research couldn't be done just now.", usd, model, searches };
  }
}
