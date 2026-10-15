import "server-only";
import { readEngine } from "../lines-server";
import type { ModelCall } from "./model";
import { anthropicModel, chosenEffort, sessionModelFor, writeUpFirst } from "./model-server";
import { openingMessage, openWords, sessionSystemPrompt } from "./prompt";
import { addEvents, beginTurn, endTurn, readOpenQuestions, saveRound, takeAnswers } from "./store-server";
import { SESSION_TOOLS } from "./tools";
import { sessionTools } from "./tools-server";
import { runTurn, type TurnEnd } from "./turn";
import { MONEY_WORDS, NO_MONEY_WORDS } from "../money-hidden";

/* A PERSON'S MESSAGE TO TIFF, ON A QUOTE (slice 4.1): the turn is taken
   (one at a time), their words go in the thread at once, and the work runs
   on after the page has its answer, saved every round, so the page reads
   it as it happens and a reload or a deploy loses nothing. Service role, by
   org; the route gates. */

export const SESSION_OFF = "Tiff's session isn't switched on for this business yet.";

export type Started = { ok: true; turnId: string; run: () => Promise<TurnEnd> } | { ok: false; reason: string; status: number };

export async function startTurn(
  orgId: string,
  jobUuid: string,
  by: string,
  words: string,
  /* `answered`: started by a tapped answer that leaves her work, which is in
     the thread already and comes to her with the answers */
  opts: { brief?: string; model?: ModelCall; modelName?: string; noMoney?: boolean; answered?: boolean } = {}
): Promise<Started> {
  const modelName = opts.modelName ?? sessionModelFor(orgId);
  if (!modelName) return { ok: false, reason: SESSION_OFF, status: 409 };
  const text = words.trim().slice(0, 8000);
  if (!text && !opts.brief?.trim() && !opts.answered) return { ok: false, reason: "Say what the job is.", status: 400 };
  if ((await readEngine(orgId, jobUuid)) !== "lines") return { ok: false, reason: "Tiff builds on the quote's lines: switch the quote to them first.", status: 409 };

  const begun = await beginTurn(orgId, jobUuid);
  if (!begun.ok) return { ok: false, reason: begun.reason, status: 409 };
  const { session, turnId } = begun;
  /* the job's words open the session's first turn only; what was answered
     since her last turn, and already put on the quote, comes first */
  const answers = await takeAnswers(orgId, session.id, turnId);
  const answered = answers.length
    ? `They answered, and the quote was changed to match:\n${answers.map((a) => `- ${a.question} ${a.answer}`).join("\n")}`
    : "";
  /* what's still open, by number, so their own words can settle it */
  const open = text ? await readOpenQuestions(orgId, session.id) : [];
  /* a person without money access: she says no prices to them (money-hidden.ts) */
  const goOn = opts.answered ? "Do what that answer leaves you to do." : "";
  /* after a turn with someone who doesn't see money, the next who does is
     said to, or her no-prices rule would carry on to them */
  const history = JSON.stringify(session.messages);
  const moneyWords = opts.noMoney ? NO_MONEY_WORDS : history.lastIndexOf(NO_MONEY_WORDS) > history.lastIndexOf(MONEY_WORDS) ? MONEY_WORDS : "";
  const said = [answered, openWords(open), moneyWords, text, goOn].filter(Boolean).join("\n\n");
  const message = session.messages.length === 0 ? openingMessage(opts.brief ?? "", said) : said;
  if (text || opts.brief) await addEvents(orgId, session.id, turnId, [{ kind: "message", author: by, body: { text: text || "Read the job", ...(opts.brief ? { read: true } : {}) } }]);

  const model = opts.model ?? anthropicModel();
  const run = async () => {
    try {
      return await runTurn({ messages: session.messages, summary: session.summary }, message, {
        model,
        modelName,
        system: sessionSystemPrompt({ writeUpFirst: writeUpFirst() }),
        tools: SESSION_TOOLS,
        effort: chosenEffort(),
        runTool: sessionTools(orgId, jobUuid),
        save: (state, events, spent) => saveRound(orgId, session.id, turnId, state, session.spentUsd + spent, events),
      });
    } finally {
      await endTurn(session.id, turnId);
    }
  };
  return { ok: true, turnId, run };
}
