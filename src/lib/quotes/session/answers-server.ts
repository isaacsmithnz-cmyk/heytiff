import "server-only";
import { buildSettingsOf } from "../build-settings";
import { addLine, changeLine, readLines, removeLine } from "../lines-server";
import { readOrgDay } from "../org-day-server";
import { readQuoteSettings } from "../settings-query";
import { answerDeltas, answeredOf, filledQty, typedFill, type Answered, type Priced } from "./answers";
import { addEvents, holding, readSession, type ThreadEvent } from "./store-server";
import { bookPrice, isErr, questionOf } from "./tools";
import { linePricer } from "./tools-server";

/* A TAPPED ANSWER, APPLIED (answers.ts says what an answer carries). The
   person's own change: each line through lines-server as them, saying what
   they answered, so it's in the history and undoable like any edit. Not
   while Tiff is working: she'd be building on a quote moving under her.
   What was answered goes to her at the start of her next turn. Service
   role, by org; the route gates. */

export type QuestionState = { deltas: (number | null)[]; answered: Answered | null };

/** Each open question's answers priced, and each answered one's answer. */
export async function priceQuestions(orgId: string, jobUuid: string, events: readonly ThreadEvent[]): Promise<Record<number, QuestionState>> {
  const questions = events.filter((e) => e.kind === "question");
  if (questions.length === 0) return {};
  const answered = answeredOf(events);
  const open = questions.filter((q) => !answered.has(q.id));
  const out: Record<number, QuestionState> = {};
  for (const q of questions) if (answered.has(q.id)) out[q.id] = { deltas: [], answered: answered.get(q.id)! };
  if (open.length === 0) return out;

  const [lines, settings, day] = await Promise.all([readLines(orgId, jobUuid), readQuoteSettings(orgId), readOrgDay(orgId)]);
  const built = buildSettingsOf(settings, day);
  const { book, hourCost, supplier } = linePricer(orgId, jobUuid);
  const [products, buyFrom] = await Promise.all([book(), supplier()]);
  const price: Priced = (code, unit) => bookPrice(products, code, unit, buyFrom);
  const hour = await hourCost();
  for (const e of open) {
    const q = questionOf(e.body);
    out[e.id] = { deltas: !isErr(q) && built.ok ? answerDeltas(q, lines, price, hour, built.settings) : [], answered: null };
  }
  return out;
}

export async function answerQuestion(orgId: string, jobUuid: string, by: string, eventId: number, index: number, events: readonly ThreadEvent[]): Promise<{ ok: true; goOn: boolean } | { ok: false; reason: string }> {
  const session = await readSession(orgId, jobUuid);
  if (!session) return { ok: false, reason: "There's no question to answer." };
  if (holding(session, Date.now())) return { ok: false, reason: "Tiff is working on the quote: answer once she's done." };
  const ev = events.find((e) => e.id === eventId && e.kind === "question");
  const q = ev ? questionOf(ev.body) : null;
  if (!q || isErr(q)) return { ok: false, reason: "That question has gone." };
  if (answeredOf(events).has(eventId)) return { ok: false, reason: "That question has been answered." };
  const answer = q.answers[index];
  if (!answer) return { ok: false, reason: "That isn't one of its answers." };

  const why = `“${answer.label}”, to “${q.question}”`;
  const { book, lineFor, supplier, unitName } = linePricer(orgId, jobUuid);
  for (const c of answer.changes) {
    const now = await readLines(orgId, jobUuid);
    if (c.op === "add") {
      const row = await lineFor({ ...c.line, source: "said", why });
      if (typeof row === "string") return { ok: false, reason: row };
      const r = await addLine(orgId, jobUuid, row, by, why);
      if (!r.ok) return r;
      continue;
    }
    const line = now.find((l) => l.id === c.lineId);
    if (!line) return { ok: false, reason: "A line this answer changes has gone since. Ask Tiff again." };
    if (c.op === "remove") {
      const r = await removeLine(orgId, jobUuid, line.id, line.version, by, why);
      if (!r.ok) return r;
    } else if (c.op === "qty") {
      const r = await changeLine(orgId, jobUuid, line.id, line.version, { qty: c.qty, source: "said" }, by, why);
      if (!r.ok) return r;
    } else {
      const p = bookPrice(await book(), c.code, line.unit, await supplier());
      if (!p) return { ok: false, reason: `${c.code} isn't in your book any more.` };
      /* a unit swapped is still named by what it is, in the room it was */
      const name = line.kind === "unit" || p.kind === "unit" ? await unitName(p, line.name) : p.name;
      const r = await changeLine(orgId, jobUuid, line.id, line.version, { name, code: p.code, supplierKey: p.supplierKey, costCents: p.costCents, sellCents: null, source: "said" }, by, why);
      if (!r.ok) return r;
    }
  }
  await addEvents(orgId, session.id, null, [{ kind: "message", author: by, body: { text: answer.label, answered: eventId, index, question: q.question } }]);
  return { ok: true, goOn: answer.goOn === true };
}

/** A typed number put straight onto its line (answers.ts typedFill), as the
    person, like a tap: null when their words aren't one, so they go to her
    as words. `left`: how many of her questions are still open after it. */
export async function answerTyped(orgId: string, jobUuid: string, by: string, words: string, events: readonly ThreadEvent[]): Promise<{ ok: true; left: number } | { ok: false; reason: string } | null> {
  const session = await readSession(orgId, jobUuid);
  if (!session || holding(session, Date.now())) return null;
  const answered = answeredOf(events);
  const open = events
    .filter((e) => e.kind === "question" && !answered.has(e.id))
    .map((e) => {
      const q = questionOf(e.body);
      return isErr(q) ? null : { id: e.id, question: q.question, fills: q.fills, put: q.put ?? "" };
    })
    .filter((q) => q != null);
  const hit = typedFill(words, open);
  const q = hit ? open.find((o) => o.id === hit.id) : undefined;
  if (!hit || !q?.fills) return null;
  const line = (await readLines(orgId, jobUuid)).find((l) => l.id === q.fills!.lineId);
  /* a line she has changed since she asked goes to her, not filled blind */
  if (!line || (q.fills.was != null && line.qty !== q.fills.was)) return null;
  const qty = filledQty(q.fills, hit.n);
  const why = `“${hit.text}”, to “${q.question}”`;
  if (qty !== line.qty) {
    const r = await changeLine(orgId, jobUuid, line.id, line.version, { qty, source: "said" }, by, why);
    if (!r.ok) return r;
  }
  const landed = `${line.name}: ${qty}${line.unit ? ` ${line.unit}` : ""}`;
  await addEvents(orgId, session.id, null, [{ kind: "message", author: by, body: { text: hit.text, answered: q.id, index: -1, question: q.question, typed: true, landed, ...(q.put ? { had: q.put } : {}) } }]);
  return { ok: true, left: open.length - 1 };
}
