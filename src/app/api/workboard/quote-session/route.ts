import { after } from "next/server";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { namesBySignIn } from "@/lib/quotes/lines-server";
import { sessionModelFor } from "@/lib/quotes/session/model-server";
import { startTurn } from "@/lib/quotes/session/session-server";
import { hasQueued, holding, queueAnswerEvent, queueMessage, queueTap, readSession, readThread, readThreadFrom, readTurnTimes, STILL_WORKING, tapWaiting } from "@/lib/quotes/session/store-server";
import { answerQuestion, answerTyped, priceQuestions, TAP_WAITS } from "@/lib/quotes/session/answers-server";
import { answeredOf } from "@/lib/quotes/session/answers";
import { isErr, questionOf } from "@/lib/quotes/session/tools";
import { researchDetailOf } from "@/lib/quotes/research";
import { putResearchedOn } from "@/lib/quotes/lines-job-server";
import { briefOf } from "@/lib/quotes/session/job-sources";
import { readJobSources } from "@/lib/quotes/session/job-sources-server";
import { maskMoney, threadWithoutMoney } from "@/lib/quotes/money-hidden";
import { clearDraft } from "@/lib/drafts/drafts-server";

/* Tiff's session on a quote (slice 4.1): GET reads the thread as a person
   reads it, after an event id, with whether she's working and what the
   session has cost; POST is a person's message, answered at once with the
   turn it started while the work runs on after the response (`after`),
   saved every round. Running the board and money access, as the quote's
   lines: everything she touches carries a cost. */

/* a turn runs on after the answer, for as long as the route may */
export const maxDuration = 300;

/* anyone on the Workboard talks a quote through with her (Isaac,
   2026-10-12: "it can still hold a conversation with the tech to get all of
   the correct information"); its money only to `financials` (quote-lines
   route, money-hidden.ts) */
type Gate = { ok: true; orgId: string; userId: string; money: boolean } | { ok: false; res: Response };

async function gate(): Promise<Gate> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("workboard"))) {
    return { ok: false, res: Response.json({ ok: false, reason: "Tiff's session needs access to Jobs." }, { status: 403 }) };
  }
  return { ok: true, orgId, userId, money: await can("financials") };
}

export async function GET(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;
  const url = new URL(req.url);
  const job = (url.searchParams.get("job") ?? "").trim().slice(0, 80);
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
  const target = await resolveJobCard(g.orgId, job);
  /* Read the job: what she'd be given, each source to untick */
  if (url.searchParams.get("sources") === "1") {
    const read = await readJobSources(g.orgId, target.parentRemoteId);
    /* ServiceM8's quote and a note can carry prices: a source's words come
       without them to someone who doesn't see money */
    return Response.json({ ok: true, ...read, sources: g.money ? read.sources : read.sources.map((s) => ({ ...s, text: maskMoney(s.text) })) });
  }
  const { session, events } = await readThread(g.orgId, target.parentRemoteId, since);
  /* what was sent while she worked waits for her: once she's free, this read
     starts it, and until it's taken she's still at it */
  const busy = session ? holding(session, Date.now()) : false;
  const waiting = session ? await hasQueued(g.orgId, session.id) : false;
  if (waiting && !busy) {
    const next = await startTurn(g.orgId, target.parentRemoteId, g.userId, "", { fromQueue: true, noMoney: !g.money, origin: url.origin });
    if (next.ok) after(next.run);
  }
  /* her questions' answers priced, asked for once she's done rather than
     every poll: it reads the book */
  const priced = url.searchParams.get("questions") === "1" ? await priceQuestions(g.orgId, target.parentRemoteId, since ? (await readThread(g.orgId, target.parentRemoteId)).events : events) : undefined;
  /* without money access, an answer shows no price difference */
  const questions =
    priced && !g.money
      ? Object.fromEntries(Object.entries(priced).map(([id, q]) => [id, { ...q, deltas: q.deltas.map((d) => (d === null ? null : 0)), answered: q.answered ? { ...q.answered } : null }]))
      : priced;
  const names = await namesBySignIn(g.orgId, [...new Set([g.userId, ...events.map((e) => e.author).filter((a) => a !== "tiff")])]);
  return Response.json({
    ok: true,
    on: sessionModelFor(g.orgId) != null,
    working: busy || waiting,
    /* what she's at this second, as her words come: the turn under way's own */
    ...(busy && session?.live && session.live.turn === session.turnId ? { live: { tool: session.live.tool, text: g.money ? session.live.text : maskMoney(session.live.text) } } : {}),
    /* how long her turns took here, first builds apart, for the bar */
    took: await readTurnTimes(g.orgId),
    /* what she's cost is money too */
    ...(g.money ? { spentUsd: session?.spentUsd ?? 0 } : {}),
    money: g.money,
    events: g.money ? events : threadWithoutMoney(events),
    names,
    me: g.userId,
    ...(questions ? { questions } : {}),
  });
}

export async function POST(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const job = typeof body?.job === "string" ? body.job.trim().slice(0, 80) : "";
  if (!body || !job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const target = await resolveJobCard(g.orgId, job);
  /* a tapped answer: its line changes, made as the person, no call to her */
  if (body.op === "answer") {
    const event = typeof body.event === "number" ? body.event : -1;
    const index = typeof body.answer === "number" ? body.answer : -1;
    /* the question on, whatever its age, with every answer since */
    const events = await readThreadFrom(g.orgId, target.parentRemoteId, event);
    const r = await answerQuestion(g.orgId, target.parentRemoteId, g.userId, event, index, events);
    /* she's at it: the tap waits its turn, its changes made once she's free */
    if (!r.ok && r.reason === TAP_WAITS) {
      const s = await readSession(g.orgId, target.parentRemoteId);
      const ev = events.find((e) => e.id === event && e.kind === "question");
      const q = ev ? questionOf(ev.body) : null;
      const a = q && !isErr(q) ? q.answers[index] : undefined;
      if (!s || !q || isErr(q) || !a) return Response.json({ ok: false, reason: "That isn't one of its answers." }, { status: 409 });
      if (answeredOf(events).has(event) || (await tapWaiting(g.orgId, s.id, event))) return Response.json({ ok: false, reason: "That question has been answered." }, { status: 409 });
      await queueTap(g.orgId, s.id, g.userId, { event, index, label: a.label, question: q.question });
      return Response.json({ ok: true, working: true, queued: true });
    }
    if (!r.ok) return Response.json(r, { status: 409 });
    /* an answer that leaves her work starts her, with it */
    if (!r.goOn) return Response.json({ ok: true });
    const started = await startTurn(g.orgId, target.parentRemoteId, g.userId, "", { answered: true, noMoney: !g.money, origin: new URL(req.url).origin });
    if (started.ok) after(started.run);
    /* she's at it: the answer waits its turn, and she takes it up when she's free */
    if (!started.ok && started.reason === STILL_WORKING) {
      const s = await readSession(g.orgId, target.parentRemoteId);
      if (s) await queueAnswerEvent(g.orgId, s.id, event, g.userId);
      return Response.json({ ok: true, working: true, queued: true });
    }
    return Response.json({ ok: true, working: started.ok });
  }
  /* a researched price used: read back from her saved thread, never from
     what the page sends (12.2) */
  if (body.op === "use") {
    if (!g.money) return Response.json({ ok: false, reason: "Using a price needs money access." }, { status: 403 });
    const event = typeof body.event === "number" ? body.event : -1;
    const events = await readThreadFrom(g.orgId, target.parentRemoteId, event);
    const ev = events.find((e) => e.id === event && e.kind === "tool" && e.body.name === "research_price");
    const r = researchDetailOf((ev?.body.detail as { research?: unknown } | undefined)?.research);
    if (!r) return Response.json({ ok: false, reason: "That price has gone." }, { status: 409 });
    const used = await putResearchedOn(g.orgId, target.parentRemoteId, g.userId, r);
    return Response.json(used, { status: used.ok ? 200 : 409 });
  }
  /* Read the job: the brief is built here from the sources left ticked,
     never taken as text from the page */
  let brief: string | undefined;
  if (Array.isArray(body.sources)) {
    const ticked = new Set(body.sources.filter((s): s is string => typeof s === "string"));
    brief = briefOf((await readJobSources(g.orgId, target.parentRemoteId)).sources, ticked);
    if (!brief) return Response.json({ ok: false, reason: "Tick something for her to read." }, { status: 400 });
  }
  const words = typeof body.message === "string" ? body.message : "";
  /* a plain number to one of her number questions goes straight onto its
     line, with no call to her; she checks them all once the last of her
     questions is answered (Isaac, 14 November 2026: B, "is it free text?") */
  if (!brief && words.trim()) {
    const typed = await answerTyped(g.orgId, target.parentRemoteId, g.userId, words, (await readThread(g.orgId, target.parentRemoteId)).events);
    if (typed && !typed.ok) return Response.json(typed, { status: 409 });
    if (typed) {
      after(() => clearDraft({ orgId: g.orgId, userSub: g.userId, box: "quote", ref: target.parentRemoteId }).then(() => undefined));
      if (typed.left > 0) return Response.json({ ok: true, landed: true });
      const check = await startTurn(g.orgId, target.parentRemoteId, g.userId, "", { answered: true, check: true, noMoney: !g.money, origin: new URL(req.url).origin });
      if (check.ok) after(check.run);
      return Response.json({ ok: true, landed: true, working: check.ok });
    }
  }
  const started = await startTurn(g.orgId, target.parentRemoteId, g.userId, words, { brief, noMoney: !g.money, origin: new URL(req.url).origin });
  /* she's at it: your words are in the thread now and wait their turn (Isaac,
     13 November 2026: "Build E, the answering while she works"); Read the job waits for her */
  if (!started.ok && started.reason === STILL_WORKING && !brief && words.trim()) {
    const s = await readSession(g.orgId, target.parentRemoteId);
    if (s) {
      await queueMessage(g.orgId, s.id, g.userId, words.trim().slice(0, 8000));
      after(() => clearDraft({ orgId: g.orgId, userSub: g.userId, box: "quote", ref: target.parentRemoteId }).then(() => undefined));
      return Response.json({ ok: true, queued: true });
    }
  }
  if (!started.ok) return Response.json({ ok: false, reason: started.reason }, { status: started.status });
  after(started.run);
  /* the words are sent: no draft of them is left in this person's box, on
     any device (reply_drafts.sql) */
  after(() => clearDraft({ orgId: g.orgId, userSub: g.userId, box: "quote", ref: target.parentRemoteId }).then(() => undefined));
  return Response.json({ ok: true, turn: started.turnId });
}
