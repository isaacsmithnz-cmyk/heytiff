"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Icon } from "@/components/shell/icon";
import type { DictationState } from "@/components/notes/dictation";

/* The recording's limits, as the voice has them (dictation.tsx): four
   minutes, the last thirty counted down. Written here as well, so the bar
   stands on its own wherever the voice is stood in for. */
const MOST_SECONDS = 240;
const COUNTDOWN_FROM = 30;

/* THE BAR WHILE YOU SPEAK, THE PHONE'S (heytiff-mobile src/components/Talk.tsx,
   `SpeakBar`). Isaac, 9 November 2026: "I want the boxes to pretty much be
   identical". A white bar of its own under the words: ✕ throws the words
   away, the blue wave moves with your voice, the time shows only in the last
   thirty seconds, ■ stops and puts the words in the box, and ↑ sends them as
   they are where the box has one answer. Every box that hears wears it: the
   box at the foot of a chat, and the box in a form. */

/** A bar and the gap after it, as the phone's. */
const STEP = 6;
/** The oldest bars fade out over this much of the left. */
const FADE = 36;
/** How often a level is taken: the phone's meter ticks at this. */
const TICK_MS = 120;
/** A little longer than a tick, so the bars never stop between two. */
const GLIDE_MS = 140;
/** As many bars as the widest bar could hold. */
const BARS = 80;

/** The voice as bars, newest on the right, drifting left at a steady pace
    like tape, the oldest fading at the left (Isaac, 5 November 2026: "how
    jumpy the blue still is"). Each new level shifts the bars by one; the
    strip is pushed back by that much in the same frame and slides home, so
    no bar ever jumps. The level is the meter's own, which writes `--lvl` to
    the element bound to `barsRef` every frame; the loudest since the last
    tick is the bar. */
export function Wave({ barsRef }: { barsRef: RefObject<HTMLSpanElement | null> }) {
  const wrap = useRef<HTMLSpanElement | null>(null);
  const strip = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const box = wrap.current;
    const row = strip.current;
    if (!box || !row) return;
    const bars = Array.from(row.children) as HTMLElement[];
    const levels: number[] = Array(BARS).fill(0);
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let peak = 0;
    let raf = 0;
    const read = () => {
      const lvl = Number(barsRef.current?.style.getPropertyValue("--lvl") || 0);
      if (Number.isFinite(lvl)) peak = Math.max(peak, lvl);
      raf = requestAnimationFrame(read);
    };
    const tick = () => {
      levels.shift();
      levels.push(Math.min(1, peak));
      peak = 0;
      const wide = box.clientWidth;
      bars.forEach((bar, k) => {
        /* bar k is k steps in from the right */
        const level = levels[levels.length - 1 - k] ?? 0;
        bar.style.height = `${3 + Math.round(level * 26)}px`;
        bar.style.opacity = String(Math.min(1, Math.max(0, (wide - k * STEP - 3) / FADE)));
      });
      if (!still && typeof row.animate === "function")
        row.animate({ transform: [`translateX(${STEP}px)`, "none"] }, { duration: GLIDE_MS, easing: "linear" });
    };
    raf = requestAnimationFrame(read);
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, [barsRef]);
  return (
    <span className="cv-wave" ref={wrap} aria-hidden="true">
      <span ref={barsRef} hidden />
      <span className="cv-strip" ref={strip}>
        {Array.from({ length: BARS }, (_, k) => (
          <i key={k} style={{ right: k * STEP }} />
        ))}
      </span>
    </span>
  );
}

/** The time, only in the last thirty seconds, counting down in red, as
    Claude's and the phone's are (Isaac, 30 October 2026). */
export function RecClock({ seconds }: { seconds: number }) {
  const left = Math.max(0, MOST_SECONDS - seconds);
  if (left > COUNTDOWN_FROM) return null;
  return (
    <span className="cv-clock" role="status" aria-live="polite">
      {`${left}s left`}
    </span>
  );
}

/** "Fixing the wording", only once it's taking a while: the live words
    settle in half a second or so with nothing to fix, and a line that
    flashes up and away reads as a fault. It shows when the live words
    dropped out and the recording is heard again, which takes longer. */
const FIXING_AFTER_MS = 1200;
export function Fixing() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), FIXING_AFTER_MS);
    return () => clearTimeout(t);
  }, []);
  if (!shown) return null;
  return (
    <p className="cv-fixing" role="status">
      Fixing the wording
      <span className="tc-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </p>
  );
}

export function SpeakBar({
  dict,
  onSendNow,
  sendLabel = "Send to Tiff",
  waiting = false,
}: {
  dict: DictationState;
  /** ↑: stop and send the words as they are, where the box has one answer. */
  onSendNow?: () => void;
  sendLabel?: string;
  waiting?: boolean;
}) {
  return (
    <div className="cv-bar">
      <button type="button" className="cv-rnd" aria-label="Throw it away" onClick={dict.cancel}>
        <Icon name="x" size={18} sw={2} />
      </button>
      <Wave barsRef={dict.barsRef} />
      <RecClock seconds={dict.seconds} />
      <button type="button" className="cv-rnd cv-stop" aria-label="Stop" onClick={dict.stop}>
        <span className="cv-stopsq" aria-hidden="true" />
      </button>
      {onSendNow && (
        <button type="button" className="cv-rnd cv-rnd--main" aria-label={sendLabel} disabled={waiting} onClick={onSendNow}>
          <Icon name="arrowUp" size={18} sw={2.2} />
        </button>
      )}
    </div>
  );
}
