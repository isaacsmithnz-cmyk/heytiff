/* ONE ANSWER, ONE PLACE — server only.

   What the ask route does with a question, apart from the session: shape
   the body, then run the loop with the tools this viewer may hold. The route
   wraps it for the wire; the eval runner (lib/tiff/evals) calls it directly,
   so the evals check what the route really does rather than a copy of it
   (docs/universal-tiff-phase-1-spec.md, PR 1E). The fast path for moves
   joins it in 1C. Not lib/tiff/answer, which is the Library's own answer. */

import { streamBrainAnswer, type AskBrainEvent, type AskHistoryTurn, type AskPage } from "@/lib/brain/ask";
import { TARGET_KINDS } from "@/lib/brain/tools";
import { toolsFor, type TiffTool, type Viewer } from "@/lib/tiff/registry";
import { screenLine } from "@/lib/tiff/registry/lines";
import { parseMove } from "@/lib/tiff/moves";
import { ALL_SCREENS, navFor } from "@/components/shell/nav";
import type { TokenUsage } from "@/lib/tiff/usage";

const QUESTION_MAX = 1_000;

/** Turns of the Tiff modal's conversation replayed ahead of the question.
    Six is three exchanges: enough for "and the one at Smith St?" to mean
    something, short of re-billing the whole note on every ask. */
const HISTORY_TURNS = 6;

/** Per turn. A long earlier answer is trimmed rather than dropped. */
const HISTORY_TEXT_MAX = 4_000;

export type AskBody = {
  /** The modal's word that these were a move request; the only value taken. */
  intent?: "move";
  question: string;
  /** Where they are: the screen, and the record the modal is aimed at. */
  page?: AskPage;
  history: AskHistoryTurn[];
};

/** An id longer than this isn't one of ours; a label is trimmed to it. */
const PAGE_ID_MAX = 64;
const PAGE_LABEL_MAX = 200;
const SCREEN_LABELS = new Set(ALL_SCREENS.map((n) => n.label));

/* WHERE THEY ARE, CHECKED. It reaches the model as text in their message, so
   each part is checked and anything off is dropped rather than refused: a
   screen must be one of the nav's names; a target a kind job_history reads
   (a ServiceM8 job sheet aims the modal at `job`), with an id of ours kept
   whole; a label trimmed. */
function shapePage(raw: unknown): AskPage | undefined {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const screen = typeof p.screen === "string" && SCREEN_LABELS.has(p.screen) ? p.screen : undefined;
  const t = (p.target && typeof p.target === "object" ? p.target : {}) as Record<string, unknown>;
  const kind = TARGET_KINDS.find((k) => k === t.kind);
  const id = typeof t.id === "string" ? t.id.trim() : "";
  const label = typeof t.label === "string" ? t.label.trim().slice(0, PAGE_LABEL_MAX) : "";
  const target = kind && id && id.length <= PAGE_ID_MAX ? { kind, id, ...(label ? { label } : {}) } : undefined;
  if (!screen && !target) return undefined;
  return { ...(screen ? { screen } : {}), ...(target ? { target } : {}) };
}

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

  const page = shapePage(body.page);
  return {
    question,
    ...(page ? { page } : {}),
    history: shapeHistory(body.history),
    ...(body.intent === "move" ? { intent: "move" as const } : {}),
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
  /* THE FREE MOVE (1C). Words that name a screen move there with no model
     call: the viewer's own nav decides, and a screen they can't see is
     refused in words, also without the model. Anything else, a record move
     included, goes to the loop. */
  const move = parseMove(body.question);
  if (move?.kind === "screen") return fastMove(viewer, move.label);
  return streamBrainAnswer({
    viewer,
    question: body.question,
    tools: opts.tools ?? toolsFor(viewer),
    page: body.page,
    todayISO: viewer.today,
    signal: opts.signal,
    history: body.history,
    onUsage: opts.onUsage,
    ...(body.intent === "move" ? { effort: "low" as const } : {}),
  });
}

async function* fastMove(viewer: Viewer, label: string): AsyncGenerator<AskBrainEvent> {
  const mine = navFor({ caps: viewer.caps, role: viewer.role }).find((n) => n.label === label);
  if (!mine) {
    yield { type: "delta", text: `You can't open ${label}.` };
    yield { type: "done" };
    return;
  }
  yield { type: "delta", text: screenLine(mine.label) };
  yield { type: "screen", href: mine.href, label: mine.label };
  yield { type: "done" };
}
