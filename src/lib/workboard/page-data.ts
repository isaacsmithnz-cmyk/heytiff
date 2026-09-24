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
import {
  kickSm8SyncIfStale,
  listSm8SyncStatus,
  type Sm8SyncStatusView,
} from "@/lib/integrations/sm8-sync";
import { kickSm8WritesIfDue } from "@/lib/integrations/sm8-writes";
import { todayInZone } from "./dates";
import { listFlags, type BoardFlag } from "./notes-query";
import { loadMaintenanceBoard, type MaintenanceBoardData } from "./board-query";
import { loadProjectsBoard, type ProjectsBoardData } from "./projects-board-query";
import { autoCompleteVisitsFromMirror, ensureVisits } from "./visit-ensure";
import { ensureMirrorClaims } from "./claim-mirror";
import { EMPTY_ALL_JOBS, loadAllJobs, readMirrorJobRow, type AllJobsData } from "./all-jobs-query";
import type { AllJobsMirrorJob } from "./all-jobs";
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
  /* The whole book of ServiceM8 jobs — the third side. Empty when standalone,
     where the side still works off native rows alone. */
  allJobs: AllJobsData;
  /** ANTHROPIC_API_KEY is set — Tiff's analyse-a-job offer renders. */
  aiEnabled: boolean;
  synced: { finishedAt: string | null; running: boolean } | null;
  /* Whether a mirror is still on its FIRST walk, per surface. Not one flag:
     `jobs` finishes long before `job_activities`, and a board that kept
     saying "still syncing" until the slowest object landed would be lying to
     an account whose job list is already complete.

     Only `backfill_done` can answer this. A row count can't — zero rows is
     what "not started" and "genuinely empty" both look like — and neither can
     `running`, which says a sweep is in flight, not that the account has
     never been fully read. Both false when standalone: nothing is syncing
     because nothing is connected, and the empty boards say THAT instead. */
  backfilling: { jobs: boolean; schedule: boolean };
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

  /* NEEDS-REAUTH IS NOT DISCONNECTED. This read `!== "connected"`, so a grant
     waiting to be signed in again dropped the entire book of work: the boards
     went to the standalone shape and every empty list told the reader to
     "Connect ServiceM8", under a chip saying ServiceM8 needed attention. The
     mirror is a table in our own database and is still whole — what has
     expired is the ability to REFRESH it. So the board reads exactly as
     before, the chip carries the warning, and only the sync is skipped. */
  if (connection === "none") {
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
      // No mirror to read. All jobs still works — it falls back to the native
      // rows, which is the whole book when there's no integration.
      allJobs: EMPTY_ALL_JOBS,
      aiEnabled: !!process.env.ANTHROPIC_API_KEY,
      synced: null,
      backfilling: { jobs: false, schedule: false },
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

  const [flags, board, projectsBoard, allJobs, sync] = await Promise.all([
    listFlags(orgId),
    loadMaintenanceBoard(orgId, today),
    loadProjectsBoard(orgId, today, { includeMoney: moneyVisible }),
    loadAllJobs(orgId, today, { includeMoney: moneyVisible }),
    listSm8SyncStatus(orgId),
  ]);

  // Looking at the board counts as looking — top the mirrors up behind the
  // response when they've gone stale. orgId is closed over; nothing inside
  // the after() callback touches request APIs (Server Component rule).
  // a grant that needs signing in again cannot sync; asking it to would only
   // burn the attempt and log a failure nobody reads
  if (connection === "connected") {
    await kickSm8SyncIfStale(orgId);
    /* and send what is waiting to go the other way — a file whose first
       send hit a busy ServiceM8 goes the next time anyone looks */
    await kickSm8WritesIfDue(orgId);
  }

  return {
    manage,
    moneyVisible,
    connection,
    timezone,
    today,
    flags,
    board,
    projectsBoard,
    allJobs,
    aiEnabled: !!process.env.ANTHROPIC_API_KEY,
    synced: sync.lastRun
      ? { finishedAt: sync.lastRun.finishedAt, running: sync.lastRun.running }
      : { finishedAt: null, running: false },
    backfilling: {
      jobs: !backfillDone(sync, "jobs"),
      schedule: !backfillDone(sync, "job_activities"),
    },
  };
}

/** Has this object finished its first full walk? A MISSING state row counts
    as unfinished, not as done: the row is written by the first run that
    touches the object, so its absence means the object has never been walked
    at all — exactly the account this flag exists to speak for. */
function backfillDone(sync: Sm8SyncStatusView, object: string): boolean {
  return sync.objects.find((o) => o.object === object)?.backfillDone ?? false;
}

/** The job a `?job=` link names: from the book this load already holds, else
    from the whole mirror — the palette finds jobs finished long before the
    board's 56-day window, and a link to one of those has to open it too.
    The id is a CHOICE from a URL, so the read is scoped to the session's own
    org and the money rule this load already decided; a job the org does not
    hold answers null and the page simply lands on the board. */
export async function loadLinkedJob(
  data: WorkboardData,
  remoteId: string
): Promise<AllJobsMirrorJob | null> {
  const held = data.allJobs.jobs.find((j) => j.remoteId === remoteId);
  if (held) return held;
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const id = remoteId.trim().slice(0, 80);
  if (!orgId || !id) return null;
  return readMirrorJobRow(orgId, id, data.today, { includeMoney: data.moneyVisible });
}
