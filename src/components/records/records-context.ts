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
  /** The jobs it was opened among, in the order the door showed them, so
      the card can step to the next (Next job, J and K). */
  list?: readonly string[];
};

export type RecordsApi = {
  /** Open a record over the screen you are on. */
  open: (ref: RecordRef, opts?: OpenRecordOptions) => void;
  /** True inside a record host. A door outside one falls back to a link. */
  hosted: boolean;
  /** Let every card go, the dock's and the recent list with them. Switching
      workspace calls it: one workspace's jobs never wait in another's. */
  forget?: () => void;
};

export const RecordsContext = createContext<RecordsApi | null>(null);

/* WHAT THE HOST HOLDS, for what draws it: the cards (record-windows) and the
   dock the frame carries (record-dock). Here rather than in the host, so the
   frame's dock reads it without the host's server action. */

/** How many cards wait in the dock at once. */
export const DOCK_MAX = 3;

/** How many jobs the palette lists as recent. */
export const RECENT_MAX = 5;

/** A job opened lately, as the palette lists it. */
export type RecentRecord = { id: string; number: string | null; clientName: string | null };

export type Win = {
  key: string;
  /** The screen it was opened over. The card in front is drawn only there:
      going somewhere else closes it (see above). */
  path: string;
  ref: RecordRef;
  row: AllJobRow;
  state: ScheduleJobState | null;
  tab: JobSheetTab | undefined;
  from: HTMLElement | null;
  /** What a booking door came for — Book in, or a leftover's Clear — and
      the ask that brought it, so the card opens afresh on it. */
  door: { bookIn: boolean; clear: string | null; n: number } | null;
  /** The jobs it was opened among, in order, for Next job. */
  list: readonly string[] | null;
  /** Waiting in the dock rather than in front. */
  aside: boolean;
};

export type WindowsApi = {
  /** Every card the host holds — the one in front and the ones set aside —
      in the order they were first opened. A card keeps its place while it
      is held, so it keeps its state between the two. */
  windows: readonly Win[];
  /** This host has a dock to set a card aside into. */
  docked: boolean;
  close: (key: string) => void;
  /** Close the card in front without touching the address: the next move
      writes its own. The dock stays. */
  dismiss: () => void;
  /** Into the dock. */
  setAside: (key: string) => void;
  /** Out of the dock, in front, over the screen you are on. */
  restore: (key: string) => void;
  /** The job after (1) or before (-1) this card's in the list it was opened
      from; null at either end, or with no list. */
  stepOf: (key: string, by: 1 | -1) => string | null;
  /** The jobs opened lately, newest first, for the palette. Kept for the
      visit only: a reload starts it again. */
  recent: readonly RecentRecord[];
  /** Open that job in this card's place. */
  step: (key: string, by: 1 | -1) => void;
  toast: (words: string) => void;
};

export const WindowsContext = createContext<WindowsApi | null>(null);

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
