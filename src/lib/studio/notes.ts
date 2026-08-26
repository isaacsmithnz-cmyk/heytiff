/* Notes — the design's own markup layer.

   Everything else on this canvas is a THING: a room has an area, a unit has a
   capacity, a run has a length. A note is the one object that means nothing to
   the engine and everything to the person reading the drawing — "check this
   bulkhead depth on site", "existing unit stays".

   It is drawn the way that has been drawn on every set of construction
   documents for fifty years: a revision cloud around what is being talked
   about, a leader line out of the drawing, and the words in the margin where
   they can't sit on top of the work. That shape is the whole point — the cloud
   says WHERE and the margin says WHAT, and neither has to fight the plan for
   room.

   Pure data + pure geometry, no React and no canvas: the same functions draw
   the note on the live canvas and on the printed sheet, so paper and screen
   can't drift. `type` is open on DesignObject by design (see document.ts), so
   the note needs no schema bump — a document without notes is a document with
   an empty markup layer, which is exactly what every design before this one
   is. */

import { newId, type DesignObject, type Point } from "./document";

export const NOTE_TYPE = "note";

/* ── ink ──────────────────────────────────────────────────────────────────
   A drawing office marks up in more than one colour, and the colour usually
   means something the words don't repeat — this trade's clouds in one ink,
   this revision's in another, a query in red.

   Eight, and deliberately DEEP ones. The system palette (cockpit-panel.ts)
   is mid-bright because a system is a 2.5px line; a note is TEXT that has to
   be read off a printed sheet, so every ink here clears 4.5:1 on white and
   sits darker than any system colour — which is also what keeps a note from
   reading as somebody's pipework. Amber is missing on purpose: rooms wear it.
   Guarded in __tests__/notes.test.ts. ── */
export interface NoteInk {
  id: string;
  label: string;
  hex: string;
}

export const NOTE_INKS: readonly NoteInk[] = [
  { id: "indigo", label: "Indigo", hex: "#4338CA" },
  { id: "blue", label: "Blue", hex: "#1D4ED8" },
  { id: "teal", label: "Teal", hex: "#0F766E" },
  { id: "green", label: "Green", hex: "#15803D" },
  { id: "red", label: "Red", hex: "#C81E3C" },
  { id: "orange", label: "Orange", hex: "#C2410C" },
  { id: "purple", label: "Purple", hex: "#7E22CE" },
  { id: "graphite", label: "Graphite", hex: "#334155" },
];

/** what a note is drawn in when nobody has chosen — the ink notes shipped in */
export const DEFAULT_NOTE_INK = NOTE_INKS[0].hex;

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** A note's ink.

    The HEX is stored, not the palette id, for the same reason `DesignSystem`
    stores one: a design printed a year from now must come out the colour it
    was drawn in, even if this palette is retuned. So the check here is that
    the value is a well-formed colour, NOT that it is still on the palette —
    a note keeps whatever it was given, and only garbage falls back. */
export function noteInkOf(o: DesignObject): string {
  const v = o.props.ink;
  return typeof v === "string" && HEX6.test(v) ? v : DEFAULT_NOTE_INK;
}

/** A note's cloud, as a box. Stored as the polygon's four corners so a note
    is an ordinary object to everything that walks geometry (bounds, floors,
    delete); read back as a rect because a cloud is always axis-aligned. */
export interface NoteRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type NoteObject = DesignObject & {
  geometry: { kind: "polygon"; points: Point[] };
};

export function isNote(o: DesignObject): o is NoteObject {
  return o.type === NOTE_TYPE && o.geometry.kind === "polygon";
}

/** The cloud's scallop chord, in world units.

    Sized off the SHORT side — about six bumps along it — so the cloud reads
    the same whether it is around a wall penetration or around half a floor.
    Floored at a fraction of the LONG side, because a 10:1 cloud sized purely
    off its short end would ripple its long edges into noise. */
export function scallopFor(rect: NoteRect): number {
  const short = Math.max(Math.min(Math.abs(rect.w), Math.abs(rect.h)), 1);
  const long = Math.max(Math.abs(rect.w), Math.abs(rect.h), 1);
  return Math.max(short / 6, long / 20, 1);
}

/** Normalise a drag (two opposite corners) into a positive-extent rect. */
export function rectFromDrag(a: Point, b: Point): NoteRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function rectCorners(r: NoteRect): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

export function noteRect(o: NoteObject): NoteRect {
  const pts = o.geometry.points;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function noteLeader(o: DesignObject): Point {
  const l = o.props.leader as { x?: unknown; y?: unknown } | undefined;
  return { x: Number(l?.x ?? 0), y: Number(l?.y ?? 0) };
}

export function noteText(o: DesignObject): string {
  return typeof o.props.text === "string" ? o.props.text : "";
}

export function createNote(opts: {
  floorId: string;
  rect: NoteRect;
  leader: Point;
  text?: string;
  /** the armed ink; omitted = the default */
  ink?: string;
  id?: string;
}): DesignObject {
  return {
    id: opts.id ?? newId("note"),
    type: NOTE_TYPE,
    /* systemId null, always. A note is about the DRAWING, not about one
       system's pipework — switching the canvas to another system must not
       make somebody's "existing unit stays" disappear from the sheet. */
    systemId: null,
    floorId: opts.floorId,
    geometry: { kind: "polygon", points: rectCorners(opts.rect) },
    plane: "room",
    props: {
      text: opts.text ?? "",
      leader: { x: opts.leader.x, y: opts.leader.y },
      ink: opts.ink && HEX6.test(opts.ink) ? opts.ink : DEFAULT_NOTE_INK,
    },
  };
}

/** Move a whole note — cloud and its margin text travel together, because a
    leader that stayed put while its cloud walked away would point at nothing. */
export function moveNote(o: NoteObject, dx: number, dy: number): DesignObject {
  const l = noteLeader(o);
  return {
    ...o,
    geometry: {
      kind: "polygon",
      points: o.geometry.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    },
    props: { ...o.props, leader: { x: l.x + dx, y: l.y + dy } },
  };
}

/* ── orphans ──────────────────────────────────────────────────────────────
   A note reaches the document at the LEADER CLICK — before a single word of
   it exists. That ordering is deliberate (the cloud has to be on the drawing
   to be drawn, and the placement has to be undoable), and closing the editor
   normally sweeps an untyped one straight back off again.

   But "closing the editor normally" is only Done, Enter and Escape. Anything
   that takes the editor away WITHOUT going through them leaves a cloud and a
   leader pointing at nothing, with no words — the exact mystery balloon that
   sweep exists to prevent. Seen for real on 2026-08-26: a deploy landed
   mid-note, hard-reloaded the tab, and the empty note was still on the design
   afterwards.

   So the sweep is also a REPAIR, run on open (normalizeDesign). It is safe as
   a repair for the same reason the attach repair is: no gesture can leave an
   empty note behind on purpose — the editor deletes one every way it can be
   closed by hand — so an empty note in a stored document is always wreckage. */

/** Nothing but a cloud and a leader: a note with no words. Whitespace counts
    as none, because a space is not a note either. */
export function isEmptyNote(o: DesignObject): boolean {
  return isNote(o) && noteText(o).trim() === "";
}

/** Drop every wordless note. Returns the SAME array when there is nothing to
    sweep, so callers can keep using identity to tell whether they changed
    anything (normalizeDesign does). */
export function pruneEmptyNotes(objects: DesignObject[]): DesignObject[] {
  const kept = objects.filter((o) => !isEmptyNote(o));
  return kept.length === objects.length ? objects : kept;
}

/* ── the cloud ──────────────────────────────────────────────────────────── */

const n2 = (v: number) => Math.round(v * 100) / 100;

/** The revision cloud as one closed SVG path: arcs of equal chord walked
    clockwise around the box, each bulging outward.

    Clockwise is what makes the sweep flag a constant. In SVG's y-down space a
    sweep-flag of 1 draws the arc clockwise on screen, and the clockwise side
    of a clockwise traversal is the OUTSIDE — so every scallop bulges away from
    the box without a per-edge normal anywhere in sight.

    Scallops are distributed evenly per edge rather than continuously around
    the perimeter, so a corner always lands on a corner. */
export function cloudPath(rect: NoteRect, scallop = scallopFor(rect)): string {
  const corners = rectCorners(rect);
  const step = Math.max(scallop, 0.01);
  const parts: string[] = [`M ${n2(corners[0].x)} ${n2(corners[0].y)}`];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const n = Math.max(1, Math.round(len / step));
    const s = len / n;
    /* radius from chord s and a sagitta of 0.28·s: r = (s²/4 + h²) / 2h.
       Bigger than s/2, so the arc is always drawable. */
    const r = n2(s * 0.5864);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      parts.push(
        `A ${r} ${r} 0 0 1 ${n2(a.x + (b.x - a.x) * t)} ${n2(a.y + (b.y - a.y) * t)}`
      );
    }
  }
  parts.push("Z");
  return parts.join(" ");
}

/* ── the leader ─────────────────────────────────────────────────────────── */

/** Where the leader leaves the cloud: the point on the box's edge along the
    line from its centre to the margin. Pointing from the centre is what keeps
    the leader aimed at the thing being talked about however the note is
    dragged around it. */
export function leaderStart(rect: NoteRect, leader: Point): Point {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = leader.x - cx;
  const dy = leader.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = Math.max(rect.w / 2, 1e-6);
  const hh = Math.max(rect.h / 2, 1e-6);
  const t = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Which way the margin text reads. The text hangs off the side of the leader
    AWAY from the cloud, so it never doubles back across the drawing. */
export function noteSide(rect: NoteRect, leader: Point): 1 | -1 {
  return leader.x >= rect.x + rect.w / 2 ? 1 : -1;
}

/* ── the margin text ────────────────────────────────────────────────────── */

/** Longest line, in characters, before the text wraps. Chosen so a note reads
    as a column in the margin rather than a sentence running off the sheet. */
export const NOTE_WRAP_CHARS = 28;

/** Word-wrap for SVG, which has no wrapping of its own. Explicit newlines are
    kept (somebody who typed a list meant a list); a single word longer than
    the measure is left long rather than hyphenated mid-model-number. */
export function wrapNoteText(text: string, maxChars = NOTE_WRAP_CHARS): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (para.trim() === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out.length > 0 ? out : [""];
}

/** The horizontal landing between the elbow and the first character. */
export const NOTE_SHOULDER_EM = 1.15;
/** Line spacing, as a multiple of the font size. */
export const NOTE_LINE_EM = 1.32;

export interface NoteTextLayout {
  lines: string[];
  side: 1 | -1;
  /** the elbow — where the leader turns into the horizontal landing */
  elbow: Point;
  /** the far end of the landing; the text starts just past it */
  shoulder: Point;
  /** x of the text's anchored edge */
  textX: number;
  anchor: "start" | "end";
  /** baseline of the first line; later lines step down by `lineH` */
  firstBaseline: number;
  lineH: number;
  /** the block's bounding box — for hit-testing and for print bounds. Width is
      ESTIMATED from the character count: nothing here can measure a font, and
      a box a few percent wide costs a slightly generous click target and a
      slightly generous margin on paper. */
  box: NoteRect;
}

/** Lay the margin text out around the leader end. `fontSize` is in the same
    units the caller draws in (world units on the canvas, sheet units on
    paper), so both surfaces get the same shape at their own scale. */
export function noteTextLayout(
  rect: NoteRect,
  leader: Point,
  text: string,
  fontSize: number,
  maxChars = NOTE_WRAP_CHARS
): NoteTextLayout {
  const lines = wrapNoteText(text, maxChars);
  const side = noteSide(rect, leader);
  const shoulderLen = fontSize * NOTE_SHOULDER_EM;
  const lineH = fontSize * NOTE_LINE_EM;
  const shoulder = { x: leader.x + side * shoulderLen, y: leader.y };
  const gap = fontSize * 0.3;
  const textX = shoulder.x + side * gap;
  // the block is centred on the leader's height: a three-line note points at
  // its middle, not at its first word
  const blockH = lines.length * lineH;
  const firstBaseline = leader.y - blockH / 2 + fontSize * 0.82;
  const width = Math.max(...lines.map((l) => l.length)) * fontSize * 0.56;
  return {
    lines,
    side,
    elbow: { x: leader.x, y: leader.y },
    shoulder,
    textX,
    anchor: side === 1 ? "start" : "end",
    firstBaseline,
    lineH,
    box: {
      x: side === 1 ? textX : textX - width,
      y: leader.y - blockH / 2,
      w: width,
      h: blockH,
    },
  };
}

/** Everything a note occupies, cloud + leader + margin text — what the print
    figure has to leave room for, or the words fall off the sheet. */
export function noteBounds(o: NoteObject, fontSize: number): NoteRect {
  const rect = noteRect(o);
  const leader = noteLeader(o);
  const lay = noteTextLayout(rect, leader, noteText(o), fontSize);
  const x0 = Math.min(rect.x, lay.box.x, leader.x);
  const y0 = Math.min(rect.y, lay.box.y, leader.y);
  const x1 = Math.max(rect.x + rect.w, lay.box.x + lay.box.w, leader.x);
  const y1 = Math.max(rect.y + rect.h, lay.box.y + lay.box.h, leader.y);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* ── hit-testing ────────────────────────────────────────────────────────── */

const nearSegment = (p: Point, a: Point, b: Point, tol: number): boolean => {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t)) <= tol;
};

const inRect = (p: Point, r: NoteRect, tol: number): boolean =>
  p.x >= r.x - tol && p.x <= r.x + r.w + tol && p.y >= r.y - tol && p.y <= r.y + r.h + tol;

/** What part of a note the pointer is on — or null for a miss.

    The cloud is grabbed by its OUTLINE, not its fill. A note is drawn around
    something, so its middle is full of the very rooms and units you still need
    to click; a solid hit target would make every clouded area unusable. */
export function noteHit(
  o: NoteObject,
  p: Point,
  tol: number,
  fontSize: number
): "cloud" | "text" | "leader" | null {
  const rect = noteRect(o);
  const leader = noteLeader(o);
  const lay = noteTextLayout(rect, leader, noteText(o), fontSize);
  if (inRect(p, lay.box, tol) || nearSegment(p, lay.elbow, lay.shoulder, tol)) return "text";
  if (inRect(p, rect, tol) && !inRect(p, rect, -tol)) return "cloud";
  if (nearSegment(p, leaderStart(rect, leader), lay.elbow, tol)) return "leader";
  return null;
}
