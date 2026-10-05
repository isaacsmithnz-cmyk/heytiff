import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { readSm8SendView } from "@/lib/quotes/sm8-send-server";

/* The job card's Quote section: what one press would send to ServiceM8 for
   the accepted quote, before anything is sent (Isaac, 2026-10-05). A read:
   nothing goes to ServiceM8 here. Running the board and money access,
   because every line is a price.

   A ROUTE, as quote-price is: the card's server actions run one at a time,
   and this read can wait behind them. */

export async function GET(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("workboard_manage")) || !(await can("financials"))) {
    return Response.json({ ok: false, reason: "What goes to ServiceM8 needs Workboard manage and money access." }, { status: 403 });
  }
  const job = (new URL(req.url).searchParams.get("job") ?? "").trim().slice(0, 80);
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const target = await resolveJobCard(orgId, job);
  const view = await readSm8SendView(orgId, target.parentRemoteId);
  return Response.json({ ok: true, plan: view.plan, editDate: view.editDate });
}
