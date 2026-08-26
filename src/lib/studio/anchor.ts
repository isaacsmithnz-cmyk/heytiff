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
  /** the thing the panel is ABOUT, as a screen-space box. A note's editor
      anchors to the leader end, but the leader is a short line — every corner
      around it is within a panel's reach of the cloud, so "flip when you would
      overflow" happily parks the card on the cloud you are annotating. Given
      this box, the corner that covers the least of it wins. */
  avoid?: { x0: number; y0: number; x1: number; y1: number };
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
    the opposite side rather than shoved when that would overflow, and — when
    an `avoid` box is given — flipped to whichever corner covers least of it.
    Returns canvas-local `left`/`top` in px.

    All four corners are CLAMPED first and judged after, because clamping is
    what actually decides where a panel lands near an edge: the corner that
    overflows on paper can be the one that, once pulled back inside, sits
    clear of the thing it describes. Judged in order: how much of `avoid` it
    covers, then how far the clamp had to shove it, then the preferred corner.
    With no `avoid` the first test is always a tie, so this is exactly the old
    below-right-then-flip behaviour. */
export function anchorFloating(opts: AnchorOpts): { left: number; top: number } {
  const {
    anchor,
    panel,
    box,
    offset = 14,
    margin = 10,
    reserveTop = 0,
    reserveBottom = 0,
    avoid,
  } = opts;

  /* Clamp the LOW edge second: a panel taller or wider than the space left to
     it pins to the top/left margin and overflows the far edge, which at least
     keeps its heading and first control reachable. */
  const maxLeft = Math.max(margin, box.w - panel.w - margin);
  const maxTop = Math.max(margin + reserveTop, box.h - panel.h - margin - reserveBottom);
  const clamp = (left: number, top: number) => ({
    left: Math.min(Math.max(left, margin), maxLeft),
    top: Math.min(Math.max(top, margin + reserveTop), maxTop),
  });

  const covered = (left: number, top: number) => {
    if (!avoid) return 0;
    const dx = Math.max(0, Math.min(avoid.x1, left + panel.w) - Math.max(avoid.x0, left));
    const dy = Math.max(0, Math.min(avoid.y1, top + panel.h) - Math.max(avoid.y0, top));
    return dx * dy;
  };

  /* in preference order — below-right first, and ties keep the earlier one */
  const corners = [
    [anchor.x + offset, anchor.y + offset],
    [anchor.x - offset - panel.w, anchor.y + offset],
    [anchor.x + offset, anchor.y - offset - panel.h],
    [anchor.x - offset - panel.w, anchor.y - offset - panel.h],
  ];

  let best: { left: number; top: number } | null = null;
  let bestScore = [Infinity, Infinity];
  for (const [wantL, wantT] of corners) {
    const at = clamp(wantL, wantT);
    const score = [
      covered(at.left, at.top),
      Math.abs(at.left - wantL) + Math.abs(at.top - wantT),
    ];
    if (score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
      best = at;
      bestScore = score;
    }
  }
  return best!;
}
