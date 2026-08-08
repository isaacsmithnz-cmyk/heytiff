/* What the Workboard loads, decided once — the fleet page-data pattern.

   The page gates with can("workboard") BEFORE calling this (route-gate test
   pins that door); this module decides which queries run. Standalone-first:
   with no ServiceM8 connection the board still loads and says so — the
   SM8-derived strips are simply absent, the way the fleet register is absent
   without assets_all. `manage` rides along so the screens can offer what the
   server will actually allow. */

import { after } from "next/server";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { getConnectionView } from "@/lib/integrations/store";
import { kickSm8SyncIfStale, listSm8SyncStatus } from "@/lib/integrations/sm8-sync";
import { todayInZone } from "./dates";
import { listFlags, type BoardFlag } from "./notes-query";
import { loadMaintenanceBoard, type MaintenanceBoardData } from "./board-query";
import { loadProjectsBoard, type ProjectsBoardData } from "./projects-board-query";
import { autoCompleteVisitsFromMirror, ensureVisits } from "./visit-ensure";
import { getSm8Timezone } from "./query";

export type WorkboardConnection = "none" | "connected" | "attention";

export type WorkboardData = {
  manage: boolean;
  connection: WorkboardConnection;
  /** The account's IANA zone once known — the clock the board buckets on. */
  timezone: string | null;
  today: string;
  /** Raised by notes, pulsing until somebody clears them. */
  flags: BoardFlag[];
  /** The redesigned maintenance board's whole dataset. */
  board: MaintenanceBoardData;
  /** The redesigned projects board's whole dataset. */
  projectsBoard: ProjectsBoardData;
  /** ANTHROPIC_API_KEY is set — Tiff's analyse-a-job offer renders. */
  aiEnabled: boolean;
  synced: { finishedAt: string | null; running: boolean } | null;
};

export async function loadWorkboardPage(): Promise<WorkboardData | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) return null;

  const manage = await can("workboard_manage");
  const view = await getConnectionView(orgId, "servicem8");
  const connection: WorkboardConnection =
    view === null ? "none" : view.status === "connected" ? "connected" : "attention";

  if (connection !== "connected") {
    // Standalone-first: projects and the maintenance radar are native rows
    // and load regardless. The visit horizon still tops itself up — behind
    // the response, so the board never waits on generation.
    const today = todayInZone(null);
    after(() => ensureVisits(orgId, { today }).catch(() => {}));
    const [flags, board, projectsBoard] = await Promise.all([
      listFlags(orgId),
      loadMaintenanceBoard(orgId, today),
      loadProjectsBoard(orgId, today),
    ]);
    return {
      manage,
      connection,
      timezone: null,
      today,
      flags,
      board,
      projectsBoard,
      aiEnabled: !!process.env.ANTHROPIC_API_KEY,
      synced: null,
    };
  }

  const timezone = await getSm8Timezone(orgId);
  const today = todayInZone(timezone);

  // Behind the response: top the visit horizon up, then let a linked job
  // that completed in ServiceM8 mark its visit done. Both bounded, both
  // idempotent — the board reads what's there NOW and is right next paint.
  after(() =>
    ensureVisits(orgId, { today })
      .then(() => autoCompleteVisitsFromMirror(orgId))
      .catch(() => {})
  );

  const [flags, board, projectsBoard, sync] = await Promise.all([
    listFlags(orgId),
    loadMaintenanceBoard(orgId, today),
    loadProjectsBoard(orgId, today),
    listSm8SyncStatus(orgId),
  ]);

  // Looking at the board counts as looking — top the mirrors up behind the
  // response when they've gone stale. orgId is closed over; nothing inside
  // the after() callback touches request APIs (Server Component rule).
  await kickSm8SyncIfStale(orgId);

  return {
    manage,
    connection,
    timezone,
    today,
    flags,
    board,
    projectsBoard,
    aiEnabled: !!process.env.ANTHROPIC_API_KEY,
    synced: sync.lastRun
      ? { finishedAt: sync.lastRun.finishedAt, running: sync.lastRun.running }
      : { finishedAt: null, running: false },
  };
}
