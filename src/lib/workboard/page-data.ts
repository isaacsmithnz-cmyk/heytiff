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
import { ensureMirrorClaims } from "./claim-mirror";
import { getSm8Timezone } from "./query";

export type WorkboardConnection = "none" | "connected" | "attention";

export type WorkboardData = {
  manage: boolean;
  /* Whether money may be SHOWN — capability `workboard_money`, owner-tier.
     It is not a styling flag: when false the loaders below never select a
     budget, a variation or a claim, so there is no money in this payload to
     leak through a component that forgot to check. The screens then render
     nothing money-shaped, which is different from rendering "not set". */
  moneyVisible: boolean;
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
  const moneyVisible = await can("workboard_money");
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
      loadProjectsBoard(orgId, today, { includeMoney: moneyVisible }),
    ]);
    return {
      manage,
      moneyVisible,
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

  /* Behind the response: top the visit horizon up, let a linked job that
     completed in ServiceM8 mark its visit done, then bring each linked job's
     invoice across as a project claim. All bounded, all idempotent — the board
     reads what's there NOW and is right next paint.

     The claim tail runs on the CONNECTED path only. Standalone has no mirror
     to read, and the absence is what lets mirrored claims sit still as cached
     history after a disconnect instead of being cleared by an empty mirror. It
     also runs regardless of who is looking: keeping the books current is not
     the same question as who may see them. */
  after(() =>
    ensureVisits(orgId, { today })
      .then(() => autoCompleteVisitsFromMirror(orgId))
      .then(() => ensureMirrorClaims(orgId, today))
      .catch(() => {})
  );

  const [flags, board, projectsBoard, sync] = await Promise.all([
    listFlags(orgId),
    loadMaintenanceBoard(orgId, today),
    loadProjectsBoard(orgId, today, { includeMoney: moneyVisible }),
    listSm8SyncStatus(orgId),
  ]);

  // Looking at the board counts as looking — top the mirrors up behind the
  // response when they've gone stale. orgId is closed over; nothing inside
  // the after() callback touches request APIs (Server Component rule).
  await kickSm8SyncIfStale(orgId);

  return {
    manage,
    moneyVisible,
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
