"use client";

import { createContext, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { JobSheetTab } from "@/components/workboard/board/job-sheet";
import type { ScheduleJobState } from "@/components/workboard/board/schedule-tab";
import type { AllJobRow } from "@/lib/workboard/all-jobs";
import { jobHref } from "@/lib/shell/links";
import type { RecordRef } from "@/lib/records/ref";

/* WHAT A DOOR NEEDS TO OPEN A RECORD, and nothing heavier.

   Kept apart from the host (./record-host) the way Tiff's context is kept
   apart from its modal: every door reads this, and none should carry the
   card and its server actions along just to open it. */

export type OpenRecordOptions = {
  /** The row the door already holds. Without it the host asks the mirror
      for the row the board's own builder makes (`openMirrorJob`). */
  row?: AllJobRow;
  /** What today's schedule says the job is doing — only when a booking
      opened it, so the card's header says what the day drew. */
  state?: ScheduleJobState | null;
  /** The face to open on, for a door that knows what it came for. */
  tab?: JobSheetTab;
  /** Where focus goes back to on close. The element that has focus when the
      record is asked for, unless the door says otherwise. */
  from?: HTMLElement | null;
  /** Open on the Visits face with Book in's panel open. */
  bookIn?: true;
  /** Open on the Visits face with this leftover booking's Clear asked (an
      activity uuid). */
  clear?: string;
};

export type RecordsApi = {
  /** Open a record over the screen you are on. */
  open: (ref: RecordRef, opts?: OpenRecordOptions) => void;
  /** True inside a record host. A door outside one falls back to a link. */
  hosted: boolean;
};

export const RecordsContext = createContext<RecordsApi | null>(null);

/** The record host's door. Outside a host — a page drawn on its own in a
    test, or a route outside the dashboard frame — it falls back to the
    record's link, so a door is never dead. */
export function useRecords(): RecordsApi {
  const host = useContext(RecordsContext);
  const router = useRouter();
  return useMemo<RecordsApi>(
    () =>
      host ?? {
        hosted: false,
        open: (ref, opts) => {
          const face = opts?.tab ? `&face=${encodeURIComponent(opts.tab)}` : "";
          router.push(`${jobHref(ref.id)}${face}`);
        },
      },
    [host, router],
  );
}
