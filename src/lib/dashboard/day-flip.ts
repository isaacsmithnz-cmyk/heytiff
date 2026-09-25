/* YOUR DAY, IN MOTION — the arithmetic of the grow.

   A card that opens grows, and the cards beside it give way; finished work
   folds into its block and opens out of it; the panel under the bar comes
   in, and the body under the day makes room for it. The layout itself is
   day-bar's and changes at once, in one commit. What moves is a FLIP: every
   box is read before the change, the change is committed, every box is read
   again, and each part is animated from where it WAS to where it now is,
   with transforms only. Nothing animates `flex-grow` or `min-width`, which
   would lay the bar out again on every frame.

   A CARD'S SKIN LEANS, so its drawn box is wider than its layout box by the
   bar's height, half at each side, and a skin mid-grow is drawn scaled as
   well. Scaling is applied BEFORE the skew (`skewX(45deg) scaleX(s)` reads
   right to left), so the slant stays 45° at every frame and the drawn box
   is always the layout box scaled, plus the slant: reading it back gives the
   box a grow in flight has reached, and a press that lands mid-grow starts
   the next one from there rather than from rest.

   THE WORDS NEVER SCALE. The tag, the name and time, and the tick each move
   by `translate` alone, from their own place before the change to their
   place after it — so the place name slides to the middle of the card that
   opens, and no letter is ever drawn stretched.

   Pure, but for `motionAllowed`, which asks the browser the two things that
   decide whether anything moves at all. */

import { DAY_H } from "./day-bar";

/** His grow's curve, as the prototype he walked eased it (`flex-grow .35s
    ease`). With `DAY_GROW_MS`, a named exemption from law 18's tokens in
    docs/design.md. */
export const DAY_GROW_EASE = "ease";
/** The panel fades in on `--t-fast`, and the body under the day moves on
    `--t-move`, ease-out: law 18's own tokens, as the numbers the animation
    API needs (home-day-sheet holds them to tokens.css). */
export const DAY_PANEL_FADE_MS = 120;
export const DAY_BODY_MOVE_MS = 200;
export const DAY_BODY_EASE = "ease-out";

/** Whether anything moves here at all: never under reduced motion, where
    every change is simply there, and never without the animation API. Read
    at the moment of a change, so a setting changed mid-visit is obeyed. */
export function motionAllowed(): boolean {
  if (typeof window === "undefined" || typeof Element === "undefined") return false;
  if (typeof Element.prototype.animate !== "function") return false;
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** A box along the bar, in page pixels. */
export type Span = { left: number; width: number };
export type Point = { x: number; y: number };

/** The level parts of a card that move with it. */
export const DAY_PARTS = ["tag", "mid", "tick"] as const;
export type DayPart = (typeof DAY_PARTS)[number];

/** One card as it stood at a moment: its key, the items it holds (a folded
    block holds several), its skin's layout box, and where each of its level
    parts was centred. */
export type CardPose = {
  key: string;
  members: readonly string[];
  span: Span | null;
  parts: Partial<Record<DayPart, Point>>;
};

/** A skin's layout box, read off its drawn bounding box: the slant widens
    the drawn box by the bar's height, half at each side, at rest and mid-
    grow alike. */
export function skinSpan(drawn: { left: number; width: number }): Span {
  return { left: drawn.left + DAY_H / 2, width: Math.max(0, drawn.width - DAY_H) };
}

const centre = (s: Span) => s.left + s.width / 2;

/** Where a card's grow starts: its own box before the change. A card that
    was folded into a block before starts as that block, so the cards open
    OUT of it; a block that has just folded starts as the cards it took in,
    end to end, so they close INTO it. Null for a card that was nowhere:
    it is simply there. */
export function startSpan(key: string, members: readonly string[], before: readonly CardPose[]): Span | null {
  const own = before.find((p) => p.key === key);
  if (own?.span) return own.span;
  if (members.length > 1 || !members.includes(key)) {
    const took = before.filter((p) => p.span && p.members.some((m) => members.includes(m)));
    if (took.length === 0) return null;
    const left = Math.min(...took.map((p) => p.span!.left));
    const right = Math.max(...took.map((p) => p.span!.left + p.span!.width));
    return { left, width: right - left };
  }
  return before.find((p) => p.span && p.key !== key && p.members.includes(key))?.span ?? null;
}

const round = (v: number, places: number) => {
  const f = 10 ** places;
  const r = Math.round(v * f) / f;
  return r === 0 ? 0 : r;
};

/** How far a skin must be put back, and how much narrower or wider, to
    stand where it was: `dx` between the two middles, `s` the old width over
    the new. Null when it has not moved. */
export function flipOf(from: Span, to: Span): { dx: number; s: number } | null {
  if (to.width <= 0) return null;
  const dx = round(centre(from) - centre(to), 2);
  const s = round(Math.max(from.width, 1) / to.width, 4);
  if (Math.abs(dx) < 0.5 && Math.abs(s - 1) < 0.005) return null;
  return { dx, s };
}

/** A skin's keyframes. The two ends are the same three functions, so the
    browser eases each one on its own — the lean held at 45° throughout —
    rather than decomposing a matrix, which would tilt it mid-grow. */
export function skinFrames({ dx, s }: { dx: number; s: number }): Keyframe[] {
  return [
    { transform: `translateX(${dx}px) skewX(45deg) scaleX(${s})` },
    { transform: "translateX(0px) skewX(45deg) scaleX(1)" },
  ];
}

/** A level part's keyframes: `translate`, which composes with whatever
    `transform` the sheet already gives it (the open tag's own centring). */
export function shiftFrames({ dx, dy }: { dx: number; dy: number }): Keyframe[] {
  return [{ translate: `${dx}px ${dy}px` }, { translate: "0px 0px" }];
}

/** What moves when the bar changes: each card that is on the bar now,
    from where it stood before. A skin grows from its start box
    (`startSpan`); each level part slides from its own place before, or —
    a part that was not there, on a card that opened out of a block — rides
    with its card from the block's middle. Nothing that stands still is in
    the plan. */
export type CardMove = {
  key: string;
  skin: { dx: number; s: number } | null;
  parts: Partial<Record<DayPart, { dx: number; dy: number }>>;
};

export function growPlan(before: readonly CardPose[], after: readonly CardPose[]): CardMove[] {
  const out: CardMove[] = [];
  for (const card of after) {
    if (!card.span) continue;
    const from = startSpan(card.key, card.members, before);
    if (!from) continue;
    const skin = flipOf(from, card.span);
    const was = before.find((p) => p.key === card.key);
    const parts: CardMove["parts"] = {};
    for (const part of DAY_PARTS) {
      const to = card.parts[part];
      if (!to) continue;
      const at = was?.parts[part];
      const d = at
        ? { dx: round(at.x - to.x, 2), dy: round(at.y - to.y, 2) }
        : { dx: round(centre(from) - centre(card.span), 2), dy: 0 };
      if (Math.abs(d.dx) >= 0.5 || Math.abs(d.dy) >= 0.5) parts[part] = d;
    }
    if (skin || Object.keys(parts).length > 0) out.push({ key: card.key, skin, parts });
  }
  return out;
}

/* ── under the bar ───────────────────────────────────────────────────── */

/** The body under the day, put back to where it stood: the panel opening
    pushes it down, closing lets it up, and it travels there on `--t-move`.
    Null when it has not moved. */
export function liftOf(before: number, after: number): number | null {
  const dy = round(before - after, 2);
  return Math.abs(dy) < 0.5 ? null : dy;
}

export function liftFrames(dy: number): Keyframe[] {
  return [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0px)" }];
}

/** The panel appears: it fades in, on `--t-fast`. It is not a height
    animation — the body's move is what makes its room. */
export const PANEL_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
