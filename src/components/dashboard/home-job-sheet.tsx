"use client";

import { useContext, useMemo, type ReactNode } from "react";
import { PageRecordsProvider } from "@/components/records/record-host";
import { RecordWindows } from "@/components/records/record-windows";
import { RecordsContext, type OpenRecordOptions } from "@/components/records/records-context";
import type { AllJobRow } from "@/lib/workboard/all-jobs";

/* ONE JOB CARD FOR THE WHOLE OF THE NEW HOME.

   Four things on this Home open a job: a booking on the day, a row in the
   list, a mention in the diary, a task's Job. Each was going to host a
   sheet of its own, and two sheets mounted side by side is two cards open
   at once. So there is one host and every door calls it: `openJob(row)`
   with the row it holds, or `openJob(uuid)` for a door that knows the job
   and not its row — the mirror is asked for the row the board's own builder
   makes (`openMirrorJob`), so the card is the same card whichever way it
   was reached.

   THE HOST IS THE APP'S NOW (components/records/record-host). This grew
   into it: the dashboard layout mounts it above every screen, so ⌘K, Tiff
   and the bell open a job the way Home's doors always did — over the
   screen, nothing thrown away. Inside the frame this is only Home's name
   for that host's door. Drawn on its own (a test, or a page outside the
   frame) it brings a host of its own, with the grants it is handed.

   A DOOR THAT CAME TO BOOK OR TO CLEAR (two-way phase 3): the list's Book
   in opens the card on its Visits face with Book in's panel open, and a
   leftover booking's Clear with that booking's confirm. Still one card: a
   door like that is a fresh one even on the job already open, so what it
   came for is what the card opens on. */

export type OpenJobOptions = Omit<OpenRecordOptions, "row">;

export type DeskJobs = {
  openJob: (job: AllJobRow | string, opts?: OpenJobOptions) => void;
};

/** The desk's one card. Only inside `DeskJobHost`. */
export function useDeskJobs(): DeskJobs {
  const records = useContext(RecordsContext);
  if (!records) throw new Error("useDeskJobs is only for the new Home, inside its DeskJobHost");
  return useMemo<DeskJobs>(
    () => ({
      openJob: (job, opts = {}) =>
        typeof job === "string"
          ? records.open({ kind: "job", id: job }, opts)
          : records.open({ kind: "job", id: job.id }, { ...opts, row: job }),
    }),
    [records],
  );
}

export function DeskJobHost({
  manage,
  moneyVisible,
  children,
}: {
  /** The board's own answers, read by the loader from the same capabilities,
      so the card offers here exactly what it offers there. Used only when
      there is no frame round Home to host the card. */
  manage: boolean;
  moneyVisible: boolean;
  children: ReactNode;
}) {
  const framed = useContext(RecordsContext)?.hosted ?? false;
  if (framed) return <>{children}</>;
  return (
    <PageRecordsProvider>
      {children}
      <RecordWindows manage={manage} moneyVisible={moneyVisible} />
    </PageRecordsProvider>
  );
}
