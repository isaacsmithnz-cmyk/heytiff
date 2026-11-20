"use client";

import { useEffect, useEffectEvent, useRef, useState, type AnimationEvent, type CSSProperties } from "react";
import { CHEVRON_STROKES } from "@/components/logo";
import { IDLE_SLOW, LAND_SHARE, LAP_MS, THROW_SHARE } from "./tiff-flight";

/* THE MARK ITSELF, so it is never copied: the Tiff button's insides, and
   the mark wherever the chevron stands for Tiff.

   THE SMALL MARK IS A BOOMERANG (Isaac, 20 November 2026, on
   https://claude.ai/artifact/6DK1HJY1QWYFYE6JDFecEm). It replaced the
   gimbal rings. The chevron stands still; when Tiff starts working she
   throws the small mark, and it circles the mark's head in real depth (out
   forward, away behind into the distance, round in front near and big) for
   as long as she works: "it should stay in air while thinking". When she's
   done it finishes the lap it is on and comes home, and the chevron gives a
   little as it lands, the catch. Black and grey only ("black only", "and
   grey"): the chevron in the ground's ink, the boomerang in the logo's own
   grey, in the air too.

   AT REST IT IS STILL (rule 8), but for Home's mark, which throws one slow
   lap now and then ("mock home throw and hover lift", then "Yes, build all
   three"); and a Tiff button lifts the boomerang under the pointer, in the
   stylesheet.

   THE FLIGHT IS THREE PHASES, so it can stay up as long as she works:
   thrown (onto the orbit), circling (one lap, `infinite`), landing. Their
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

type Phase = "rest" | "throw" | "orbit" | "land";

/* THE CLOCK. `working` is whether Tiff is working; `alive` is Home's mark,
   which throws a slow lap now and then at rest. */
function useFlight(working: boolean, alive: boolean) {
  const [phase, setPhase] = useState<Phase>("rest");
  const [slow, setSlow] = useState(false);
  const [caught, setCaught] = useState(false);
  /* read once, before anything is thrown; it is never drawn, so the server's
     answer (false) cannot disagree with the page's */
  const [still] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  /* what the phase that is ending should go on to: read when it ends */
  const want = useRef(working);
  useEffect(() => {
    want.current = working;
  }, [working]);

  /* she starts working: thrown at the working pace, in the same render */
  if (!still && working && phase === "rest") {
    setSlow(false);
    setPhase("throw");
  }

  /* Home's mark at rest: one slow lap every so often */
  useEffect(() => {
    if (still || !alive || working || phase !== "rest") return;
    const t = setTimeout(() => {
      setSlow(true);
      setPhase("throw");
    }, IDLE_EVERY);
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
    if (now.current !== "throw") return;
    if (!want.current) return go("land");
    setSlow(false);
    go("orbit");
  };
  const lapDone = () => {
    if (now.current === "orbit" && !want.current) go("land");
  };
  const landed = () => {
    if (now.current !== "land") return;
    setCaught(true);
    setSlow(false);
    go("rest");
  };

  /* the fallback clock: the same ends, a little after the animation's own */
  const lap = LAP_MS * (slow ? IDLE_SLOW : 1);
  const ended = useEffectEvent((p: Phase) => (p === "throw" ? thrown() : p === "land" ? landed() : lapDone()));
  useEffect(() => {
    const wait = phase === "throw" ? lap * THROW_SHARE : phase === "land" ? lap * LAND_SHARE : phase === "orbit" && !working ? lap : 0;
    if (!wait) return;
    const t = setTimeout(() => ended(phase), wait + SLACK);
    return () => clearTimeout(t);
  }, [phase, working, lap]);

  useEffect(() => {
    if (!caught) return;
    const t = setTimeout(() => setCaught(false), CATCH_MS);
    return () => clearTimeout(t);
  }, [caught]);

  const onAnimationEnd = (e: AnimationEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.animationName === "tiffThrow") thrown();
    if (e.animationName === "tiffLand") landed();
  };
  const onAnimationIteration = (e: AnimationEvent) => {
    if (e.target === e.currentTarget && e.animationName === "tiffOrbit") lapDone();
  };
  const className = `tiffbtn-st ${phase === "rest" ? "rest" : `fly-${phase}`}${slow ? " fly-slow" : ""}${caught ? " caught" : ""}`;
  return { className, onAnimationEnd, onAnimationIteration };
}

function Stroke({ s }: { s: (typeof CHEVRON_STROKES)[number] }) {
  return <path d={s.d} fill="none" strokeWidth={s.width} strokeLinecap={s.cap} strokeLinejoin="round" />;
}

/** The chevron and its boomerang. The ground's skin comes from the class
    of whatever it stands in: `.tiffbtn-<place>`, `.tiffmk-<ground>`. */
export function TiffMark({ working = false, alive = false }: { working?: boolean; alive?: boolean }) {
  const flight = useFlight(working, alive);
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

   ALIVE is Home's mark alone (rule 8's one exception): it throws a slow lap
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
  /** Home's mark: a slow lap now and then at rest. */
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
