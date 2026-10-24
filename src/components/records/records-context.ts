"use client";

import { createContext, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { JobSheetTab } from "@/components/workboard/board/job-sheet";
import type { AgreementCard, VisitCard } from "@/lib/workboard/maintenance-cards";
import { jobHref } from "@/lib/shell/links";
import { recordHref, type RecordRef } from "@/lib/records/ref";

/* WHAT A DOOR NEEDS TO OPEN A RECORD, and nothing heavier.

   Kept apart from the host (./record-host) the way Tiff's context is kept
   apart from its modal: every door reads this, and none should carry the
   card and its server actions along just to open it. */

export type OpenRecordOptions = {
  /** A job's section to open on, for a door that knows what it came for. */
  tab?: JobSheetTab;
  /** Where focus goes back to on close. The element that has focus when the
      record is asked for, unless the door says otherwise. */
  from?: HTMLElement | null;
};

export type RecordsApi = {
  /** Open a record: a visit or an agreement over the screen you are on, a
      job on its own page (the card over the screen went, 24 October 2026). */
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

/** How many records the palette lists as recent. */
export const RECENT_MAX = 5;

/** A record opened lately, as the palette lists it. */
export type RecentRecord = { key: string; ref: RecordRef; title: string; sub: string | null };

/** A maintenance visit's card, or its service agreement's, as the board
    would hand its sheet (lib/workboard/maintenance-cards). */
export type VisitBody = { kind: "visit"; card: VisitCard };
export type AgreementBody = { kind: "agreement"; card: AgreementCard };

export type WinBody = VisitBody | AgreementBody;

export type Win = {
  key: string;
  /** The screen it was opened over. The card in front is drawn only there:
      going somewhere else closes it (see above). */
  path: string;
  ref: RecordRef;
  from: HTMLElement | null;
  /** Waiting in the dock rather than in front. */
  aside: boolean;
  /** What the card draws. */
  body: WinBody;
};

/** What a card is called where it is not open — the dock, the palette's
    heading over its verbs, the recent list: a visit and an agreement by
    their own name, each with its client. */
export function titleOf(body: WinBody): { title: string; sub: string | null } {
  if (body.kind === "visit") return { title: body.card.visit.label, sub: body.card.visit.clientName };
  return { title: body.card.agreement.label, sub: body.card.agreement.clientName };
}

export type WindowsApi = {
  /** Every card the host holds — the one in front and the ones set aside —
      in the order they were first opened. A card keeps its place while it
      is held, so it keeps its state between the two. */
  windows: readonly Win[];
  /** This host has a dock to set a card aside into. */
  docked: boolean;
  close: (key: string) => void;
  /** Into the dock. */
  setAside: (key: string) => void;
  /** Out of the dock, in front, over the screen you are on. */
  restore: (key: string) => void;
  /** The records opened lately (a job's page among them), newest first,
      for the palette. Kept for the
      visit only: a reload starts it again. */
  recent: readonly RecentRecord[];
  /** A record opened as a page of its own (a job's page, v2 step 5) joins
      the recent list, as one opened here does. */
  remember?: (r: RecentRecord) => void;
  /** Read a card again after a press on it changed it (a visit's, an
      agreement's: their sheets are drawn from what was read). */
  reload: (key: string) => void;
  toast: (words: string, undo?: () => void | Promise<void>) => void;
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
        open: (ref, opts) => router.push(ref.kind === "job" ? jobHref(ref.id, opts?.tab) : recordHref(ref)),
      },
    [host, router],
  );
}
