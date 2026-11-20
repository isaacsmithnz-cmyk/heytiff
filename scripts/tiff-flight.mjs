#!/usr/bin/env node
/* THE BOOMERANG'S FLIGHT, WORKED OUT ONCE.

   Tiff's small mark is a boomerang (Isaac, 20 November 2026). Its loop
   (https://claude.ai/artifact/J5cTywUNx5VVErDK6F3YeN): thrown forward on her
   right, it rises over her and swings wide out to her top left, behind her,
   then comes round in front and home, spinning clockwise from the moment it
   leaves. The path is sampled into keyframes here, because a stylesheet
   cannot do trigonometry and the ratchets allow no curve of our own: the
   speed is in where the samples fall, quick away and quick home, hanging out
   at her top left.

   Four phases:
     open   the opening: one quick lap and home (about 1.6 s), when she's opened
     throw  thinking begins: from its place out onto the loop
     orbit  one whole lap, seamless, run `infinite` while she thinks
     land   from the loop's join back into its place, with a last settle
   Thinking runs 1.8 times slower than the opening ("slower when thinking").
   Each phase moves three wrappers: the flight (`.tiffbtn-boom`), the lean
   into the curve (`.tiffbtn-bank`) and the spin (`.tiffbtn-spin`).

   Run it after changing a number here:
     node scripts/tiff-flight.mjs
   It rewrites the generated block in src/app/dashboard/shell.css and the
   timings in src/components/notes/tiff-flight.ts. */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOME = [74, 31]; /* the small mark's middle, in the logo's 100 box, which it spins about */
/* the loop: its middle up and left of hers, so it swings well out past her top left */
const C = [40, 22], R = 72, LIFT = 32;
const FAR = 0.4; /* how deep it goes behind her, in mark widths: not so deep that it shrinks back in */
const NEAR = 0.45; /* how near it comes in front */
const TH0 = (30 * Math.PI) / 180; /* thrown forward, on her right */
const OUT_P = (TH0 + 0.75 * Math.PI) / (2 * Math.PI); /* where in a lap it is out at her top left */
const FAR_P = (TH0 + Math.PI / 2) / (2 * Math.PI);
const JOIN = 0.7; /* laps from its place where the thinking lap starts and ends */
const OPEN_MS = 1600; /* the opening, one lap */
const SLOWER = 1.8; /* thinking, this much slower */
const OPEN_TURNS = 6; /* the opening's spins, clockwise */
const THINK_RATE = 2.5 / 1000; /* thinking's spins, turns a millisecond */

const wrap = (p) => ((p % 1) + 1) % 1;
const bump = (p, at, w) => Math.exp(-((Math.min(Math.abs(wrap(p) - at), 1 - Math.abs(wrap(p) - at)) / w) ** 2));
/* hangs at the far side and out at her top left */
const steady = (p) => (1 - 0.55 * bump(p, FAR_P, 0.12) + 0.25 * bump(p, FAR_P + 0.5, 0.12)) * (1 - 0.4 * bump(p, OUT_P, 0.1));
/* and quick away, quick home */
const fast = (p) => steady(p) * (1 + 1.4 * Math.exp(-((p / 0.1) ** 2)) + 0.9 * Math.exp(-(((1 - p) / 0.1) ** 2)));
const timeBy = (v) => (a, b, n = 200) => {
  let t = 0;
  for (let i = 0; i < n; i++) t += (b - a) / n / v(a + ((b - a) * (i + 0.5)) / n);
  return t;
};
const tFast = timeBy(fast), tSteady = timeBy(steady);
const MS = OPEN_MS / tFast(0, 1); /* the opening's milliseconds per unit of time */
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/* where it is at lap position p, k of the way out from its place onto the loop */
function at(p, k) {
  const th = TH0 - 2 * Math.PI * p, sn = Math.sin(th), cs = Math.cos(th);
  return {
    x: (C[0] + R * cs - HOME[0]) * k,
    y: (C[1] + LIFT * sn - HOME[1]) * k,
    z: (sn > 0 ? NEAR * sn : FAR * sn) * k,
    /* it spins on its side: tipped back while it is behind, the other way in front */
    rx: k * (sn < 0 ? 40 * -sn : -18 * sn),
    ry: -20 * cs * k,
    front: sn * k > 0.02,
  };
}

const n = (v, d = 2) => (Math.abs(v) < 1e-9 ? "0" : v.toFixed(d).replace(/\.?0+$/, ""));
/* spin(f, turns) gives the angle at a share f of the phase's time */
function phase(name, a, b, kOf, time, scale, steps, spinOf) {
  const total = time(a, b), ms = total * scale;
  let path = "", bank = "", spin = "", t = 0, prev = a;
  for (let i = 0; i <= steps; i++) {
    const p = a + ((b - a) * i) / steps;
    if (i) t += time(prev, p, 12);
    prev = p;
    const f = i === steps ? 1 : t / total, pct = `${n(f * 100)}%`, q = at(p, kOf(p));
    path += `  ${pct} { transform:translate3d(calc(var(--orb) * ${n(q.x)}%), calc(var(--orb) * ${n(q.y)}%), calc(var(--art) * var(--orb) * ${n(q.z, 3)})); z-index:${q.front ? 2 : 0}; }\n`;
    bank += `  ${pct} { transform:rotateX(${n(q.rx, 1)}deg) rotateY(${n(q.ry, 1)}deg); }\n`;
    spin += `  ${pct} { transform:rotate(${n(spinOf(f, ms), 1)}deg); }\n`;
  }
  return { name, ms: Math.round(ms), css: `@keyframes ${name} {\n${path}}\n@keyframes ${name}Bank {\n${bank}}\n@keyframes ${name}Spin {\n${spin}}\n` };
}
/* by the clock, a whole number of turns, so each phase begins and ends square */
const steadySpin = (f, ms) => 360 * Math.max(1, Math.round(THINK_RATE * ms)) * f;
const settleSpin = (f, ms) => {
  const turns = 360 * Math.max(1, Math.round(THINK_RATE * ms));
  return turns * (f < 0.9 ? (f / 0.9) * 0.97 : 0.97 + 0.03 * smooth((f - 0.9) / 0.1));
};
/* the opening spins from release at one speed, easing into its last turn */
const openSpin = (f) => {
  const u = Math.min(1, f / 0.92);
  return 360 * OPEN_TURNS * (u < 0.85 ? (u / 0.85) * 0.94 : 0.94 + 0.06 * smooth((u - 0.85) / 0.15));
};

const P = {
  open: phase("tiffOpen", 0, 1, (p) => smooth(p / 0.16) * smooth((1 - p) / 0.2), tFast, MS, 48, openSpin),
  throw: phase("tiffThrow", 0, JOIN, (p) => smooth(p / 0.16), tFast, MS * SLOWER, 36, steadySpin),
  orbit: phase("tiffOrbit", JOIN, JOIN + 1, () => 1, tSteady, MS * SLOWER, 48, steadySpin),
  land: phase("tiffLand", JOIN, 1, (p) => smooth((1 - p) / 0.2), tFast, MS * SLOWER, 20, settleSpin),
};

const BEGIN = "/* ── THE BOOMERANG'S FLIGHT, GENERATED by scripts/tiff-flight.mjs: change the script, not these ── */";
const END = "/* ── end of the generated flight ── */";
const rules = (cls, ph, iter) =>
  [".tiffbtn-boom", ".tiffbtn-bank", ".tiffbtn-spin"]
    .map((el, i) => `.tiffbtn-st.${cls} ${el} { animation:${ph.name}${["", "Bank", "Spin"][i]} ${ph.ms}ms linear ${iter}; }`)
    .join("\n");
const block = [
  BEGIN,
  rules("fly-open", P.open, "both"),
  rules("fly-throw", P.throw, "both"),
  rules("fly-orbit", P.orbit, "infinite"),
  rules("fly-land", P.land, "both"),
  P.open.css + P.throw.css + P.orbit.css + P.land.css + END,
].join("\n");

const root = process.cwd();
const cssPath = join(root, "src/app/dashboard/shell.css");
const css = readFileSync(cssPath, "utf8");
const from = css.indexOf(BEGIN), to = css.indexOf(END);
if (from < 0 || to < 0) throw new Error(`shell.css has no generated flight block: put\n${BEGIN}\n${END}\nwhere it goes`);
writeFileSync(cssPath, css.slice(0, from) + block + css.slice(to + END.length));

writeFileSync(
  join(root, "src/components/notes/tiff-flight.ts"),
  `/* GENERATED by scripts/tiff-flight.mjs, with the keyframes in shell.css:
   change the script and run it, not this. The boomerang's timings, for the
   mark's own clock to fall back on if an animation event never comes (a
   mark inside something hidden runs no animation at all). */

/** The opening: one quick lap and home. */
export const OPEN_MS = ${P.open.ms};
/** Thinking begins: out onto the loop. */
export const THROW_MS = ${P.throw.ms};
/** One lap of the thinking loop. */
export const LAP_MS = ${P.orbit.ms};
/** Thinking ends: home from the loop. */
export const LAND_MS = ${P.land.ms};
`
);
console.log(`flight: open ${P.open.ms} ms, throw ${P.throw.ms}, lap ${P.orbit.ms}, land ${P.land.ms}`);
