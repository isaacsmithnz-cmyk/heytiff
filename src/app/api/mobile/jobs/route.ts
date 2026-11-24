import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { listMirrorJobsByNumber, readMirrorJobsByIds, searchAllMirrorJobs } from "@/lib/workboard/all-jobs-query";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import { ok, requireMobile, type MobileCtx } from "@/lib/mobile/auth";
import { readStars, starredAmong, type StarOwner } from "@/lib/jobs/job-stars";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { supabaseAdmin } from "@/lib/supabase-server";

const OPEN_STATUSES = ["Work Order", "Quote"] as const;

/* FINDING A JOB from the phone: the whole mirror, as All jobs' own search
   reaches it (actions/workboard's searchAllJobs), behind `workboard`. Money
   rides only for someone who holds `workboard_money`; without it the
   loader never reads it.

   YOUR STARS (Isaac, 24 November 2026, the Star a job mock): every job
   here carries `starred` where you starred it, for the star at its row's
   end; `starred=1` is Jobs' Starred, newest starred first, each with your
   open task on it (`task`), the newest, in place of where it is. */
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
  const owner: StarOwner = { orgId: ctx.orgId, userId: ctx.userId };
  if (!q && params.get("starred") === "1") return ok(await starredJobs(ctx, owner, today, includeMoney));
  /* The Jobs screen before anything is typed (Isaac, 8 November 2026):
     `ids=` reads the jobs this phone opened last, fresh and in that order;
     `list=1` is every job, newest number first, a page at a time from `from`. */
  const ids = params.get("ids");
  if (!q && ids !== null) return ok(await withStars(owner, await readMirrorJobsByIds(ctx.orgId, ids.split(",").slice(0, 20), today, { includeMoney })));
  if (!q && params.get("list") === "1") {
    const from = Number.parseInt(params.get("from") ?? "0", 10);
    return ok(await withStars(owner, await listMirrorJobsByNumber(ctx.orgId, today, { includeMoney, from: Number.isFinite(from) ? from : 0 })));
  }
  return ok(await withStars(owner, await searchAllMirrorJobs(ctx.orgId, q, today, { includeMoney, statuses })));
}

type StarredJob = AllJobsMirrorJob & { starred?: true; task?: string };

/** The jobs, each you starred marked so. A star that can't be read leaves the jobs as they are. */
async function withStars(owner: StarOwner, jobs: AllJobsMirrorJob[]): Promise<StarredJob[]> {
  const mine = await starredAmong(owner, jobs.map((j) => j.remoteId)).catch(() => new Set<string>());
  return mine.size === 0 ? jobs : jobs.map((j) => (mine.has(j.remoteId.toLowerCase()) ? { ...j, starred: true as const } : j));
}

/** Your starred jobs, newest starred first, each with your newest open task on it. */
async function starredJobs(ctx: MobileCtx, owner: StarOwner, today: string, includeMoney: boolean): Promise<StarredJob[]> {
  const stars = await readStars(owner);
  if (stars.length === 0) return [];
  const ids = stars.map((s) => s.job);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));
  const [read, staffId] = await Promise.all([
    Promise.all(chunks.map((c) => readMirrorJobsByIds(ctx.orgId, c, today, { includeMoney }))),
    staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null),
  ]);
  const task = new Map<string, string>();
  if (staffId) {
    const { data } = await supabaseAdmin
      .from("tasks")
      .select("title, sm8_job_uuid, created_at")
      .eq("org_id", ctx.orgId)
      .eq("assigned_to", staffId)
      .eq("status", "open")
      .in("sm8_job_uuid", ids)
      .order("created_at", { ascending: false });
    for (const t of (data ?? []) as { title: string; sm8_job_uuid: string }[]) {
      const k = t.sm8_job_uuid.toLowerCase();
      if (!task.has(k)) task.set(k, t.title);
    }
  }
  const seen = new Set<string>();
  const out: StarredJob[] = [];
  for (const j of read.flat()) {
    const k = j.remoteId.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const t = task.get(k);
    out.push({ ...j, starred: true, ...(t ? { task: t } : {}) });
  }
  return out;
}
