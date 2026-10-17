"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/* WHERE A FLOATING PART STANDS: the menu and the time wheel's panel.

   Both portal to <body>, so they leave every `overflow:hidden` card and the
   shell's `will-change` behind, and stand `position:fixed` against the
   viewport. Below the trigger, flipped above it when there is no room
   there and more above; clamped inside the window either way. It is
   measured again on any scroll (capture, so a modal's body counts) and on
   resize, so it follows a trigger that moves.

   A trigger inside a dialog lifts the panel to the dialog's layer: at
   `--z-overlay` it would open behind the dialog it was opened from, and
   at the same layer it wins on being later in the page. */

const GAP = 4;
const EDGE = 8;

export type FloatAlign = "start" | "end";

type Place = { left: number; top?: number; bottom?: number; maxHeight: number; minWidth?: number; overModal: boolean };

function measure(anchor: HTMLElement, panel: HTMLElement, align: FloatAlign, matchWidth: boolean): Place {
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const minWidth = matchWidth ? r.width : undefined;
  const width = Math.max(panel.offsetWidth, minWidth ?? 0);
  const want = align === "end" ? r.right - width : r.left;
  const left = Math.max(EDGE, Math.min(want, vw - width - EDGE));
  /* scrollHeight is the panel's whole height, even while a max-height
     from the last measure is cutting it short */
  const height = panel.scrollHeight;
  const below = vh - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  const overModal = !!anchor.closest("[aria-modal='true'], [role='dialog'], dialog");
  if (height > below && above > below) {
    return { left, bottom: vh - r.top + GAP, maxHeight: Math.max(0, above), minWidth, overModal };
  }
  return { left, top: r.bottom + GAP, maxHeight: Math.max(0, below), minWidth, overModal };
}

/** The fixed position for `panel` against `anchor`, as a style, and whether
    it has to stand over a dialog. Hidden until the first measure, which
    lands before the first paint. */
export function useFloat(
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  { align = "start", matchWidth = false }: { align?: FloatAlign; matchWidth?: boolean } = {},
): { style: CSSProperties; overModal: boolean } {
  const [place, setPlace] = useState<Place | null>(null);

  useLayoutEffect(() => {
    const sync = () => {
      const a = anchor.current;
      const p = panel.current;
      if (a && p) setPlace(measure(a, p, align, matchWidth));
    };
    sync();
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [anchor, panel, align, matchWidth]);

  if (!place) return { style: { position: "fixed", left: 0, top: 0, visibility: "hidden" }, overModal: false };
  return {
    style: {
      position: "fixed",
      left: place.left,
      top: place.top,
      bottom: place.bottom,
      maxHeight: place.maxHeight,
      minWidth: place.minWidth,
    },
    overModal: place.overModal,
  };
}

/** A press anywhere but the panel and its trigger. The trigger is left
    out so pressing it again closes through its own click, not twice. */
export function useOutsidePress(
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  onOutside: () => void,
): void {
  const outside = useEffectEvent(onOutside);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      outside();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [anchor, panel]);
}
