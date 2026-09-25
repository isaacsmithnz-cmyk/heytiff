"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { Icon } from "@/components/shell/icon";
import {
  DAY_GROW_MS,
  DAY_NOMINAL_W,
  dayCardLabel,
  dayCardPaint,
  dayCardTip,
  dayState,
  fitDay,
  guessMeasure,
  type DayItem,
  type DayMeasure,
} from "@/lib/dashboard/day-bar";
import {
  DAY_GROW_EASE,
  DAY_PARTS,
  growPlan,
  motionAllowed,
  shiftFrames,
  skinFrames,
  skinSpan,
  type CardPose,
  type DayPart,
} from "@/lib/dashboard/day-flip";

/* THE BAR ITSELF: his slanted cards (handoff "Home - Diagonal day", §2).

   Every number that decides a card lives in `lib/dashboard/day-bar`, where
   it is tested: which cards fold, how wide each may get, what it says, what
   colour it is. This file only measures what that arithmetic needs — the
   bar's width and the words' — and draws what comes back.

   A CARD IS THREE LAYERS in a button that is only a layout box:
     .hd-skin  the 45° shape: its ground, the progress filling it, and the
               ink outline when it is open. The only part the pointer hits,
               so a click lands on the card whose SHAPE is under it, not on
               the box it leans out of.
     .hd-lab   the words, never skewed. Each sits where the slant puts it at
               its own height (x moves by its height from the middle, at
               45°), so text is never drawn through a skew and can later
               move without being distorted.
     .hd-tick  a finished card's green tick, level.
   The bar clips the row, whose ends reach 44px past it on each side, so the
   first and last cards' outer slants are cut away and the bar's ends read
   square.

   FIRST PAINT IS THE SERVER'S. It cannot see the bar or the font, so both
   sides lay the bar out at his width (DAY_NOMINAL_W) with the generous
   letter-count guess; once the page is in the browser the bar measures
   itself (a ResizeObserver) and the words (canvas, in the page's own face,
   after the fonts are in), and lays itself out again. A guess can only fold
   early, so the one correction is in the safe direction.

   THE GROW IS A FLIP (lib/dashboard/day-flip). A change still commits its
   widths at once, and nothing in the sheet transitions: before the day
   changes the bar it asks it to `capture` where every card is drawn, and
   once the change is committed each skin grows from there to its new box
   by transforms alone, the words sliding level beside it. A change made
   from the keyboard, or under reduced motion, is simply there (law 8), and
   stops any grow still in flight.

   THE TRACE is the light that runs round the job on now: a ring cut by two
   masks from a conic gradient turning inside it, so the turn is a rotation
   the compositor runs and the page is never painted for it. His loop, named
   in docs/design.md; it stands still under reduced motion. */

/** Canvas text metrics in the page's own face; null where there is no
    canvas to ask, or no face to ask it in, which keeps the guess. The family is the hashed next/font
    name, read off the bar's computed style, so it is the face the words are
    actually drawn in. */
export function canvasMeasure(family: string): DayMeasure | null {
  /* A font string with no family is not a font: the canvas would keep its
     own 10px face and every word would measure a third short. */
  if (!family.trim() || typeof OffscreenCanvas === "undefined") return null;
  const ctx = new OffscreenCanvas(1, 1).getContext("2d");
  if (!ctx) return null;
  return (text, font) => {
    ctx.font = `${font.weight} ${font.px}px ${family}`;
    return ctx.measureText(text).width;
  };
}

/** WHERE A CLICK LEAVES THE OPEN CARD OPEN. A click anywhere else on the
    page closes it (the handoff, §2.6); these are the places it does not:
    the bar and the panel themselves, the row of tabs (the card stays open
    across faces: "if the card is open, they can just close it if they want
    more space", Isaac, 2026-09-25), and the Calendar, which his prototype
    leaves the card open over. Spread onto each. */
export const KEEPS_DAY = { "data-day-keep": "" } as const;

/** The level parts that slide beside a growing skin, by their class. */
const PART_SEL: Record<DayPart, string> = { tag: ".hd-tag", mid: ".hd-mid", tick: ".hd-tick" };

/** One card as it is drawn right now, a grow in flight included. */
function poseOf(el: HTMLElement, key: string, members: readonly string[]): CardPose {
  const skin = el.querySelector(".hd-skin");
  const parts: CardPose["parts"] = {};
  for (const part of DAY_PARTS) {
    const p = el.querySelector(PART_SEL[part]);
    if (!p) continue;
    const r = p.getBoundingClientRect();
    parts[part] = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { key, members, span: skin ? skinSpan(skin.getBoundingClientRect()) : null, parts };
}

/** What the day asks of the bar just before it changes it. */
export type DayBarHandle = {
  /** Read where every card is drawn, so the change about to be committed
      grows from there. `false` — a change from the keyboard, or with motion
      off — stops any grow in flight instead, and the change is simply there. */
  capture: (move: boolean) => void;
};

export function HomeDayBar({
  items,
  nowMin,
  selectedKey,
  showFinished,
  panelId,
  onChoose,
  onUnfold,
  hold,
  ref,
}: {
  items: readonly DayItem[];
  nowMin: number | null;
  selectedKey: string | null;
  showFinished: boolean;
  /** The panel every card opens, for `aria-controls`. */
  panelId: string;
  /** A card was pressed: open it, or close it when it is the one open.
      `pointer` is false for a press from the keyboard. */
  onChoose: (key: string, pointer: boolean) => void;
  /** The folded run was pressed; `first` is the first card it held. */
  onUnfold: (first: string, pointer: boolean) => void;
  /** Hands each card's button to the day, which gives focus back to it; a
      folded block is handed over under every card it holds. */
  hold: (key: string, el: HTMLButtonElement | null) => void;
  ref?: Ref<DayBarHandle>;
}) {
  const bar = useRef<HTMLDivElement>(null);
  /* THE CARD UNDER THE POINTER is never folded and shows at full strength,
     so it is part of the fit. It clears when the pointer leaves the BAR,
     not the card: a finished card that unfolds under the pointer grows,
     and clearing on the card's own edge would fold it back under the
     pointer and flicker.

     IT IS THE CARD THE POINTER MOVED ONTO, read off `mousemove`, never
     `mouseenter`. The cards grow and give way under a pointer that is
     standing still, and the browser reports each one that passes under it
     as entered; taking those as hovers would unfold the next card, move
     the bar again, and chase the pointer. A move is the person's own. */
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  /* THE GROW. Every card's button by its slot key, the slots as last drawn
     (key and the items each holds), the poses read before a change, and
     the grow in flight. Read and written only in handlers and effects. */
  const els = useRef(new Map<string, HTMLButtonElement>());
  const drawn = useRef<{ key: string; members: string[] }[]>([]);
  const pending = useRef<CardPose[] | "cut" | null>(null);
  const runs = useRef<Animation[]>([]);
  const shoot = (): CardPose[] =>
    drawn.current.flatMap(({ key, members }) => {
      const el = els.current.get(key);
      return el ? [poseOf(el, key, members)] : [];
    });
  const capture = (move: boolean) => {
    pending.current = move && motionAllowed() ? shoot() : "cut";
  };
  useImperativeHandle(ref, () => ({ capture }));
  const hover = (key: string | null) => {
    if (key === hoverKey) return;
    capture(true);
    setHoverKey(key);
  };
  const [width, setWidth] = useState<number | null>(null);
  /* Wrapped: a function handed to a state setter is called, not stored. */
  const [measured, setMeasured] = useState<{ measure: DayMeasure } | null>(null);

  /* Both set from callbacks, never synchronously in the effect, so the
     first render is the server's on both sides of hydration. */
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = bar.current;
    const ready = typeof document === "undefined" ? undefined : document.fonts?.ready;
    if (!el || !ready) return;
    let live = true;
    void ready.then(() => {
      const measure = live ? canvasMeasure(getComputedStyle(el).fontFamily) : null;
      if (measure) setMeasured({ measure });
    });
    return () => {
      live = false;
    };
  }, []);

  const fit = fitDay({
    items,
    nowMin,
    barWidth: width ?? DAY_NOMINAL_W,
    selectedKey,
    hoverKey,
    showFinished,
    measure: measured?.measure ?? guessMeasure,
  });
  const last = fit.slots.length - 1;
  const at = fit.slots.findIndex((s) => s.selected);
  /* The open card's outline runs round its slant, and an end card's outer
     slant is cut away by the bar: the bar draws that side of the outline
     itself, down its own square end. */
  const selEnd = [at === 0 && "first", at >= 0 && at === last && "last"].filter(Boolean).join(" ");

  /* After every commit: note what was drawn, and if the day captured the
     bar before this change, grow each card from where it stood. Any grow
     still in flight stops first, so the boxes read here are the layout's
     own — and the ones captured were where that grow had got to. */
  useLayoutEffect(() => {
    drawn.current = fit.slots.map((s) => ({ key: s.key, members: s.items.map((it) => it.key) }));
    const first = pending.current;
    pending.current = null;
    if (first === null) return;
    for (const a of runs.current) a.cancel();
    runs.current = [];
    if (first === "cut") return;
    const timing = { duration: DAY_GROW_MS, easing: DAY_GROW_EASE };
    for (const move of growPlan(first, shoot())) {
      const el = els.current.get(move.key);
      const skin = el?.querySelector(".hd-skin");
      if (move.skin && skin) runs.current.push(skin.animate(skinFrames(move.skin), timing));
      for (const part of DAY_PARTS) {
        const d = move.parts[part];
        const p = d && el?.querySelector(PART_SEL[part]);
        if (d && p) runs.current.push(p.animate(shiftFrames(d), timing));
      }
    }
  });

  return (
    <div
      className="hd-bar"
      ref={bar}
      {...KEEPS_DAY}
      data-sel-end={selEnd || undefined}
      data-compact={fit.compact || undefined}
      onMouseLeave={() => hover(null)}
    >
      <div className="hd-row">
        {fit.slots.map((slot, i) => {
          const group = slot.kind === "group";
          const paint = dayCardPaint(slot, slot.p, { selected: slot.selected, hovered: slot.hovered });
          const end = [i === 0 && "first", i === last && "last"].filter(Boolean).join(" ");
          return (
            <button
              key={slot.key}
              ref={(el) => {
                if (el) els.current.set(slot.key, el);
                else els.current.delete(slot.key);
                hold(slot.key, el);
                if (group) for (const it of slot.items) hold(it.key, el);
              }}
              type="button"
              className="hd-card"
              data-kind={slot.kind}
              data-state={group ? "done" : dayState(slot.items[0]!, nowMin)}
              data-end={end || undefined}
              data-live={slot.live || undefined}
              data-collapsed={slot.collapsed || undefined}
              aria-expanded={group ? undefined : slot.selected}
              aria-controls={group ? undefined : panelId}
              aria-label={dayCardLabel(slot, nowMin)}
              title={dayCardTip(slot) ?? undefined}
              style={
                {
                  flex: `${slot.grow} ${slot.shrink} ${slot.basis}px`,
                  minWidth: slot.minWidth,
                  "--hd-bg": paint.bg,
                  "--hd-fill": paint.fill,
                  "--hd-text": paint.text,
                  /* The darker shade fills the card as the job runs; to come
                     and finished have none. */
                  "--hd-p": slot.p > 0 && slot.p < 1 ? String(slot.p) : "0",
                } as CSSProperties
              }
              onClick={(e) =>
                group ? onUnfold(slot.items[0]!.key, e.detail > 0) : onChoose(slot.key, e.detail > 0)
              }
              onMouseMove={group ? undefined : () => hover(slot.key)}
            >
              <span className="hd-skin">
                <span className="hd-fill" />
                {/* The light round the job on now: his loop, named in docs/design.md. */}
                {slot.live && (
                  <span className="hd-trace">
                    <i />
                  </span>
                )}
              </span>
              {!slot.collapsed && (
                <span className="hd-lab">
                  <span className="hd-tag">{slot.tag}</span>
                  <span className="hd-mid">
                    <span className="hd-name">{slot.name}</span>
                    <span className="hd-time">{slot.time}</span>
                  </span>
                </span>
              )}
              {slot.p >= 1 && (
                <span className="hd-tick">
                  <Icon name="check" size={12} sw={3.4} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
