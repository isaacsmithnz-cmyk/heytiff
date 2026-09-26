import type { CSSProperties } from "react";
import { CHEVRON_STROKES } from "@/components/logo";

/* THE MARK ITSELF, so it is never copied: the Tiff button's insides, which
   is the logo as a gyroscope (Isaac, 2026-09-25: "gimbal light, without the
   sphere").

   THREE THINGS MOVE, AND NONE OF THEM IS A GLOW. The chevron is solid (ten
   copies stacked in depth, the face in front, the gradient down its sides)
   and PRECESSES: it leans 18° and the lean travels round once every 6
   seconds, the way a gyroscope's axis circles, with a small nod riding on it.
   Two gimbal rings turn on their own axes around it, and a line of light runs
   along each one. A band of light crosses the face once a turn. The aura the
   first rounds had was taken off on his word ("aura looks too generic ai"):
   the light lives on the rings and the mark, never around them.

   EVERYTHING MOVES BY TRANSFORM, and that is the performance budget. The
   prototype this came from drew its light with blurred, blended blobs, which
   repaint every frame; here the only animated properties are `transform` and
   `opacity`, the geometry is the browser's 3D (one wrapper per motion, the
   same trick the orb uses), and nothing holds a clock.

   THE GROUND DECIDES THE SKIN, as it always has for this button. On the
   frame's ink the face is paper and the depth is the brand gradient; on a
   sheet's paper the face takes the brand gradient itself and the depth goes
   a step darker, because a white face on white is nothing. The rings follow:
   light-headed on ink, coloured on paper.

   The shapes are `CHEVRON_STROKES`, the same data the logo and the dot field
   draw from, so there is still one chevron in the codebase. */

export type Ground = "ink" | "paper";

/** Copies of the mark stacked in depth, back to front. Ten is where the side
    stops reading as separate outlines at 36px. */
const LAYERS = 10;
/** The solid's depth, as a share of the button; the stack is centred on 0. */
const DEPTH = 0.12;

/** The viewBox nudged 6 right: the chevron hangs off-centre in its own box
    (it was drawn to sit beside a wordmark) and a circle shows that at once. */
const VIEW = "6 0 100 100";

/* The mark's silhouette as a mask, for the band of light that crosses the
   face. Built once from the same strokes; identical on server and client. */
const maskSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW}">` +
  CHEVRON_STROKES.map(
    (s) =>
      `<path d="${s.d}" fill="none" stroke="#fff" stroke-width="${s.width}" stroke-linecap="${s.cap}" stroke-linejoin="round"/>`
  ).join("") +
  `</svg>`;
export const MARK_MASK = `url("data:image/svg+xml,${encodeURIComponent(maskSvg)}")`;

/* Gradient ids are constants per ground: every button of a ground declares
   identical defs, and identical defs never collide visually — the same call
   the logo's `htGrad` made, and for the same reason it stays hydration-safe. */
const IDS = {
  ink: { face: null, depth: "tiffDepthInk", runA: "tiffRunAInk", runB: "tiffRunBInk" },
  paper: { face: "tiffFacePaper", depth: "tiffDepthPaper", runA: "tiffRunAPaper", runB: "tiffRunBPaper" },
} as const;

/** Stop colours are tokens, set as style (a presentation attribute cannot read a custom property). */
const stop = (offset: number, colour: string, opacity = 1) => (
  <stop key={offset} offset={offset} style={{ stopColor: colour, stopOpacity: opacity }} />
);

/* A ring's run of light is a 120° arc, tail to head, clockwise from three
   o'clock (a circle's path starts there). The gradient runs along its chord,
   transparent at the tail to the head's colour at the leading end, so turning
   the arc reads as light travelling round the ring. */
const R = 48;
const HEAD = { x: 50 + R * Math.cos((2 * Math.PI) / 3), y: 50 + R * Math.sin((2 * Math.PI) / 3) };
function Run({ id, colour, head }: { id: string; colour: string; head: string }) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={50 + R} y1={50} x2={HEAD.x} y2={HEAD.y}>
      {stop(0, colour, 0)}
      {stop(0.6, colour, 0.92)}
      {stop(0.95, head)}
      {stop(1, head)}
    </linearGradient>
  );
}

function Defs({ ground }: { ground: Ground }) {
  const ink = ground === "ink";
  return (
    <svg className="tiffbtn-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {ink ? (
          <linearGradient id={IDS.ink.depth} x1="0" y1="0" x2="1" y2="1">
            {stop(0, "var(--mark-teal)")}
            {stop(1, "var(--mark-blue)")}
          </linearGradient>
        ) : (
          <>
            <linearGradient id={IDS.paper.face} x1="0" y1="0" x2="1" y2="1">
              {stop(0, "var(--mark-teal-d)")}
              {stop(1, "var(--mark-blue)")}
            </linearGradient>
            <linearGradient id={IDS.paper.depth} x1="0" y1="0" x2="1" y2="1">
              {stop(0, "var(--mark-teal-ink)")}
              {stop(1, "var(--mark-blue-ink)")}
            </linearGradient>
          </>
        )}
        <Run id={IDS[ground].runA} colour={ink ? "var(--mark-teal)" : "var(--mark-teal-d)"} head={ink ? "var(--paper)" : "var(--mark-teal-d)"} />
        <Run id={IDS[ground].runB} colour={ink ? "var(--mark-blue-l)" : "var(--mark-blue)"} head={ink ? "var(--paper)" : "var(--mark-blue)"} />
      </defs>
    </svg>
  );
}

function Layer({ stroke, z, opacity, face }: { stroke: string; z: number; opacity: number; face?: boolean }) {
  return (
    <svg
      className={face ? "tiffbtn-ly face" : "tiffbtn-ly"}
      viewBox={VIEW}
      aria-hidden="true"
      focusable="false"
      style={{ "--z": z.toFixed(4), opacity: opacity === 1 ? undefined : opacity } as CSSProperties}
    >
      {CHEVRON_STROKES.map((s, i) => (
        <path
          key={i}
          d={s.d}
          fill="none"
          stroke={stroke}
          strokeWidth={s.width}
          strokeLinecap={s.cap}
          strokeLinejoin="round"
          opacity={s.opacity === 1 ? undefined : s.opacity}
        />
      ))}
    </svg>
  );
}

function Gimbal({ axis, run, ring }: { axis: "a" | "b"; run: string; ring: string }) {
  return (
    <span className={`tiffbtn-gim tiffbtn-gim-${axis}`}>
      <span className="tiffbtn-arc">
        <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          <circle className="tiffbtn-ring" cx="50" cy="50" r={R} style={{ stroke: ring }} vectorEffect="non-scaling-stroke" />
          <circle
            cx="50"
            cy="50"
            r={R}
            stroke={`url(#${run})`}
            pathLength={360}
            strokeDasharray="120 240"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </span>
    </span>
  );
}

export function TiffMark({ ground }: { ground: Ground }) {
  const ids = IDS[ground];
  const ink = ground === "ink";
  const layers = [];
  for (let k = 0; k < LAYERS; k++) {
    const z = -DEPTH / 2 + (DEPTH * k) / (LAYERS - 1);
    const front = k === LAYERS - 1;
    layers.push(
      front ? (
        <Layer key={k} face z={z} opacity={1} stroke={ink ? "currentColor" : `url(#${IDS.paper.face})`} />
      ) : (
        <Layer key={k} z={z} opacity={0.45 + (0.5 * k) / (LAYERS - 1)} stroke={`url(#${ids.depth})`} />
      )
    );
  }
  return (
    <>
      <Defs ground={ground} />
      <span className="tiffbtn-st" aria-hidden="true">
        <span className="tiffbtn-root">
          {/* the press turns this once on the chevron's own point */}
          <span className="tiffbtn-flip">
            <span className="tiffbtn-pre">
              <span className="tiffbtn-nod">
                {layers}
                <span className="tiffbtn-sheen" />
              </span>
            </span>
          </span>
          <span className="tiffbtn-gw">
            <Gimbal axis="a" run={ids.runA} ring={ink ? "var(--mark-teal)" : "var(--mark-teal-d)"} />
            <Gimbal axis="b" run={ids.runB} ring={ink ? "var(--mark-blue-l)" : "var(--mark-blue)"} />
          </span>
        </span>
      </span>
    </>
  );
}

/* THE MARK OUTSIDE THE BUTTON. Wherever the chevron stands for Tiff it is
   the gimbal too (Isaac, 2026-09-25: "Elsewhere, for reference — looks good
   lets do it"), and it moves, the way the button does ("round end, moving,
   no dark background", the same day, after a still pose read as a smudge
   at label size). Two paces:

   AT REST it runs the button's own loops: a label for Tiff — the chat's
   header and ask bar, the palette's footer, and the round end of a Tiff
   button (`.tiffkey`).

   IT STANDS ON PAPER, every one of them. Its one mark on ink was the
   capture card's answer ribbon, which went with the old capture UI
   (2026-09-27), so the glyph takes no ground: the ink skin is the frame's
   button's alone (`TiffMark`, `.tiffbtn-topbar`).

   WORKING it runs them at the thinking pace: a wait, a valuation, a receipt
   being read. It starts when the work starts and goes when it is done.

   QUIET marks move only while their control is hovered or focused, for a
   control repeated down a list (Ask Tiff on every document): a hundred
   gyroscopes turning at once is a page of motion, and a compositor bill.

   The logo fills more of it than of the button (74%, rings at the edge),
   because it is small: at 15–24px the button's proportions left a smudge.
   Sized by `size`, or by the slot's stylesheet when the slot has more than
   one size, because an inline size would beat every one of them. */
export function TiffGlyph({
  working = false,
  quiet = false,
  size,
  label,
}: {
  working?: boolean;
  /** Moves only while its control is hovered or focused: for a control repeated down a list. */
  quiet?: boolean;
  size?: number;
  /** Stand alone as "HeyTiff" for a screen reader; omit it beside words that already name the thing. */
  label?: string;
}) {
  return (
    <span
      className={`tiffmk tiffmk-paper${working ? " working" : ""}${quiet ? " quiet" : ""}`}
      style={{ "--tiffbtn-mask": MARK_MASK, ...(size ? { "--tb": `${size}px` } : {}) } as CSSProperties}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <TiffMark ground="paper" />
    </span>
  );
}
