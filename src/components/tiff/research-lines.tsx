"use client";

import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import {
  lanePulse,
  lineState,
  overlayVisible,
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

/** How far a run leaves the bar before it may turn. */
const LEAD = 22;

/** How far it travels level into the card after its last bend. */
const APPROACH = 26;

/** Elbow sweep. Clamped per lane — at a narrow width a fixed radius would
    consume the run it is supposed to bend. */
const ELBOW = 9;

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
  /* The anchor is the INPUT PILL, not the form: the form carries the mode row
     underneath, and a line "from the composer" that leaves level with a row
     of chips is a line from nowhere in particular. Fall back to the form when
     the pill isn't rendered (tests mount bare refs). */
  const pill = composer.querySelector(".tinput .tin") ?? composer;
  const from = pill.getBoundingClientRect();

  /* ONE ORIGIN RULE, BOTH SCREENS, AND IT TOUCHES THE BAR. Every earlier cut
     floated: the landing's shoulder origin started above the pill (and the
     aurora swallowed the first 20px), and the thread's corridor origin sat
     14px off the column edge — lines that hovered NEAR the bar, visibly
     unattached to it. The lanes start 2px UNDER the pill's right edge — the
     pill is opaque and paints above, so each line emerges from the bar
     itself — and leave travelling horizontally into the corridor, which no
     conversation content ever occupies. */
  const sx = from.right - base.left - 2;
  const anchorY = from.top - base.top + from.height / 2;

  /* ── PIPEWORK, NOT HAIR ──
     Five thin low-opacity curves fanning out of one point is, precisely, the
     shape of strands of hair — the owner kept trying to blow them off the
     screen, on a product he built. Freehand curves were the wrong grammar for
     a trade tool: what a tech reads all day is conduit, trunking and riser
     diagrams, which are orthogonal.

     So every lane is a run: out of the bar, one bend, up or down its own
     channel, one bend, in to its card. The bends are swept rather than
     mitred — a hard 90° pixel corner reads as a chart axis, a radiused one
     reads as an elbow, which is what it is.

     THE CHANNELS ARE A BANK, evenly pitched across the corridor like a tray
     of parallel runs, and which lane gets which channel is what keeps them
     from crossing: the card FURTHEST from the bar turns off earliest and
     takes the innermost channel, so its long vertical happens before any
     other lane's horizontal reaches that x. Every horizontal then sits at its
     own card's height and every vertical at its own channel, which is why the
     bank reads as parallel rather than as a tangle. (Proved on the harness by
     segment intersection, not by eye — the previous curve construction looked
     right and braided.) */
  const rects = KB_CATEGORIES.map((cat, i) => {
    const el = cards.get(cat.key);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      cat,
      // the origin steps down the pill's edge IN CARD ORDER, so the takeoffs
      // read as separate ports on one manifold rather than one thick line
      sy: anchorY + (i - (KB_CATEGORIES.length - 1) / 2) * 8,
      ex: r.left - base.left - 10,
      ey: r.top - base.top + r.height / 2,
    };
  }).filter((v): v is NonNullable<typeof v> => v !== null);

  if (rects.length === 0) return null;

  /* Channel slots, innermost first, handed out by how far the lane travels.
     `slot` is looked up per lane below rather than sorted in place, because
     the DRAW order has to stay the category order — the colours are read
     against the rail beside them. */
  const byReach = [...rects].sort(
    (a, b) => Math.abs(b.ey - b.sy) - Math.abs(a.ey - a.sy)
  );
  const slotOf = new Map(byReach.map((r, i) => [r.cat.key, i]));

  const lanes: Lane[] = rects.map((r) => {
    const dy = r.ey - r.sy;
    /* A card level with the bar is a straight run — forcing a bend into it
       would draw a kink around nothing. */
    if (Math.abs(dy) < 2) {
      return { key: r.cat.key, color: r.cat.color, d: `M ${sx} ${r.sy} H ${r.ex}` };
    }

    const slot = slotOf.get(r.cat.key) ?? 0;
    const span = Math.max(0, r.ex - sx - LEAD - APPROACH);
    const pitch = rects.length > 1 ? span / (rects.length - 1) : 0;
    const tx = sx + LEAD + slot * pitch;

    // the elbow, clamped so it can never eat its own run at a narrow width
    const dir = dy > 0 ? 1 : -1;
    const bend = Math.max(
      0,
      Math.min(ELBOW, Math.abs(dy) / 2, (tx - sx) / 2, (r.ex - tx) / 2)
    );

    return {
      key: r.cat.key,
      color: r.cat.color,
      d: [
        `M ${sx} ${r.sy}`,
        `H ${tx - bend}`,
        `Q ${tx} ${r.sy} ${tx} ${r.sy + dir * bend}`,
        `V ${r.ey - dir * bend}`,
        `Q ${tx} ${r.ey} ${tx + bend} ${r.ey}`,
        `H ${r.ex}`,
      ].join(" "),
    };
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

  return (
    <svg className="tk-lines" aria-hidden="true">
      {lanes.map((lane) => {
        /* Per lane now, because direction is meaning: outbound on every lane
           while the search is out, back along the winner only while the
           answer is written. A phase in flight always outranks the resting
           diagram. */
        const pulse = live ? lanePulse(viz, lane.key) : "off";
        return (
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
                while something is genuinely in motion — no length trick here,
                its dash travels in real user units */}
            {pulse !== "off" && (
              <path
                className={`tk-line pulse${pulse === "back" ? " back" : ""}`}
                data-cat={lane.key}
                d={lane.d}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
