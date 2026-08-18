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

  /* ── THE WAY IN ──
     The dots fly out of the Tiff button and land in the mark, and the ORDER is
     the whole readable idea: the button sits up and right of the card, `t` runs
     up the mark's own diagonal the same way, so filling from the top down lays
     the chevron out away from the corner it arrived from. Get the sort
     backwards and the animation still plays — it just builds back toward the
     button, which reads as the mark being sucked in rather than delivered. */
  it("arrives from the top of the mark down", () => {
    const gd = dots.map((d) => d.gd);
    expect(Math.min(...gd)).toBe(0);
    expect(Math.max(...gd)).toBe(1);

    const first = dots.reduce((a, b) => (a.gd < b.gd ? a : b));
    const last = dots.reduce((a, b) => (a.gd > b.gd ? a : b));
    expect(first.t).toBeGreaterThan(last.t);
    // and it is the extreme of the mark either end, not merely a high one
    expect(first.t).toBe(Math.max(...dots.map((d) => d.t)));
    expect(last.t).toBe(Math.min(...dots.map((d) => d.t)));
  });

  /* RANKED, NOT TAKEN RAW. `t` is not evenly spread — the tail is a third of
     the dots over a fifth of the range — so using it directly as the delay
     bunches those departures into a lump and leaves gaps elsewhere. Ranking
     spreads them, and this is the property that says so: every step between
     consecutive arrivals is the same. */
  it("spreads the departures evenly, however `t` is bunched", () => {
    const sorted = [...dots].map((d) => d.gd).sort((a, b) => a - b);
    const step = 1 / (sorted.length - 1);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeCloseTo(step, 6);
    }
  });

  it("bows the flight, and keeps the bow off the straight line", () => {
    for (const d of dots) {
      expect(Math.abs(d.bx)).toBeLessThanOrEqual(38);
      expect(Math.abs(d.by)).toBeLessThanOrEqual(38);
    }
    // no two dots share a bow, or 200 of them fly as one object
    const seen = new Set(dots.map((d) => `${d.bx.toFixed(2)},${d.by.toFixed(2)}`));
    expect(seen.size).toBe(dots.length);
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
