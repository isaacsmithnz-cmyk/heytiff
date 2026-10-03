import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { readQuotePrice } from "@/lib/quotes/quote-price-server";

/* The job card's Quote section, priced: the job's own Materials list and
   labour at this business's own prices (Isaac, 2026-10-04: "Switch it on
   now"). Running the board, like the draft beside it, and money access,
   because every line is a buy price and a markup.

   A ROUTE, as quote-labour is: the card's server actions run one at a
   time, and this read can wait behind them. */

export async function GET(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("workboard_manage")) || !(await can("financials"))) {
    return Response.json({ ok: false, reason: "The quote's price needs Workboard manage and money access." }, { status: 403 });
  }
  const job = (new URL(req.url).searchParams.get("job") ?? "").trim().slice(0, 80);
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const target = await resolveJobCard(orgId, job);
  const price = await readQuotePrice(orgId, target.parentRemoteId);
  return Response.json({ ok: true, price });
}
