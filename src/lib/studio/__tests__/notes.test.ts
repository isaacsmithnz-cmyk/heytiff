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
  noteGripAt,
  noteGrips,
  noteHit,
  noteLayoutOf,
  noteLeader,
  noteRect,
  noteScaleOf,
  noteSide,
  noteText,
  noteTextLayout,
  noteWrapOf,
  NOTE_SCALE_MAX,
  NOTE_SCALE_MIN,
  NOTE_WRAP_CHARS,
  NOTE_WRAP_MAX,
  NOTE_WRAP_MIN,
  scaleForGripY,
  wrapForEdgeX,
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

  /* the default is the ONE ink with no hue: whatever colours a design's
     systems end up wearing, a note in graphite can never be read as one.
     The old default was an indigo, and on a sheet whose system was blue the
     two read as the same colour (seen on paper, 2026-08-26). */
  it("defaults to the hueless one", () => {
    expect(DEFAULT_NOTE_INK).toBe(NOTE_INKS[0].hex);
    const n = parseInt(DEFAULT_NOTE_INK.slice(1), 16);
    expect((n >> 16) & 255).toBe((n >> 8) & 255);
    expect((n >> 8) & 255).toBe(n & 255);
  });

  /* the point of the set: a LADDER from a near-black pen to a mid-tone, not
     eight similar darks */
  it("spans a real range of darkness rather than clustering", () => {
    const ratios = NOTE_INKS.map((i) => onWhite(i.hex));
    expect(Math.max(...ratios)).toBeGreaterThan(12);
    expect(Math.min(...ratios)).toBeLessThan(5.5);
  });

  const hue = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
    const mx = Math.max(r, g, b);
    const d = mx - Math.min(r, g, b);
    if (d === 0) return null; // the neutral
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (((h * 60) % 360) + 360) % 360;
  };
  const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

  it("spreads its hues instead of stacking up in one corner", () => {
    const hues = NOTE_INKS.map((i) => hue(i.hex)).filter((h): h is number => h !== null);
    expect(hues).toHaveLength(7); // exactly one neutral, and it is the default
    for (const a of hues) {
      const near = hues.filter((b) => b !== a && apart(a, b) < 20);
      expect([a, near]).toEqual([a, []]);
    }
  });

  /* A note must not read as somebody's pipework — and what makes two marks
     confusable is hue AND weight together, not either alone. Sharing a hue is
     fine when the ink is far darker (Navy sits 7° from the system blue and
     nearly nine stops below it); sharing a weight is fine when the hues are
     nothing alike (Olive and that same blue are 150° apart). The first draft
     of this guard tested weight only and failed Olive for looking nothing
     like a blue, which is how the rule got stated properly. */
  it("never matches a system colour in both hue and weight", () => {
    const system = ["#2E68FF", "#E4572E", "#17A398", "#9B5DE5", "#F5A623", "#D63384"];
    const clashes: string[] = [];
    for (const sys of system) {
      const sh = hue(sys);
      for (const ink of NOTE_INKS) {
        const ih = hue(ink.hex);
        if (sh === null || ih === null) continue;
        if (apart(sh, ih) < 25 && Math.abs(onWhite(ink.hex) - onWhite(sys)) < 1)
          clashes.push(`${ink.label} vs ${sys}`);
      }
    }
    expect(clashes).toEqual([]);
  });

  /* the tightest pair in the set, pinned so a retune cannot quietly close it:
     Brick sits almost exactly on the system orange's hue and is kept apart by
     weight alone */
  it("keeps its closest call to the system palette honest", () => {
    const brick = NOTE_INKS.find((i) => i.id === "brick")!;
    expect(apart(hue(brick.hex)!, hue("#E4572E")!)).toBeLessThan(10);
    expect(onWhite(brick.hex) - onWhite("#E4572E")).toBeGreaterThan(1.2);
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
    const wine = createNote({
      floorId: "flr",
      rect: RECT,
      leader: { x: 400, y: 60 },
      ink: "#9D174D",
    });
    expect(noteInkOf(wine)).toBe("#9D174D");
    expect(noteInkOf({ ...n, props: { ...n.props, ink: "red" } })).toBe(DEFAULT_NOTE_INK);
    expect(noteInkOf({ ...n, props: { ...n.props, ink: 42 } })).toBe(DEFAULT_NOTE_INK);
  });

  /* the hex is stored, not the palette id — and this stopped being
     hypothetical the day the palette was retuned (2026-08-26). Every note
     drawn before it keeps the colour it was drawn in, the old indigo default
     included; nothing silently re-tints on a design somebody has printed. */
  it("keeps an ink that is no longer on the palette", () => {
    const n = mkNote(RECT, { x: 400, y: 60 });
    expect(noteInkOf({ ...n, props: { ...n.props, ink: "#123456" } })).toBe("#123456");
    expect(noteInkOf({ ...n, props: { ...n.props, ink: "#4338CA" } })).toBe("#4338CA");
    expect(NOTE_INKS.map((i) => i.hex)).not.toContain("#4338CA");
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

/* ── the measure and the size (#552) ──────────────────────────────────────
   A note's words are a text frame: pull the side and they reflow, pull the
   corner and they scale. Both values live on the NOTE and both are read
   through a clamp, because a document is data from somewhere else. */

const sized = (props: Record<string, unknown>): NoteObject => {
  const n = mkNote(RECT, { x: 500, y: 60 }, "one two three four five six seven");
  return { ...n, props: { ...n.props, ...props } };
};

describe("a note's own measure and size", () => {
  it("defaults to the sheet's measure at the sheet's size", () => {
    const n = mkNote(RECT, { x: 500, y: 60 });
    expect(noteWrapOf(n)).toBe(NOTE_WRAP_CHARS);
    expect(noteScaleOf(n)).toBe(1);
  });

  it("clamps whatever the document says, rather than trusting it", () => {
    expect(noteWrapOf(sized({ wrap: 2 }))).toBe(NOTE_WRAP_MIN);
    expect(noteWrapOf(sized({ wrap: 5000 }))).toBe(NOTE_WRAP_MAX);
    expect(noteWrapOf(sized({ wrap: "wide" }))).toBe(NOTE_WRAP_CHARS);
    expect(noteWrapOf(sized({ wrap: 31.4 }))).toBe(31);
    expect(noteScaleOf(sized({ textScale: 0 }))).toBe(1);
    expect(noteScaleOf(sized({ textScale: -2 }))).toBe(1);
    expect(noteScaleOf(sized({ textScale: 99 }))).toBe(NOTE_SCALE_MAX);
    expect(noteScaleOf(sized({ textScale: 0.01 }))).toBe(NOTE_SCALE_MIN);
  });

  /* the whole point of `noteLayoutOf`: ONE door, so the canvas and the print
     figure cannot disagree about how wide or how big a note is */
  it("lays a note out at its own measure and size", () => {
    const narrow = noteLayoutOf(sized({ wrap: 10 }), 12);
    const wide = noteLayoutOf(sized({ wrap: 40 }), 12);
    expect(narrow.lines.length).toBeGreaterThan(wide.lines.length);
    expect(narrow.fontSize).toBe(12);

    const big = noteLayoutOf(sized({ textScale: 2 }), 12);
    expect(big.fontSize).toBe(24);
    // the type scaled, the wrap did NOT — same words, same lines
    expect(big.lines).toEqual(noteLayoutOf(sized({}), 12).lines);
    expect(big.box.h).toBeCloseTo(noteLayoutOf(sized({}), 12).box.h * 2, 6);
  });

  /* the "fit" pass reads these bounds, and it is the one thing that reliably
     leaves a note's words off the screen when they are not counted */
  it("carries both onto the bounds a fit has to leave room for", () => {
    const plain = noteBounds(sized({}), 12);
    const big = noteBounds(sized({ textScale: 2 }), 12);
    expect(big.w).toBeGreaterThan(plain.w);
    // tall enough to break out of the cloud's own 120 before the height moves
    const narrowAndBig = noteBounds(sized({ textScale: 2, wrap: NOTE_WRAP_MIN }), 12);
    expect(narrowAndBig.h).toBeGreaterThan(plain.h);
  });

  it("carries both into what the words CATCH", () => {
    const big = sized({ textScale: 2.5 });
    const lay = noteLayoutOf(big, 12);
    // a point well below the un-scaled block still lands on the scaled one
    const low = { x: lay.box.x + 2, y: lay.box.y + lay.box.h - 1 };
    expect(noteHit(big, low, 1, 12)).toBe("text");
    expect(noteHit(sized({}), low, 1, 12)).toBeNull();
  });
});

describe("the grips on a selected note's words", () => {
  const n = sized({});
  const lay = noteLayoutOf(n, 12);

  it("sit on the OUTER edge — the inner one already means 'move me'", () => {
    const g = noteGrips(n, 12);
    expect(g.measure.x).toBeCloseTo(lay.box.x + lay.box.w, 6);
    // the measure grip rides the leader's own height: the block is centred on
    // it, so it is the one point that does not move as lines are added
    expect(g.measure.y).toBe(60);
    expect(g.size.y).toBeGreaterThan(lay.box.y + lay.box.h);
  });

  it("flips with the words when the margin is on the other side", () => {
    const left = mkNote(RECT, { x: -400, y: 60 }, "one two three four five six");
    const l = noteLayoutOf(left, 12);
    expect(noteGrips(left, 12).measure.x).toBeCloseTo(l.box.x, 6);
  });

  it("hands the pointer the NEARER grip, and nothing at a distance", () => {
    const g = noteGrips(n, 12);
    expect(noteGripAt(n, g.measure, 4, 12)).toBe("measure");
    expect(noteGripAt(n, g.size, 4, 12)).toBe("size");
    expect(noteGripAt(n, { x: g.size.x, y: g.size.y + 500 }, 4, 12)).toBeNull();
  });
});

describe("what a grip drag works out", () => {
  const lay = noteLayoutOf(sized({}), 12);

  it("reads the measure off the edge the pointer is on", () => {
    // 20 characters' worth of width past the text's anchored edge
    const x = lay.textX + lay.side * (20 * lay.fontSize * 0.56);
    expect(wrapForEdgeX(lay, x)).toBe(20);
  });

  it("never lets the column collapse or run away", () => {
    expect(wrapForEdgeX(lay, lay.textX)).toBe(NOTE_WRAP_MIN);
    expect(wrapForEdgeX(lay, lay.textX - lay.side * 9999)).toBe(NOTE_WRAP_MIN);
    expect(wrapForEdgeX(lay, lay.textX + lay.side * 999999)).toBe(NOTE_WRAP_MAX);
  });

  /* the grip stays under the pointer: the block is centred on the leader, so
     its distance from there IS proportional to the type size */
  it("doubles the size when the grip is pulled to twice the distance", () => {
    expect(scaleForGripY({ from: 1, startY: 100, leaderY: 60, y: 140 })).toBe(2);
    expect(scaleForGripY({ from: 1, startY: 100, leaderY: 60, y: 90 })).toBe(0.75);
  });

  it("lands on a size somebody chose, not on a mouse event", () => {
    // 1.8670251… is what the raw ratio gives; a note stores 1.85
    expect(scaleForGripY({ from: 1, startY: 100, leaderY: 60, y: 134.68 })).toBe(1.85);
  });

  it("clamps, and survives a grip that began on the leader's own line", () => {
    expect(scaleForGripY({ from: 1, startY: 100, leaderY: 60, y: 9999 })).toBe(NOTE_SCALE_MAX);
    expect(scaleForGripY({ from: 1, startY: 100, leaderY: 60, y: 60 })).toBe(NOTE_SCALE_MIN);
    expect(scaleForGripY({ from: 1.4, startY: 60, leaderY: 60, y: 900 })).toBe(1.4);
  });
});
