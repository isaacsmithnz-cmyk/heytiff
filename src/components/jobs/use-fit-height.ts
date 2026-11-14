"use client";

import { useLayoutEffect, useRef, useState } from "react";

/* A JOB'S TAB FITS THE SCREEN (Isaac, 14 November 2026: "Only scroll inside
   the cards"; call 11, "the cards stop shrinking at 420 high, then the page
   scrolls"). The height the tab's cards may take: from the tab's top to the
   foot of the page's scroller, less the page's own margin there, and never
   under the floor. Below the floor the page scrolls, and the job's head
   scrolls with it.

   Measured, not written into the sheet as a sum, because what stands over
   the tab changes its height: a description that wraps, a client's name on
   three lines, Make it a work order asked under the head. It is measured
   again whenever the scroller or the page under it changes size. A tab
   that's hidden is not measured; it is when it shows. */

/** The least a fitted card is ever drawn, in px. */
export const FIT_FLOOR = 420;
/** The page's margin under the cards, in px: the wrap's own, on a fitted tab. */
export const FIT_FOOT = 16;

export function fitHeight(scrollerHeight: number, offsetTop: number, floor = FIT_FLOOR, foot = FIT_FOOT): number {
  return Math.max(floor, Math.floor(scrollerHeight - offsetTop - foot));
}

export function useFitHeight<T extends HTMLElement>(floor = FIT_FLOOR) {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = el.closest<HTMLElement>(".outlet") ?? (document.scrollingElement as HTMLElement | null);
    if (!scroller) return;
    const measure = () => {
      if (el.offsetParent === null && el.getClientRects().length === 0) return;
      const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      setHeight(fitHeight(scroller.clientHeight, offset, floor));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const seen = new ResizeObserver(measure);
    seen.observe(scroller);
    const page = el.closest<HTMLElement>(".wrap") ?? el.parentElement;
    if (page) seen.observe(page);
    return () => seen.disconnect();
  }, [floor]);
  return [ref, height] as const;
}
