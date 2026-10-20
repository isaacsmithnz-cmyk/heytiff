"use server";

import { can } from "@/lib/permissions-server";
import { schedulePanelJobs, type PanelJob } from "@/lib/schedule/schedule-page-query";

/** The Schedule's Jobs panel, read on its own (lib/schedule/schedule-page-query).
    The Schedule's gate is this read's gate. */
export async function loadSchedulePanel(): Promise<{ ok: true; jobs: PanelJob[] } | { ok: false }> {
  if (!(await can("workboard"))) return { ok: false };
  try {
    return { ok: true, jobs: await schedulePanelJobs() };
  } catch {
    return { ok: false };
  }
}
