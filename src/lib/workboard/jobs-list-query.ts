/* What the Jobs list loads (v2, /dashboard/jobs) — server only.

   The same reads the Workboard makes for its All jobs, Projects and
   Maintenance sides (page-data.ts), with two things of its own folded into
   the jobs' read: who is on each job's bookings, and the day each work
   order was won. The rows are
   decided in jobs-list.ts; only they reach the page, so the boards' whole
   datasets stay on the server.

   The page gates with can("workboard") before calling this. Money follows
   `workboard_money` exactly as the board's does: without it loadAllJobs
   never selects a total or a payment, and the rows carry none. */

import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { jobsTimer } from "./jobs-timing";
import { getConnectionView } from "@/lib/integrations/store";
import { listSm8SyncStatus } from "@/lib/integrations/sm8-sync";
import { freshenSm8AfterResponse } from "@/lib/integrations/sm8-freshness";
import { EMPTY_ALL_JOBS, loadAllJobs } from "./all-jobs-query";
import { loadMaintenanceBoard } from "./board-query";
import { todayInZone } from "./dates";
import { jobsListRows, type JobsListRow } from "./jobs-list";
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


export async function loadJobsList(opts: { from?: string } = {}): Promise<JobsListData | null> {
  /* timed for a day, to the server's log only (./jobs-timing) */
  const clock = jobsTimer(opts.from ?? "page");
  const session = await auth0.getSession();
  clock.mark("session");
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
  clock.mark("grants");
  const connection = view === null ? "none" : view.status === "connected" ? "connected" : "attention";
  const connected = connection !== "none";
  const today = todayInZone(connected ? zone : null);

  /* who is on each job and when each was won come in the jobs' own waits
     (`crew`): they were a wait of their own after the jobs landed, then a
     third for the staff names (the Jobs list's timing, 26 October 2026) */
  const [board, projectsBoard, allJobs, sync] = await Promise.all([
    clock.lap("maintenance", loadMaintenanceBoard(orgId, today)),
    clock.lap("projects", loadProjectsBoard(orgId, today, { includeMoney: false })),
    clock.lap("jobs", connected ? loadAllJobs(orgId, today, { includeMoney: moneyVisible, timer: clock, crew: true }) : Promise.resolve(EMPTY_ALL_JOBS)),
    clock.lap("sync", connected ? listSm8SyncStatus(orgId) : Promise.resolve(null)),
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
    crew: allJobs.crew ?? {},
    wonOn: allJobs.wonOn ?? {},
    today,
    moneyVisible,
  });

  clock.done({ rows: rows.length, jobs: allJobs.jobs.length });

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
