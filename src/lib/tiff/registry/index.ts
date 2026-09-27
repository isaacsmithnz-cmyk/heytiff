/* THE REGISTRY — server only.

   Every tool Tiff holds, in one ordered list. The order is the tool block's
   order in every request, so it never changes by accident: the prompt cache
   is a prefix match, and a reordered list re-pays the whole prefix.

   Reads reachable by ASKING are the same set reachable by LOOKING: a tool
   whose gate the viewer doesn't pass is not in their request at all. */

import { passes } from "./gates";
import { READS } from "./reads";
import { SCREEN_TOOLS } from "./screens";
import type { TiffTool, Viewer } from "./types";

export { passes } from "./gates";

export type { Gate, Outcome, Risk, TiffTool, Viewer } from "./types";

export const TIFF_TOOLS: readonly TiffTool[] = [...READS, ...SCREEN_TOOLS];


/** The tools this viewer may hold, in registry order. */
export const toolsFor = (viewer: Viewer, tools: readonly TiffTool[] = TIFF_TOOLS): TiffTool[] =>
  tools.filter((t) => passes(t.gate, viewer));

/** Anthropic-shaped tool definitions, for the ask loop's API call. */
export const toolDefs = (tools: readonly TiffTool[]) =>
  tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));

export type ToolRun =
  | { ok: true; outcome: import("./types").Outcome }
  | { ok: false; error: string };

/** Dispatch one call. Unknown names are an error VALUE, not a throw — inside
    an agentic loop a throw kills the answer, and the honest failure is to
    tell the model it asked for a tool that doesn't exist. */
export async function runTool(
  viewer: Viewer,
  name: string,
  input: Record<string, unknown>,
  allowed: readonly TiffTool[]
): Promise<ToolRun> {
  const tool = allowed.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `No such tool: ${name}` };
  try {
    return { ok: true, outcome: await tool.run(viewer, input) };
  } catch {
    return { ok: false, error: `${name} failed — answer without it.` };
  }
}
