import { after } from "next/server";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { askCompare, compareView, putComparedOn } from "@/lib/quotes/compare-server";
import { addCompared } from "@/lib/quotes/lines-job-server";
import { sessionModelFor } from "@/lib/quotes/session/model-server";
import { startTurn } from "@/lib/quotes/session/session-server";

/* Compare on a quote's unit line (slice 10.2, compare.ts): GET the columns;
   POST {ask} to add a unit in the person's own words (found in the book
   with no Tiff call where it can be, else handed to Tiff to pick), or
   {use} to put a compared unit on the quote. Running the board and money
   access, as the quote's lines. */

export const maxDuration = 300;

async function gate() {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("workboard_manage")) || !(await can("financials"))) return null;
  return { orgId, userId };
}
const refused = () => Response.json({ ok: false, reason: "Compare needs Workboard manage and money access." }, { status: 403 });

export async function GET(req: Request) {
  const g = await gate();
  if (!g) return refused();
  const url = new URL(req.url);
  const job = (url.searchParams.get("job") ?? "").trim().slice(0, 80);
  const line = (url.searchParams.get("line") ?? "").trim().slice(0, 60);
  if (!job || !line) return Response.json({ ok: false, reason: "No line named." }, { status: 400 });
  const target = await resolveJobCard(g.orgId, job);
  return Response.json(await compareView(g.orgId, target.parentRemoteId, line));
}

export async function POST(req: Request) {
  const g = await gate();
  if (!g) return refused();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const job = typeof body?.job === "string" ? body.job.trim().slice(0, 80) : "";
  const line = typeof body?.line === "string" ? body.line.trim().slice(0, 60) : "";
  if (!body || !job || !line) return Response.json({ ok: false, reason: "No line named." }, { status: 400 });
  const jobUuid = (await resolveJobCard(g.orgId, job)).parentRemoteId;

  if (typeof body.use === "string") {
    const r = await putComparedOn(g.orgId, jobUuid, line, body.use.slice(0, 80), g.userId);
    return Response.json(r, { status: r.ok ? 200 : 409 });
  }

  const ask = typeof body.ask === "string" ? body.ask.trim().slice(0, 300) : "";
  if (!ask) return Response.json({ ok: false, reason: "Say what to compare it with." }, { status: 400 });
  const { found, line: onQuote } = await askCompare(g.orgId, jobUuid, line, ask);
  if (!onQuote) return Response.json({ ok: false, reason: "That line has gone from the quote." }, { status: 409 });
  if (found) {
    const r = await addCompared(g.orgId, jobUuid, line, found.indoor.code, g.userId);
    return Response.json(r.ok ? { ok: true, added: found.indoor.code } : r, { status: r.ok ? 200 : 409 });
  }
  /* it needs judgement: Tiff picks from the book, when she's on */
  if (!sessionModelFor(g.orgId)) return Response.json({ ok: false, reason: "Nothing in your book matched that. Ask by a model, or a brand and a size." }, { status: 409 });
  const started = await startTurn(
    g.orgId,
    jobUuid,
    g.userId,
    `Compare the ${onQuote.name} (${onQuote.code ?? "no code"}) on option ${onQuote.optionIndex + 1}${onQuote.system ? `, ${onQuote.system}` : ""} with: ${ask}. Pick from the book and add each with compare_with, line ${onQuote.id}.`
  );
  if (!started.ok) return Response.json({ ok: false, reason: started.reason }, { status: started.status });
  after(started.run);
  return Response.json({ ok: true, toTiff: true });
}
