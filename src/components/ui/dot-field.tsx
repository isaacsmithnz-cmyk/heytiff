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

export type DotFieldStage = "mark" | "cloud" | "fall";

/** How long the drop takes, start to last dot gone. The caller needs this to
    know how long to keep the field mounted after the wait ends — see
    `useDotFieldExit` — and the stylesheet needs it to match. */
export const FALL_MS = 1100;

export function DotField({
  stage,
  size = 268,
  cols = 26,
  className,
}: {
  stage: DotFieldStage;
  /** The field's width in px; everything scales off it. */
  size?: number;
  /** Grid resolution across the mark. */
  cols?: number;
  className?: string;
}) {
  /* Built once per size, not per render and not per mount of a card that opens
     dozens of times a day. Pure arithmetic over the mark's own path data — see
     lib/ui/dot-mark for why this is not asked of the browser. */
  const { dots, dotPx } = useMemo(() => buildDotField(size, cols), [size, cols]);

  return (
    <div
      className={className ? `dotf ${className}` : "dotf"}
      data-stage={stage}
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
 * Keeps the field on screen long enough to leave.
 *
 * A wait that ends unmounts the card's body, and an unmounted element cannot
 * animate — the cloud would simply blink out. This holds the last live stage
 * for the length of the drop and then lets go, so the caller can render the
 * field for exactly as long as it has something to do.
 *
 * @param live  what the field should be right now, or null once the wait is over
 */
export function useDotFieldExit(live: DotFieldStage | null): DotFieldStage | null {
  const [shown, setShown] = useState<DotFieldStage | null>(live);
  const wasCloud = useRef(false);

  useEffect(() => {
    if (live) {
      wasCloud.current = live === "cloud";
      setShown(live);
      return;
    }
    /* Only a cloud has anywhere to fall from. A recording that is abandoned
       before the mic closes should go with the card, not perform an exit. */
    if (!wasCloud.current) {
      setShown(null);
      return;
    }
    setShown("fall");
    const t = setTimeout(() => setShown(null), FALL_MS);
    return () => clearTimeout(t);
  }, [live]);

  return shown;
}
