"use client";

import { useEffect, useEffectEvent, useRef, useState, type AnimationEvent, type CSSProperties } from "react";
import { CHEVRON_STROKES } from "@/components/logo";
import { LAND_MS, LAP_MS, OPEN_MS, THROW_MS } from "./tiff-flight";

/* THE MARK ITSELF, so it is never copied: the Tiff button's insides, and
   the mark wherever the chevron stands for Tiff.

   THE SMALL MARK IS A BOOMERANG (Isaac, 20 November 2026, on
   https://claude.ai/artifact/6DK1HJY1QWYFYE6JDFecEm). It replaced the
   gimbal rings. The chevron stands still; when Tiff starts working she
   throws the small mark, and it flies a big loop in depth, up over her and
   wide out to her top left, round in front and back, spinning clockwise,
   for as long as she works: "it should stay in air while thinking", then
   "should be almost the same but continuos" and "slower when thinking".
   When she's done it finishes the lap it is on and comes home, and the
   chevron gives a little as it lands, the catch. OPENING her plays the same
   loop once, quickly, spinning from release ("on opening tiff, fast
   release", on https://claude.ai/artifact/J5cTywUNx5VVErDK6F3YeN). Black and grey only ("black only", "and
   grey"): the chevron in the ground's ink, the boomerang in the logo's own
   grey, in the air too.

   AT REST IT IS STILL (rule 8), but for Home's mark, which throws one lap
   of the thinking loop now and then ("mock home throw and hover lift", then "Yes, build all
   three"); and a Tiff button lifts the boomerang under the pointer, in the
   stylesheet.

   THE FLIGHT IS THREE PHASES, so it can stay up as long as she works:
   thrown (onto the loop), circling (one lap, `infinite`), landing; and the
   opening, a fourth, on its own. Their
   keyframes are sampled by scripts/tiff-flight.mjs into shell.css; this
   component only says which phase the mark is in. It moves on the
   animations' own events, a lap's end or a phase's end, so it never cuts a
   lap short, and falls back on its own clock where no event will come: a
   mark inside something hidden runs no animation at all. Under reduced
   motion it never leaves its place.

   The shapes are `CHEVRON_STROKES`, the same data the logo draws from, so
   there is still one chevron in the codebase. */

export type Ground = "ink" | "paper";

/** The viewBox nudged 6 right: the chevron hangs off-centre in its own box
    (it was drawn to sit beside a wordmark) and a circle shows that at once. */
const VIEW = "6 0 100 100";
const [CHEVRON, BOOMERANG] = CHEVRON_STROKES;

/** Home's mark throws a lap this often at rest. */
const IDLE_EVERY = 10_000;
/** How long the chevron's give lasts when the boomerang lands. */
const CATCH_MS = 400;
/** Slack on the fallback clock, so the animation's own event always wins. */
const SLACK = 250;

type Phase = "rest" | "open" | "throw" | "orbit" | "land";

/* THE CLOCK. `working` is whether Tiff is working; `alive` is Home's mark,
   which throws a lap now and then at rest; `opened` counts the times she
   has been opened from this mark, and each new one plays the opening. */
function useFlight(working: boolean, alive: boolean, opened: number) {
  const [phase, setPhase] = useState<Phase>("rest");
  const [caught, setCaught] = useState(false);
  const [seen, setSeen] = useState(opened);
  /* read once, before anything is thrown; it is never drawn, so the server's
     answer (false) cannot disagree with the page's */
  const [still] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  /* what the phase that is ending should go on to: read when it ends */
  const want = useRef(working);
  useEffect(() => {
    want.current = working;
  }, [working]);

  /* she's opened: the opening, once, from its place */
  if (opened !== seen) {
    setSeen(opened);
    if (!still && phase === "rest") setPhase("open");
  }
  /* she starts working: thrown, in the same render */
  if (!still && working && phase === "rest") setPhase("throw");

  /* Home's mark at rest: one lap every so often */
  useEffect(() => {
    if (still || !alive || working || phase !== "rest") return;
    const t = setTimeout(() => setPhase("throw"), IDLE_EVERY);
    return () => clearTimeout(t);
  }, [still, alive, working, phase]);

  /* the ends of the phases. The animation's event and the fallback clock
     can both arrive; the phase as it stands now decides, so the second is
     nothing. */
  const now = useRef<Phase>("rest");
  useEffect(() => {
    now.current = phase;
  }, [phase]);
  const go = (p: Phase) => {
    now.current = p;
    setPhase(p);
  };
  const thrown = () => {
    if (now.current === "throw") go(want.current ? "orbit" : "land");
  };
  const lapDone = () => {
    if (now.current === "orbit" && !want.current) go("land");
  };
  /* home from a landing or the opening: the catch */
  const landed = () => {
    if (now.current !== "land" && now.current !== "open") return;
    setCaught(true);
    go("rest");
  };

  /* the fallback clock: the same ends, a little after the animation's own */
  const ended = useEffectEvent((p: Phase) => (p === "throw" ? thrown() : p === "orbit" ? lapDone() : landed()));
  useEffect(() => {
    const wait = { rest: 0, open: OPEN_MS, throw: THROW_MS, orbit: working ? 0 : LAP_MS, land: LAND_MS }[phase];
    if (!wait) return;
    const t = setTimeout(() => ended(phase), wait + SLACK);
    return () => clearTimeout(t);
  }, [phase, working]);

  useEffect(() => {
    if (!caught) return;
    const t = setTimeout(() => setCaught(false), CATCH_MS);
    return () => clearTimeout(t);
  }, [caught]);

  const onAnimationEnd = (e: AnimationEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.animationName === "tiffThrow") thrown();
    if (e.animationName === "tiffLand" || e.animationName === "tiffOpen") landed();
  };
  const onAnimationIteration = (e: AnimationEvent) => {
    if (e.target === e.currentTarget && e.animationName === "tiffOrbit") lapDone();
  };
  const className = `tiffbtn-st ${phase === "rest" ? "rest" : `fly-${phase}`}${caught ? " caught" : ""}`;
  return { className, onAnimationEnd, onAnimationIteration };
}

function Stroke({ s }: { s: (typeof CHEVRON_STROKES)[number] }) {
  return <path d={s.d} fill="none" strokeWidth={s.width} strokeLinecap={s.cap} strokeLinejoin="round" />;
}

/** The chevron and its boomerang. The ground's skin comes from the class
    of whatever it stands in: `.tiffbtn-<place>`, `.tiffmk-<ground>`. A new
    `opened` plays the opening. */
export function TiffMark({ working = false, alive = false, opened = 0 }: { working?: boolean; alive?: boolean; opened?: number }) {
  const flight = useFlight(working, alive, opened);
  return (
    <span className={flight.className} aria-hidden="true">
      <svg className="tiffbtn-chev" viewBox={VIEW} focusable="false">
        <Stroke s={CHEVRON} />
      </svg>
      <span className="tiffbtn-lift">
        <span className="tiffbtn-boom" onAnimationEnd={flight.onAnimationEnd} onAnimationIteration={flight.onAnimationIteration}>
          <span className="tiffbtn-bank">
            <svg className="tiffbtn-spin" viewBox={VIEW} focusable="false">
              <Stroke s={BOOMERANG} />
            </svg>
          </span>
        </span>
      </span>
    </span>
  );
}

/* THE MARK OUTSIDE THE BUTTON. Wherever the chevron stands for Tiff it is
   the same mark: a label for Tiff (the chat's turns, the palette's footer,
   the round end of a Tiff button, `.tiffkey`), a wait (a page's hold, a
   valuation, a receipt being read), and Home's mark over her box.

   WORKING it throws the boomerang, and it stays up until the work is done.

   ALIVE is Home's mark alone (rule 8's one exception): it throws a lap
   now and then at rest.

   THE GROUND DECIDES ITS SKIN, as it does the button's: paper everywhere
   but the Tiff modal's own ink (`.tiffmk-ink`).

   The logo fills more of it than of the button (74%), because it is small;
   under 48 it flies a smaller circle, so it stays near its own square.
   Sized by `size`, or by the slot's stylesheet when the slot has more than
   one size, because an inline size would beat every one of them. */
export function TiffGlyph({
  ground = "paper",
  working = false,
  alive = false,
  size,
  label,
}: {
  /** The ground it stands on: paper everywhere but the Tiff modal's ink. */
  ground?: Ground;
  /** Tiff is working: the boomerang is thrown and stays up until this goes false. */
  working?: boolean;
  /** Home's mark: a lap now and then at rest. */
  alive?: boolean;
  size?: number;
  /** Stand alone as "HeyTiff" for a screen reader; omit it beside words that already name the thing. */
  label?: string;
}) {
  const small = (size ?? 24) < 48;
  return (
    <span
      className={`tiffmk tiffmk-${ground}${small ? " small" : ""}${working ? " working" : ""}${alive ? " alive" : ""}`}
      style={size ? ({ "--tb": `${size}px` } as CSSProperties) : undefined}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <TiffMark working={working} alive={alive} />
    </span>
  );
}
