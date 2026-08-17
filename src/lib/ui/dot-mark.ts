import { CHEVRON_STROKES } from "@/components/logo";

/* THE MARK, AS DOTS — the geometry behind the capture card's instrument.

   The card draws the HeyTiff chevron as a field of dots that fly apart into a
   cloud while Tiff thinks. Everything about where those dots are lives here,
   as plain arithmetic over the SAME path data the SVG draws (`CHEVRON_STROKES`
   in components/logo). Hand-tracing the chevron into a second array is a second
   logo, and it drifts the first time the real one is touched.

   WHY NOT ASK THE BROWSER. The prototype tested a grid against the real stroked
   path with `SVGGeometryElement.isPointInStroke`, which is exact and free of
   arithmetic — and wrong for shipping three times over: it needs a laid-out SVG
   in the document, it runs on every mount of a card that opens dozens of times
   a day, and it cannot run in jsdom, so nothing about the mark could be tested.
   A stroked polyline is just "within half a width of a segment", which is a
   dozen lines, deterministic, and provable.

   IT IS PURE, and that is the point of the file. No DOM, no clock, no random
   source — every per-dot number is derived from the dot's own index through a
   seeded hash, so the cloud is the same cloud every time it opens. Randomness
   per run reads as noise; repeatable reads as a mechanism. */

/** Only `M`, `L` and `Z` appear in the mark, and asserting that is cheaper than
    parsing SVG properly — a curve would silently sample as a straight line, so
    it throws rather than quietly drawing the wrong logo. Exported because that
    refusal is the part worth testing. */
export function parsePolyline(d: string): [number, number][] {
  /* Tokenised rather than split on whitespace: SVG writes the command hard
     against its first coordinate — the mark's own data is `M22 24 L40 24`, not
     `M 22 24` — so splitting on spaces yields "M22" and rejects the real logo. */
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
  const pts: [number, number][] = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === "Z" || cmd === "z") {
      if (pts.length) pts.push(pts[0]);
      continue;
    }
    if (cmd === "M" || cmd === "L") {
      pts.push([Number(tokens[i++]), Number(tokens[i++])]);
      continue;
    }
    throw new Error(`dot-mark: the mark grew a "${cmd}" command; this parser only knows M, L and Z`);
  }
  return pts;
}

/** Distance from a point to a segment — the whole of the hit test. With round
    joins and caps, "inside the stroke" IS "within half a width of the line",
    which is why nothing here needs to know about joins at all. */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

const STROKES = CHEVRON_STROKES.map((s) => ({ pts: parsePolyline(s.d), half: s.width / 2, opacity: s.opacity }));

/** Seeded, so the cloud and every dart in it are identical on every open. */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export type MarkDot = {
  /** Where it sits in the chevron, in px from the field's centre. */
  x: number;
  y: number;
  /** The mark's own weight — the tail is drawn at 55% and keeps it. */
  lit: number;
  /** 0–1 across the mark: the swell's phase, and the brand gradient's ramp. */
  t: number;
  /** Where it lives in the cloud, and the point it flies out through. */
  hx: number; hy: number; hz: number;
  fx: number; fy: number; fz: number;
  /** The four points it darts between while it waits, as offsets from home. */
  zip: [number, number, number][];
  /** Its own clocks, so no two dots are ever in step. */
  zipMs: number; zipPhase: number; fireMs: number; firePhase: number;
  /** How late it leaves on the way down, and its sideways drift. */
  delay: number; gx: number;
};

export type DotFieldGeometry = {
  dots: MarkDot[];
  /** Dot diameter for this size and density, in px. */
  dotPx: number;
};

/** How far the cloud's shell sits from the middle, as a share of the field. */
const CLOUD_INNER = 0.23, CLOUD_OUTER = 0.42;
/** How far a dot wanders from its own patch while it waits, in px. */
const ZIP_REACH = 34;

/**
 * Every dot in the mark, with everywhere it has to be afterwards.
 *
 * @param size  the field's width in px — everything scales off it
 * @param cols  grid resolution across the mark; 26 is the shipped density
 */
export function buildDotField(size: number, cols = 26): DotFieldGeometry {
  const half = (cols - 1) / 2;
  const cell = (size * 0.76) / cols;

  /* Pass one: which cells the stroke covers, and the mark's own bounds. The
     chevron is NOT centred in its viewBox — it sits between x 22 and 90,
     drawn to hang beside a wordmark — so centring on the box would read
     visibly right of where the eye puts it. */
  type Hit = { c: number; r: number; lit: number; raw: number };
  const hits: Hit[] = [];
  let minC = cols, maxC = -1, minR = cols, maxR = -1, minRaw = Infinity, maxRaw = -Infinity;

  for (let r = 0; r < cols; r++) {
    for (let c = 0; c < cols; c++) {
      const px = ((c + 0.5) * 100) / cols;
      const py = ((r + 0.5) * 100) / cols;
      let lit = 0;
      for (const s of STROKES) {
        let inside = false;
        for (let i = 1; i < s.pts.length && !inside; i++) {
          const [ax, ay] = s.pts[i - 1], [bx, by] = s.pts[i];
          if (distToSegment(px, py, ax, ay, bx, by) <= s.half) inside = true;
        }
        if (inside) { lit = s.opacity; break; }
      }
      if (!lit) continue;
      /* The gradient and the wave both run along the mark's diagonal, weighted
         toward x because the chevron points that way. */
      const raw = px * 0.7 + py * 0.3;
      if (c < minC) minC = c; if (c > maxC) maxC = c;
      if (r < minR) minR = r; if (r > maxR) maxR = r;
      if (raw < minRaw) minRaw = raw; if (raw > maxRaw) maxRaw = raw;
      hits.push({ c, r, lit, raw });
    }
  }

  const ox = (minC + maxC) / 2, oy = (minR + maxR) / 2;
  const span = maxRaw - minRaw || 1;

  /* Pass two: everything a dot needs for the rest of its life. The cloud is a
     loose SHELL rather than a filled ball — dots through the middle read as
     fog rather than as depth, the same reason the sphere drops its far side. */
  const dots: MarkDot[] = hits.map((h, i) => {
    const rr = size * (CLOUD_INNER + hash(i + 61) * (CLOUD_OUTER - CLOUD_INNER));
    const theta = hash(i + 149) * Math.PI * 2;
    const phi = Math.acos(2 * hash(i + 233) - 1);
    const hx = rr * Math.sin(phi) * Math.cos(theta);
    const hy = rr * Math.cos(phi) * 0.82;
    const hz = rr * Math.sin(phi) * Math.sin(theta);

    const zip: [number, number, number][] = [];
    for (let k = 0; k < 4; k++) {
      zip.push([
        (hash(i * 7 + k * 31 + 11) - 0.5) * 2 * ZIP_REACH,
        (hash(i * 7 + k * 31 + 401) - 0.5) * 2 * ZIP_REACH,
        (hash(i * 7 + k * 31 + 809) - 0.5) * 2 * ZIP_REACH,
      ]);
    }

    return {
      x: (h.c - ox) * cell,
      y: (h.r - oy) * cell,
      lit: h.lit * 0.92,
      t: (h.raw - minRaw) / span,
      hx, hy, hz,
      // the waypoint sits outside the shell, so the dots gather inward onto it
      fx: hx * 1.5 + (hash(i + 977) - 0.5) * 40,
      fy: hy * 1.5 + (hash(i + 1861) - 0.5) * 40,
      fz: hz * 1.5 + (hash(i + 2729) - 0.5) * 40,
      zip,
      zipMs: 3600 + hash(i + 4409) * 3400,
      zipPhase: hash(i + 5171) * 7,
      fireMs: 2800 + hash(i + 6089) * 3600,
      firePhase: hash(i + 6947) * 7,
      delay: hash(i + 3517),
      gx: (hash(i + 7723) - 0.5) * 74,
    };
  });

  return { dots, dotPx: cell * 0.62 };
}

/** The brand gradient across separate elements. The real mark paints one
    linear gradient over the whole path; here each dot picks its own colour
    from where it sits, which is why `t` is normalised over the MARK's extent
    rather than the viewBox's — taken raw it never reaches either end and the
    whole chevron comes out blue. */
export function markInk(t: number) {
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${lerp(0, 46)},${lerp(229, 104)},${lerp(192, 255)})`;
}
