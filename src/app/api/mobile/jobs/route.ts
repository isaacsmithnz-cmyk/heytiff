import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { listMirrorJobsByNumber, readMirrorJobsByIds, searchAllMirrorJobs } from "@/lib/workboard/all-jobs-query";
import { ok, requireMobile } from "@/lib/mobile/auth";

const OPEN_STATUSES = ["Work Order", "Quote"] as const;

/* FINDING A JOB from the phone: the whole mirror, as All jobs' own search
   reaches it (actions/workboard's searchAllJobs), behind `workboard`. Money
   rides only for someone who holds `workboard_money`; without it the
   loader never reads it. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;

  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim().slice(0, 120);
  const today = todayInZone(await getSm8Timezone(ctx.orgId));
  /* `open=1`: only the jobs a booking can go on, open Work Orders and Quotes
     (the phone's Move, Isaac 28 October 2026), so finished ones never crowd them out */
  const statuses = params.get("open") === "1" ? OPEN_STATUSES : undefined;
  const includeMoney = ctx.caps.has("workboard_money");
  /* The Jobs screen before anything is typed (Isaac, 8 November 2026):
     `ids=` reads the jobs this phone opened last, fresh and in that order;
     `list=1` is every job, newest number first, a page at a time from `from`. */
  const ids = params.get("ids");
  if (!q && ids !== null) return ok(await readMirrorJobsByIds(ctx.orgId, ids.split(",").slice(0, 20), today, { includeMoney }));
  if (!q && params.get("list") === "1") {
    const from = Number.parseInt(params.get("from") ?? "0", 10);
    return ok(await listMirrorJobsByNumber(ctx.orgId, today, { includeMoney, from: Number.isFinite(from) ? from : 0 }));
  }
  return ok(await searchAllMirrorJobs(ctx.orgId, q, today, { includeMoney, statuses }));
}
