"use client";

import { useEffect, useEffectEvent, useRef, type MouseEvent as ReactMouseEvent } from "react";

/* A DOUBLE-CLICK OPENS THE JOB ITS FIRST CLICK CHOSE.

   On the rail and in the capacity day a click brings a job forward, and the
   sheet is the second step; a double-click is both steps in one motion. But
   the first click MOVES the board before the second arrives. On the rail,
   bringing a job forward opens the inspector, the inspector takes 400px off
   the rail, and the hours share what is left — so every block after the
   day's first hour slides left, a 3pm block at 1440 by more than its own
   width. In the capacity day the row doesn't slide, it goes: the job's card
   takes the day's place. Either way the second click lands on whatever is
   under the pointer by then — another job, an empty lane, the panel's own
   buttons — and an ordinary dblclick handler would open the wrong job, or
   nothing.

   So the pair is read by its FIRST click. The card a pointer's first click
   lands on arms itself; the second click of that pair, wherever it lands,
   opens the armed job and does nothing else. It never selects the block that
   slid under it or presses the button that appeared there, and a third click
   in the same run — someone who clicked once and then double-clicked — is
   spent too, rather than landing on the sheet it just opened. A click that
   starts a new pair disarms.

   On the WINDOW, in the capture phase, because the second click has to be
   caught before anything under the pointer answers it — the sheet's scrim
   included, which is portalled outside this tab. */
export function useDoubleClickOpen(open: (id: string) => void) {
  const armed = useRef<string | null>(null);
  const openArmed = useEffectEvent((id: string) => open(id));

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      /* the second press of the pair must not select a word or take focus
         for whatever slid under it */
      if (e.detail >= 2 && armed.current) e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (e.detail < 2) {
        armed.current = null;
        return;
      }
      const id = armed.current;
      if (!id) return;
      e.stopPropagation();
      if (e.detail === 2) openArmed(id);
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("click", onClick, true);
    };
  }, []);

  /** Called from a card's own click. Only a pointer's FIRST click arms — a
      keyboard's click (detail 0) is never half of a pair. */
  return (id: string, e: ReactMouseEvent) => {
    if (e.detail === 1) armed.current = id;
  };
}
