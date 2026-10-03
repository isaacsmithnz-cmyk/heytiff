import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { readQuoteLabour } from "@/lib/quotes/quote-labour-server";

/* The job card's Quote section: the job's labour, from its brief, else this
   business's own history of the kind of work, else nothing (Isaac,
   2026-10-04). Beside the quote draft, so the same gate: running the board.
   The cost needs money access as well; without it the hours stand alone.

   A ROUTE, as quote-draft is: the card's server actions run one at a time,
   and this read can wait behind them. */

export async function GET(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("workboard_manage"))) {
    return Response.json({ ok: false, reason: "The quote's labour needs Workboard manage access." }, { status: 403 });
  }
  const job = (new URL(req.url).searchParams.get("job") ?? "").trim().slice(0, 80);
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const target = await resolveJobCard(orgId, job);
  const labour = await readQuoteLabour(orgId, target.parentRemoteId, { money: await can("financials") });
  if (!labour) return Response.json({ ok: false, reason: "That job isn't in this workspace." }, { status: 404 });
  return Response.json({ ok: true, labour });
}
