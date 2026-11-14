import "server-only";
import { namesBySignIn, readEngine } from "../lines-server";
import type { ModelCall } from "./model";
import { anthropicModel, chosenEffort, sessionModelFor, writeUpFirst } from "./model-server";
import { openingMessage, openWords, sessionSystemPrompt } from "./prompt";
import { addEvents, beginTurn, claimQueued, endTurn, readOpenQuestions, readThread, saveRound, takeAnswers } from "./store-server";
import { answerQuestion } from "./answers-server";
import { briefOf } from "./job-sources";
import { readJobSources } from "./job-sources-server";
import { SESSION_TOOLS } from "./tools";
import { sessionTools } from "./tools-server";
import { ANSWER_BY_S, runTurn, type TurnEnd } from "./turn";
import { sendBack } from "./send-back";
import { MONEY_WORDS, NO_MONEY_WORDS } from "../money-hidden";

/* A PERSON'S MESSAGE TO TIFF, ON A QUOTE (slice 4.1): the turn is taken
   (one at a time), their words go in the thread at once, and the work runs
   on after the page has its answer, saved every round, so the page reads
   it as it happens and a reload or a deploy loses nothing. Service role, by
   org; the route gates. */

export const SESSION_OFF = "Tiff's session isn't switched on for this business yet.";

/** Before words sent while she worked (startTurn `fromQueue`). */
export const QUEUED_NOTE =
  "They sent this while you were working on what came before, so before they saw what you did with it. Where what you did since changed or dropped the question it answers, use it only where it still clearly fits; otherwise ask the question again as it now stands.";

/** Her reply after answers alone. */
export const ONE_LINE = "Reply in one short line: the total now, and what changed if it's more than the answers say. Nothing else unless a line is wrong or something new needs asking.";

/** Her check once her questions are all answered with numbers put straight on their lines. */
export const CHECK_NOTE =
  "Those numbers were put straight on their lines as they typed them, without you. Check each line reads right for what they said (a figure per head, a length in lengths), change any that doesn't, and bring the write-up up to date.";

export type Started = { ok: true; turnId: string; run: () => Promise<TurnEnd> } | { ok: false; reason: string; status: number };

export async function startTurn(
  orgId: string,
  jobUuid: string,
  by: string,
  words: string,
  /* `answered`: started by a tapped answer that leaves her work, which is in
     the thread already and comes to her with the answers */
  /* `origin`: the host the turn was asked on, where a plan she has read is drawn (plans-server.ts) */
  /* `fromQueue`: the words are what was sent while she worked (store-server
     queueMessage), taken now that she's free; `words` and `by` are unused */
  /* `check`: started once the last of her questions is answered with typed
     numbers put straight on their lines (answers-server answerTyped) */
  opts: { brief?: string; model?: ModelCall; modelName?: string; noMoney?: boolean; answered?: boolean; origin?: string; fromQueue?: boolean; check?: boolean } = {}
): Promise<Started> {
  const modelName = opts.modelName ?? sessionModelFor(orgId);
  if (!modelName) return { ok: false, reason: SESSION_OFF, status: 409 };
  let text = words.trim().slice(0, 8000);
  if (!opts.fromQueue && !text && !opts.brief?.trim() && !opts.answered) return { ok: false, reason: "Say what the job is.", status: 400 };
  if ((await readEngine(orgId, jobUuid)) !== "lines") return { ok: false, reason: "Tiff builds on the quote's lines: switch the quote to them first.", status: 409 };

  const begun = await beginTurn(orgId, jobUuid);
  if (!begun.ok) return { ok: false, reason: begun.reason, status: 409 };
  const { session, turnId } = begun;
  let goOnAnswer = opts.answered === true;
  let speakerId = by;
  if (opts.fromQueue) {
    /* what was sent while she worked, oldest first: typed words come to her
       together, as one person's; a tapped answer is in the thread already */
    const claimed = await claimQueued(orgId, session.id, turnId);
    if (claimed.length === 0) {
      await endTurn(session.id, turnId);
      return { ok: false, reason: "Nothing is waiting for her.", status: 409 };
    }
    /* a tap made while she worked: its changes now, as the one who tapped; one
       that can't be made any more comes to her as their words */
    const taps = claimed.filter((c) => c.body.tap && typeof c.body.tap === "object");
    const unmade: string[] = [];
    let tapGoOn = false;
    if (taps.length) {
      const { events } = await readThread(orgId, jobUuid);
      for (const t of taps) {
        const tap = t.body.tap as { event?: unknown; index?: unknown };
        const r = await answerQuestion(orgId, jobUuid, t.author, Number(tap.event), Number(tap.index), events, { inTurn: true, asEvent: t.id });
        if (r.ok) tapGoOn ||= r.goOn;
        else unmade.push(`${String(t.body.question ?? "")} ${String(t.body.text ?? "")}`.trim());
      }
    }
    const typed = [
      ...claimed.filter((c) => c.body.answered == null && !c.body.tap && String(c.body.text ?? "").trim()),
      ...unmade.map((text, i) => ({ id: -1 - i, author: taps[0]!.author, body: { text } })),
    ];
    /* only taps that leave her nothing to do: they're on the quote, and she's let go */
    if (taps.length === claimed.length && unmade.length === 0 && !tapGoOn) {
      await endTurn(session.id, turnId);
      return { ok: false, reason: "Answered.", status: 409 };
    }
    /* sent before they'd seen what she did with the last: an answer to a
       question that's changed or gone since isn't put on blind (Isaac, 13
       November 2026: "What if one of the questions would affect the answer
       to the others?") */
    const joined = typed.map((c) => String(c.body.text).trim()).join("\n\n");
    text = joined ? `${QUEUED_NOTE}\n\n${joined}`.slice(0, 8000) : "";
    speakerId = typed[0]?.author ?? claimed[0]!.author;
    if (!text || tapGoOn) goOnAnswer = true;
  }
  /* the job's words open the session's first turn only; what was answered
     since her last turn, and already put on the quote, comes first */
  const answers = await takeAnswers(orgId, session.id, turnId);
  const answered = answers.length
    ? `They answered, and the quote was changed to match:\n${answers.map((a) => `- ${a.question} ${a.answer}`).join("\n")}`
    : "";
  /* what's still open, by number, so their own words can settle it */
  const open = text ? await readOpenQuestions(orgId, session.id) : [];
  /* a person without money access: she says no prices to them (money-hidden.ts) */
  const goOn = opts.check ? CHECK_NOTE : goOnAnswer ? "Do what that answer leaves you to do." : "";
  /* after a turn with someone who doesn't see money, the next who does is
     said to, or her no-prices rule would carry on to them */
  const history = JSON.stringify(session.messages);
  const moneyWords = opts.noMoney ? NO_MONEY_WORDS : history.lastIndexOf(NO_MONEY_WORDS) > history.lastIndexOf(MONEY_WORDS) ? MONEY_WORDS : "";
  /* WHO IS SPEAKING, by name: a quote is worked on by more than one person,
     and with no name her notes gave Isaac's words to Luke, the tech the
     job's brief names (the 3465 review, 5 November 2026) */
  const speaker = text ? ((await namesBySignIn(orgId, [speakerId]).catch(() => ({}) as Record<string, string>))[speakerId] ?? null) : null;
  const spoken = text && speaker ? `${speaker} says:\n${text}` : text;
  /* answers alone, nothing typed and nothing left her to do: she says it in a line (the mock's Done board, 13 November 2026) */
  const brief1 = answers.length > 0 && !text && (!goOnAnswer || opts.check) ? ONE_LINE : "";
  const said = [answered, openWords(open), moneyWords, spoken, goOn, brief1].filter(Boolean).join("\n\n");
  /* a first turn opened with typed words, not Read the job, still has the
     job in front of her: every source, as Read the job ticks them. 3421, 21
     October: "Add an option for Linear Mitsubishi Zone kit" reached her with
     an empty quote and none of ServiceM8's three options, and she built the
     whole job again */
  const brief = opts.brief ?? (session.messages.length === 0 && text ? await jobBrief(orgId, jobUuid) : "");
  const message = session.messages.length === 0 ? openingMessage(brief, said) : said;
  if ((text || opts.brief) && !opts.fromQueue) await addEvents(orgId, session.id, turnId, [{ kind: "message", author: by, body: { text: text || "Read the job", ...(opts.brief ? { read: true } : {}) } }]);

  const model = opts.model ?? anthropicModel();
  const run = async () => {
    const answerBy = Date.now() + ANSWER_BY_S * 1000;
    try {
      return await runTurn({ messages: session.messages, summary: session.summary }, message, {
        model,
        modelName,
        system: sessionSystemPrompt({ writeUpFirst: writeUpFirst() }),
        tools: SESSION_TOOLS,
        effort: chosenEffort(),
        runTool: sessionTools(orgId, jobUuid, opts.origin ?? null),
        sendBack,
        answerBy,
        save: (state, events, spent) => saveRound(orgId, session.id, turnId, state, session.spentUsd + spent, events),
      });
    } finally {
      await endTurn(session.id, turnId);
    }
  };
  return { ok: true, turnId, run };
}

/** The job, every source of it, as Read the job sends it with all of them
    ticked; nothing when it can't be read. */
async function jobBrief(orgId: string, jobUuid: string): Promise<string> {
  const read = await readJobSources(orgId, jobUuid).catch(() => null);
  return read ? briefOf(read.sources, new Set(read.sources.map((s) => s.id))) : "";
}
