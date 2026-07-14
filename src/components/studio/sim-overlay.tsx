"use client";

import { useEffect, useRef } from "react";
import type { Point } from "@/lib/studio/document";
import {
  fillProgress,
  tempTint,
  throwLengthU,
  type SimHandlerModel,
  type SimHandlerState,
} from "@/lib/studio/sim";
import type { SimRuntime } from "@/lib/studio/sim-runtime";

/* The Stage-12 rendering surface ADR-001 reserves: a dedicated <canvas>
   painted over the SVG scene graph. Everything simulation draws lives here —
   the scene graph is never touched (the read-only guarantee is architectural).
   pointer-events: none — the SVG underneath keeps pan/zoom.

   Drawn per frame: room temperature tints with the §5a fill-front, cone
   plumes off each emitter (particles; static chevrons under reduced motion),
   inferred-facing ticks, and screen-space temperature chips. */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  seed: number;
  handlerId: string;
}

const MAX_PARTICLES = 600;
const PARTICLE_LIFE_S = 3.5;
const SPAWN_PER_S = 20; // per emitter at full fan — denser reads as a continuous stream
const DRAG_K = 0.32; // s⁻¹ — gentle: particles hold speed along the path so streaks stay long
const STREAK_S = 0.4; // seconds of travel a streak represents — the jet length

export function SimOverlay({
  runtime,
  vp,
  size,
}: {
  runtime: SimRuntime;
  vp: { x: number; y: number; zoom: number };
  size: { w: number; h: number };
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useRef(vp);
  view.current = vp;
  const particles = useRef<Particle[]>([]);
  const spawnDebt = useRef<Record<string, number>>({});

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return; // jsdom / lost context — engine still runs headless
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dtReal = Math.min((now - last) / 1000, 0.25);
      last = now;
      runtime.advance(dtReal);
      draw(ctx, cv, runtime, view.current, particles.current, spawnDebt.current, dtReal, reduced);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [runtime]);

  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : 1;
  return (
    <canvas
      ref={ref}
      className="ds-sim-canvas"
      data-testid="sim-overlay"
      width={Math.max(1, Math.round(size.w * dpr))}
      height={Math.max(1, Math.round(size.h * dpr))}
      style={{ width: size.w, height: size.h }}
    />
  );
}

/* ── drawing ── */

function draw(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  runtime: SimRuntime,
  vp: { x: number; y: number; zoom: number },
  particles: Particle[],
  spawnDebt: Record<string, number>,
  dtReal: number,
  reduced: boolean
) {
  const { model, state } = runtime;
  const dpr = cv.width / Math.max(1, parseFloat(cv.style.width) || cv.width);
  const zoom = vp.zoom;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);

  /* world space */
  const world = () => ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -vp.x * zoom * dpr, -vp.y * zoom * dpr);
  world();

  /* 1 — room tints with the fill-front */
  for (const room of model.rooms) {
    const t = state.roomTempC[room.id];
    const tint = tempTint(t);
    if (!tint) continue;
    const p = fillProgress(model, state, room.id);
    const emitter = model.handlers.find((h) => h.roomId === room.id);

    ctx.save();
    tracePolygon(ctx, room.points);
    ctx.clip();
    if (p >= 1 || !emitter) {
      ctx.fillStyle = `rgba(${tint.rgb}, ${tint.alpha})`;
      fillRoomBounds(ctx, room.points);
    } else {
      /* a faint base so the room never reads untouched… */
      ctx.fillStyle = `rgba(${tint.rgb}, ${tint.alpha * 0.25})`;
      fillRoomBounds(ctx, room.points);
      /* …and the front, growing out of where the air lands */
      const maxD = room.points.reduce(
        (m, pt) => Math.max(m, Math.hypot(pt.x - emitter.at.x, pt.y - emitter.at.y)),
        0
      );
      const r = Math.max(p * maxD, 1);
      const g = ctx.createRadialGradient(emitter.at.x, emitter.at.y, 0, emitter.at.x, emitter.at.y, r);
      g.addColorStop(0, `rgba(${tint.rgb}, ${tint.alpha})`);
      g.addColorStop(0.75, `rgba(${tint.rgb}, ${tint.alpha})`);
      g.addColorStop(1, `rgba(${tint.rgb}, 0)`);
      ctx.fillStyle = g;
      fillRoomBounds(ctx, room.points);
    }
    ctx.restore();
  }

  /* 2 — plumes */
  for (const h of model.handlers) {
    const s = state.handlers[h.id];
    if (!s) continue;
    if (reduced) drawChevrons(ctx, h, s, model.mPerUnit, zoom);
    else stepEmitter(h, s, model.mPerUnit, particles, spawnDebt, dtReal, state.paused);
    drawFacingTick(ctx, h, zoom);
  }
  if (!reduced) stepAndDrawParticles(ctx, runtime, particles, dtReal);

  /* 3 — temperature chips, screen space */
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const room of model.rooms) {
    const t = state.roomTempC[room.id];
    const prev = state.prevTempC[room.id] ?? t;
    const trend = t - prev > 0.05 ? "↗" : t - prev < -0.05 ? "↘" : "→";
    drawChip(ctx, room.centroid, vp, `${t.toFixed(1)}° ${trend}`, false);
  }
  for (const room of model.unknownRooms) drawChip(ctx, room.centroid, vp, "—", true);
}

function tracePolygon(ctx: CanvasRenderingContext2D, pts: Point[]) {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

function fillRoomBounds(ctx: CanvasRenderingContext2D, pts: Point[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

/* plume colour: the supply-air tint, gently boosted. Near-neutral supply
   (coil still cold) is nearly invisible — the blush is the coil lag. The cap
   stays LOW because overlapping particles stack alpha: smoke, not fire. */
function plumeColor(supplyC: number): { rgb: string; alpha: number } | null {
  const t = tempTint(supplyC);
  if (!t) return null;
  return { rgb: t.rgb, alpha: Math.min(t.alpha * 1.3, 0.22) };
}

function stepEmitter(
  h: SimHandlerModel,
  s: SimHandlerState,
  mPerUnit: number | null,
  particles: Particle[],
  spawnDebt: Record<string, number>,
  dtReal: number,
  paused: boolean
) {
  if (!s.on || paused || !mPerUnit) return;
  const strength = s.fanFrac * (s.running ? 1 : 0.4);
  if (strength < 0.05) return;
  const throwU = throwLengthU(h, s, mPerUnit);
  if (throwU <= 0) return;

  const debt = (spawnDebt[h.id] ?? 0) + SPAWN_PER_S * strength * dtReal;
  const n = Math.floor(debt);
  spawnDebt[h.id] = debt - n;
  const faceOff = 0.25 / mPerUnit; // leave from the discharge face, not the centre
  const lateral = 0.35 / mPerUnit; // spawn across the louvre width
  const px = -h.dir.y, py = h.dir.x;
  for (let i = 0; i < n && particles.length < MAX_PARTICLES; i++) {
    const spread = (Math.random() - 0.5) * (Math.PI / 7); // ±13° — a clean jet
    const cos = Math.cos(spread), sin = Math.sin(spread);
    const dx = h.dir.x * cos - h.dir.y * sin;
    const dy = h.dir.x * sin + h.dir.y * cos;
    const life = PARTICLE_LIFE_S * (0.85 + Math.random() * 0.3);
    /* with drag k, distance = v0/k·(1−e^{−k·life}) — solve v0 so the particle
       dies right at the throw length instead of overshooting the room */
    const kDrag = DRAG_K;
    const v0 = (throwU * kDrag) / (1 - Math.exp(-kDrag * life));
    const side = (Math.random() - 0.5) * 2 * lateral;
    particles.push({
      x: h.at.x + h.dir.x * faceOff + px * side,
      y: h.at.y + h.dir.y * faceOff + py * side,
      vx: dx * v0,
      vy: dy * v0,
      age: 0,
      life,
      seed: Math.random() * Math.PI * 2,
      handlerId: h.id,
    });
  }
}

function stepAndDrawParticles(
  ctx: CanvasRenderingContext2D,
  runtime: SimRuntime,
  particles: Particle[],
  dtReal: number
) {
  const { model, state } = runtime;
  const mPerUnit = model.mPerUnit ?? 0.01;
  const byId = new Map(model.handlers.map((h) => [h.id, h]));
  const roomById = new Map(model.rooms.map((r) => [r.id, r]));

  /* advance everything first */
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dtReal;
    if (p.age >= p.life || !byId.get(p.handlerId)) {
      particles.splice(i, 1);
      continue;
    }
    if (!state.paused) {
      const drag = Math.exp(-DRAG_K * dtReal); // smooth deceleration into the room
      p.vx *= drag;
      p.vy *= drag;
      /* soft curl: a little lateral breathing, per-particle phase */
      const wob = Math.sin(p.age * 2 + p.seed) * 0.08 * dtReal;
      p.x += p.vx * dtReal - p.vy * wob;
      p.y += p.vy * dtReal + p.vx * wob;
    }
  }

  /* draw per handler, CLIPPED to its room — supply air never crosses walls */
  for (const h of model.handlers) {
    const s = state.handlers[h.id];
    const room = roomById.get(h.roomId);
    if (!s || !room) continue;
    const col = plumeColor(s.supplyC);
    if (!col) continue;
    ctx.save();
    tracePolygon(ctx, room.points);
    ctx.clip();
    ctx.lineCap = "round";
    for (const p of particles) {
      if (p.handlerId !== h.id) continue;
      const k = p.age / p.life;
      const fade = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88; // ease in, fade out
      /* draw each particle as a velocity-aligned STREAK — long and thin where
         the air moves fast (the jet off the louvre), collapsing to a soft dot
         as drag slows it and it mixes into the room. Width thin at the nozzle,
         widening slightly as it diffuses. */
      const sp = Math.hypot(p.vx, p.vy); // world units / s
      const len = sp * STREAK_S; // streak length, world units
      const w = (0.06 + 0.22 * k) / mPerUnit; // ~0.06 m jet → ~0.28 m mixed
      ctx.strokeStyle = `rgba(${col.rgb}, ${(col.alpha * fade).toFixed(3)})`;
      ctx.lineWidth = w;
      if (len < w) {
        // essentially stopped — a round puff, so the tail never pops to a dash
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(p.x, p.y, w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const ux = p.vx / sp;
        const uy = p.vy / sp;
        ctx.beginPath();
        ctx.moveTo(p.x - ux * len, p.y - uy * len); // tail
        ctx.lineTo(p.x, p.y); // leading head, in the flow direction
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

/* reduced-motion fallback: static chevrons along the throw, sized by flow */
function drawChevrons(
  ctx: CanvasRenderingContext2D,
  h: SimHandlerModel,
  s: SimHandlerState,
  mPerUnit: number | null,
  zoom: number
) {
  if (!s.on) return;
  const throwU = throwLengthU(h, s, mPerUnit);
  if (throwU <= 0) return;
  const col = plumeColor(s.supplyC) ?? { rgb: "120, 130, 145", alpha: 0.4 };
  ctx.strokeStyle = `rgba(${col.rgb}, ${Math.max(col.alpha, 0.3)})`;
  ctx.lineWidth = 2 / zoom;
  ctx.lineCap = "round";
  const px = -h.dir.y, py = h.dir.x; // perpendicular
  for (let i = 1; i <= 3; i++) {
    const d = (throwU * i) / 3.5;
    const w = (4 + i * 3) / zoom;
    const cx = h.at.x + h.dir.x * d;
    const cy = h.at.y + h.dir.y * d;
    const bx = 8 / zoom;
    ctx.beginPath();
    ctx.moveTo(cx - h.dir.x * bx + px * w, cy - h.dir.y * bx + py * w);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx - h.dir.x * bx - px * w, cy - h.dir.y * bx - py * w);
    ctx.stroke();
  }
}

/* the inferred-facing tick (§5a: visible and auditable) */
function drawFacingTick(
  ctx: CanvasRenderingContext2D,
  h: SimHandlerModel,
  zoom: number
) {
  const len = 12 / zoom;
  const ax = h.at.x + h.dir.x * len;
  const ay = h.at.y + h.dir.y * len;
  ctx.strokeStyle = "rgba(5, 5, 5, 0.35)";
  ctx.lineWidth = 1.5 / zoom;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(h.at.x, h.at.y);
  ctx.lineTo(ax, ay);
  const hd = 4 / zoom;
  const px = -h.dir.y, py = h.dir.x;
  ctx.moveTo(ax - h.dir.x * hd + px * hd, ay - h.dir.y * hd + py * hd);
  ctx.lineTo(ax, ay);
  ctx.lineTo(ax - h.dir.x * hd - px * hd, ay - h.dir.y * hd - py * hd);
  ctx.stroke();
}

/* screen-space temperature chip at a room centroid (Jakarta, tabular reads) */
function drawChip(
  ctx: CanvasRenderingContext2D,
  centroid: Point,
  vp: { x: number; y: number; zoom: number },
  label: string,
  muted: boolean
) {
  const sx = (centroid.x - vp.x) * vp.zoom;
  const sy = (centroid.y - vp.y) * vp.zoom - 18;
  ctx.font = '600 11px "Plus Jakarta Sans", system-ui, sans-serif';
  const w = ctx.measureText(label).width + 14;
  const hgt = 19;
  const x = sx - w / 2;
  const y = sy - hgt / 2;
  ctx.beginPath();
  const r = 9.5;
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.fill();
  ctx.strokeStyle = "rgba(5, 5, 5, 0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = muted ? "rgba(5, 5, 5, 0.35)" : "rgba(5, 5, 5, 0.85)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, sx, sy + 0.5);
}
