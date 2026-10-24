/* What the Jobs list loads (v2, /dashboard/jobs) — server only.

   The same reads the Workboard makes for its All jobs, Projects and
   Maintenance sides (page-data.ts), and two small ones of its own: who is
   on each job's bookings, and the day each work order was won. The rows are
   decided in jobs-list.ts; only they reach the page, so the boards' whole
   datasets stay on the server.

   The page gates with can("workboard") before calling this. Money follows
   `workboard_money` exactly as the board's does: without it loadAllJobs
   never selects a total or a payment, and the rows carry none. */

import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { inChunks } from "@/lib/in-chunks";
import { getConnectionView } from "@/lib/integrations/store";
import { listSm8SyncStatus } from "@/lib/integrations/sm8-sync";
import { freshenSm8AfterResponse } from "@/lib/integrations/sm8-freshness";
import { ALL_JOBS_HORIZON_DAYS } from "./all-jobs";
import { EMPTY_ALL_JOBS, loadAllJobs } from "./all-jobs-query";
import { loadMaintenanceBoard } from "./board-query";
import { plusDays, todayInZone } from "./dates";
import { crewOf, jobsListRows, type JobsListRow } from "./jobs-list";
import { loadProjectsBoard } from "./projects-board-query";
import { getSm8Timezone } from "./query";

export type JobsListData = {
  rows: JobsListRow[];
  today: string;
  moneyVisible: boolean;
  /** runs the board: offered the way to connect ServiceM8 */
  manage: boolean;
  /** a ServiceM8 mirror to read (connected, or waiting to be signed in again) */
  connected: boolean;
  /** connected, and the jobs' first walk hasn't finished */
  syncing: boolean;
  /** the open jobs ran past the board's cap */
  truncated: boolean;
};


type Act = { job_uuid: string; staff_uuid: string | null; start_date: string | null };

/** Who is on each job, and when each work order was won, for the jobs the
    book already holds. The bookings are read back to the board's 56-day
    window, so "the last day booked" is a recent one. */
async function readJobExtras(
  orgId: string,
  jobs: readonly { remoteId: string; status: string | null }[],
  today: string,
): Promise<{ crew: Record<string, string[]>; wonOn: Record<string, string> }> {
  const ids = jobs.map((j) => j.remoteId);
  const workIds = jobs.filter((j) => j.status === "Work Order").map((j) => j.remoteId);
  if (ids.length === 0) return { crew: {}, wonOn: {} };
  const floor = `${plusDays(today, -ALL_JOBS_HORIZON_DAYS)} 00:00:00`;

  const [acts, won] = await Promise.all([
    inChunks(ids, 100, async (chunk) => {
      const { data, error } = await supabaseAdmin
        .from("sm8_job_activities")
        .select("job_uuid, staff_uuid, start_date")
        .eq("org_id", orgId)
        .eq("active", 1)
        .eq("activity_was_scheduled", 1)
        .in("job_uuid", chunk)
        .gte("start_date", floor);
      if (error) console.error(`[jobs] couldn't read org ${orgId}'s bookings for the list:`, error);
      return (data ?? []) as Act[];
    }),
    inChunks(workIds, 200, async (chunk) => {
      const { data } = await supabaseAdmin.from("sm8_jobs").select("uuid, work_order_date").eq("org_id", orgId).in("uuid", chunk);
      return (data ?? []) as { uuid: string; work_order_date: string | null }[];
    }),
  ]);

  const staffIds = [...new Set(acts.map((a) => a.staff_uuid).filter((s): s is string => !!s))];
  const names = new Map<string, string>();
  if (staffIds.length) {
    const rows = await inChunks(staffIds, 200, async (chunk) => {
      const { data } = await supabaseAdmin.from("sm8_staff").select("uuid, first, last").eq("org_id", orgId).in("uuid", chunk);
      return (data ?? []) as { uuid: string; first: string | null; last: string | null }[];
    });
    for (const s of rows) {
      const name = [s.first, s.last].filter(Boolean).join(" ").trim();
      if (name) names.set(s.uuid, name);
    }
  }

  const wonOn: Record<string, string> = {};
  for (const r of won) if (r.work_order_date && r.work_order_date.length >= 10) wonOn[r.uuid] = r.work_order_date.slice(0, 10);
  return { crew: crewOf(acts, names, today), wonOn };
}

export async function loadJobsList(): Promise<JobsListData | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) return null;

  /* the grants, the connection and its clock in one wait: none needs
     another's answer, and the clock is one cheap row read whether or not it
     is used (25 October 2026) */
  const [moneyVisible, manage, view, zone] = await Promise.all([
    can("workboard_money"),
    can("workboard_manage"),
    getConnectionView(orgId, "servicem8"),
    getSm8Timezone(orgId),
  ]);
  const connection = view === null ? "none" : view.status === "connected" ? "connected" : "attention";
  const connected = connection !== "none";
  const today = todayInZone(connected ? zone : null);

  /* the extras (who is on each job, when each was won) need the jobs, and
     nothing else here: they are read the moment the jobs land, beside the
     boards rather than after them */
  const allJobsP = connected ? loadAllJobs(orgId, today, { includeMoney: moneyVisible }) : Promise.resolve(EMPTY_ALL_JOBS);
  const [board, projectsBoard, allJobs, sync, extras] = await Promise.all([
    loadMaintenanceBoard(orgId, today),
    loadProjectsBoard(orgId, today, { includeMoney: false }),
    allJobsP,
    connected ? listSm8SyncStatus(orgId) : Promise.resolve(null),
    allJobsP.then((a) => readJobExtras(orgId, a.jobs, today)),
  ]);

  /* looking at the list counts as looking, as the board's does */
  if (connection === "connected") freshenSm8AfterResponse(orgId);

  const rows = jobsListRows({
    jobs: allJobs.jobs,
    projectLinks: allJobs.projectLinks,
    visits: board.visits.map((v) => ({
      id: v.id,
      agreementId: v.agreementId,
      jobNo: v.jobNo,
      remoteId: v.remoteId,
      clientName: v.clientName,
      label: v.label,
      siteLabel: v.siteLabel,
      category: v.category ? { name: v.category.name, accent: v.category.accent } : null,
      dueDate: v.dueDate,
      bookedDate: v.bookedDate,
      status: v.status,
      completedAt: v.completedAt,
      invoicedAt: v.invoicedAt,
      techs: v.techs.map((t) => t.name),
    })),
    agreements: board.agreements.map((a) => ({
      id: a.id,
      label: a.label,
      clientName: a.clientName,
      siteLabel: a.siteLabel,
      intervalMonths: a.intervalMonths,
      status: a.status,
      category: a.category ? { name: a.category.name, accent: a.category.accent } : null,
      nextDue: a.nextDue,
      overdueCount: a.overdueCount,
    })),
    projects: projectsBoard.projects.map((p) => ({
      id: p.id,
      name: p.name,
      clientName: p.clientName,
      siteLabel: p.siteLabel,
      stage: p.stage,
      status: p.status,
      updatedAt: p.updatedAt,
      jobs: p.jobs.map((j) => ({ remoteId: j.remoteId, role: j.role })),
    })),
    trips: projectsBoard.visits.map((t) => ({
      projectId: t.projectId,
      status: t.status,
      bookedDate: t.bookedDate,
      techs: t.techs.map((x) => x.name),
    })),
    crew: extras.crew,
    wonOn: extras.wonOn,
    today,
    moneyVisible,
  });

  return {
    rows,
    today,
    moneyVisible,
    manage,
    connected,
    syncing: connected && !(sync?.objects.find((o) => o.object === "jobs")?.backfillDone ?? false),
    truncated: allJobs.truncated,
  };
}
