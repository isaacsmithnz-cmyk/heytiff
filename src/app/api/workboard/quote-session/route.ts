import { after } from "next/server";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { namesBySignIn } from "@/lib/quotes/lines-server";
import { chosenModel } from "@/lib/quotes/session/model-server";
import { startTurn } from "@/lib/quotes/session/session-server";
import { holding, readThread } from "@/lib/quotes/session/store-server";
import { answerQuestion, priceQuestions } from "@/lib/quotes/session/answers-server";

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
  const { session, events } = await readThread(g.orgId, target.parentRemoteId, since);
  /* her questions' answers priced, asked for once she's done rather than
     every poll: it reads the book */
  const questions = url.searchParams.get("questions") === "1" ? await priceQuestions(g.orgId, target.parentRemoteId, since ? (await readThread(g.orgId, target.parentRemoteId)).events : events) : undefined;
  const names = await namesBySignIn(g.orgId, [...new Set(events.map((e) => e.author).filter((a) => a !== "tiff"))]);
  return Response.json({
    ok: true,
    on: chosenModel() != null,
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
  const started = await startTurn(g.orgId, target.parentRemoteId, g.userId, typeof body.message === "string" ? body.message : "", {
    brief: typeof body.brief === "string" ? body.brief.slice(0, 40_000) : undefined,
  });
  if (!started.ok) return Response.json({ ok: false, reason: started.reason }, { status: started.status });
  after(started.run);
  return Response.json({ ok: true, turn: started.turnId });
}
