/* PROBE P3: DOES TOOL SEARCH WORK ON OUR SETUP? — server only.

   One phrase at a time, the model is shown the forty draft tools either all
   at once (loaded) or behind the BM25 tool search with everything but the
   five most-used deferred (searched). Either way it is asked to reach for
   the one tool that does the job; the probe reads which tool it reached
   for and stops. Nothing runs.

   The request is the ask loop's own: Opus 5, the server-side fallback beta,
   effort medium, a cache marker on the last loaded tool. A deferred tool
   can't carry `cache_control` (a 400), so in the searched shape the marker
   sits on the last tool that stays loaded.

   `followUp` sends a second round for a phrase, with a made-up result for
   the tool it picked, so the report can show whether that round reads its
   prefix back from the cache: tool search appends what it finds rather than
   editing the prefix, and this is where that is seen. */

import Anthropic from "@anthropic-ai/sdk";
import { BRAIN_TOOLS, toolDefs } from "@/lib/brain/tools";
import { DRAFT_TOOLS } from "./drafts";
import type { Usage } from "./rows";

const EPHEMERAL = { type: "ephemeral" } as const;

/* Loaded in both shapes: what almost every turn needs. */
const ALWAYS = ["job_history", "search_jobs", "open_task_load", "task_complete", "calendar_add_event"];

const SYSTEM = [
  "You are Tiff, the assistant inside an Australian HVAC business's own workspace.",
  "This is a routing check. For what the person says, call the one tool that does it,",
  "with your best guess at its arguments. Don't look anything up first and don't answer in words.",
].join("\n");

const SEARCH_HINT =
  "More tools are found with the tool search: tasks and reminders, issues and flags, the " +
  "calendar, maintenance visits and their checklists, projects and claims, ServiceM8 and " +
  "email, leave and availability, timesheets, vehicles, approvals, staff and the noticeboard.";

type Shape = "loaded" | "searched";

export type SearchPick = {
  shape: Shape;
  picked: string | null;
  searches: string[];
  ms: number;
  usage: Usage;
  model: string;
  error?: string;
  followUp?: { usage: Usage; ms: number };
};

type Block = { type: string; name?: string; id?: string; input?: Record<string, unknown> };

function toolsFor(shape: Shape): unknown[] {
  const all = [...toolDefs(BRAIN_TOOLS), ...DRAFT_TOOLS];
  if (shape === "loaded") {
    return all.map((d, i) => (i === all.length - 1 ? { ...d, cache_control: EPHEMERAL } : d));
  }
  const kept = all.filter((d) => ALWAYS.includes(d.name));
  const deferred = all.filter((d) => !ALWAYS.includes(d.name)).map((d) => ({ ...d, defer_loading: true }));
  return [
    { type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" },
    ...kept.map((d, i) => (i === kept.length - 1 ? { ...d, cache_control: EPHEMERAL } : d)),
    ...deferred,
  ];
}

export async function pickTool(
  client: Anthropic,
  say: string,
  shape: Shape,
  model: string,
  followUp = false,
): Promise<SearchPick> {
  const tools = toolsFor(shape);
  const system = shape === "searched" ? `${SYSTEM}\n\n${SEARCH_HINT}` : SYSTEM;
  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: say }];
  const started = performance.now();
  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16_000,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      output_config: { effort: "medium" },
      system,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: tools as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: messages as any,
    });
    const ms = performance.now() - started;
    const blocks = response.content as unknown as Block[];
    const call = blocks.find((b) => b.type === "tool_use");
    const searches = blocks
      .filter((b) => b.type === "server_tool_use")
      .map((b) => String((b.input as { query?: unknown } | undefined)?.query ?? ""));
    const pick: SearchPick = {
      shape,
      picked: call?.name ?? null,
      searches,
      ms,
      usage: response.usage as Usage,
      model: response.model,
    };
    if (followUp && call?.id) {
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: call.id, content: "Done." }],
      });
      const t = performance.now();
      const second = await client.beta.messages.create({
        model,
        max_tokens: 16_000,
        betas: ["server-side-fallback-2026-06-01"],
        fallbacks: [{ model: "claude-opus-4-8" }],
        output_config: { effort: "medium" },
        system,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: tools as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages as any,
      });
      pick.followUp = { usage: second.usage as Usage, ms: performance.now() - t };
    }
    return pick;
  } catch (err) {
    return {
      shape,
      picked: null,
      searches: [],
      ms: performance.now() - started,
      usage: { input_tokens: 0, output_tokens: 0 },
      model,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
