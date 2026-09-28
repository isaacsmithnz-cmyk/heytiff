/* ONE ANSWER, ONE PLACE — server only.

   What the ask route does with a question, apart from the session: shape
   the body, then run the loop with the tools this viewer may hold. The route
   wraps it for the wire; the eval runner (lib/tiff/evals) calls it directly,
   so the evals check what the route really does rather than a copy of it
   (docs/universal-tiff-phase-1-spec.md, PR 1E). The fast path for moves
   joins it in 1C. Not lib/tiff/answer, which is the Library's own answer. */

import { streamBrainAnswer, type AskBrainEvent, type AskHistoryTurn } from "@/lib/brain/ask";
import { TARGET_KINDS } from "@/lib/brain/tools";
import { toolsFor, type TiffTool, type Viewer } from "@/lib/tiff/registry";
import type { TokenUsage } from "@/lib/tiff/usage";

const QUESTION_MAX = 1_000;

/** Turns of the Tiff modal's conversation replayed ahead of the question.
    Six is three exchanges: enough for "and the one at Smith St?" to mean
    something, short of re-billing the whole note on every ask. */
const HISTORY_TURNS = 6;

/** Per turn. A long earlier answer is trimmed rather than dropped. */
const HISTORY_TEXT_MAX = 4_000;

export type AskBody = {
  question: string;
  target?: { kind: (typeof TARGET_KINDS)[number]; id: string };
  targetLabel?: string;
  history: AskHistoryTurn[];
};

/* The history is replayed into the model as earlier turns, so it is the one
   input a caller could use to put words in Tiff's mouth: text only, the last
   few, each capped, and only the two voices the modal has. A turn from
   anyone else is dropped, not relabelled. */
function shapeHistory(raw: unknown): AskHistoryTurn[] {
  const out: AskHistoryTurn[] = [];
  for (const turn of Array.isArray(raw) ? raw : []) {
    const row = (turn && typeof turn === "object" ? turn : {}) as Record<string, unknown>;
    if (row.who !== "you" && row.who !== "tiff") continue;
    const text = typeof row.text === "string" ? row.text.trim().slice(0, HISTORY_TEXT_MAX) : "";
    if (!text) continue;
    out.push({ who: row.who, text });
  }
  return out.slice(-HISTORY_TURNS);
}

/** The body as the route receives it, shaped: null when there is no question. */
export function shapeAsk(raw: unknown): AskBody | null {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const question =
    typeof body.question === "string" ? body.question.trim().slice(0, QUESTION_MAX) : "";
  if (!question) return null;

  /* A target is whatever job_history can read — the system prompt tells the
     loop to call it with this — and nothing else. A ServiceM8 job sheet aims
     the modal at `job`, so a list without it drops the target in silence and
     "what's wrong with this job?" arrives about no job at all. */
  let target: AskBody["target"];
  const t = (body.target ?? null) as Record<string, unknown> | null;
  const kind = TARGET_KINDS.find((k) => k === t?.kind);
  if (kind && typeof t?.id === "string" && t.id) {
    target = { kind, id: t.id };
  }

  const targetLabel =
    typeof body.targetLabel === "string" ? body.targetLabel.trim().slice(0, 200) : undefined;

  return {
    question,
    target,
    targetLabel: targetLabel || undefined,
    history: shapeHistory(body.history),
  };
}

/** Run the loop for one shaped question. `tools` replaces the viewer's own
    set only for the eval runner, which stubs a tool's result to plant words
    in it; the route never passes it. */
export function answer(
  viewer: Viewer,
  body: AskBody,
  opts: {
    signal?: AbortSignal;
    tools?: readonly TiffTool[];
    onUsage?: (model: string, usage: TokenUsage) => void;
  } = {}
): AsyncGenerator<AskBrainEvent> {
  return streamBrainAnswer({
    viewer,
    question: body.question,
    tools: opts.tools ?? toolsFor(viewer),
    targetLabel: body.targetLabel,
    targetRef: body.target,
    todayISO: viewer.today,
    signal: opts.signal,
    history: body.history,
    onUsage: opts.onUsage,
  });
}
