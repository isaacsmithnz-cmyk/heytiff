/* THE BOOMERANG'S FLIGHT AS NUMBERS, for anything that draws it outside a
   stylesheet: the front page's 3D mark (components/landing).

   It is the same flight the app's Tiff mark flies: scripts/tiff-flight.mjs
   samples it into keyframes for shell.css, and this reads the same loop live.
   Thrown forward on her right, up over her and wide out to her top left where
   it hangs, behind her, round in front and home; quick away, quick home,
   spinning clockwise from release (Isaac, 20 November 2026). The constants
   are the script's own, and tiff-flight-path.test holds them equal, so the
   two cannot drift apart.

   `reach` scales the loop out from her hand: 1 is the app's own flight. The
   front page throws it further, so it goes out and comes back (Isaac, 26
   November 2026: "make sure it copies trajectory of current prod logo or
   betters it (maybe flies further to come back etc"). */

export const FLIGHT = {
  /** the small mark's middle, in the logo's 100 box, which it spins about */
  HOME: [74, 31] as const,
  /** the loop's middle, up and left of hers */
  C: [40, 22] as const,
  R: 72,
  LIFT: 32,
  /** how deep it goes behind her, in mark widths */
  FAR: 0.4,
  /** how near it comes in front */
  NEAR: 0.45,
  /** thrown forward, on her right, in degrees */
  TH0_DEG: 30,
  /** one lap's spins, clockwise */
  OPEN_TURNS: 6,
  /** one lap, at the opening's pace */
  OPEN_MS: 1600,
  /** thinking, this much slower */
  SLOWER: 1.8,
  /** laps from its place where the thinking lap starts and ends */
  JOIN: 0.7,
  /** thinking's spins, turns a millisecond */
  THINK_RATE: 2.5 / 1000,
} as const;

/** Where the boomerang is, off its place: x right and y down in the logo's
    100 box (as the SVG has it), z towards you in the same units; the lean
    and the spin in radians, the spin clockwise as you look at it. */
export type FlightPoint = { x: number; y: number; z: number; rx: number; ry: number; spin: number };

const TH0 = (FLIGHT.TH0_DEG * Math.PI) / 180;
const OUT_P = (TH0 + 0.75 * Math.PI) / (2 * Math.PI);
const FAR_P = (TH0 + Math.PI / 2) / (2 * Math.PI);

const wrap = (p: number) => ((p % 1) + 1) % 1;
const bump = (p: number, at: number, w: number) => {
  const d = Math.abs(wrap(p) - at);
  return Math.exp(-((Math.min(d, 1 - d) / w) ** 2));
};
/* hangs at the far side and out at her top left */
const steady = (p: number) => (1 - 0.55 * bump(p, FAR_P, 0.12) + 0.25 * bump(p, FAR_P + 0.5, 0.12)) * (1 - 0.4 * bump(p, OUT_P, 0.1));
/* and quick away, quick home */
const fast = (p: number) => steady(p) * (1 + 1.4 * Math.exp(-((p / 0.1) ** 2)) + 0.9 * Math.exp(-(((1 - p) / 0.1) ** 2)));
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/* The time it takes to cover each stretch of the lap, summed: the share of a
   lap's time maps to where on the lap it is, as the script places its
   keyframes. Worked out once. */
const N = 800;
const CUM = (() => {
  const c = [0];
  for (let i = 0; i < N; i++) c.push(c[i] + 1 / N / fast((i + 0.5) / N));
  return c;
})();
function lapAt(f: number): number {
  const target = f * CUM[N];
  let lo = 0, hi = N;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (CUM[mid] < target) lo = mid;
    else hi = mid;
  }
  return (lo + (target - CUM[lo]) / (CUM[hi] - CUM[lo] || 1)) / N;
}

/* the opening spins from release at one speed, easing into its last turn */
function spinAt(f: number): number {
  const u = Math.min(1, f / 0.92);
  return 2 * Math.PI * FLIGHT.OPEN_TURNS * (u < 0.85 ? (u / 0.85) * 0.94 : 0.94 + 0.06 * smooth((u - 0.85) / 0.15));
}

/* where it is at lap position p, k of the way out from its place onto the loop */
function onLoop(p: number, k: number, reach: number, spin: number): FlightPoint {
  const th = TH0 - 2 * Math.PI * p, sn = Math.sin(th), cs = Math.cos(th);
  return {
    x: (FLIGHT.C[0] - FLIGHT.HOME[0] + FLIGHT.R * cs) * reach * k,
    y: (FLIGHT.C[1] - FLIGHT.HOME[1] + FLIGHT.LIFT * sn) * reach * k,
    z: (sn > 0 ? FLIGHT.NEAR * sn : FLIGHT.FAR * sn) * 100 * reach * k,
    rx: ((k * (sn < 0 ? 40 * -sn : -18 * sn)) * Math.PI) / 180,
    ry: (-20 * cs * k * Math.PI) / 180,
    spin,
  };
}

/* THE THROW AND THE THINKING LAP, as the app flies them while Tiff works:
   thrown from her hand out onto the loop (lap 0 to JOIN, quick away), then
   one whole lap from JOIN round to JOIN again, seamless, so it circles for as
   long as it is asked without ever coming home. Each is timed as the script
   times it: the throw by `fast`, the lap by `steady`. */
function paced(v: (p: number) => number, a: number, b: number) {
  const c = [0];
  for (let i = 0; i < N; i++) c.push(c[i] + (b - a) / N / v(a + ((b - a) * (i + 0.5)) / N));
  return (f: number) => {
    const target = Math.max(0, Math.min(1, f)) * c[N];
    let lo = 0, hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] < target) lo = mid;
      else hi = mid;
    }
    return a + ((b - a) * (lo + (target - c[lo]) / (c[hi] - c[lo] || 1))) / N;
  };
}
const throwLap = paced(fast, 0, FLIGHT.JOIN);
const thinkLap = paced(steady, FLIGHT.JOIN, FLIGHT.JOIN + 1);

/** The throw: `f` is the share of the throw's time, 0 to 1; it ends on the loop where the lap begins. */
export function throwAt(f: number, reach = 1, spin = 0): FlightPoint {
  const p = throwLap(f);
  return onLoop(p, smooth(p / 0.16), reach, spin);
}

/** The thinking lap: `f` is the share of one lap's time; it begins and ends where the throw left it, so laps follow one another without a seam. */
export function orbitAt(f: number, reach = 1, spin = 0): FlightPoint {
  return onLoop(thinkLap(((f % 1) + 1) % 1), 1, reach, spin);
}

const landLap = paced(fast, FLIGHT.JOIN, 1);

/** The landing: from where a thinking lap ends (lap JOIN) home to her hand, quick home; `f` is the share of the landing's time. */
export function landAt(f: number, reach = 1, spin = 0): FlightPoint {
  const p = landLap(f);
  return onLoop(p, smooth((1 - p) / 0.2), reach, spin);
}

/** One lap from her hand and home: `f` is the share of the lap's time, 0 to 1. */
export function flightAt(f: number, reach = 1): FlightPoint {
  const t = Math.max(0, Math.min(1, f));
  const p = lapAt(t);
  const k = smooth(p / 0.16) * smooth((1 - p) / 0.2);
  const th = TH0 - 2 * Math.PI * p, sn = Math.sin(th), cs = Math.cos(th);
  return {
    x: (FLIGHT.C[0] - FLIGHT.HOME[0] + FLIGHT.R * cs) * reach * k,
    y: (FLIGHT.C[1] - FLIGHT.HOME[1] + FLIGHT.LIFT * sn) * reach * k,
    z: (sn > 0 ? FLIGHT.NEAR * sn : FLIGHT.FAR * sn) * 100 * reach * k,
    /* it spins on its side: tipped back while it is behind, the other way in front */
    rx: ((k * (sn < 0 ? 40 * -sn : -18 * sn)) * Math.PI) / 180,
    ry: (-20 * cs * k * Math.PI) / 180,
    spin: spinAt(t),
  };
}
