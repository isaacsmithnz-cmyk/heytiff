"use client";

import { createContext, useContext } from "react";
import type { EarlierTurn, TiffRoom } from "@/lib/workboard/note-turns";

/* WHAT A TIFF BUTTON NEEDS TO KNOW ABOUT THE MODAL, and nothing heavier.

   Kept apart from the host (./tiff-host) because every Tiff button reads
   it, and none should carry the modal and its server actions along just to
   open it.

   IT IS ON WHEREVER THERE IS A HOST. Until the new Home was everyone's
   (2026-09-26) the top bar asked the HOME_DESK switch and reported whether
   this viewer got the modal, and everyone it left out kept the capture
   sheet. The switch went with the old Home, and so did the report: the
   host is on for everyone it is mounted for, which is every screen in the
   dashboard's frame. */

export type TiffOpen = {
  /** The button pressed. The modal grows from it and gives focus back to it. */
  from: HTMLElement;
  /** Where focus goes back to instead, when the button pressed will not be
      there: Sort it out takes the words out of the box, and the box's
      buttons go with them, so focus goes back to the box. */
  back?: HTMLElement;
  /** Words already typed ("Sort it out"): the first turn, sent at once. */
  words?: string;
  /** A conversation already had — a diary entry's, opened from Tiff's line
      under it. Its turns are there when the modal opens, it opens on the
      reply box rather than listening (a door to what was said, not a Tiff
      button), and what you say next is read by them. */
  conversation?: readonly EarlierTurn[];
  /** Where the words were said, a hint for the router. */
  room?: TiffRoom;
  /** The day what is said is for, ISO, when the words name none: the
      Calendar's box adds to a day and says which ("Add to Thu 1 Oct…"), so
      a line for the calendar that names no day goes on it rather than Tiff
      asking "Which day?" (app/actions/calendar `fileCalendarLine`). */
  day?: string;
  /** Which button, so it alone reads as expanded. */
  id?: string;
  /** Pressed from the keyboard: it opens where it sits and nothing flies
      from the button (law 8). Tiff's thinking still takes its time: that is
      state, not the press. */
  keyboard?: boolean;
};

/** What the last conversation filed: the notes, and the rows with ids. */
export type TiffLanded = {
  noteIds: string[];
  ids: string[];
  /** The room it was had in, as it opened (the host's to say; the
      conversation does not know). Words said to the Calendar land on the
      Calendar, so nothing brings the Diary forward over it for them. */
  room?: TiffRoom;
  /** The keyboard drove it: opened with a key, or closed with one (Escape,
      or × pressed from the keyboard). Whatever the page brings forward for
      it is simply there, with no slide (law 8). The host's to say. */
  keyboard?: boolean;
};

export type TiffApi = {
  /** A host is mounted to open the modal: always, inside the dashboard's
      frame. False only from the default below — a Tiff button drawn with no
      host round it, which still opens the capture sheet until that goes. */
  enabled: boolean;
  /** Open a conversation. False when one is already open, or when there is
      no host to open it. */
  open: (o: TiffOpen) => boolean;
  /** The id of the button that opened the one that is open. */
  openedBy: string | null;
  isOpen: boolean;
  /** What the last conversation filed, for about two seconds after it
      closed, so the place underneath can light what arrived. */
  landed: TiffLanded | null;
};

export const TiffContext = createContext<TiffApi>({
  enabled: false,
  open: () => false,
  openedBy: null,
  isOpen: false,
  landed: null,
});

export const useTiff = () => useContext(TiffContext);
