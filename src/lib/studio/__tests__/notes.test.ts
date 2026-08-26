/* Notes — the markup layer's geometry.

   Two properties carry the whole feature and neither is visible from the code
   alone, so they are tested against the SVG spec rather than against the
   implementation:

   1. every scallop bulges OUTWARD (a cloud that bulges inward is a flower);
   2. the middle of a cloud is NOT a hit target — a note is drawn AROUND
      rooms and units, and if its middle swallowed clicks it would make every
      clouded area of the plan unusable.

   The first is checked by rebuilding each arc's midpoint from the SVG arc
   parameterisation (w3.org/TR/SVG/implnote.html#ArcConversionEndpointToCenter)
   and asserting it lands outside the box. That is deliberately NOT how
   cloudPath computes anything, so the test can actually fail. */

import {
  cloudPath,
  createNote,
  DEFAULT_NOTE_INK,
  isEmptyNote,
  NOTE_INKS,
  noteInkOf,
  pruneEmptyNotes,
  isNote,
  leaderStart,
  moveNote,
  noteBounds,
  noteHit,
  noteLeader,
  noteRect,
  noteSide,
  noteText,
  noteTextLayout,
  rectCorners,
  rectFromDrag,
  wrapNoteText,
  type NoteObject,
  type NoteRect,
} from "../notes";
import type { DesignObject, Point } from "../document";

const RECT: NoteRect = { x: 0, y: 0, w: 200, h: 120 };

/* ── the arc midpoint, from the SVG endpoint→centre conversion ── */
function arcMid(p1: Point, p2: Point, r: number): Point {
  const xp = (p1.x - p2.x) / 2;
  const yp = (p1.y - p2.y) / 2;
  const d2 = xp * xp + yp * yp;
  // large-arc 0, sweep 1 → the flags differ → the centre offset takes the + sign
  const k = Math.sqrt(Math.max(0, (r * r - d2) / d2));
  const cx = k * yp + (p1.x + p2.x) / 2;
  const cy = -k * xp + (p1.y + p2.y) / 2;
  const t1 = Math.atan2(p1.y - cy, p1.x - cx);
  const t2 = Math.atan2(p2.y - cy, p2.x - cx);
  let sweep = t2 - t1;
  while (sweep <= 0) sweep += Math.PI * 2; // sweep-flag 1 = increasing angle
  const t = t1 + sweep / 2;
  return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
}

/** every arc in a cloud path, as {from, to, r} */
function arcs(d: string): { from: Point; to: Point; r: number }[] {
  const tokens = d.split(/(?=[MAZ])/).map((t) => t.trim()).filter(Boolean);
  const out: { from: Point; to: Point; r: number }[] = [];
  let cur: Point = { x: 0, y: 0 };
  for (const tk of tokens) {
    if (tk.startsWith("M")) {
      const [x, y] = tk.slice(1).trim().split(/\s+/).map(Number);
      cur = { x, y };
    } else if (tk.startsWith("A")) {
      const n = tk.slice(1).trim().split(/\s+/).map(Number);
      const to = { x: n[5], y: n[6] };
      out.push({ from: cur, to, r: n[0] });
      cur = to;
    }
  }
  return out;
}

const mkNote = (rect: NoteRect, leader: Point, text = "Check on site"): NoteObject =>
  createNote({ floorId: "flr", rect, leader, text, id: "note_1" }) as NoteObject;

describe("the revision cloud", () => {
  it("closes, and starts at the box's top-left corner", () => {
    const d = cloudPath(RECT);
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.trimEnd().endsWith("Z")).toBe(true);
  });

  /* the corner order IS the outward direction: sweep-flag 1 draws clockwise on
     screen, and the clockwise side of a clockwise traversal is the outside.
     Reverse these four points and every scallop turns inward. */
  it("walks its corners clockwise in screen space", () => {
    const pts = rectCorners(RECT);
    let shoelace = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      shoelace += a.x * b.y - b.x * a.y;
    }
    expect(shoelace).toBeGreaterThan(0); // y-down: positive = clockwise
  });

  it("bulges every scallop outward, on all four sides", () => {
    const found = arcs(cloudPath(RECT));
    expect(found.length).toBeGreaterThanOrEqual(8);
    const sides = new Set<string>();
    for (const a of found) {
      const m = arcMid(a.from, a.to, a.r);
      const out =
        m.x < RECT.x - 0.01
          ? "left"
          : m.x > RECT.x + RECT.w + 0.01
            ? "right"
            : m.y < RECT.y - 0.01
              ? "top"
              : m.y > RECT.y + RECT.h + 0.01
                ? "bottom"
                : null;
      expect(out).not.toBeNull(); // never inside the box
      sides.add(out!);
    }
    expect([...sides].sort()).toEqual(["bottom", "left", "right", "top"]);
  });

  it("uses the sweep flag that makes that true", () => {
    // "A r r 0 0 1 x y" — large-arc 0, sweep 1
    expect(/A [\d.]+ [\d.]+ 0 0 1 /.test(cloudPath(RECT))).toBe(true);
    expect(cloudPath(RECT)).not.toContain(" 0 0 0 ");
  });

  it("keeps every arc drawable — radius never below half its chord", () => {
    for (const a of arcs(cloudPath(RECT))) {
      const chord = Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y);
      expect(a.r).toBeGreaterThanOrEqual(chord / 2 - 1e-6);
    }
  });

  it("scales its scallops with the box rather than counting them", () => {
    const small = arcs(cloudPath({ x: 0, y: 0, w: 40, h: 40 })).length;
    const big = arcs(cloudPath({ x: 0, y: 0, w: 400, h: 400 })).length;
    expect(small).toBeGreaterThanOrEqual(8);
    expect(big).toBeGreaterThanOrEqual(8);
    // both stay in a readable range — no single bulge per edge, no ripples
    expect(small).toBeLessThan(40);
    expect(big).toBeLessThan(40);
  });

  it("survives a degenerate box without emitting NaN", () => {
    const d = cloudPath({ x: 5, y: 5, w: 0, h: 0 });
    expect(d).not.toContain("NaN");
  });
});

describe("the leader", () => {
  it("leaves the cloud on the side the words are on", () => {
    expect(leaderStart(RECT, { x: 500, y: 60 })).toEqual({ x: 200, y: 60 });
    expect(leaderStart(RECT, { x: -500, y: 60 })).toEqual({ x: 0, y: 60 });
    expect(leaderStart(RECT, { x: 100, y: -500 })).toEqual({ x: 100, y: 0 });
    expect(leaderStart(RECT, { x: 100, y: 500 })).toEqual({ x: 100, y: 120 });
  });

  it("reads the text away from the plan, not back across it", () => {
    expect(noteSide(RECT, { x: 600, y: 0 })).toBe(1);
    expect(noteSide(RECT, { x: -600, y: 0 })).toBe(-1);
  });
});

describe("the margin text", () => {
  it("wraps to a column and keeps the lines somebody typed", () => {
    expect(wrapNoteText("one two three four five", 9)).toEqual([
      "one two",
      "three",
      "four five",
    ]);
    expect(wrapNoteText("first\nsecond", 40)).toEqual(["first", "second"]);
  });

  it("leaves a long word long rather than breaking a model number", () => {
    expect(wrapNoteText("MSZ-AP50VGKD", 6)).toEqual(["MSZ-AP50VGKD"]);
  });

  it("anchors to the side it reads towards", () => {
    const right = noteTextLayout(RECT, { x: 500, y: 60 }, "hello", 12);
    const left = noteTextLayout(RECT, { x: -500, y: 60 }, "hello", 12);
    expect(right.anchor).toBe("start");
    expect(right.textX).toBeGreaterThan(500);
    expect(right.box.x).toBeGreaterThan(500);
    expect(left.anchor).toBe("end");
    expect(left.textX).toBeLessThan(-500);
    expect(left.box.x + left.box.w).toBeLessThan(-500);
  });

  /* a three-line note points at its middle, not at its first word */
  it("centres the block on the leader's height", () => {
    const lay = noteTextLayout(RECT, { x: 500, y: 60 }, "a\nb\nc", 12);
    expect(lay.lines).toHaveLength(3);
    expect(lay.box.y + lay.box.h / 2).toBeCloseTo(60, 6);
  });
});

describe("a note as an object", () => {
  it("belongs to no system — markup is about the drawing", () => {
    const n = mkNote(RECT, { x: 400, y: 60 });
    expect(n.systemId).toBeNull();
    expect(isNote(n)).toBe(true);
    expect(noteRect(n)).toEqual(RECT);
    expect(noteLeader(n)).toEqual({ x: 400, y: 60 });
    expect(noteText(n)).toBe("Check on site");
  });

  it("is not mistaken for a room", () => {
    const n = mkNote(RECT, { x: 400, y: 60 });
    expect(n.type).not.toBe("room");
    expect(isNote({ ...n, type: "room" })).toBe(false);
  });

  it("travels whole — a leader left behind points at nothing", () => {
    const moved = moveNote(mkNote(RECT, { x: 400, y: 60 }), 10, -5) as NoteObject;
    expect(noteRect(moved)).toEqual({ x: 10, y: -5, w: 200, h: 120 });
    expect(noteLeader(moved)).toEqual({ x: 410, y: 55 });
  });

  it("reads a rect back from either drag direction", () => {
    expect(rectFromDrag({ x: 30, y: 40 }, { x: 10, y: 10 })).toEqual({
      x: 10,
      y: 10,
      w: 20,
      h: 30,
    });
  });

  it("claims room for its words, not just its cloud", () => {
    const n = mkNote(RECT, { x: 900, y: 60 });
    const b = noteBounds(n, 12);
    expect(b.x).toBeLessThanOrEqual(0);
    expect(b.x + b.w).toBeGreaterThan(900); // the text is past the leader
  });
});

/* The ink palette. Two of these are contrast guards over DATA rather than
   over a stylesheet, which is the only kind that can be checked here — a note
   is text on white paper, and an ink nobody can read is not a colour choice,
   it is a bug that only shows up on a printed sheet in somebody's van. */
describe("the ink palette", () => {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
  };
  const onWhite = (hex: string) => 1.05 / (lum(hex) + 0.05);

  it("offers eight inks, each one usable", () => {
    expect(NOTE_INKS).toHaveLength(8);
    for (const ink of NOTE_INKS) {
      expect(ink.hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(ink.label.length).toBeGreaterThan(0);
    }
  });

  it("keeps every ink readable as TEXT on white paper", () => {
    // asserted as a map so a failure NAMES the ink that fell short
    const failing = NOTE_INKS.filter((i) => onWhite(i.hex) < 4.5).map(
      (i) => `${i.label} ${i.hex} @ ${onWhite(i.hex).toFixed(2)}:1`
    );
    expect(failing).toEqual([]);
  });

  it("has no two inks a person could confuse", () => {
    const ids = NOTE_INKS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const hexes = NOTE_INKS.map((i) => i.hex);
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it("reads a note's ink back, and falls back only on garbage", () => {
    const n = mkNote(RECT, { x: 400, y: 60 });
    expect(noteInkOf(n)).toBe(DEFAULT_NOTE_INK);
    const red = createNote({
      floorId: "flr",
      rect: RECT,
      leader: { x: 400, y: 60 },
      ink: "#C81E3C",
    });
    expect(noteInkOf(red)).toBe("#C81E3C");
    expect(noteInkOf({ ...n, props: { ...n.props, ink: "red" } })).toBe(DEFAULT_NOTE_INK);
    expect(noteInkOf({ ...n, props: { ...n.props, ink: 42 } })).toBe(DEFAULT_NOTE_INK);
  });

  /* the hex is stored, not the palette id — a design printed a year from now
     must come out the colour it was drawn in, even if this palette is retuned */
  it("keeps an ink that is no longer on the palette", () => {
    const n = mkNote(RECT, { x: 400, y: 60 });
    expect(noteInkOf({ ...n, props: { ...n.props, ink: "#123456" } })).toBe("#123456");
  });
});

/* A note reaches the document at the LEADER CLICK, before its words exist.
   Every ordinary way of closing the editor sweeps an untyped one straight
   back off; a deploy reload mid-note does not, and that is how one arrived on
   a real design (prod, 2026-08-26). These pin the sweep that repairs it. */
describe("wordless notes", () => {
  const withText = (t: string) =>
    createNote({ floorId: "flr", rect: RECT, leader: { x: 400, y: 60 }, text: t, id: "n" });

  it("knows a note with nothing on it", () => {
    expect(isEmptyNote(withText(""))).toBe(true);
    expect(isEmptyNote(withText("   "))).toBe(true);
    expect(isEmptyNote(withText("\n\t "))).toBe(true);
    expect(isEmptyNote(withText("Check on site"))).toBe(false);
    // a single character IS a note — the bar is "did somebody write anything"
    expect(isEmptyNote(withText("?"))).toBe(false);
  });

  it("does not mistake another empty-propped object for one", () => {
    const room: DesignObject = {
      id: "r", type: "room", systemId: null, floorId: "flr",
      geometry: { kind: "polygon", points: rectCorners(RECT) }, plane: "room", props: {},
    };
    expect(isEmptyNote(room)).toBe(false);
  });

  it("sweeps the wordless and keeps the rest, in order", () => {
    const kept = withText("Existing unit stays");
    const objs = [withText(""), kept, withText("  ")];
    expect(pruneEmptyNotes(objs).map((o) => noteText(o))).toEqual(["Existing unit stays"]);
  });

  /* the identity contract normalizeDesign leans on to tell an open from an
     edit: nothing to sweep must return the SAME array */
  it("returns the same array when there is nothing to sweep", () => {
    const objs = [withText("a"), withText("b")];
    expect(pruneEmptyNotes(objs)).toBe(objs);
  });

  it("leaves a document of non-notes untouched by reference", () => {
    const objs: DesignObject[] = [];
    expect(pruneEmptyNotes(objs)).toBe(objs);
  });
});

describe("what a note catches", () => {
  const n = mkNote(RECT, { x: 500, y: 60 });

  it("is grabbed by its outline", () => {
    expect(noteHit(n, { x: 0, y: 60 }, 6, 12)).toBe("cloud");
    expect(noteHit(n, { x: 200, y: 60 }, 6, 12)).toBe("cloud");
  });

  /* the point of the whole hit-test: the middle of a cloud belongs to the
     plan underneath it */
  it("lets a click through its middle to the drawing beneath", () => {
    expect(noteHit(n, { x: 100, y: 60 }, 6, 12)).toBeNull();
  });

  it("is grabbed by its words", () => {
    const lay = noteTextLayout(RECT, { x: 500, y: 60 }, noteText(n), 12);
    expect(noteHit(n, { x: lay.box.x + 2, y: 60 }, 6, 12)).toBe("text");
  });

  it("is grabbed by its leader", () => {
    expect(noteHit(n, { x: 350, y: 60 }, 6, 12)).toBe("leader");
  });

  it("misses everything else", () => {
    expect(noteHit(n, { x: -400, y: -400 }, 6, 12)).toBeNull();
  });
});
