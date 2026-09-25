"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/* EACH PART OF THE TIFF MODAL MOVES BY ITS OWN BOX.

   The modal is never given a height. A turn arriving, the dock folding away
   while Tiff thinks, the face zone closing once she answers: each part opens
   or closes by its OWN height, margin and padding, and the modal follows it
   frame by frame. That was the lesson of the prototype's film (Isaac,
   2026-09-24, "fix the animation … it looks bad"): whole-modal height morphs
   fought each other, and a `gap` appeared whole the moment a turn was shown,
   where a margin can open with it.

   Web Animations, not classes, because the start of a close is the part's
   measured box — a number only the page knows. `--t-move` and ease-out, the
   two motion tokens, read off the page so a retuned token retunes this.

   UNDER REDUCED MOTION NOTHING TRAVELS: a part is simply there, or gone. */

/** Reduced motion, asked when something happens — never in render. */
export function prefersStill(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** A motion token in ms, read off the page, with the design's own value
    when the page cannot say (a test, a stylesheet not loaded yet). */
export function tokenMs(name: "--t-move" | "--t-fast", fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const ms = raw.endsWith("ms") ? parseFloat(raw) : raw.endsWith("s") ? parseFloat(raw) * 1000 : NaN;
  return Number.isFinite(ms) && ms > 0 ? ms : fallback;
}

export const MOVE_MS = 200;
export const EASE = "ease-out";

/** Whether this element can be animated at all (jsdom cannot). */
export const canAnimate = (el: Element | null): el is HTMLElement =>
  !!el && typeof (el as HTMLElement).animate === "function";

/** The parts of a box a part opens and closes by. */
type Box = Record<"height" | "marginTop" | "paddingTop" | "paddingBottom", string>;
const SHUT: Box = { height: "0px", marginTop: "0px", paddingTop: "0px", paddingBottom: "0px" };

function boxOf(el: HTMLElement): Box {
  const cs = getComputedStyle(el);
  return { height: cs.height, marginTop: cs.marginTop, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom };
}

/** Stop whatever is running on this element first: a `fill: forwards` fade
    left on an element outlives a later fade-in on the same element, and the
    element stays invisible (the prototype's `calm`). */
function calm(el: HTMLElement) {
  for (const a of el.getAnimations?.() ?? []) a.cancel();
}

/** Open or close `el` by its own box. Resolves when it has finished — at once
    where nothing can move. */
export function moveBox(el: HTMLElement | null, dir: "open" | "close"): Promise<void> {
  if (!canAnimate(el) || prefersStill()) return Promise.resolve();
  calm(el);
  const box = boxOf(el);
  const was = el.style.overflow;
  el.style.overflow = "hidden";
  const frames: Keyframe[] =
    dir === "open"
      ? [{ opacity: 0, ...SHUT }, { opacity: 1, ...box }]
      : [{ opacity: 1, ...box }, { opacity: 0, ...SHUT }];
  const run = el.animate(frames, {
    duration: tokenMs("--t-move", MOVE_MS),
    easing: EASE,
    fill: dir === "open" ? "backwards" : "forwards",
  });
  return run.finished.then(
    () => {
      el.style.overflow = was;
    },
    () => {
      el.style.overflow = was;
    }
  );
}

/**
 * Keep a part on the page long enough to leave, and grow it in when it comes.
 *
 * `shown` is whether the part should be there. It is rendered while it is
 * shown and for as long as its close is running; the close is measured off
 * its real box. A part mounted already shown does not grow unless it says
 * `appear` — the modal's own entrance covers everything it opens with.
 *
 * THE CHANGE IS ANSWERED IN RENDER, the way `useDotFieldExit` answers its
 * own: showing a part mounts it in the same render, and only the timer-like
 * part — the animation finishing — sets state from outside.
 */
export function useBoxMotion(
  ref: RefObject<HTMLElement | null>,
  shown: boolean,
  appear = false
): boolean {
  const [seen, setSeen] = useState(shown);
  const [present, setPresent] = useState(shown);
  if (shown !== seen) {
    setSeen(shown);
    if (shown) setPresent(true);
  }

  const first = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    const mounting = first.current;
    first.current = false;
    if (shown) {
      if (!mounting || appear) void moveBox(el, "open");
      return;
    }
    if (mounting) return;
    let live = true;
    void moveBox(el, "close").then(() => {
      if (live) setPresent(false);
    });
    return () => {
      live = false;
    };
  }, [ref, shown, appear]);

  return shown || present;
}

/**
 * A part whose content grows it — your words arriving line by line — grows
 * into the new line rather than jumping to it.
 */
export function useGrow(ref: RefObject<HTMLElement | null>, content: string): void {
  const last = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const was = last.current;
    last.current = h;
    if (was === null || Math.abs(h - was) < 1 || !canAnimate(el) || prefersStill()) return;
    el.animate([{ height: `${was}px` }, { height: `${h}px` }], {
      duration: tokenMs("--t-move", MOVE_MS),
      easing: EASE,
    });
  }, [ref, content]);
}
