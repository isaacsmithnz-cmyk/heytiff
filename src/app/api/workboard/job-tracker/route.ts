import { auth0 } from "@/lib/auth0";
import { can, getCapabilities } from "@/lib/permissions-server";
import { readJobTracker } from "@/lib/jobs/job-tracker-server";

/* The job's Overview, its Job tracker: labour, materials and equipment
   against the quote (lib/jobs/job-tracker). For whoever sees money on the
   board (`workboard_money`), as the Overview's Money cell is; its dollar
   figures are at cost, so they come only with `financials` as well.

   A ROUTE, as quote-price is: the card's server actions run one at a time,
   and this read (the job's hours and the price book) can wait behind them. */

export async function GET(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("workboard")) || !(await can("workboard_money"))) {
    return Response.json({ ok: false, reason: "The job tracker needs access to Jobs and Money on jobs." }, { status: 403 });
  }
  const job = (new URL(req.url).searchParams.get("job") ?? "").trim().slice(0, 80);
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const tracker = await readJobTracker(orgId, await getCapabilities(), job);
  if (!tracker) return Response.json({ ok: false, reason: "That job isn't here." }, { status: 404 });
  return Response.json({ ok: true, tracker });
}
