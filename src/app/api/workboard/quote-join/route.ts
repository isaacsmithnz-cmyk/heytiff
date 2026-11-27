import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { answerDesignJoin, readDesignJoin } from "@/lib/quotes/design-units-server";

/* ONE LIST OF UNITS (design-units.ts): how the job's quote and its Studio
   design share their units. GET ?job: where each unit line stands, the
   Design row, and Tiff's questions where they don't agree. POST {job,
   question, answer}: an answer carried out. On the Workboard with the
   Studio, as the quote's Design step is; what each answer costs, and
   answering, which prices lines, need money access, as pricing does. */

async function gate() {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId) return null;
  const [board, studio, money] = await Promise.all([can("workboard"), can("studio"), can("financials")]);
  return board && studio ? { orgId, userId, money } : null;
}

export async function GET(req: Request) {
  const g = await gate();
  if (!g) return Response.json({ ok: false }, { status: 403 });
  const job = (new URL(req.url).searchParams.get("job") ?? "").trim().slice(0, 80);
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const target = await resolveJobCard(g.orgId, job);
  return Response.json({ ok: true, join: await readDesignJoin(g.orgId, target.parentRemoteId, g.money) });
}

export async function POST(req: Request) {
  const g = await gate();
  if (!g) return Response.json({ ok: false }, { status: 403 });
  if (!g.money) return Response.json({ ok: false, reason: "Joining the quote to the design prices its units, which needs money access." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const job = typeof body?.job === "string" ? body.job.trim().slice(0, 80) : "";
  const question = typeof body?.question === "string" ? body.question.slice(0, 200) : "";
  const answer = typeof body?.answer === "number" ? Math.round(body.answer) : -1;
  if (!job || !question || answer < 0) return Response.json({ ok: false, reason: "No answer given." }, { status: 400 });
  const target = await resolveJobCard(g.orgId, job);
  const r = await answerDesignJoin(g.orgId, target.parentRemoteId, question, answer, g.userId);
  return Response.json(r.ok ? { ok: true, join: await readDesignJoin(g.orgId, target.parentRemoteId, g.money) } : r);
}
