import "server-only";
import { readEngine } from "../lines-server";
import type { ModelCall } from "./model";
import { anthropicModel, chosenModel } from "./model-server";
import { openingMessage, sessionSystemPrompt } from "./prompt";
import { addEvents, beginTurn, endTurn, saveRound } from "./store-server";
import { SESSION_TOOLS } from "./tools";
import { sessionTools } from "./tools-server";
import { runTurn, type TurnEnd } from "./turn";

/* A PERSON'S MESSAGE TO TIFF, ON A QUOTE (slice 4.1): the turn is taken
   (one at a time), their words go in the thread at once, and the work runs
   on after the page has its answer, saved every round, so the page reads
   it as it happens and a reload or a deploy loses nothing. Service role, by
   org; the route gates. */

export const SESSION_OFF = "Tiff's session isn't switched on yet: her model hasn't been chosen.";

export type Started = { ok: true; turnId: string; run: () => Promise<TurnEnd> } | { ok: false; reason: string; status: number };

export async function startTurn(
  orgId: string,
  jobUuid: string,
  by: string,
  words: string,
  opts: { brief?: string; model?: ModelCall; modelName?: string } = {}
): Promise<Started> {
  const modelName = opts.modelName ?? chosenModel();
  if (!modelName) return { ok: false, reason: SESSION_OFF, status: 409 };
  const text = words.trim().slice(0, 8000);
  if (!text && !opts.brief?.trim()) return { ok: false, reason: "Say what the job is.", status: 400 };
  if ((await readEngine(orgId, jobUuid)) !== "lines") return { ok: false, reason: "Tiff builds on the quote's lines: switch the quote to them first.", status: 409 };

  const begun = await beginTurn(orgId, jobUuid);
  if (!begun.ok) return { ok: false, reason: begun.reason, status: 409 };
  const { session, turnId } = begun;
  /* the job's words open the session's first turn only */
  const message = session.messages.length === 0 ? openingMessage(opts.brief ?? "", text) : text;
  await addEvents(orgId, session.id, turnId, [{ kind: "message", author: by, body: { text: text || "Read the job" } }]);

  const model = opts.model ?? anthropicModel();
  const run = async () => {
    try {
      return await runTurn({ messages: session.messages, summary: session.summary }, message, {
        model,
        modelName,
        system: sessionSystemPrompt(),
        tools: SESSION_TOOLS,
        runTool: sessionTools(orgId, jobUuid),
        save: (state, events, spent) => saveRound(orgId, session.id, turnId, state, session.spentUsd + spent, events),
      });
    } finally {
      await endTurn(session.id, turnId);
    }
  };
  return { ok: true, turnId, run };
}
