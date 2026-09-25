"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { openMirrorJob } from "@/app/actions/workboard";
import { JobSheet, type JobSheetTab } from "@/components/workboard/board/job-sheet";
import type { ScheduleJobState } from "@/components/workboard/board/schedule-tab";
import { ToastHost, useBoardToasts } from "@/components/workboard/board/toasts";
import type { AllJobRow } from "@/lib/workboard/all-jobs";

/* ONE JOB CARD FOR THE WHOLE OF THE NEW HOME.

   Four things on this Home open a job: a booking on the day, a row in the
   list, a mention in the diary, a task's Job. Each was going to host a
   sheet of its own, and two sheets mounted side by side is two cards open
   at once. So there is one host, above everything on the page, and every
   door calls it: `openJob(row)` with the row it holds, or `openJob(uuid)`
   for a door that knows the job and not its row — the mirror is asked for
   the row the board's own builder makes (`openMirrorJob`), so the card is
   the same card whichever way it was reached.

   The card is the board's own, on the same row and wearing the day-state a
   booking wore; its agreement door lands on the board with the job open
   (`?job=`), where the modal it needs lives. Closing it puts focus back
   where the press came from. */

export type OpenJobOptions = {
  /** What today's schedule says the job is doing — only when a booking
      opened it, so the card's header says what the day drew. */
  state?: ScheduleJobState | null;
  /** The face to open on, for a door that knows what it came for. */
  tab?: JobSheetTab;
  /** Where focus goes back to on close. The element that has focus when
      the card is asked for, unless the door says otherwise. */
  from?: HTMLElement | null;
};

export type DeskJobs = {
  openJob: (job: AllJobRow | string, opts?: OpenJobOptions) => void;
};

const DeskJobsContext = createContext<DeskJobs | null>(null);

/** The desk's one card. Only inside `DeskJobHost`. */
export function useDeskJobs(): DeskJobs {
  const jobs = useContext(DeskJobsContext);
  if (!jobs) throw new Error("useDeskJobs is only for the new Home, inside its DeskJobHost");
  return jobs;
}

type Open = {
  row: AllJobRow;
  state: ScheduleJobState | null;
  tab: JobSheetTab | undefined;
  from: HTMLElement | null;
};

/** The element that has focus now, when it is something focus can go back
    to — not the page itself. */
function focused(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

export function DeskJobHost({
  manage,
  moneyVisible,
  children,
}: {
  /** The board's own answers, read by the loader from the same capabilities,
      so the card offers here exactly what it offers there. */
  manage: boolean;
  moneyVisible: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Open | null>(null);
  const { toasts, toast, dismiss } = useBoardToasts();
  /* THE LAST ASK WINS. A card asked for by uuid waits on the mirror; a
     second ask, or a close, while it waits makes that answer stale, and a
     stale answer must not open a card over whatever came after it. */
  const asked = useRef(0);

  const openJob = useCallback(
    (job: AllJobRow | string, opts: OpenJobOptions = {}) => {
      const n = ++asked.current;
      const from = opts.from !== undefined ? opts.from : focused();
      const land = (row: AllJobRow) =>
        setOpen({ row, state: opts.state ?? null, tab: opts.tab, from });
      if (typeof job !== "string") {
        land(job);
        return;
      }
      void openMirrorJob(job).then(
        (row) => {
          if (n !== asked.current) return;
          if (row) land(row);
          else toast("That job isn't in ServiceM8's copy any more.");
        },
        () => {
          if (n === asked.current) toast("Could not open that job");
        },
      );
    },
    [toast],
  );

  const close = () => {
    asked.current += 1;
    const from = open?.from;
    setOpen(null);
    if (from?.isConnected) from.focus();
  };

  const value = useMemo<DeskJobs>(() => ({ openJob }), [openJob]);

  return (
    <DeskJobsContext.Provider value={value}>
      {children}
      {/* Portalled to <body> by the sheet itself. Keyed by the job, so a
          second job is a new card rather than the old one refilling. No
          mirror-health chip: Home does not carry the sync clock, and the
          card says "Open in ServiceM8" in its place. */}
      {open && (
        <JobSheet
          key={open.row.id}
          row={open.row}
          manage={manage}
          moneyVisible={moneyVisible}
          scheduleState={open.state}
          initialTab={open.tab}
          onClose={close}
          onCreateAgreement={(row) => {
            setOpen(null);
            router.push(`/dashboard/workboard?job=${encodeURIComponent(row.id)}`);
          }}
          onOpenTracked={(t) => {
            setOpen(null);
            router.push(
              t.kind === "project" ? `/dashboard/workboard/projects/${t.id}` : "/dashboard/workboard",
            );
          }}
          onToast={(m) => toast(m)}
        />
      )}
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </DeskJobsContext.Provider>
  );
}
