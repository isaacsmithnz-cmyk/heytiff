"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { buildDotField, markInk } from "@/lib/ui/dot-mark";

/* THE FIELD — the capture card's instrument, and the mark itself.

   While you talk it is the HeyTiff chevron, drawn as a field of dots with a
   wave swelling through it. When Tiff takes the words away every dot flies out
   into a slowly turning cloud and darts around its own patch until the answer
   comes back, and then the whole thing drops out of the card.

   IT IS ONE SET OF ELEMENTS THROUGHOUT. Nothing is swapped and nothing
   crossfades: each dot carries two addresses — where it sits in the chevron
   and where it lives in the cloud — and the wait is the journey between them.
   That is the only version of this where the transition is the point rather
   than a dissolve dressed up as one.

   FOUR NESTED ELEMENTS, ONE JOB EACH, because they run on different clocks:

     .dotf-tilt    leans the whole thing over once it is a cloud
     .dotf-orbit   turns it, slowly, and only while it is a cloud
     .dotf-cell    WHERE a dot is — the chevron, the cloud, or falling
     i             the dot: the swell while it is the mark, a flare while it waits

   Collapse any two of those and one has to restate the other's work in every
   keyframe, which is the wall this hit repeatedly while it was a prototype:
   a dot's transform IS its position, so anything that also wanted to move it
   had to know where two hundred different dots were.

   WHAT THE PROTOTYPE NEEDED AND THIS DOES NOT. Flipping between states by hand
   meant handling cloud → mark, which needs the turn wound down onto a whole
   revolution and every dart frozen and eased home, or a hundred dots jump. The
   real flow only ever runs forwards — mark, cloud, fall, gone — so all of that
   machinery is absent. If a path back is ever added, it comes back with it.

   IT SAYS NOTHING TO A SCREEN READER. The stage it sits in is already named by
   the ribbon above it, and a field of dots has nothing to add to "Recording". */

export type DotFieldStage = "gather" | "mark" | "cloud" | "fall";

/** How long the mark takes to arrive, first dot leaving to last dot seated.
    The stylesheet's `dotfGather` has to agree with it; nothing else needs to
    know, because the field lets go of the stage on its own. */
export const GATHER_MS = 1420;

/** How long the drop takes, start to last dot gone. The caller needs this to
    know how long to keep the field mounted after the wait ends — see
    `useDotFieldExit` — and the stylesheet needs it to match. */
export const FALL_MS = 1100;

export function DotField({
  stage,
  size = 268,
  cols = 26,
  className,
  from,
}: {
  stage: DotFieldStage;
  /** The field's width in px; everything scales off it. */
  size?: number;
  /** Grid resolution across the mark. */
  cols?: number;
  className?: string;
  /** Where the mark is arriving FROM — the pressed button's offset from the
      card's centre, which is the same pair the card's own entrance rides on
      (`--cap-dx/--cap-dy`, see tiff-button). Absent on every surface that has
      no button to fly out of: the debrief, a field's nudge, the postures. */
  from?: { dx: number; dy: number } | null;
}) {
  const shown = useGather(from ? stage : null) ?? stage;
  const root = useRef<HTMLDivElement | null>(null);

  /* THE BUTTON, IN THE FIELD'S OWN COORDINATES. `from` is measured against the
     CARD's centre and the dots are placed from the FIELD's, so the difference
     between those two centres is the whole of this effect.

     `offsetLeft/offsetTop` rather than a rect, and that is the point: the card
     is mid-blossom when this runs — scaled to a third of itself and sitting on
     the button — so every rect in the subtree is a rect of the animation
     rather than of the layout. Offsets ignore transforms, so they describe
     where the field is GOING to be, which is what the dots need.

     An effect, not a layout effect, and a frame of slack is free: `dotfGather`
     opens at `opacity:0`, so the frame that runs before these land has nothing
     on screen to be wrong. */
  useEffect(() => {
    const el = root.current;
    const card = el?.offsetParent as HTMLElement | null;
    if (!el || !card || !from) return;
    const fx = el.offsetLeft + el.offsetWidth / 2 - card.offsetWidth / 2;
    const fy = el.offsetTop + el.offsetHeight / 2 - card.offsetHeight / 2;
    el.style.setProperty("--gox", (from.dx - fx).toFixed(1));
    el.style.setProperty("--goy", (from.dy - fy).toFixed(1));
  }, [from]);

  /* Built once per size, not per render and not per mount of a card that opens
     dozens of times a day. Pure arithmetic over the mark's own path data — see
     lib/ui/dot-mark for why this is not asked of the browser. */
  const { dots, dotPx } = useMemo(() => buildDotField(size, cols), [size, cols]);

  return (
    <div
      ref={root}
      className={className ? `dotf ${className}` : "dotf"}
      data-stage={shown}
      style={{ "--dotf": `${size}px`, "--dotf-dot": `${dotPx.toFixed(2)}px` } as CSSProperties}
      aria-hidden="true"
    >
      <div className="dotf-tilt">
        <div className="dotf-orbit">
          {dots.map((d, i) => (
            <div
              key={i}
              className="dotf-cell"
              style={
                {
                  "--lx": d.x.toFixed(1),
                  "--ly": d.y.toFixed(1),
                  "--hx": d.hx.toFixed(1),
                  "--hy": d.hy.toFixed(1),
                  "--hz": d.hz.toFixed(1),
                  "--fx": d.fx.toFixed(1),
                  "--fy": d.fy.toFixed(1),
                  "--fz": d.fz.toFixed(1),
                  "--gx": d.gx.toFixed(1),
                  "--sd": d.delay.toFixed(3),
                  "--gd": d.gd.toFixed(3),
                  "--bx": d.bx.toFixed(1),
                  "--by": d.by.toFixed(1),
                } as CSSProperties
              }
            >
              <div
                className="dotf-wander"
                style={
                  {
                    "--z0x": d.zip[0][0].toFixed(1), "--z0y": d.zip[0][1].toFixed(1), "--z0z": d.zip[0][2].toFixed(1),
                    "--z1x": d.zip[1][0].toFixed(1), "--z1y": d.zip[1][1].toFixed(1), "--z1z": d.zip[1][2].toFixed(1),
                    "--z2x": d.zip[2][0].toFixed(1), "--z2y": d.zip[2][1].toFixed(1), "--z2z": d.zip[2][2].toFixed(1),
                    "--z3x": d.zip[3][0].toFixed(1), "--z3y": d.zip[3][1].toFixed(1), "--z3z": d.zip[3][2].toFixed(1),
                    "--zd": `${Math.round(d.zipMs)}ms`,
                    "--zp": d.zipPhase.toFixed(2),
                  } as CSSProperties
                }
              >
                <i
                  style={
                    {
                      color: markInk(d.t),
                      "--lit": d.lit.toFixed(3),
                      "--w": d.t.toFixed(3),
                      "--fd": `${Math.round(d.fireMs)}ms`,
                      "--fp": d.firePhase.toFixed(2),
                    } as CSSProperties
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Holds the first `mark` open long enough for the dots to arrive in it.
 *
 * The mark is the field's RESTING state, so nothing about it moves — which is
 * right once it is there and wrong for the moment it appears, where two
 * hundred dots simply materialised in formation. `gather` is that moment given
 * a stage of its own: the dots start on the button and fly to their seats,
 * and the whole thing hands over to the swell when the last one is down.
 *
 * ONE-SHOT, AND ONLY ON THE WAY IN. It fires for the first `mark` this field
 * ever shows and never again, so choosing Talk mid-flight carries the same
 * arrival on rather than restarting it, and a mark coming BACK from anywhere
 * (there is no such path today) would not replay an entrance.
 *
 * @param live  what the field is being asked to show, or null where there is
 *              no button to have flown out of — the caller passes that, and
 *              this returns null in kind so the stage passes straight through
 */
function useGather(live: DotFieldStage | null): DotFieldStage | null {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done || live !== "mark") return;
    const t = setTimeout(() => setDone(true), GATHER_MS);
    return () => clearTimeout(t);
  }, [done, live]);

  if (!live || done) return null;
  return live === "mark" ? "gather" : null;
}

/**
 * Keeps the field on screen long enough to leave.
 *
 * A wait that ends unmounts the card's body, and an unmounted element cannot
 * animate — the cloud would simply blink out. This holds the last live stage
 * for the length of the drop and then lets go, so the caller can render the
 * field for exactly as long as it has something to do.
 *
 * THE CHANGE IS ANSWERED IN RENDER, NOT IN AN EFFECT. The first version did
 * all of this in a `useEffect` on `live`, which is the shape React's own
 * compiler rules refuse — `setState` in an effect body renders the tree,
 * commits it, and renders again, so the card painted one frame of the OLD
 * stage every single time it moved. (It also shipped `eslint` red: the rule
 * is `react-hooks/set-state-in-effect`, and it landed with the field.)
 *
 * What is left in an effect is the one thing that genuinely belongs there —
 * a timer — and its `setState` runs in the timer's own callback, which is
 * the sanctioned shape: subscribe to something outside React, tell React
 * when it fires.
 *
 * @param live  what the field should be right now, or null once the wait is over
 */
export function useDotFieldExit(live: DotFieldStage | null): DotFieldStage | null {
  const [seen, setSeen] = useState<DotFieldStage | null>(live);
  const [shown, setShown] = useState<DotFieldStage | null>(live);

  if (live !== seen) {
    setSeen(live);
    /* Only a cloud has anywhere to fall from — `shown` IS the answer to "was
       it one", which is what the `wasCloud` ref used to carry. A recording
       abandoned before the mic closes goes with the card rather than
       performing an exit. */
    setShown(live ?? (shown === "cloud" ? "fall" : null));
  }

  useEffect(() => {
    if (shown !== "fall") return;
    const t = setTimeout(() => setShown(null), FALL_MS);
    return () => clearTimeout(t);
  }, [shown]);

  return shown;
}
