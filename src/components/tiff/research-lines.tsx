"use client";

import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import {
  lineState,
  overlayVisible,
  pulseState,
  type ResearchViz,
} from "@/lib/tiff/research-viz";
import { KB_CATEGORIES, type KbCategoryKey } from "./kb";

/* The search lines: four beziers from the composer out to the four shelves,
   drawn under the conversation while Tiff is actually looking.

   THE GEOMETRY IS MEASURED, NOT DECLARED, exactly as the system map measures
   its wires (src/components/hq/system-map.tsx): every endpoint is a live
   `getBoundingClientRect()` taken relative to the stage's own rect, so the
   lines stay correct as the composer moves, the window resizes and the rail
   reflows — no hardcoded offsets to go stale. The SVG has NO viewBox on
   purpose: user units are CSS pixels, which is what the rects are in.

   WHAT MOVES, AND WHAT WE WATCH. A ResizeObserver on the stage catches the
   stage changing size. It does NOT catch the composer sliding down the column
   when the landing screen gives way to a transcript — that is a position
   change, not a size change, and no observer fires for one. Hence
   `measureKey`: the parent bumps it when the transcript grows.

   BELOW 1100px THERE ARE NO LINES. The stylesheet stacks the rail under the
   conversation there, and a line from a composer to a card directly beneath it
   is a scribble, not an explanation. This renders nothing at all rather than
   drawing something apologetic.

   IT SAYS NOTHING TO A SCREEN READER. Everything the animation conveys — which
   shelves were searched, what each one held, which one the answer came from —
   is already text in the rail and in the source chips. aria-hidden.

   ⚠ RENDER IT LAST INSIDE THE STAGE, after the columns it measures. React
   detaches every callback ref in the mutation phase and re-attaches them in
   the layout phase in TREE ORDER — so an overlay placed first would run its
   layout effect while the four cards were momentarily unregistered and
   measure a rail that wasn't there. It paints underneath by z-index, not by
   DOM order, so being last costs nothing. (`lanesBetween` refusing to answer
   for an empty card map is the second belt on the same trousers.) */

/** A measured lane: one path, from the composer's edge to one card's edge. */
type Lane = { key: KbCategoryKey; color: string; d: string };

/* The exact complement of the stylesheet's `@media (max-width:1100px)`, so
   there is no width at which the lines are drawn against a stacked layout —
   `(min-width:1100px)` would overlap it by a pixel. */
export const WIDE_QUERY = "not all and (max-width: 1100px)";

/** Anything with a `.current` element: a `useRef` from the parent fits. */
type ElementRef = { readonly current: HTMLElement | null };

export type CardRefs = { readonly current: Map<KbCategoryKey, HTMLElement> | null };

/* ── the breakpoint, as a subscription ───────────────────────────────────── */

const mediaQuery = (): MediaQueryList | null =>
  typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? null
    : window.matchMedia(WIDE_QUERY);

const subscribeWide = (onChange: () => void): (() => void) => {
  const mql = mediaQuery();
  if (!mql) return () => {};
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};

const wideNow = (): boolean => mediaQuery()?.matches ?? false;

/* Narrow on the server, because the server cannot know the viewport and a
   guess that has to be corrected on hydration is a mismatch. Costs one extra
   frame at page load, which nothing is waiting on — the lines never appear
   until a question is asked. */
const wideOnServer = (): boolean => false;

/* ── measuring ───────────────────────────────────────────────────────────── */

/* The lanes RISE from the composer's shoulder and arrive at each card
   travelling horizontally — NOT the system map's midpoint bezier. That
   construction assumes its endpoints are far apart horizontally; here the
   composer's right edge sits one grid-gap (~28px) from the rail, and with
   horizontal tangents squeezed into that corridor all four lanes collapse
   into one near-vertical strand (watched happen on the visual harness, not
   theorised). So: start just inside the composer's top-right shoulder,
   leave travelling UP (both ends of the first control leg share x), and
   sweep into the card with a per-category approach depth — the topmost
   shelf's lane swings widest — so the four read as a fan, not a cable run.

   Null means "not measurable yet" — some endpoint has no element — which is a
   different answer from "no lanes" and is why the caller keeps what it already
   had rather than blanking the lines mid-question. */
function lanesBetween(
  stage: HTMLElement | null,
  composer: HTMLElement | null,
  cards: Map<KbCategoryKey, HTMLElement> | null
): Lane[] | null {
  if (!stage || !composer || !cards) return null;

  const base = stage.getBoundingClientRect();
  const from = composer.getBoundingClientRect();
  const sx = from.right - base.left - 30;
  const sy = from.top - base.top - 6;

  const lanes: Lane[] = [];
  KB_CATEGORIES.forEach((cat, i) => {
    const el = cards.get(cat.key);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ex = r.left - base.left - 10;
    const ey = r.top - base.top + r.height / 2;
    // vertical first tangent, sized to the climb; a card unexpectedly below
    // the composer still gets the minimum shoulder before diving
    const c1y = sy - Math.max(50, (sy - ey) * 0.55);
    /* The approach control, measured back from the card so each lane arrives
       travelling horizontally into its own row.

       A FRACTION OF THE GUTTER, NOT A FIXED DEPTH. This was `max(ex - 110, …)`
       — a constant reach, clamped so it could never land left of where the
       lane started and bow the curve backwards. The clamp fired on every lane
       at every width, because the gutter was one 28px grid gap and 110px of
       reach never fitted in it; every lane therefore got the same fallback and
       the five collapsed into one strand. Widening the gutter alone would not
       have fixed that — the constant would still have overshot below ~1400px.

       Measuring the corridor and taking a share of it per lane is inherently
       in-bounds (the deepest share is 0.79, so c2x > sx always, no clamp) and
       it opens the same fan at every width: the gutter is ~72px at the narrow
       end and ~160px at full width, and the lanes fan in proportion rather
       than bunching at one and sprawling at the other. */
    const gutter = ex - sx;
    const c2x = ex - gutter * (0.35 + i * 0.11);
    lanes.push({
      key: cat.key,
      color: cat.color,
      d: `M ${sx} ${sy} C ${sx} ${c1y}, ${c2x} ${ey}, ${ex} ${ey}`,
    });
  });
  // no cards registered is a moment between renders, not a rail with no shelves
  return lanes.length > 0 ? lanes : null;
}

/* ── the overlay ─────────────────────────────────────────────────────────── */

export function ResearchLines({
  stageRef,
  composerRef,
  cardRefs,
  viz,
  idle = false,
  measureKey = 0,
}: {
  /** The two-column grid the lines are drawn inside — the measuring frame. */
  stageRef: ElementRef;
  composerRef: ElementRef;
  cardRefs: CardRefs;
  viz: ResearchViz;
  /** Draw the lanes faintly with nothing happening — the landing's diagram of
      itself. A live phase always wins, so this only shows at rest. */
  idle?: boolean;
  /** Bumped by the parent whenever the composer may have moved. */
  measureKey?: number;
}) {
  const [lanes, setLanes] = useState<Lane[]>([]);
  const wide = useSyncExternalStore(subscribeWide, wideNow, wideOnServer);
  const phase = viz.phase;

  /* Takes its endpoints as arguments rather than reading the refs it closes
     over, which is what keeps it genuinely constant across renders — the
     effects below are subscriptions, and one that tore itself down every
     render would thrash a ResizeObserver for nothing. */
  const remeasure = useCallback(
    (
      stage: HTMLElement | null,
      composer: HTMLElement | null,
      cards: Map<KbCategoryKey, HTMLElement> | null
    ) => {
      const next = lanesBetween(stage, composer, cards);
      if (next) setLanes(next);
    },
    []
  );

  /* Recompute before paint, so a line is never shown at last frame's
     coordinates: the transcript growing under the composer, the phase turning
     over, anything the parent flags with `measureKey`. */
  useLayoutEffect(() => {
    remeasure(stageRef.current, composerRef.current, cardRefs.current);
  }, [remeasure, stageRef, composerRef, cardRefs, measureKey, phase]);

  /* Subscribing happens after the first commit, not during it. Refs attach
     from the leaves up, so at the moment THIS component's layout effect first
     runs, the stage it wants to observe has no ref yet — every endpoint is
     still null, and an observer set up then would be an observer of nothing.
     A passive effect is the earliest point they all exist, which is also the
     earliest an honest first measurement can be taken. */
  useEffect(() => {
    const run = () => remeasure(stageRef.current, composerRef.current, cardRefs.current);
    run();

    const stage = stageRef.current;
    window.addEventListener("resize", run);
    const ro = stage && typeof ResizeObserver !== "undefined" ? new ResizeObserver(run) : null;
    if (ro && stage) ro.observe(stage);

    return () => {
      window.removeEventListener("resize", run);
      ro?.disconnect();
    };
  }, [remeasure, stageRef, composerRef, cardRefs]);

  const live = overlayVisible(viz);
  if (!wide || (!live && !idle)) return null;

  // a phase in flight always outranks the resting diagram
  const pulsing = live && pulseState(viz) === "pulse";

  return (
    <svg className="tk-lines" aria-hidden="true">
      {lanes.map((lane) => (
        <g
          key={lane.key}
          data-cat={lane.key}
          style={{ "--tkc": lane.color } as React.CSSProperties}
        >
          {/* pathLength=1 turns the length into a fraction, so one
              stroke-dasharray draws in every line at the same rate however
              far its shelf happens to be */}
          <path
            className={`tk-line ${live ? lineState(viz, lane.key) : "idle"}`}
            data-cat={lane.key}
            d={lane.d}
            pathLength="1"
          />
          {/* the pulse is a second stroke over the first, and it exists only
              while something is genuinely outstanding — no length trick here,
              its dash travels in real user units */}
          {pulsing && <path className="tk-line pulse" data-cat={lane.key} d={lane.d} />}
        </g>
      ))}
    </svg>
  );
}
