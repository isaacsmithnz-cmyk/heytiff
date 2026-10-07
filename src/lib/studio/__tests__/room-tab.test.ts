/* A ROOM'S LABEL IS A TAB ON ITS WALL (Isaac, 2026-10-07): mid-wall it hugs
   one wall, slid to a square corner it tucks in, at an inside corner it stops
   a flare short. Mocked at claude.ai/artifact/WfWqaNsqrgPtkQh5fowQPi. */

import type { Point } from "../document";
import {
  autoTabS,
  nearestTabS,
  placeTab,
  storedTabS,
  tabPath,
  tabShare,
  tabSizePx,
  wallsOf,
  wordsWidthPx,
  TAB_FLARE,
} from "../room-tab";

const rect = (x0: number, y0: number, w: number, h: number): Point[] => [
  { x: x0, y: y0 },
  { x: x0 + w, y: y0 },
  { x: x0 + w, y: y0 + h },
  { x: x0, y: y0 + h },
];
/* an L: the top arm 0–430 by 0–90, the leg 0–120 down to 230 */
const L: Point[] = [
  { x: 0, y: 0 },
  { x: 430, y: 0 },
  { x: 430, y: 90 },
  { x: 120, y: 90 },
  { x: 120, y: 230 },
  { x: 0, y: 230 },
];
const SIZE = { w: 80, h: 44 };

describe("the words' width", () => {
  it("is the face's own, glyph by glyph — 'Living / Dining' measured 6.80 em", () => {
    expect(wordsWidthPx("Living / Dining", 100)).toBeCloseTo(679, -1);
  });

  it("sizes the tab to its words and its padding", () => {
    const s = tabSizePx([{ text: "Bath", size: 13 }, { text: "4.6 m²", size: 11, weight: 600 }], 16);
    expect(s.w).toBe(Math.ceil(Math.max(wordsWidthPx("Bath", 13), wordsWidthPx("4.6 m²", 11, 600)) + 24));
    expect(s.firstBaseline).toBeGreaterThan(8);
  });
});

describe("a tab on a wall", () => {
  const room = wallsOf(rect(0, 0, 600, 400));

  it("in the middle of a run hugs that one wall, centred where it was put", () => {
    const t = placeTab(room, 300, SIZE, 1)!;
    expect(t.att).toEqual({ top: true, right: false, bottom: false, left: false });
    expect([t.x0, t.x1, t.y0, t.y1]).toEqual([260, 340, 0, 44]);
  });

  it("slid within a snap of a square corner tucks into it, square on both walls", () => {
    const t = placeTab(room, 50, SIZE, 1)!;
    expect(t.att).toEqual({ top: true, right: false, bottom: false, left: true });
    expect([t.x0, t.y0]).toEqual([0, 0]);
  });

  it("on a plumb wall reaches into the room by its width, its words still level", () => {
    // the right wall runs 600–1000 round
    const t = placeTab(room, 800, SIZE, 1)!;
    expect(t.att.right).toBe(true);
    expect(t.x1 - t.x0).toBe(80);
    expect(t.y1 - t.y0).toBe(44);
  });

  it("stops a flare short of an inside corner rather than run across the floor", () => {
    // the L's inside corner is (120, 90): the top arm's underside runs 520–830 round, toward it
    const g = wallsOf(L);
    const t = placeTab(g, 829, SIZE, 1)!;
    expect(t.att.bottom).toBe(true);
    expect(t.x0).toBeCloseTo(120 + TAB_FLARE, 6);
  });

  it("measures the way round clockwise whichever way the room was drawn", () => {
    const cw = rect(0, 0, 600, 400);
    const ccw = [cw[0], cw[3], cw[2], cw[1]];
    expect(placeTab(wallsOf(ccw), 300, SIZE, 1)).toEqual(placeTab(wallsOf(cw), 300, SIZE, 1));
  });

  it("is nothing when no level or plumb wall can carry it", () => {
    const diamond = [{ x: 300, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 300 }];
    expect(placeTab(wallsOf(diamond), 0, SIZE, 1)).toBeNull();
    expect(placeTab(wallsOf(rect(0, 0, 40, 30)), 0, SIZE, 1)).toBeNull();
  });
});

describe("its outline", () => {
  const t = placeTab(wallsOf(rect(0, 0, 600, 400)), 300, SIZE, 1)!;

  it("fills as one closed shape, the wall flaring into it", () => {
    const d = tabPath(t, 1);
    expect(d.endsWith("Z")).toBe(true);
    // the flare runs out onto the wall a flare's width past each side
    expect(d).toContain(`${260 - TAB_FLARE} 0`);
    expect(d).toContain(`${340 + TAB_FLARE} 0`);
  });

  it("is dashed only along its own sides — the run on the wall is lifted, not drawn", () => {
    const edge = tabPath(t, 1, true);
    expect(edge.endsWith("Z")).toBe(false);
    // the run along the top wall is a move, never a line
    expect(edge).not.toMatch(/L [\d.]+ 0(?![\d.])/);
    expect((edge.match(/A /g) ?? []).length).toBe(4); // two flares, two rounded corners
  });
});

describe("moving it round", () => {
  const g = wallsOf(rect(0, 0, 600, 400));

  it("takes the pointer to the nearest point on a wall it can sit on", () => {
    expect(nearestTabS(g, { x: 590, y: 200 }, SIZE)).toBeCloseTo(800, 6);
    expect(nearestTabS(g, { x: 300, y: 20 }, SIZE)).toBeCloseTo(300, 6);
  });

  it("is kept as a share of the way round, so a reshaped room keeps it on about the same stretch", () => {
    expect(tabShare(800, g.P)).toBe(0.4);
    expect(storedTabS({ labelEdge: 0.4 }, wallsOf(rect(0, 0, 900, 600)))).toBeCloseTo(1200, 6);
    expect(storedTabS({}, g)).toBeNull();
  });
});

describe("where it goes by itself", () => {
  const g = wallsOf(rect(0, 0, 600, 400));

  it("is the top-left corner when nothing is there", () => {
    const s = autoTabS(g, SIZE, 1, () => 0)!;
    expect(placeTab(g, s, SIZE, 1)!.att).toEqual({ top: true, right: false, bottom: false, left: true });
  });

  it("moves to the next clear corner when something sits in that one", () => {
    const s = autoTabS(g, SIZE, 1, (t) => (t.x0 === 0 && t.y0 === 0 ? 1 : 0))!;
    const t = placeTab(g, s, SIZE, 1)!;
    expect(t.att).toEqual({ top: true, right: true, bottom: false, left: false });
  });
});
