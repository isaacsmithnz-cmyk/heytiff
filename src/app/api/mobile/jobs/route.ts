import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { searchAllMirrorJobs } from "@/lib/workboard/all-jobs-query";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* FINDING A JOB from the phone: the whole mirror, as All jobs' own search
   reaches it (actions/workboard's searchAllJobs), behind `workboard`. Money
   rides only for someone who holds `workboard_money`; without it the
   loader never reads it. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 120);
  const today = todayInZone(await getSm8Timezone(ctx.orgId));
  return ok(await searchAllMirrorJobs(ctx.orgId, q, today, { includeMoney: ctx.caps.has("workboard_money") }));
}
