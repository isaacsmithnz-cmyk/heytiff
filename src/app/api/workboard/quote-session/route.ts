import { after } from "next/server";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { namesBySignIn } from "@/lib/quotes/lines-server";
import { sessionModelFor } from "@/lib/quotes/session/model-server";
import { startTurn } from "@/lib/quotes/session/session-server";
import { holding, readThread } from "@/lib/quotes/session/store-server";
import { answerQuestion, priceQuestions } from "@/lib/quotes/session/answers-server";
import { researchDetailOf } from "@/lib/quotes/research";
import { putResearchedOn } from "@/lib/quotes/lines-job-server";
import { briefOf } from "@/lib/quotes/session/job-sources";
import { readJobSources } from "@/lib/quotes/session/job-sources-server";

/* Tiff's session on a quote (slice 4.1): GET reads the thread as a person
   reads it, after an event id, with whether she's working and what the
   session has cost; POST is a person's message, answered at once with the
   turn it started while the work runs on after the response (`after`),
   saved every round. Running the board and money access, as the quote's
   lines: everything she touches carries a cost. */

/* a turn runs on after the answer, for as long as the route may */
export const maxDuration = 300;

type Gate = { ok: true; orgId: string; userId: string } | { ok: false; res: Response };

async function gate(): Promise<Gate> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("workboard_manage")) || !(await can("financials"))) {
    return { ok: false, res: Response.json({ ok: false, reason: "Tiff's session needs Workboard manage and money access." }, { status: 403 }) };
  }
  return { ok: true, orgId, userId };
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
  if (url.searchParams.get("sources") === "1") return Response.json({ ok: true, ...(await readJobSources(g.orgId, target.parentRemoteId)) });
  const { session, events } = await readThread(g.orgId, target.parentRemoteId, since);
  /* her questions' answers priced, asked for once she's done rather than
     every poll: it reads the book */
  const questions = url.searchParams.get("questions") === "1" ? await priceQuestions(g.orgId, target.parentRemoteId, since ? (await readThread(g.orgId, target.parentRemoteId)).events : events) : undefined;
  const names = await namesBySignIn(g.orgId, [...new Set([g.userId, ...events.map((e) => e.author).filter((a) => a !== "tiff")])]);
  return Response.json({
    ok: true,
    on: sessionModelFor(g.orgId) != null,
    working: session ? holding(session, Date.now()) : false,
    spentUsd: session?.spentUsd ?? 0,
    events,
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
    const { events } = await readThread(g.orgId, target.parentRemoteId);
    const r = await answerQuestion(g.orgId, target.parentRemoteId, g.userId, event, index, events);
    return Response.json(r, { status: r.ok ? 200 : 409 });
  }
  /* a researched price used: read back from her saved thread, never from
     what the page sends (12.2) */
  if (body.op === "use") {
    const event = typeof body.event === "number" ? body.event : -1;
    const { events } = await readThread(g.orgId, target.parentRemoteId);
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
  const started = await startTurn(g.orgId, target.parentRemoteId, g.userId, typeof body.message === "string" ? body.message : "", { brief });
  if (!started.ok) return Response.json({ ok: false, reason: started.reason }, { status: started.status });
  after(started.run);
  return Response.json({ ok: true, turn: started.turnId });
}
