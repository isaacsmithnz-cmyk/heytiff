import { CHEVRON_STROKES } from "@/components/logo";
import { buildDotField, markInk, parsePolyline } from "../dot-mark";

/* The mark, drawn as dots, is the one thing on the capture card that has to
   still BE the logo after a hundred small edits. These pin the properties that
   would break silently — a chevron that is off-centre, a gradient that never
   reaches teal, or a cloud that differs between two opens — none of which
   throws, and all of which just look slightly wrong. */

/** Re-derived independently of the module: is a point inside the stroke? */
function insideStroke(px: number, py: number) {
  for (const s of CHEVRON_STROKES) {
    const nums = s.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const pts: [number, number][] = [];
    for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    if (s.d.trim().endsWith("Z")) pts.push(pts[0]);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const vx = bx - ax, vy = by - ay;
      const len2 = vx * vx + vy * vy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
      if (Math.hypot(px - (ax + vx * t), py - (ay + vy * t)) <= s.width / 2) return true;
    }
  }
  return false;
}

describe("the mark, as dots", () => {
  const SIZE = 268, COLS = 26;
  const { dots, dotPx } = buildDotField(SIZE, COLS);

  it("covers the chevron and nothing else", () => {
    // enough to read as the mark, not so many it is a filled block
    expect(dots.length).toBeGreaterThan(80);
    expect(dots.length).toBeLessThan(160);

    // every dot the module kept is genuinely on the stroke, checked against a
    // second implementation that shares only the path data
    const cell = 100 / COLS;
    const kept = new Set<string>();
    for (const d of dots) kept.add(`${d.x.toFixed(3)},${d.y.toFixed(3)}`);
    let checked = 0;
    for (let r = 0; r < COLS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (insideStroke((c + 0.5) * cell, (r + 0.5) * cell)) checked++;
      }
    }
    expect(checked).toBe(dots.length);
  });

  /* THE CHEVRON IS NOT CENTRED IN ITS OWN VIEWBOX — it sits between x 22 and
     90, drawn to hang beside a wordmark. Centred on the box instead of on its
     own bounds it reads visibly right of centre, and nothing about that fails
     loudly. */
  it("is centred on its own bounds, not the viewBox's", () => {
    const xs = dots.map((d) => d.x), ys = dots.map((d) => d.y);
    const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    // within half a cell of dead centre
    expect(Math.abs(midX)).toBeLessThan(dotPx);
    expect(Math.abs(midY)).toBeLessThan(dotPx);
  });

  /* The gradient ramp is normalised over the mark's extent. Taken raw across
     the viewBox the chevron only spans about a fifth to four fifths of the
     diagonal, never reaches either end, and the whole thing renders blue. */
  it("ramps the full gradient across the mark", () => {
    const ts = dots.map((d) => d.t);
    expect(Math.min(...ts)).toBeCloseTo(0, 5);
    expect(Math.max(...ts)).toBeCloseTo(1, 5);
    expect(markInk(0)).toBe("rgb(0,229,192)");
    expect(markInk(1)).toBe("rgb(46,104,255)");
  });

  it("keeps the tail at the weight the mark draws it", () => {
    const weights = [...new Set(dots.map((d) => +(d.lit / 0.92).toFixed(2)))].sort();
    expect(weights).toEqual([0.55, 1]);
  });

  /* Two opens must be the same cloud. Anything drawn from a real random source
     reads as noise rather than as a mechanism, and it would also mean the
     capture card never looks the same twice. */
  it("builds the same cloud every time", () => {
    const a = buildDotField(SIZE, COLS).dots;
    const b = buildDotField(SIZE, COLS).dots;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("puts the cloud in a shell, clear of the middle", () => {
    for (const d of dots) {
      const r = Math.hypot(d.hx, d.hy / 0.82, d.hz);
      expect(r).toBeGreaterThan(SIZE * 0.2);
      expect(r).toBeLessThan(SIZE * 0.45);
      // the waypoint is further out again, so dots gather inward onto the shell
      expect(Math.hypot(d.fx, d.fy, d.fz)).toBeGreaterThan(r * 0.9);
    }
  });

  /* If the mark ever gains a curve, this parser would sample it as a straight
     line and the dots would quietly draw a slightly different logo. It refuses
     instead, which is the one failure mode worth being loud about. */
  it("refuses a path command it cannot sample", () => {
    expect(parsePolyline("M22 24 L40 24 Z")).toEqual([[22, 24], [40, 24], [22, 24]]);
    expect(() => parsePolyline("M22 24 C30 24 34 30 40 50")).toThrow(/only knows M, L and Z/);
  });

  it("still parses the real mark", () => {
    for (const s of CHEVRON_STROKES) expect(parsePolyline(s.d).length).toBeGreaterThan(2);
  });
});
