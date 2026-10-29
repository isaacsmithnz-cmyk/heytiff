import { ok, requireMobile } from "@/lib/mobile/auth";
import { readJobMoney } from "@/lib/mobile/job-money";

/* A JOB'S MONEY on the phone (lib/mobile/job-money): quoted, allowed at
   cost, and the labour so far. Owners only, the same gate as the job's
   values on the web (`workboard_money`); the cost of anyone's hour needs
   `financials` too, which the read decides. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard_money");
  if (ctx instanceof Response) return ctx;
  const money = await readJobMoney(ctx, (await params).id);
  return money ? ok(money) : Response.json({ error: "That job isn't here." }, { status: 404, headers: { "cache-control": "no-store" } });
}
