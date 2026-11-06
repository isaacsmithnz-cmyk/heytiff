"use server";

import { can } from "@/lib/permissions-server";
import { auth0 } from "@/lib/auth0";
import { schedulePanelJobs, type PanelJob } from "@/lib/schedule/schedule-page-query";
import { readPileBlocks } from "@/lib/schedule/blocks-store";
import type { PileBlock } from "@/lib/schedule/blocks";

/** The Schedule's Jobs panel, read on its own (lib/schedule/schedule-page-query),
    with the blocks out waiting at its top (lib/schedule/blocks). The
    Schedule's gate is this read's gate. */
export async function loadSchedulePanel(): Promise<{ ok: true; jobs: PanelJob[]; blocks: PileBlock[] } | { ok: false }> {
  if (!(await can("workboard"))) return { ok: false };
  try {
    const orgId = (await auth0.getSession())?.orgId as string | undefined;
    const [jobs, blocks] = await Promise.all([schedulePanelJobs(), orgId ? readPileBlocks(orgId).catch(() => []) : Promise.resolve([])]);
    return { ok: true, jobs, blocks };
  } catch {
    return { ok: false };
  }
}
