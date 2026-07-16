import type { DesignDocument } from "./document";
import type { Point } from "./document";
import type { DataPack } from "./packs/schema";
import { roomAreaM2, roomLoadKw, type RoomObj } from "./loads-room";
import { clamp, polygonCentroid } from "./geometry";

/* Simulation engine (Stage 12a — split slice) — pure data + pure functions,
   no React, no canvas (docs/design-studio-simulation-spec.md). The model is
   derived from the document through the same lenses the cockpit uses and is
   NEVER written back: sim state lives outside the document ("the lock gate:
   sim never mutates the document").

   Two clocks (spec §2f): THERMAL time is compressed (state.speed ×) and
   drives room integration, coil lag and compressor ramps; MECHANICAL time is
   real seconds and drives fan ramps (and, later, damper travel) so the
   machinery plays at watching speed. Nothing steps — everything travels
   (Principle 7): every dynamic quantity below is rate-limited or lagged. */

/* ── modeled constants — the §9 honesty table. Everything else derives from
      pack data + the design. ── */
export const SIM = {
  /** ρ·cp for air, W per (L/s · K) */
  RHO_CP: 1.21,
  /** effective thermal capacitance multiplier over bare air (furniture/linings) */
  K_FABRIC: 4,
  /** design ΔT that turns a room's load (W) into a loss coefficient (W/K) */
  DT_DESIGN_K: 15,
  /** J/K per m³ of air */
  AIR_C_PER_M3: 1206,
  /** fan fractions of rated airflow at lo/mid/hi (pack has one nominal-high figure) */
  FAN_FRAC: { lo: 0.6, mid: 0.8, hi: 1.0 } as const,
  /** fan volume ramp: seconds (real) to travel full range */
  FAN_RAMP_S: 3,
  /* ── inverter compressor start-up (thermal clock, sim-seconds) ──
     A real inverter soft-starts: it crawls up to a working speed, then ramps
     harder. We model two phases so the customer sees a believable ~5 min
     kick-in with airflow held back until the coil is warm (cold-blow
     prevention). All tunable. */
  /** slow soft-start: 0 → AIRFLOW_ON_FRAC over this long (~3 min) */
  SOFT_START_S: 180,
  /** faster climb: AIRFLOW_ON_FRAC → 1.0 over this long (~2.5 min → ~100% at ~5½ min) */
  RAMP_FULL_S: 150,
  /** compressor fraction at which the fan engages and conditioned air begins */
  AIRFLOW_ON_FRAC: 0.3,
  /** compressor fraction at which airflow (and the plume) is fully delivered */
  AIRFLOW_FULL_FRAC: 0.6,
  /** coil first-order lag, sim-seconds */
  COIL_LAG_S: 90,
  /** inverter proportional band (K); OUTPUT_FLOOR is the modulation floor the
      compressor holds while running (it doesn't drop to 0 until satisfied). */
  BAND_K: 1.5,
  OUTPUT_FLOOR: 0.2,
  START_ERR_K: 0.35,
  STOP_OVERSHOOT_K: 0.25,
  /** supply-air clamp guard, °C */
  SUPPLY_MIN_C: 8,
  SUPPLY_MAX_C: 50,
  /** visual airflow for units with no pack airflow_ls: L/s per rated kW */
  VISUAL_LS_PER_KW: 55,
  /** unconditioned free-running offset over outdoor (internal + solar gains) */
  FREE_RUN_GAIN_K: 3,
  /** cone throw (§5a): saturating with airflow — 2 m floor + 0.02 m per L/s,
      capped at 8 m, × the mode factor, and never past the room boundary.
      (100 L/s ≈ 4 m neutral; real throw does NOT scale linearly forever.) */
  THROW_BASE_M: 2,
  THROW_PER_LS: 0.02,
  THROW_MAX_M: 8,
  THROW_COOL_X: 1.4,
  THROW_HEAT_X: 0.7,
} as const;

export type SimMode = "heat" | "cool";
export type SimFan = "auto" | "lo" | "mid" | "hi";

/* ── model (derived once from doc + pack; rebuilt on any doc change) ── */

export interface SimRoomModel {
  id: string;
  name: string;
  points: Point[]; // world units
  centroid: Point;
  areaM2: number;
  volumeM3: number;
  /** thermal capacitance, J/K */
  capJK: number;
  /** loss coefficient, W/K (= design load / ΔT_design) */
  uaWK: number;
  loadW: number;
}

export interface SimHandlerModel {
  /** the placed IDU object id */
  id: string;
  systemId: string;
  systemName: string;
  colour: string;
  model: string;
  /** the room it senses and serves (split: its own room) */
  roomId: string;
  ratedHeatKw: number;
  ratedCoolKw: number;
  /** plume scale only — thermal maths never uses it (spec §9) */
  visualLs: number;
  /** emitter position (world units) + inferred facing (unit vector) */
  at: Point;
  dir: Point;
  /** distance (world units) from the emitter along `dir` to the room
      boundary — the hard ceiling on throw (air stops at the far wall) */
  roomExtentU: number;
}

export interface SimNotReady {
  systemId: string;
  systemName: string;
  reason: string;
}

export interface SimModel {
  floorId: string;
  /** metres per world unit (null = uncalibrated → sim not buildable) */
  mPerUnit: number | null;
  rooms: SimRoomModel[];
  handlers: SimHandlerModel[];
  /** rooms on the floor that can't simulate (no load) — rendered grey */
  unknownRooms: { id: string; name: string; points: Point[]; centroid: Point }[];
  notReady: SimNotReady[];
}

/* ── state (ephemeral, never persisted) ── */

export interface SimHandlerState {
  on: boolean;
  mode: SimMode;
  setpointC: number;
  fan: SimFan;
  /** thermostat state with hysteresis */
  running: boolean;
  /** 0..1 demand from the proportional band (the target the compressor chases) */
  demand: number;
  /** 0..1 inverter compressor speed — soft-starts up, modulates down near
      setpoint. The single honest driver of output, airflow and room change. */
  compressorFrac: number;
  /** compressor output after ramp, kW (= compressorFrac × rated) */
  outputKw: number;
  /** fan volume fraction after ramp (mechanical clock) */
  fanFrac: number;
  /** supply air temp after coil lag, °C */
  supplyC: number;
}

export interface SimState {
  /** elapsed sim-seconds */
  tSim: number;
  outdoorC: number;
  /** thermal time compression */
  speed: number;
  paused: boolean;
  roomTempC: Record<string, number>;
  /** room temp when its handler last powered on — drives the fill-front */
  baselineC: Record<string, number>;
  /** sampled ~20 sim-s ago, for trend arrows */
  prevTempC: Record<string, number>;
  handlers: Record<string, SimHandlerState>;
}

/** unheated/uncooled equilibrium a room drifts to (gains over ambient) */
export const freeRunningC = (outdoorC: number): number =>
  clamp(outdoorC + SIM.FREE_RUN_GAIN_K, 8, 34);

/* ── facing inference (spec §5a): a split IDU hangs on a wall — its
      discharge direction is the inward normal of the containing room's
      nearest edge. Fallback: plan-down (the glyph's louvre edge). ── */
export function inferFacing(at: Point, roomPoints: Point[]): Point {
  if (roomPoints.length < 3) return { x: 0, y: 1 };
  const c = polygonCentroid(roomPoints);
  let bestD = Infinity;
  let dir: Point = { x: 0, y: 1 };
  for (let i = 0; i < roomPoints.length; i++) {
    const a = roomPoints[i];
    const b = roomPoints[(i + 1) % roomPoints.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey;
    if (len2 === 0) continue;
    const t = clamp(((at.x - a.x) * ex + (at.y - a.y) * ey) / len2, 0, 1);
    const cp = { x: a.x + t * ex, y: a.y + t * ey };
    const d = Math.hypot(at.x - cp.x, at.y - cp.y);
    if (d >= bestD) continue;
    bestD = d;
    const el = Math.sqrt(len2);
    let nx = ey / el;
    let ny = -ex / el;
    // pick the sign that points into the room (toward the centroid)
    if (nx * (c.x - cp.x) + ny * (c.y - cp.y) < 0) {
      nx = -nx;
      ny = -ny;
    }
    dir = { x: nx, y: ny };
  }
  return dir;
}

/** distance from `at` along `dir` to the polygon boundary (ray → nearest
    edge crossing). Air stops at the far wall — this caps the throw. */
export function rayExitDistance(at: Point, dir: Point, roomPoints: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < roomPoints.length; i++) {
    const a = roomPoints[i];
    const b = roomPoints[(i + 1) % roomPoints.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = dir.x * ey - dir.y * ex;
    if (Math.abs(denom) < 1e-9) continue; // parallel
    const t = ((a.x - at.x) * ey - (a.y - at.y) * ex) / denom; // along the ray
    const u = ((a.x - at.x) * dir.y - (a.y - at.y) * dir.x) / denom; // along the edge
    if (t > 1e-6 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return Number.isFinite(best) ? best : 0;
}

/** a split system's rated pair capacities, both modes (pair table row) */
function pairRatedKw(
  doc: DesignDocument,
  pack: DataPack,
  systemId: string
): { heatKw: number; coolKw: number } | null {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return null;
  const mine = doc.objects.filter((o) => o.systemId === systemId && o.type === "unit");
  const idu = String(
    mine.find((o) => o.props.role === "idu")?.props.model ?? sys.settings.pairIdu ?? ""
  );
  const odu = String(
    mine.find((o) => o.props.role === "odu")?.props.model ?? sys.settings.pairOdu ?? ""
  );
  if (!idu || !odu) return null;
  const row = pack.pair_tables.find((p) => p.idu_model === idu && p.odu_model === odu);
  if (!row) return null;
  return { heatKw: row.rated_heat_kw ?? 0, coolKw: row.rated_cool_kw ?? 0 };
}

const isRoomObj = (o: { type: string; geometry: { kind: string } }): boolean =>
  o.type === "room" && o.geometry.kind === "polygon";

/** Derive the simulatable picture for one floor. Pure; degrades per system
    with a reason instead of guessing (spec Principle 6). Split systems only
    in this slice — other types are simply not offered. */
export function buildSimModel(
  doc: DesignDocument,
  pack: DataPack | null,
  floorId: string
): SimModel {
  const floor = doc.floors.find((f) => f.id === floorId);
  const mPerUnit = floor?.scaleMmPerUnit ? floor.scaleMmPerUnit / 1000 : null;

  const rooms: SimRoomModel[] = [];
  const unknownRooms: SimModel["unknownRooms"] = [];
  const roomById = new Map<string, SimRoomModel>();

  for (const o of doc.objects) {
    if (o.floorId !== floorId || !isRoomObj(o)) continue;
    const r = o as RoomObj;
    const points = r.geometry.points;
    const centroid = polygonCentroid(points);
    const name = String(r.props.name ?? "Room");
    const areaM2 = roomAreaM2(doc, r);
    const loadKw = roomLoadKw(doc, r);
    if (areaM2 == null || loadKw == null || loadKw <= 0) {
      unknownRooms.push({ id: r.id, name, points, centroid });
      continue;
    }
    const heightM = typeof r.props.ceilingHeightM === "number" ? r.props.ceilingHeightM : 2.4;
    const volumeM3 = areaM2 * heightM;
    const loadW = loadKw * 1000;
    const room: SimRoomModel = {
      id: r.id,
      name,
      points,
      centroid,
      areaM2,
      volumeM3,
      capJK: SIM.AIR_C_PER_M3 * volumeM3 * SIM.K_FABRIC,
      uaWK: loadW / SIM.DT_DESIGN_K,
      loadW,
    };
    rooms.push(room);
    roomById.set(room.id, room);
  }

  const handlers: SimHandlerModel[] = [];
  const notReady: SimNotReady[] = [];

  for (const sys of doc.systems) {
    if (sys.type !== "split") continue;
    const fail = (reason: string) =>
      notReady.push({ systemId: sys.id, systemName: sys.name, reason });
    if (!pack) {
      fail("data pack not loaded");
      continue;
    }
    const idu = doc.objects.find(
      (o) => o.systemId === sys.id && o.type === "unit" && o.props.role === "idu"
    );
    if (!idu || idu.geometry.kind !== "point") {
      fail("no indoor unit placed");
      continue;
    }
    if (idu.floorId !== floorId) {
      fail("indoor unit is on another floor");
      continue;
    }
    if (mPerUnit == null) {
      fail("floor not calibrated");
      continue;
    }
    const roomId = typeof idu.props.roomId === "string" ? idu.props.roomId : null;
    const room = roomId ? roomById.get(roomId) : undefined;
    if (!room) {
      fail(roomId ? "its room has no heat load yet" : "indoor unit is not inside a room");
      continue;
    }
    const rated = pairRatedKw(doc, pack, sys.id);
    if (!rated || (rated.heatKw <= 0 && rated.coolKw <= 0)) {
      fail("no rated pair capacity in the pack");
      continue;
    }
    const packIdu = pack.indoor_units.find((u) => u.model === String(idu.props.model ?? ""));
    const visualLs =
      packIdu?.airflow_ls ?? SIM.VISUAL_LS_PER_KW * Math.max(rated.heatKw, rated.coolKw);
    const dir = inferFacing(idu.geometry.at, room.points);
    handlers.push({
      id: idu.id,
      systemId: sys.id,
      systemName: sys.name,
      colour: sys.colour,
      model: String(idu.props.model ?? ""),
      roomId: room.id,
      ratedHeatKw: rated.heatKw,
      ratedCoolKw: rated.coolKw,
      visualLs,
      at: idu.geometry.at,
      dir,
      roomExtentU: rayExitDistance(idu.geometry.at, dir, room.points),
    });
  }

  return { floorId, mPerUnit, rooms, handlers, unknownRooms, notReady };
}

/* ── state lifecycle ── */

export function initSimState(
  model: SimModel,
  opts: { outdoorC: number; mode?: SimMode; setpointC?: number; speed?: number }
): SimState {
  const free = freeRunningC(opts.outdoorC);
  const mode: SimMode = opts.mode ?? (opts.outdoorC < 18 ? "heat" : "cool");
  const roomTempC: Record<string, number> = {};
  const baselineC: Record<string, number> = {};
  const prevTempC: Record<string, number> = {};
  for (const r of model.rooms) {
    roomTempC[r.id] = free;
    baselineC[r.id] = free;
    prevTempC[r.id] = free;
  }
  const handlers: Record<string, SimHandlerState> = {};
  for (const h of model.handlers) {
    handlers[h.id] = {
      on: false,
      mode,
      setpointC: opts.setpointC ?? (mode === "heat" ? 22 : 23),
      fan: "auto",
      running: false,
      demand: 0,
      compressorFrac: 0,
      outputKw: 0,
      fanFrac: 0,
      supplyC: free,
    };
  }
  return {
    tSim: 0,
    outdoorC: opts.outdoorC,
    speed: opts.speed ?? 60,
    paused: false,
    roomTempC,
    baselineC,
    prevTempC,
    handlers,
  };
}

/** carry temps + handler settings across a model rebuild (doc edited) */
export function carryState(model: SimModel, prev: SimState): SimState {
  const next = initSimState(model, { outdoorC: prev.outdoorC, speed: prev.speed });
  next.tSim = prev.tSim;
  next.paused = prev.paused;
  for (const r of model.rooms) {
    if (prev.roomTempC[r.id] != null) {
      next.roomTempC[r.id] = prev.roomTempC[r.id];
      next.baselineC[r.id] = prev.baselineC[r.id] ?? prev.roomTempC[r.id];
      next.prevTempC[r.id] = prev.prevTempC[r.id] ?? prev.roomTempC[r.id];
    }
  }
  for (const h of model.handlers) {
    if (prev.handlers[h.id]) next.handlers[h.id] = { ...prev.handlers[h.id] };
  }
  return next;
}

/* ── the tick. dtRealS is wall-clock seconds since the last call; thermal
      time advances dtRealS × speed (0 while paused — the fans keep breathing
      so pausing reads as a freeze-frame, not a power cut). Mutates nothing;
      returns a new state. ── */
export function simTick(model: SimModel, state: SimState, dtRealS: number): SimState {
  const dtReal = clamp(dtRealS, 0, 0.25); // rAF hiccups never teleport the sim
  const dtSim = state.paused ? 0 : dtReal * state.speed;
  const free = freeRunningC(state.outdoorC);

  const roomTempC = { ...state.roomTempC };
  const prevTempC = { ...state.prevTempC };
  const baselineC = { ...state.baselineC };
  const handlers: Record<string, SimHandlerState> = {};

  /* signed heat into each room this tick, W (+ heats, − cools) */
  const roomInW: Record<string, number> = {};

  for (const h of model.handlers) {
    const s = state.handlers[h.id];
    if (!s) continue;
    const sensed = roomTempC[h.roomId] ?? free;
    const rated = s.mode === "heat" ? h.ratedHeatKw : h.ratedCoolKw;
    const err = s.mode === "heat" ? s.setpointC - sensed : sensed - s.setpointC;

    /* thermostat with hysteresis — no flapping at setpoint */
    let running = s.running;
    if (!s.on) running = false;
    else if (!running && err > SIM.START_ERR_K) running = true;
    else if (running && err < -SIM.STOP_OVERSHOOT_K) running = false;

    /* demand modulates from the proportional band, held at the inverter floor
       while running (it eases DOWN near setpoint, doesn't slam off) */
    const demand = running
      ? clamp(Math.max(err, 0) / SIM.BAND_K, SIM.OUTPUT_FLOOR, 1)
      : 0;

    /* inverter compressor: soft-starts, then chases `demand`. Two-phase rate —
       a slow crawl up to the airflow-on point, then a faster climb — so the
       customer sees a believable ~5-min kick-in. Ramps DOWN at the same rates
       when demand drops (modulation / shut-off). */
    const target = s.on && running ? demand : 0;
    const rate =
      s.compressorFrac < SIM.AIRFLOW_ON_FRAC
        ? SIM.AIRFLOW_ON_FRAC / SIM.SOFT_START_S
        : (1 - SIM.AIRFLOW_ON_FRAC) / SIM.RAMP_FULL_S;
    const compStep = rate * dtSim;
    const compressorFrac = clamp(
      s.compressorFrac + clamp(target - s.compressorFrac, -compStep, compStep),
      0,
      1
    );
    const outputKw = compressorFrac * rated;

    /* the fan (and conditioned air) is held until the coil is warm — cold-blow
       prevention — engaging as the compressor passes AIRFLOW_ON_FRAC */
    const gate = airflowGate(compressorFrac);

    /* fan ramps on the mechanical clock, only once the gate opens */
    const fanTarget =
      !s.on || gate <= 0
        ? 0
        : (s.fan === "auto" ? 0.6 + 0.4 * demand : SIM.FAN_FRAC[s.fan]) * gate;
    const fanStep = dtReal / SIM.FAN_RAMP_S;
    const fanFrac = s.fanFrac + clamp(fanTarget - s.fanFrac, -fanStep, fanStep);

    /* supply temp = delivery ΔT (compressor-scaled; lower fan → hotter),
       chased through the coil lag. Uses the fan SETTING (never 0) so it stays
       finite during preheat and rises smoothly with the compressor. */
    const fanSet = s.fan === "auto" ? 0.6 + 0.4 * demand : SIM.FAN_FRAC[s.fan];
    const qLs = Math.max(fanSet * h.visualLs, 30);
    const dT = (outputKw * 1000) / (SIM.RHO_CP * qLs);
    const supplyTarget = clamp(
      s.mode === "heat" ? sensed + dT : sensed - dT,
      SIM.SUPPLY_MIN_C,
      SIM.SUPPLY_MAX_C
    );
    const supplyC =
      s.supplyC + (supplyTarget - s.supplyC) * Math.min(1, dtSim / SIM.COIL_LAG_S);

    handlers[h.id] = { ...s, running, demand, compressorFrac, outputKw, fanFrac, supplyC };

    /* energy is only DELIVERED once air is flowing (gate) — the kick-in delay:
       the compressor spins for minutes before the room actually moves */
    const deliveredKw = outputKw * gate;
    const signedW = (s.mode === "heat" ? 1 : -1) * deliveredKw * 1000;
    roomInW[h.roomId] = (roomInW[h.roomId] ?? 0) + signedW;
  }

  if (dtSim > 0) {
    for (const r of model.rooms) {
      const T = roomTempC[r.id] ?? free;
      /* losses pull toward the free-running temp (gains folded in) */
      const dT = ((roomInW[r.id] ?? 0) + r.uaWK * (free - T)) / r.capJK;
      roomTempC[r.id] = T + dT * dtSim;
    }
  }

  /* trend sample roughly every 20 sim-seconds */
  const tSim = state.tSim + dtSim;
  if (Math.floor(tSim / 20) !== Math.floor(state.tSim / 20)) {
    for (const r of model.rooms) prevTempC[r.id] = state.roomTempC[r.id] ?? free;
  }

  return { ...state, tSim, roomTempC, prevTempC, baselineC, handlers };
}

/* ── derived readouts ── */

/** airflow / conditioned-air delivery fraction for a compressor speed:
    0 below AIRFLOW_ON_FRAC (fan held — cold-blow prevention), smoothly to 1 by
    AIRFLOW_FULL_FRAC. Exported: the overlay fades the plume in with it. */
export function airflowGate(compressorFrac: number): number {
  const t = clamp(
    (compressorFrac - SIM.AIRFLOW_ON_FRAC) / (SIM.AIRFLOW_FULL_FRAC - SIM.AIRFLOW_ON_FRAC),
    0,
    1
  );
  return t * t * (3 - 2 * t); // smoothstep
}

/** compressor speed as a 0–100 % for the gauge/readout */
export function compressorPct(state: SimState, handlerId: string): number {
  return Math.round((state.handlers[handlerId]?.compressorFrac ?? 0) * 100);
}

export type CompressorPhase = "off" | "preheat" | "airflow" | "running" | "easing";

/** the presentation phase for the notification/tag (mode-aware label lives in
    the UI, which knows heat vs cool → "Preheating" / "Pre-cooling") */
export function compressorPhase(
  model: SimModel,
  state: SimState,
  handlerId: string
): CompressorPhase {
  const h = model.handlers.find((x) => x.id === handlerId);
  const s = h && state.handlers[h.id];
  if (!h || !s || !s.on) return "off";
  if (s.compressorFrac < SIM.AIRFLOW_ON_FRAC) return "preheat";
  // past preheat: modulating down (near setpoint) or cycled off → easing;
  // otherwise ramping up (airflow) or holding full (running)
  if (!s.running || s.demand < 0.95) return "easing";
  return s.compressorFrac >= 0.85 ? "running" : "airflow";
}

/** sim-seconds for the compressor to ramp from its current speed up to full
    output — the "kick-in" lag the estimate must add on top of the thermal time. */
export function startupRemainingSimS(compressorFrac: number): number {
  const on = SIM.AIRFLOW_ON_FRAC;
  if (compressorFrac >= 1) return 0;
  if (compressorFrac < on) {
    return SIM.SOFT_START_S * ((on - compressorFrac) / on) + SIM.RAMP_FULL_S;
  }
  return SIM.RAMP_FULL_S * ((1 - compressorFrac) / (1 - on));
}

/** steady-state temp a room heads to with its handlers at RATED output */
export function steadyStateC(model: SimModel, state: SimState, roomId: string): number | null {
  const room = model.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const free = freeRunningC(state.outdoorC);
  let ratedW = 0;
  for (const h of model.handlers) {
    if (h.roomId !== roomId) continue;
    const s = state.handlers[h.id];
    if (!s?.on) continue;
    ratedW += (s.mode === "heat" ? 1 : -1) * (s.mode === "heat" ? h.ratedHeatKw : h.ratedCoolKw) * 1000;
  }
  return free + ratedW / room.uaWK;
}

/** first-order time (sim-seconds) for a room to reach its handler's setpoint;
    null = it never gets there (the honest line: "tops out at N°") */
export function timeToSetpointSimS(
  model: SimModel,
  state: SimState,
  handlerId: string
): number | null {
  const h = model.handlers.find((x) => x.id === handlerId);
  const s = h && state.handlers[h.id];
  if (!h || !s || !s.on) return null;
  const room = model.rooms.find((r) => r.id === h.roomId);
  if (!room) return null;
  const T = state.roomTempC[room.id];
  const S = s.setpointC;
  const ss = steadyStateC(model, state, room.id);
  if (ss == null) return null;
  const heat = s.mode === "heat";
  if (heat ? T >= S : T <= S) return 0;
  if (heat ? ss <= S : ss >= S) return null;
  const tau = room.capJK / room.uaWK;
  const thermal = tau * Math.log((ss - T) / (ss - S));
  /* realistic: add the compressor's remaining ramp-up ("kick-in") on top of
     the thermal warm-up — a cold start reads longer and tightens as it spins
     up; near full speed this term vanishes and it reduces to the pure curve. */
  return startupRemainingSimS(s.compressorFrac) + thermal;
}

/** fill-front progress 0..1 for a room (spec §5a) */
export function fillProgress(model: SimModel, state: SimState, roomId: string): number {
  const h = model.handlers.find((x) => x.roomId === roomId);
  const s = h && state.handlers[h.id];
  if (!h || !s || !s.on) return 1; // no active handler → uniform tint
  const base = state.baselineC[roomId] ?? state.roomTempC[roomId];
  const span = s.setpointC - base;
  if (Math.abs(span) < 0.5) return 1;
  return clamp((state.roomTempC[roomId] - base) / span, 0, 1);
}

/** blue↔orange temperature tint (spec §5): anchored at 21° = clear.
    Returns null when the tint would be invisible. Colour is deliberately held
    apart from the system-hue cycle (#2E68FF / #E4572E). */
export function tempTint(tC: number): { rgb: string; alpha: number } | null {
  const d = tC - 21;
  const a = Math.abs(d);
  const alpha = a <= 1 ? a * 0.06 : a <= 4 ? 0.06 + ((a - 1) / 3) * 0.12 : 0.18 + ((a - 4) / 4) * 0.14;
  if (alpha < 0.015) return null;
  return { rgb: d < 0 ? "56, 154, 232" : "255, 138, 0", alpha: Math.min(alpha, 0.35) };
}

/** cone throw length in world units for an emitter (spec §5a mode factors):
    saturating with delivered airflow, capped, and never past the far wall */
export function throwLengthU(
  h: SimHandlerModel,
  s: SimHandlerState,
  mPerUnit: number | null
): number {
  if (!mPerUnit) return 0;
  const modeX = s.mode === "cool" ? SIM.THROW_COOL_X : SIM.THROW_HEAT_X;
  const metres = clamp(
    (SIM.THROW_BASE_M + SIM.THROW_PER_LS * h.visualLs * s.fanFrac) * modeX,
    SIM.THROW_BASE_M,
    SIM.THROW_MAX_M
  );
  return Math.min(metres / mPerUnit, h.roomExtentU * 0.95);
}
