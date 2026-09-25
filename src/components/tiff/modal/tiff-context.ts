"use client";

import { createContext, useContext, useEffect } from "react";
import type { TiffRoom } from "@/lib/workboard/note-turns";

/* WHAT A TIFF BUTTON NEEDS TO KNOW ABOUT THE MODAL, and nothing heavier.

   Kept apart from the host (./tiff-host) because the top bar reports into
   it and every Tiff button reads it, and neither should carry the modal and
   its server actions along just to ask whether it is on. */

export type TiffOpen = {
  /** The button pressed. The modal grows from it and gives focus back to it. */
  from: HTMLElement;
  /** Where focus goes back to instead, when the button pressed will not be
      there: Sort it out takes the words out of the box, and the box's
      buttons go with them, so focus goes back to the box. */
  back?: HTMLElement;
  /** Words already typed ("Sort it out"): the first turn, sent at once. */
  words?: string;
  /** Where the words were said, a hint for the router. */
  room?: TiffRoom;
  /** Which button, so it alone reads as expanded. */
  id?: string;
  /** Pressed from the keyboard: it opens where it sits and nothing flies
      from the button (law 8). Tiff's thinking still takes its time: that is
      state, not the press. */
  keyboard?: boolean;
};

/** What the last conversation filed: the notes, and the rows with ids. */
export type TiffLanded = { noteIds: string[]; ids: string[] };

export type TiffApi = {
  /** HOME_DESK gives this viewer the modal. */
  enabled: boolean;
  /** Open a conversation. False when one is already open or it is off. */
  open: (o: TiffOpen) => boolean;
  /** The id of the button that opened the one that is open. */
  openedBy: string | null;
  isOpen: boolean;
  /** What the last conversation filed, for about two seconds after it
      closed, so the place underneath can light what arrived. */
  landed: TiffLanded | null;
  /** The top bar's report. */
  report: (on: boolean) => void;
};

export const TiffContext = createContext<TiffApi>({
  enabled: false,
  open: () => false,
  openedBy: null,
  isOpen: false,
  landed: null,
  report: () => {},
});

export const useTiff = () => useContext(TiffContext);

/** The top bar's report: this viewer gets the modal, or does not. Called
    where the answer is known — the top bar's server slot asks `deskOn`. */
export function useTiffModalSwitch(on: boolean): void {
  const { report } = useTiff();
  useEffect(() => {
    report(on);
    return () => report(false);
  }, [on, report]);
}
