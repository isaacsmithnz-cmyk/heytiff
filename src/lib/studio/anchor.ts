/* Placing a floating panel next to a point on the canvas.

   The calibration card used to do this with two hard-coded guesses
   (`Math.min(x + 14, size.w - 240)`): the numbers were a stand-in for the
   panel's real size, there was no lower clamp, and it never flipped to the
   other side of the anchor — so near the right or bottom edge the card was
   shoved back over the very point it was asking about, or simply cut off.

   The panel's measured size goes in, so nothing here has to guess. */

export type Size = { w: number; h: number };

export type AnchorOpts = {
  /** the point the panel belongs to, in canvas-local screen px */
  anchor: { x: number; y: number };
  /** the panel's measured size */
  panel: Size;
  /** the canvas box the panel must stay inside */
  box: Size;
  /** gap between the anchor and the panel */
  offset?: number;
  /** keep-clear from the canvas edges */
  margin?: number;
  /** chrome to stay clear of at the top (the tool-hint strip) */
  reserveTop?: number;
  /** chrome to stay clear of at the bottom (the readout HUD) */
  reserveBottom?: number;
};

/** Choose the bottom or top slot for a horizontally-centred panel so it
    covers as little of `rect` as possible.

    The wall-marking panel lives in a fixed slot at the bottom of the canvas —
    which is where the bottom wall of the room you're marking usually is, so
    the panel hid the very edge you were trying to click. Ties keep the
    bottom, which is where the panel has always been. */
export function dodgeSlot(opts: {
  /** the thing to stay off, as a screen-space bounding box */
  rect: { x0: number; y0: number; x1: number; y1: number };
  panel: Size;
  box: Size;
  /** the slot's inset from the top/bottom edge */
  margin?: number;
}): "top" | "bottom" {
  const { rect, panel, box, margin = 22 } = opts;
  const panelLeft = (box.w - panel.w) / 2;
  const overlapAt = (top: number) => {
    const dy = Math.max(0, Math.min(rect.y1, top + panel.h) - Math.max(rect.y0, top));
    const dx = Math.max(
      0,
      Math.min(rect.x1, panelLeft + panel.w) - Math.max(rect.x0, panelLeft)
    );
    return dx * dy;
  };
  return overlapAt(box.h - margin - panel.h) <= overlapAt(margin) ? "bottom" : "top";
}

/** Position a panel beside `anchor`: below-right by preference, flipped to
    the opposite side when that would overflow, then clamped inside the box.
    Returns canvas-local `left`/`top` in px. */
export function anchorFloating(opts: AnchorOpts): { left: number; top: number } {
  const {
    anchor,
    panel,
    box,
    offset = 14,
    margin = 10,
    reserveTop = 0,
    reserveBottom = 0,
  } = opts;

  // preferred corner, then flip rather than shove — a panel pushed back over
  // its own anchor hides the thing it is describing
  let left = anchor.x + offset;
  if (left + panel.w + margin > box.w) left = anchor.x - offset - panel.w;
  let top = anchor.y + offset;
  if (top + panel.h + margin + reserveBottom > box.h) top = anchor.y - offset - panel.h;

  /* Clamp last, and clamp the LOW edge second: a panel taller or wider than
     the space left to it pins to the top/left margin and overflows the far
     edge, which at least keeps its heading and first control reachable. */
  const maxLeft = Math.max(margin, box.w - panel.w - margin);
  const maxTop = Math.max(margin + reserveTop, box.h - panel.h - margin - reserveBottom);
  return {
    left: Math.min(Math.max(left, margin), maxLeft),
    top: Math.min(Math.max(top, margin + reserveTop), maxTop),
  };
}
