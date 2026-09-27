"use client";

import { RING_DRAWN } from "@/components/notes/tiff-mark";

/* THE TIFF MODAL FROM THE RINGS (Isaac, 2026-09-27: "C is the one", picked
   from the "Tiff Circle Modal" board, then "make the reshape slower", "keep
   the dark theme", "make the modal bigger" and "fix the flash").

   The two gimbal rings leave the Tiff button you pressed — still turning on
   their own axes, at the button's own pace — dive down a bowed arc and spin
   down flat over where the modal will be. The instant they are flat, each
   circle reshapes into the modal's rectangle and the two lines meet as one
   outline, their runs of light still travelling round it. The modal fills in
   from the outline inwards, then its zones arrive. Close runs it backwards:
   the fill drains, the outline rounds back into the two rings, and they climb
   back into the button in the pose its own rings have reached by then.

   EVERYTHING IS WEB ANIMATIONS, built up front and sequenced by `delay`: no
   timers, so a close mid-way can play the open backwards from exactly where
   it is. The flight is sampled from one small model every 8ms into linear
   keyframes (path, size, spin, tilt, lens, run of light), which is why no
   curve of its own appears anywhere: the ease is in the numbers.

   NO HANDOVER EVER CROSSFADES. Two identical layers at half strength each let
   the page show through for that instant, and at a quarter speed it lands on
   a frame as a flash (Isaac, "there's a flash just before animation
   completes"). The fills overlap, the incoming one fully on before the
   outgoing one goes; the rings and the outline, thin lines that would double
   up bright, swap on one exact instant (two keyframes at the same offset).

   THE ONE DOOR THAT ONLY FADES: reduced motion, and a press from the
   keyboard (law 8). The modal and its outline fade in where they stand and
   the button keeps its rings. */

/* ── the parts it moves ── */

export type FlyRing = {
  root: HTMLElement;
  pos: HTMLElement;
  gim: HTMLElement;
  size: HTMLElement;
  arc: HTMLElement;
  ink: SVGSVGElement;
  paper: SVGSVGElement;
  rings: SVGElement[];
  runs: SVGElement[];
  runfull: SVGElement[];
};
export type RingParts = {
  fly: Record<Key, FlyRing>;
  /** the outline over the modal, with a run of light on each ring's line */
  outline: SVGSVGElement;
  line: Record<Key, SVGPathElement>;
  comet: Record<Key, SVGGElement>;
  segs: Record<Key, SVGPathElement[]>;
  /** the fill while it reshapes, under the modal */
  fill: SVGSVGElement;
  fp: SVGPathElement;
  fu: SVGPathElement;
};
export type Scene = {
  dialog: HTMLElement;
  scrim: HTMLElement | null;
  /** the button pressed, or the one the rings go back into */
  from: HTMLElement | null;
};
export type Flight = {
  kind: "open" | "close";
  anims: Animation[];
  clock: Animation | null;
  /** the button's own rings, hidden while theirs are out */
  hold: Animation[];
  /** the modal changed size while it opened (you started talking): the outline and fill aim at its new box */
  retarget?: () => void;
};
type Key = "a" | "b";
const KEYS: Key[] = ["a", "b"];

/* ── numbers ── */

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (u: number) => {
  u = clamp(u);
  return u * u * u * (u * (u * 6 - 15) + 10);
};
/** A speed profile u^a (1-u)^b, integrated and normalised to run 0 → 1. */
function profile(a: number, b: number, N = 2000): (u: number) => number {
  const f = (u: number) => Math.pow(u, a) * Math.pow(1 - u, b);
  const tab = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) tab[i] = tab[i - 1]! + (f((i - 1) / N) + f(i / N)) / (2 * N);
  const tot = tab[N]!;
  return (u) => {
    u = clamp(u);
    const x = u * N;
    const i = Math.min(N - 1, Math.floor(x));
    return (tab[i]! + (tab[i + 1]! - tab[i]!) * (x - i)) / tot;
  };
}
const mod = (x: number, m = 360) => ((x % m) + m) % m;
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const f2 = (x: number) => x.toFixed(2);
const f3 = (x: number) => x.toFixed(3);

/** The button's clocks (shell.css `.tiffbtn-*`): the gimbals and the run of light, in degrees a millisecond. */
const W: Record<Key, number> = { a: 360 / 7000, b: 360 / 5000 };
const WARC = 360 / 2600;
const TILT: Record<Key, number> = { a: -20, b: 25 };
const DT = 12;
/** A ring's own line: at rest, in flight (so it reads over the veil), and as the outline, resting and reshaping. */
const FAINT = 0.18;
const FLY = 0.7;
const REST = 0.28;
const SHOW = 0.6;
/** The modal's corner on the outline's centre line, and the run of light: a third of a ring, a quarter of the outline. */
const RC = 16 - 0.75;
const RUN0 = 1 / 3;
const RUN1 = 0.24;
export const NSEG = 20;
/** Laps a millisecond for each ring's run once landed: 18 and 14 seconds a lap. */
const LAP: Record<Key, number> = { a: 18000, b: 14000 };

/* The open: flat at TL, the rectangle at TM, filled as it gets there, the zones as it lands. Isaac watched it live
   (2026-09-27, "needs to be faster and smoother on open"): 1,660ms became about 1,100. */
const TL = 520;
const MD = 380;
const TM = TL + MD;
const FS = TL + 120;
const FD = TM - FS;
const CI = TM - 80;
const CD = 180;
const CS = 24;
const END = CI + 3 * CS + CD;
/* The close: the fill drains and the outline rounds off; the rings take over at TH and are home at T. */
const TU = 60;
const UD = 260;
const TH = TU + UD;
const F = 400;
const T = TH + F;
const TS = 20;
const TMF = 40;
const DD = 200;
/** How long a ring's run of light takes to go out before it lands, or to come back once it has left the outline. */
const RUNFADE = 120;

const GROW = profile(0.5, 1.5);
const GO = profile(1.8, 3);
const SPIN = profile(1, 3);
const SHP = profile(0.9, 1.8);
const UNSHP = profile(1.8, 0.9);
const INE = profile(1.1, 1.6);
const OUTE = profile(1.6, 1.1);
const SHRINK = profile(1.4, 0.9);
const BACK = profile(1.6, 1.6);
const RESPIN = profile(1.2, 2.2);

/* ── the button ── */

type Button = {
  x: number;
  y: number;
  /** each ring's box, as drawn, hover included */
  box: Record<Key, number>;
  phase: { a: number; b: number; arcA: number; arcB: number };
  ground: "ink" | "paper";
  gw: HTMLElement | null;
  hov: boolean;
  /** the button's own lens: 3 × its width, over ring A's drawn size */
  rho: number;
};

/** Where the button's rings are, and how they are turned, right now. */
export function readButton(from: HTMLElement | null): Button | null {
  if (!from || !from.isConnected) return null;
  const r = from.getBoundingClientRect();
  const gw = from.querySelector<HTMLElement>(".tiffbtn-gw");
  const arcA = from.querySelector<HTMLElement>(".tiffbtn-gim-a .tiffbtn-arc");
  const arcB = from.querySelector<HTMLElement>(".tiffbtn-gim-b .tiffbtn-arc");
  const hov = from.matches(":hover");
  const scale = gw && hov ? 1.07 : 1;
  const find = (el: Element | null, name: string) =>
    el?.getAnimations?.().find((a) => (a as CSSAnimation).animationName === name) ?? null;
  const deg = (a: Animation | null, dur: number) => {
    const t = a?.currentTime;
    return typeof t === "number" ? ((t % dur) / dur) * 360 : 0;
  };
  const gimA = from.querySelector(".tiffbtn-gim-a");
  const gimB = from.querySelector(".tiffbtn-gim-b");
  const tb = gw ? from.offsetWidth || 36 : 36;
  const box = {
    a: (arcA?.offsetWidth || tb * 0.86) * scale,
    b: (arcB?.offsetWidth || tb * 0.72) * scale,
  };
  return {
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    box,
    phase: {
      a: deg(find(gimA, "tiffGimbalA"), 7000),
      b: deg(find(gimB, "tiffGimbalB"), 5000),
      arcA: deg(find(arcA, "tiffArc"), 2600),
      arcB: deg(find(arcB, "tiffArc"), 2600),
    },
    ground: from.classList.contains("tiffbtn-topbar") ? "ink" : "paper",
    gw,
    hov: !!gw && hov,
    rho: (3 * tb) / box.a,
  };
}

/* ── the shapes ── */

type Box = { x: number; y: number; w: number; h: number };
const boxOf = (el: HTMLElement): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/** A rounded rectangle as one path from three o'clock, clockwise: a circle is
    the same path with its straight runs at nothing, so the two interpolate
    command for command. */
function raw(cx: number, cy: number, w: number, h: number, r: number): string {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const x = cx - w / 2;
  const y = cy - h / 2;
  const R = x + w;
  const B = y + h;
  return (
    `M ${f2(R)} ${f2(cy)} L ${f2(R)} ${f2(B - r)} A ${f2(r)} ${f2(r)} 0 0 1 ${f2(R - r)} ${f2(B)} ` +
    `L ${f2(x + r)} ${f2(B)} A ${f2(r)} ${f2(r)} 0 0 1 ${f2(x)} ${f2(B - r)} L ${f2(x)} ${f2(y + r)} ` +
    `A ${f2(r)} ${f2(r)} 0 0 1 ${f2(x + r)} ${f2(y)} L ${f2(R - r)} ${f2(y)} A ${f2(r)} ${f2(r)} 0 0 1 ${f2(R)} ${f2(y + r)} Z`
  );
}
const perimeter = (w: number, h: number, r: number) => {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
};

type Land = { L: { x: number; y: number }; d: Record<Key, number> };
/** Where the rings lie flat: over the modal's centre, about as wide as the modal is on average, and never past the
    window's edge (a short modal sits near the top, and a circle as wide as it is would leave the screen). */
function landing(b: Box): Land {
  const L = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const room = 2 * Math.min(L.y, window.innerHeight - L.y, L.x, window.innerWidth - L.x) - 32;
  const a = clamp(Math.min((b.w + b.h) / 2, room), 240, 900);
  return { L, d: { a, b: a - 24 } };
}

/** The outline at reshape m (0 = the ring flat over the centre, 1 = the modal), with its run of light. */
function outlineFrame(k: Key, m: number, u: number, c: number, land: Land, box: Box) {
  const d0 = land.d[k] * RING_DRAWN;
  const cx = lerp(land.L.x, box.x + box.w / 2, m);
  const cy = lerp(land.L.y, box.y + box.h / 2, m);
  const w = lerp(d0, box.w - 1.5, m);
  const h = lerp(d0, box.h - 1.5, m);
  const r = lerp(d0 / 2, RC, m);
  const P = perimeter(w, h, r);
  const Lr = c * P;
  const seg = Lr / NSEG;
  const head = mod(u, 1) * P;
  return { d: `path("${raw(cx, cy, w, h, r)}")`, P, seg, off: (i: number) => -(head - Lr + i * seg) };
}
/** The fill at reshape m, e of the way in: the inner ring's shape (the modal's own box at m = 1), with a hole of
    the same shape shrinking to its centre. The hole is always there, zero-sized when full, so every frame has the
    same commands. The hole is the path's `fill-rule` attribute (tiff-rings.tsx): the `d` property takes no rule,
    and a `path(evenodd, …)` in it is no path at all (the band never drew, and the fill was only its fading centre). */
function fillBox(m: number, land: Land, box: Box) {
  const d0 = land.d.b * RING_DRAWN;
  return {
    cx: lerp(land.L.x, box.x + box.w / 2, m),
    cy: lerp(land.L.y, box.y + box.h / 2, m),
    w: lerp(d0, box.w, m),
    h: lerp(d0, box.h, m),
    r: lerp(d0 / 2, 16, m),
  };
}
function fillD(m: number, e: number, land: Land, box: Box): string {
  const b = fillBox(m, land, box);
  const k = 1 - clamp(e);
  return `path("${raw(b.cx, b.cy, b.w, b.h, b.r)} ${raw(b.cx, b.cy, b.w * k, b.h * k, b.r * k)}")`;
}
function fillU(m: number, land: Land, box: Box): string {
  const b = fillBox(m, land, box);
  return `path("${raw(b.cx, b.cy, b.w, b.h, b.r)}")`;
}

/** The resting outline, on the modal's own box, whatever size it is now. */
export function restOutline(p: RingParts, dialog: HTMLElement) {
  const b = boxOf(dialog);
  const w = b.w - 1.5;
  const h = b.h - 1.5;
  const d = raw(b.x + b.w / 2, b.y + b.h / 2, w, h, RC);
  const P = perimeter(w, h, RC);
  for (const k of KEYS) {
    p.line[k].setAttribute("d", d);
    for (const s of p.segs[k]) s.setAttribute("d", d);
  }
  p.outline.style.setProperty("--tm-p", f3(P));
  p.outline.style.setProperty("--tm-l", f3(RUN1 * P));
  p.outline.style.setProperty("--tm-seg", f3((RUN1 * P) / NSEG));
}

/* ── the flight ── */

type Track = { at: (p: number) => { x: number; y: number }; size: (k: Key, g: number) => number };
function track(b: Button, land: Land): Track {
  const x0 = b.x;
  const y0 = b.y;
  const x1 = land.L.x;
  const y1 = land.L.y;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const bow = 0.26 * len;
  let nx = -dy / len;
  let ny = dx / len;
  if (nx + ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const cx = (x0 + x1) / 2 + nx * bow;
  const cy = (y0 + y1) / 2 + ny * bow;
  return {
    at: (u) => {
      const q = 1 - u;
      return { x: q * q * x0 + 2 * u * q * cx + u * u * x1, y: q * q * y0 + 2 * u * q * cy + u * u * y1 };
    },
    size: (k, g) => b.box[k] * Math.pow(land.d[k] / b.box[k], g),
  };
}
/** The run of light: from th0 at w0, easing to w1 by `settle`, with any difference to its target taken while it
    flies, so it never runs back. */
function runOfLight(th0: number, w0: number, w1: number, settle: number, end: number, target: (e: number) => number) {
  const nat = [0];
  const w = (t: number) => w1 + (w0 - w1) * (1 - smooth(t / settle));
  for (let t = 1; t <= end; t++) nat[t] = nat[t - 1]! + (w(t - 1) + w(t)) / 2;
  const X = target(th0 + nat[end]!);
  return (t: number) => th0 + nat[clamp(Math.round(t), 0, end)]! + X * smooth(t / settle);
}
const grid = (T: number) => {
  const ts: number[] = [];
  for (let t = 0; t < T; t += DT) ts.push(t);
  ts.push(T);
  return ts;
};
type Sample = { x: number; y: number; size: number; g: number; z: number; y3: number; x3: number; P: number; line: number };

export type Anim = (el: Element, kf: Keyframe[], o: KeyframeAnimationOptions) => Animation;

function flyRing(anim: Anim, r: FlyRing, T: number, S: (t: number) => Sample, arc: (t: number) => number, delay = 0) {
  const ts = grid(T);
  const sm = ts.map(S);
  const kf = (fn: (s: Sample, t: number) => Keyframe) => ts.map((t, i) => ({ offset: t / T, ...fn(sm[i]!, t) }));
  const o: KeyframeAnimationOptions = { duration: T, delay, easing: "linear", fill: "both" };
  anim(r.pos, kf((s) => ({ transform: `translate3d(${f2(s.x)}px, ${f2(s.y)}px, 0px)` })), o);
  anim(r.size, kf((s) => ({ width: `${f2(s.size)}px`, height: `${f2(s.size)}px` })), o);
  anim(r.gim, kf((s) => ({ transform: `perspective(${f2(s.P)}px) rotateZ(${f3(s.z)}deg) rotateY(${f3(s.y3)}deg) rotateX(${f3(s.x3)}deg)` })), o);
  const fl = (s: Sample) => (s.line - FAINT) / (FLY - FAINT);
  /* never over the outline's 1.5px: grown full or showing full, the ring is the width of the line it hands to */
  for (const e of r.rings) anim(e, kf((s) => ({ strokeWidth: `${f3(1.2 + 0.3 * Math.min(1, Math.max(s.g, fl(s))))}px`, strokeOpacity: f3(s.line) })), o);
  for (const e of [...r.runs, ...r.runfull]) anim(e, kf((s) => ({ strokeWidth: `${f3(1.2 + 1.3 * Math.min(1, s.g / 0.35))}px` })), o);
  anim(r.arc, kf((_, t) => ({ transform: `rotate(${f3(arc(t))}deg)` })), o);
  return { ts, sm };
}
const persp = (lens: number) => (lens <= 1e-6 ? 1e6 : Math.min(1e6, 1 / lens));

/** An element that cannot animate (a test's page, an old browser) gets a still stand-in, so a flight is always
    whole: it simply shows where everything ends. */
const still = (): Animation =>
  ({ cancel() {}, play() {}, finished: Promise.resolve(), playState: "finished", currentTime: 0, playbackRate: 1 }) as unknown as Animation;

/** Everything that moves goes through here, so the whole flight is one list to scrub, reverse or cancel. */
function recorder() {
  const anims: Animation[] = [];
  const anim: Anim = (el, kf, o) => {
    const a = typeof (el as Element & { animate?: unknown }).animate === "function" ? el.animate(kf, o) : still();
    anims.push(a);
    return a;
  };
  return { anims, anim };
}

/** The zones of the modal, top to bottom, as they are now. */
const zonesOf = (dialog: HTMLElement) =>
  [".tm-head", ".tm-face", ".tm-turns", ".tm-dock"]
    .map((s) => dialog.querySelector<HTMLElement>(`:scope > ${s}`))
    .filter((z): z is HTMLElement => !!z);

/** The modal as it lands: fading where it stands, rings kept in the button (reduced motion, the keyboard). */
export function fadeIn(p: RingParts, s: Scene, ms: number): Flight {
  const { anims, anim } = recorder();
  const o: KeyframeAnimationOptions = { duration: ms, easing: "ease-out", fill: "backwards" };
  anim(s.dialog, [{ opacity: 0 }, { opacity: 1 }], o);
  anim(p.outline, [{ opacity: 0 }, { opacity: 1 }], o);
  if (s.scrim) anim(s.scrim, [{ opacity: 0 }, { opacity: 1 }], o);
  return { kind: "open", anims, clock: anims[0] ?? null, hold: [] };
}
export function fadeOut(p: RingParts, s: Scene, ms: number): Flight {
  const { anims, anim } = recorder();
  const o: KeyframeAnimationOptions = { duration: ms, easing: "ease-out", fill: "forwards" };
  anim(s.dialog, [{ opacity: 1 }, { opacity: 0 }], o);
  anim(p.outline, [{ opacity: 1 }, { opacity: 0 }], o);
  if (s.scrim) anim(s.scrim, [{ opacity: 1 }, { opacity: 0 }], o);
  return { kind: "close", anims, clock: anims[0] ?? null, hold: [] };
}

/** The modal's own box as it will stand: its parts open by their own heights as it mounts (./box-motion), so
    measured then it was a 77px bar, and the rings shaped the outline and the fill to that while the modal grew under
    them (Isaac, live: "it looks bad"). Its parts are hidden while the rings arrive, so their openings are simply
    finished first. A loop cannot finish, and is left alone. */
function settled(dialog: HTMLElement): Box {
  for (const a of dialog.getAnimations?.({ subtree: true }) ?? []) {
    if (a.effect?.getTiming().iterations === Infinity) continue;
    try {
      a.finish();
    } catch {
      /* a paused or unresolved one: leave it */
    }
  }
  return boxOf(dialog);
}

/** THE OPEN. Returns null when there is no button to fly from, and the modal simply fades. */
export function flyIn(p: RingParts, s: Scene): Flight | null {
  const btn = readButton(s.from);
  if (!btn) return null;
  const { anims, anim } = recorder();
  let box = settled(s.dialog);
  const land = landing(box);
  const tr = track(btn, land);
  const clock = anim(s.dialog, [], { duration: END });

  if (s.scrim) anim(s.scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: "ease-out", fill: "backwards" });

  /* the button's rings go on the very instant the flying copies take over */
  const hold: Animation[] = [];
  const rest = btn.hov ? 1 : 0.85;
  if (btn.gw) hold.push(anim(btn.gw, [{ opacity: rest }, { opacity: 0, offset: 0 }, { opacity: 0 }], { duration: 1, easing: "linear", fill: "both" }));

  /* the spin: each ring's own slow turn, plus a gentle kick ending on a whole turn (flat). B's kick is picked a turn
     either way so the two are never edge-on at once mid-flight, where both read as dotted slivers. */
  const kick = (k: Key, extra: number) => {
    const base = btn.phase[k] + (W[k] * TL) / 2;
    return 360 * Math.round((base + extra) / 360) - base;
  };
  const phiOf = (k: Key, D: number) => (t: number) => {
    const u = clamp(t / TL);
    return btn.phase[k] + W[k] * TL * (u - (u * u) / 2) + D * SPIN(u);
  };
  const edge = (f: number) => Math.abs(Math.cos((f * Math.PI) / 180)) < 0.15;
  const DK: Record<Key, number> = { a: kick("a", 180), b: 0 };
  const clash = (Db: number) => {
    const fa = phiOf("a", DK.a);
    const fb = phiOf("b", Db);
    for (let t = 150; t <= TL - 100; t += 8) if (edge(fa(t)) && edge(fb(t))) return true;
    return false;
  };
  const b0 = kick("b", 270);
  DK.b = [b0, b0 + 360, b0 - 360].find((D) => D > 0 && !clash(D)) ?? b0;

  const sizeA = (t: number) => tr.size("a", GROW(clamp(t / TL)));
  const o0 = btn.hov ? 1 : 0.85;
  const u0: Record<Key, number> = { a: 0, b: 0 };
  for (const k of KEYS) {
    const r = p.fly[k];
    const phi = phiOf(k, DK[k]);
    const th0 = mod(k === "a" ? btn.phase.arcA : btn.phase.arcB);
    const w1 = 360 / LAP[k];
    const th = runOfLight(th0, WARC, w1, TL, TL, () => 0);
    const S = (t: number): Sample => {
      const u = clamp(t / TL);
      const g = GROW(u);
      const q = tr.at(GO(u));
      const lens = (btn.hov ? 1 : smooth(t / 180)) / (btn.rho * sizeA(t));
      /* the line hands to the outline at the outline's own strength: with the lights out for the reshape, a line
         that dipped to the ring's resting strength there was the ring all but gone as it landed */
      const line = FAINT + (FLY - FAINT) * smooth(t / 160) - (FLY - SHOW) * smooth((t - 0.62 * TL) / (0.38 * TL));
      return { x: q.x, y: q.y, size: tr.size(k, g), g, z: TILT[k] * (1 - smooth(t / (0.9 * TL))), y3: k === "a" ? phi(t) : 0, x3: k === "b" ? phi(t) : 0, P: persp(lens), line };
    };
    const { ts, sm } = flyRing(anim, r, TL, S, th);
    let tHand = 120;
    ts.forEach((t, i) => {
      if (sm[i]!.size <= 46) tHand = t;
    });
    /* the button's dashed run hands to the true arc while the ring is small; the run goes out as the ring lands, so
       the outline reshapes as a plain line, and the lights come back on it once the modal is down (the stylesheet's
       fade): forty dash paths reshaping every frame is what made the live open stutter */
    const h0 = Math.max(0, tHand - 90) / TL;
    const h1 = Math.max(0, tHand) / TL;
    const g0 = (TL - RUNFADE) / TL;
    for (const e of r.runfull) anim(e, [{ opacity: 1 }, { opacity: 1, offset: h0 }, { opacity: 0, offset: Math.max(h0, h1) }, { opacity: 0 }], { duration: TL, easing: "linear", fill: "both" });
    for (const e of r.runs) anim(e, [{ opacity: 0 }, { opacity: 0, offset: h0 }, { opacity: 1, offset: Math.max(h0, h1) }, { opacity: 1, offset: Math.max(g0, h1) }, { opacity: 0 }], { duration: TL, easing: "linear", fill: "both" });
    /* the ground decides the skin: the button's own as it leaves, the frame's (ink) over the dark modal */
    if (btn.ground === "ink") {
      anim(r.ink, [{ opacity: o0 }, { opacity: 1 }], { duration: 120, easing: "linear", fill: "both" });
      anim(r.paper, [{ opacity: 0 }, { opacity: 0 }], { duration: 1, fill: "both" });
    } else {
      anim(r.paper, [{ opacity: o0 }, { opacity: o0, offset: 0.25 }, { opacity: 0 }], { duration: 480, easing: "linear", fill: "both" });
      anim(r.ink, [{ opacity: 0 }, { opacity: 0, offset: 0.25 }, { opacity: 1 }], { duration: 480, easing: "linear", fill: "both" });
    }
    /* the handover: on the instant TL the ring is flat, and the outline takes its place */
    anim(
      r.root,
      btn.gw
        ? [{ opacity: 1 }, { opacity: 1, offset: 1 }, { opacity: 0, offset: 1 }]
        : /* a button without rings of its own (Sort it out): they appear from it */
          [{ opacity: 0 }, { opacity: 1, offset: 120 / TL }, { opacity: 1, offset: 1 }, { opacity: 0, offset: 1 }],
      { duration: TL, easing: "linear", fill: "both" }
    );
    u0[k] = mod(th(TL) + 120) / 360;
  }

  /* the outline, reshaping from the flat rings into the modal, their runs going round it */
  const T2 = END - TL;
  const lines: Record<Key, Animation | null> = { a: null, b: null };
  const lineFrames = (k: Key, b: Box) => {
    const lineOp = (t: number) => SHOW - (SHOW - REST) * smooth((t - (FS - TL)) / FD);
    return grid(T2).map((t) => {
      const f = outlineFrame(k, SHP(t / MD), 0, RUN1, land, b);
      return { offset: t / T2, d: f.d, strokeOpacity: f3(lineOp(t)) };
    });
  };
  anim(p.outline, [{ opacity: 0 }, { opacity: 0, offset: TL / END }, { opacity: 1, offset: TL / END }, { opacity: 1 }], { duration: END, easing: "linear", fill: "both" });
  for (const k of KEYS) {
    const wu = 1 / LAP[k];
    lines[k] = anim(p.line[k], lineFrames(k, box), { duration: T2, delay: TL, easing: "linear", fill: "backwards" });
    /* the lights come back on the outline where the ring's run was, once it has landed */
    p.comet[k].style.setProperty("--tm-u0", mod(u0[k] + wu * T2, 1).toFixed(6));
    p.comet[k].style.setProperty("--tm-lap", `${LAP[k]}ms`);
  }

  /* the fill, inside the reshaping inner ring; then the modal's own, on at TM, and the shaped one staying under it to
     the end. The two are not on one clock: the fill's opacity runs on the compositor and the modal's colour on the
     page's thread, which can be a frame late, and a fill that went at TM left that frame with neither (the flash Isaac
     saw live, 2026-09-27) */
  const tsF = grid(FD);
  const fpFrames = (b: Box) => tsF.map((t) => ({ offset: t / FD, d: fillD(SHP((FS + t - TL) / MD), INE(t / FD), land, b) }));
  const fuFrames = (b: Box) => tsF.map((t) => ({ offset: t / FD, d: fillU(SHP((FS + t - TL) / MD), land, b), opacity: f3(INE(t / FD)) }));
  const fpA = anim(p.fp, fpFrames(box), { duration: FD, delay: FS, easing: "linear", fill: "both" });
  const fuA = anim(p.fu, fuFrames(box), { duration: FD, delay: FS, easing: "linear", fill: "both" });
  anim(p.fill, [{ opacity: 0 }, { opacity: 0, offset: FS / END }, { opacity: 1, offset: FS / END }, { opacity: 1, offset: 1 }, { opacity: 0, offset: 1 }], { duration: END, easing: "linear", fill: "both" });
  const cs = getComputedStyle(s.dialog);
  const bg = cs.backgroundColor;
  const sh = cs.boxShadow;
  anim(
    s.dialog,
    [
      { backgroundColor: "transparent", boxShadow: "none" },
      { backgroundColor: "transparent", boxShadow: "none", offset: TM / END },
      { backgroundColor: bg, boxShadow: "none", offset: TM / END },
      { backgroundColor: bg, boxShadow: sh, offset: Math.min(1, (TM + 200) / END) },
      { backgroundColor: bg, boxShadow: sh },
    ],
    { duration: END, easing: "linear", fill: "both" }
  );
  /* the zones, top to bottom, as the fill reaches them */
  zonesOf(s.dialog).forEach((z, i) =>
    anim(z, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: CD, delay: CI + i * CS, easing: "ease-out", fill: "both" })
  );
  const retarget = () => {
    const b = boxOf(s.dialog);
    if (Math.abs(b.w - box.w) < 1 && Math.abs(b.h - box.h) < 1 && Math.abs(b.y - box.y) < 1) return;
    box = b;
    for (const k of KEYS) (lines[k]?.effect as KeyframeEffect | null | undefined)?.setKeyframes?.(lineFrames(k, b));
    (fpA.effect as KeyframeEffect | null)?.setKeyframes?.(fpFrames(b));
    (fuA.effect as KeyframeEffect | null)?.setKeyframes?.(fuFrames(b));
  };
  return { kind: "open", anims, clock, hold, retarget };
}

/** THE CLOSE, from the landed modal: the fill drains, the outline rounds back into the rings, and they fly home.
    Returns null when there is no button to fly back into, and the modal simply fades. */
export function flyOut(p: RingParts, s: Scene): Flight | null {
  const btn = readButton(s.from);
  if (!btn) return null;
  const { anims, anim } = recorder();
  const box = settled(s.dialog);
  const land = landing(box);
  const tr = track(btn, land);
  const clock = anim(s.dialog, [], { duration: T + 1 });

  zonesOf(s.dialog).forEach((z) => anim(z, [{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: "ease-out", fill: "both" }));
  if (s.scrim) anim(s.scrim, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: T - 300, easing: "ease-out", fill: "both" });

  /* the modal's fill hands to the shaped one (on first, underneath), which drains as the outline rounds off */
  const cs = getComputedStyle(s.dialog);
  const bg = cs.backgroundColor;
  const sh = cs.boxShadow;
  const DS = TU;
  anim(s.dialog, [{ backgroundColor: bg, boxShadow: sh }, { backgroundColor: bg, boxShadow: "none", offset: (DS - 1) / (DS + 1) }, { backgroundColor: "transparent", boxShadow: "none", offset: (DS - 1) / (DS + 1) }, { backgroundColor: "transparent", boxShadow: "none" }], { duration: DS + 1, easing: "linear", fill: "both" });
  const tsD = grid(DD);
  anim(p.fp, tsD.map((t) => ({ offset: t / DD, d: fillD(1 - UNSHP((DS + t - TU) / UD), 1 - OUTE(t / DD), land, box) })), { duration: DD, delay: DS, easing: "linear", fill: "both" });
  anim(p.fu, tsD.map((t) => ({ offset: t / DD, d: fillU(1 - UNSHP((DS + t - TU) / UD), land, box), opacity: f3(1 - OUTE(t / DD)) })), { duration: DD, delay: DS, easing: "linear", fill: "both" });
  anim(p.fill, [{ opacity: 0 }, { opacity: 0, offset: (DS - 3) / (DS + DD) }, { opacity: 1, offset: (DS - 3) / (DS + DD) }, { opacity: 1 }], { duration: DS + DD, easing: "linear", fill: "both" });

  /* the outline rounds back into two flat rings over the centre, the runs still going, and on the instant TH the
     flying rings take over as those circles */
  anim(p.outline, [{ opacity: 1 }, { opacity: 1, offset: TH / (TH + 2) }, { opacity: 0, offset: TH / (TH + 2) }, { opacity: 0 }], { duration: TH + 2, easing: "linear", fill: "both" });
  const sizeA = (t: number) => tr.size("a", 1 - SHRINK(clamp((t - TMF) / (F - TMF))));
  for (const k of KEYS) {
    const ccs = getComputedStyle(p.comet[k]);
    const wu = 1 / LAP[k];
    const uNow = (parseFloat(ccs.getPropertyValue("--tm-u0")) || 0) + (parseFloat(ccs.getPropertyValue("--tm-ro")) || 0);
    const frames = grid(TH).map((t) => {
      const m = 1 - UNSHP((t - TU) / UD);
      return { t, f: outlineFrame(k, m, uNow + wu * t, lerp(RUN0, RUN1, m), land, box) };
    });
    const o: KeyframeAnimationOptions = { duration: TH, easing: "linear", fill: "both" };
    const lineOp = (t: number) => REST + (SHOW - REST) * smooth(t / 150);
    anim(p.line[k], frames.map(({ t, f }) => ({ offset: t / TH, d: f.d, strokeOpacity: f3(lineOp(t)) })), o);
    anim(p.comet[k], [{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: "linear", fill: "both" });

    /* the flying ring, from that circle back into the button: it tips into its spin, lifts off and climbs, arriving
       in the pose the button's own ring has reached by then, at its speed, in its skin */
    const r = p.fly[k];
    const thH = mod(360 * (uNow + wu * TH) - 120);
    const span = F - TS;
    const goal = btn.phase[k] + W[k] * T;
    const n = Math.round((goal - (W[k] * span) / 2 - (k === "a" ? 180 : 240)) / 360);
    const D = goal - 360 * n - (W[k] * span) / 2;
    const goalArc = mod((k === "a" ? btn.phase.arcA : btn.phase.arcB) + WARC * T);
    const th = runOfLight(thH, 360 * wu, WARC, F, F, (e) => mod(goalArc - e));
    const S = (t: number): Sample => {
      const v = clamp((t - TS) / span);
      const w = clamp((t - TMF) / (F - TMF));
      const g = 1 - SHRINK(w);
      const q = tr.at(1 - BACK(w));
      const phi = (W[k] * span * v * v) / 2 + D * RESPIN(v);
      const lens = (btn.hov ? 1 : 1 - smooth((t - (F - 170)) / 170)) / (btn.rho * sizeA(t));
      const line = SHOW + (FLY - SHOW) * smooth((t - 60) / 140) - (FLY - FAINT) * smooth((t - (F - 150)) / 150);
      return { x: q.x, y: q.y, size: tr.size(k, g), g, z: TILT[k] * smooth((t - TS) / (0.85 * span)), y3: k === "a" ? phi : 0, x3: k === "b" ? phi : 0, P: persp(lens), line };
    };
    const { ts, sm } = flyRing(anim, r, F, S, th, TH);
    let tHand: number | null = null;
    ts.forEach((t, i) => {
      if (tHand === null && sm[i]!.size <= 46) tHand = t;
    });
    const hand = tHand ?? F - 90;
    const q0 = RUNFADE / F;
    const q1 = Math.max(q0, hand / F);
    const q2 = Math.max(q1, (F - 10) / F);
    for (const e of r.runfull) anim(e, [{ opacity: 0 }, { opacity: 0, offset: q1 }, { opacity: 1, offset: q2 }, { opacity: 1 }], { duration: F, delay: TH, easing: "linear", fill: "both" });
    for (const e of r.runs) anim(e, [{ opacity: 0 }, { opacity: 1, offset: q0 }, { opacity: 1, offset: q1 }, { opacity: 0, offset: q2 }, { opacity: 0 }], { duration: F, delay: TH, easing: "linear", fill: "both" });
    const oR = btn.hov ? 1 : 0.85;
    if (btn.ground === "ink") {
      anim(r.ink, [{ opacity: 1 }, { opacity: 1, offset: (T - 150) / T }, { opacity: oR }], { duration: T, easing: "linear", fill: "both" });
      anim(r.paper, [{ opacity: 0 }, { opacity: 0 }], { duration: 1, fill: "both" });
    } else {
      anim(r.ink, [{ opacity: 1 }, { opacity: 1, offset: (T - 380) / T }, { opacity: 0, offset: (T - 120) / T }, { opacity: 0 }], { duration: T, easing: "linear", fill: "both" });
      anim(r.paper, [{ opacity: 0 }, { opacity: 0, offset: (T - 380) / T }, { opacity: oR, offset: (T - 120) / T }, { opacity: oR }], { duration: T, easing: "linear", fill: "both" });
    }
    /* out of the line on the instant TH, gone on the instant T */
    anim(r.root, [{ opacity: 0 }, { opacity: 0, offset: TH / (T + 1) }, { opacity: 1, offset: TH / (T + 1) }, { opacity: 1, offset: T / (T + 1) }, { opacity: 0, offset: T / (T + 1) }, { opacity: 0 }], { duration: T + 1, easing: "linear", fill: "both" });
  }
  /* the button's rings: hidden while theirs are out, and back on the instant they arrive, at their resting strength */
  const hold: Animation[] = [];
  if (btn.gw) {
    const rest = btn.hov ? 1 : 0.85;
    hold.push(anim(btn.gw, [{ opacity: 0 }, { opacity: 0, offset: T / (T + 1) }, { opacity: rest, offset: T / (T + 1) }, { opacity: rest }], { duration: T + 1, easing: "linear", fill: "both" }));
  }
  return { kind: "close", anims, clock, hold };
}

/** Plays a running open backwards from exactly where it is. Every animation is put at the flight's own time first: a
    short one that already finished holds its end, and would otherwise run back from that end on its own. */
export function reverse(f: Flight): Flight {
  const now = f.clock?.currentTime;
  const at = typeof now === "number" ? now : 0;
  for (const a of f.anims) {
    const paused = a.playState === "paused";
    a.currentTime = at;
    a.playbackRate = -Math.abs(a.playbackRate || 1);
    if (paused) a.play();
  }
  return { ...f, kind: "close" };
}

/** Lets go of everything a flight holds. */
export function release(f: Flight | null) {
  if (!f) return;
  for (const a of f.anims) a.cancel();
}

/** The total length of the open, for tests and the host. */
export const OPEN_MS = END;
export const CLOSE_MS = T + 1;
