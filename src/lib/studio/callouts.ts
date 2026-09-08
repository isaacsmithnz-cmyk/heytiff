/* Unit callouts — a unit's own information, said on the drawing.

   A unit carries no text on the plan. That was a deliberate fix: role and
   model used to sit stacked on every box, and with face labels, spigot
   diameters and pipe lengths alongside them the plan stopped being readable.
   So identity moved off the drawing — the glyph and the system colour carry it
   there, hovering names the unit in a corner card, clicking opens it in the
   inspector.

   Which is fine while you are AT the screen, and no use at all on paper or to
   anyone reading over your shoulder. Isaac:

     "when you click on a unit, I want to display the unit information as if it
      were a cloud note — a line coming off that unit the same way the line
      generates off the cloud note. That would bring you to a little bubble to
      show you that unit's information, model number."

   And, asked whether that is a live readout or part of the drawing:

     "Part of the drawing. That way you can move the unit information to
      somewhere that you want to yourself, just in case it's hard to read on
      the plan."

   So this is the drawing-office callout: a leader out of the thing, and its
   name at the end of it, placed by hand where there is room. Same mechanic as
   the revision cloud's leader in notes.ts, and deliberately so — one gesture
   language for everything that points at something.

   ── WHY A CALLOUT IS NOT AN OBJECT ──

   It lives on the unit, as `props.callout`, and it is ONLY an offset. Every
   word in the bubble is read live from the unit and the pack at draw time, so
   a callout owns no data of its own and there is nothing in it to go stale.

   That is also what keeps it out of the orphan class the note tool shipped
   with (#541): a note is an independent object written to the document before
   its words exist, so anything that killed the editor left a cloud pointing at
   nothing, and it took a repair pass on load to sweep them. A callout cannot
   be orphaned by construction — move the unit and it travels, delete the unit
   and it goes with it, and no sweep exists because none can be needed.

   ── AND WHY IT IS PURE GEOMETRY, HERE, WITH NO REACT ──

   The canvas and `plan-figure.tsx` both lay a callout out through
   `calloutLayout`, exactly as they both lay a note out through `noteLayoutOf`.
   That single door is the only thing stopping paper drifting from screen, and
   the note tool learned it the hard way. `fontSize` is in whatever units the
   caller draws in — world units on the canvas, sheet units on paper — so both
   surfaces get the same shape at their own scale. */

import type { DesignObject, Point } from "./document";
import { leaderStart, type NoteRect } from "./notes";

/** Where the leader ENDS, as an offset from the unit's own point. The bubble
    hangs off that end the way a note's words hang off its leader. */
export interface CalloutPlacement {
  x: number;
  y: number;
}

/** The lines the bubble says. The model is the headline — it is the thing
    Isaac asked for by name — and the rest is what the corner card already
    knows: what it is, what it holds, and what it serves. */
export interface CalloutContent {
  model: string;
  lines: string[];
}

export interface CalloutLayout {
  /** every line, model first */
  lines: string[];
  /** 1 = the bubble hangs to the right of the leader end, -1 = to the left */
  side: 1 | -1;
  /** where the leader leaves the unit's footprint */
  start: Point;
  /** where the leader meets the bubble */
  end: Point;
  box: NoteRect;
  textX: number;
  anchor: "start" | "end";
  firstBaseline: number;
  lineH: number;
  fontSize: number;
}

/* Both from the note's own type scale, so a callout and a written note read at
   one weight on the same sheet rather than as two different conventions. */
const LINE_EM = 1.32;
/* Neither renderer can measure text — the print figure runs inside
   `renderToStaticMarkup` with no DOM at all — so the box is sized from a
   character-width estimate, the same way notes.ts sizes its margin text.

   TWO ESTIMATES, NOT ONE, and the second is not a refinement: the head line is
   a MODEL NUMBER, which is uppercase alphanumeric set at weight 800, while the
   body lines are mixed case at 600. Measured on the real sheet the head runs
   about 0.70 em a character against the body's 0.545 — so a single estimate
   sized the box to the body and let "MSZ-AP50VGKD" hang five units out past
   its own border, which is exactly what the walk showed. */
const CHAR_EM = 0.56;
const HEAD_CHAR_EM = 0.72;
const PAD_EM = 0.62;

/** The placement stored on a unit, or null if nobody has placed one. Read
    through a clamp rather than validated on the way in, exactly like the note
    ink: a document is data from somewhere else and the drawing has to survive
    whatever is in it. */
export function calloutOf(o: DesignObject): CalloutPlacement | null {
  const c = o.props.callout as { x?: unknown; y?: unknown } | undefined;
  if (!c || typeof c !== "object") return null;
  const x = Number(c.x);
  const y = Number(c.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function withCallout(o: DesignObject, at: CalloutPlacement): DesignObject {
  return { ...o, props: { ...o.props, callout: { x: at.x, y: at.y } } };
}

export function withoutCallout(o: DesignObject): DesignObject {
  if (!("callout" in o.props)) return o;
  const props = { ...o.props };
  delete props.callout;
  return { ...o, props };
}

/**
 * What a unit says about itself.
 *
 * EVERY LINE IS A DOCUMENT FACT, and that is a constraint rather than a
 * preference: `plan-figure.tsx` is handed the document and nothing else — no
 * data pack, by design, because it is pure geometry that has to render inside
 * `renderToStaticMarkup` with no DOM. So anything derived from the pack could
 * be said on screen and not on paper, and the two would drift in the one place
 * the note tool proved they must not.
 *
 * Capacity is the line that costs: it is the obvious thing to want and it
 * lives in the catalogue, not on the object. It is left out rather than shown
 * in one renderer and missing from the other — and the cockpit, the hover card
 * and the schedule all still carry it, on screen, where the pack is.
 */
export function calloutContent(
  o: DesignObject,
  roomName: string | null
): CalloutContent {
  const lines: string[] = [];
  if (roomName) lines.push(`Serves ${roomName}`);
  const w = Math.round(Number(o.props.widthMm ?? 0));
  const d = Math.round(Number(o.props.depthMm ?? 0));
  if (w > 0 && d > 0) lines.push(`${w} × ${d} mm`);
  return { model: String(o.props.model ?? ""), lines };
}

/**
 * Where a callout first appears, before anyone has moved it.
 *
 * Up and to the RIGHT, and the direction is not arbitrary: the rotate knob
 * hangs off the footprint's turned TOP edge, so a default that went straight
 * up would put the bubble on the one handle a selected unit already has. Right
 * is also where a left-to-right reader looks for a label.
 *
 * It is proportional to the unit rather than a fixed distance, so a 600mm head
 * and a 2m AHU both get a leader that reads as a leader instead of a whisker
 * on one and a journey on the other.
 */
export function defaultCalloutOffset(fp: { w: number; h: number }): CalloutPlacement {
  return { x: fp.w * 0.9 + fp.w * 0.6, y: -(fp.h * 0.9 + fp.h * 0.6) };
}

/** Which way the bubble hangs: away from the unit, so it never doubles back
    across the thing it is naming. */
function sideOf(offset: CalloutPlacement): 1 | -1 {
  return offset.x >= 0 ? 1 : -1;
}

/**
 * A callout laid out around its leader end.
 *
 * `fontSize` is in the caller's own units — world on the canvas, sheet units
 * on paper — and every other measure here is in ems of it, which is what makes
 * one function serve both surfaces.
 */
export function calloutLayout(opts: {
  /** the unit's point, in the caller's units */
  at: Point;
  /** the unit's footprint, same units */
  footprint: { w: number; h: number };
  /** the stored placement, or the default if there is none */
  offset: CalloutPlacement;
  content: CalloutContent;
  fontSize: number;
  /** the unit's own rotation in degrees, if it has been turned */
  rotation?: number;
}): CalloutLayout {
  const { at, footprint, offset, content, fontSize } = opts;
  const lines = [content.model || "No model yet", ...content.lines].filter(
    (l) => l.trim().length > 0
  );
  const side = sideOf(offset);
  const end = { x: at.x + offset.x, y: at.y + offset.y };

  const pad = fontSize * PAD_EM;
  const lineH = fontSize * LINE_EM;
  const textW =
    fontSize *
    Math.max(
      lines[0].length * HEAD_CHAR_EM,
      ...lines.slice(1).map((l) => l.length * CHAR_EM),
      0
    );
  const boxW = textW + pad * 2;
  const boxH = lines.length * lineH + pad * 2;

  /* The box hangs off the leader end and is centred on its height, so a
     three-line callout points at its middle rather than at its first word —
     the same rule the note's margin text follows. */
  const box: NoteRect = {
    x: side === 1 ? end.x : end.x - boxW,
    y: end.y - boxH / 2,
    w: boxW,
    h: boxH,
  };

  /* The leader leaves the footprint along the line from the unit's centre to
     the bubble, which is what keeps it aimed at the unit however the bubble is
     dragged around it. Same function the note's cloud uses — a footprint is a
     rect like any other.

     A TURNED UNIT IS THE CATCH. `leaderStart` works on an axis-aligned rect,
     and both renderers draw the glyph rotated — so on a unit turned 45° an
     axis-aligned root would stop short of the edge you can see, or jut past
     it. The fix costs two rotations: ask the question in the unit's OWN frame
     and turn the answer back. */
  const fpRect: NoteRect = {
    x: at.x - footprint.w / 2,
    y: at.y - footprint.h / 2,
    w: footprint.w,
    h: footprint.h,
  };
  const rot = ((opts.rotation ?? 0) * Math.PI) / 180;
  const spin = (p: Point, a: number): Point => {
    if (!a) return p;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const dx = p.x - at.x;
    const dy = p.y - at.y;
    return { x: at.x + dx * c - dy * s, y: at.y + dx * s + dy * c };
  };

  return {
    lines,
    side,
    start: spin(leaderStart(fpRect, spin(end, -rot)), rot),
    end,
    box,
    textX: side === 1 ? box.x + pad : box.x + boxW - pad,
    anchor: side === 1 ? "start" : "end",
    firstBaseline: box.y + pad + fontSize * 0.82,
    lineH,
    fontSize,
  };
}

/** Everything a callout occupies — the bubble and the leader both. What the
    fit has to frame and what the pan clamp has to keep reachable, or a label
    dragged clear of the plan becomes a label you cannot get back to. */
export function calloutBounds(lay: CalloutLayout): NoteRect {
  const x0 = Math.min(lay.box.x, lay.start.x);
  const y0 = Math.min(lay.box.y, lay.start.y);
  const x1 = Math.max(lay.box.x + lay.box.w, lay.start.x);
  const y1 = Math.max(lay.box.y + lay.box.h, lay.start.y);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Where the remove control sits: the bubble's OUTER top corner — the side
    the words run away from the unit, so it can never land between the leader
    and the thing being named. Drawn only while the unit is selected, because a
    close button visible on every label would be chrome on the drawing. */
export function calloutCloseAt(lay: CalloutLayout): Point {
  return {
    x: lay.side === 1 ? lay.box.x + lay.box.w : lay.box.x,
    y: lay.box.y,
  };
}

/**
 * Is `p` on the bubble?
 *
 * The BOX is the whole target and the leader is not, which is the mirror of
 * the note's rule that the middle of a cloud is not a hit target. There the
 * reason is that the cloud is drawn AROUND work that has to stay clickable
 * through it; here it is that the leader sweeps across the drawing as the
 * bubble is dragged, and a line that grabs whatever it passes over would make
 * the plan underneath it unusable.
 */
export function hitCallout(lay: CalloutLayout, p: Point, tol = 0): boolean {
  return (
    p.x >= lay.box.x - tol &&
    p.x <= lay.box.x + lay.box.w + tol &&
    p.y >= lay.box.y - tol &&
    p.y <= lay.box.y + lay.box.h + tol
  );
}
