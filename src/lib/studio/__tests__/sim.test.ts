/* Simulation engine (Stage 12a split slice) — model derivation, the two-clock
   tick, control loop, estimates, and the Stage-12 lock gate: sim never
   mutates the document. Runs against the REAL shipped pack. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import {
  SIM,
  airflowGate,
  buildSimModel,
  compressorPct,
  compressorPhase,
  freeRunningC,
  facingOf,
  inferFacing,
  initSimState,
  rayExitDistance,
  simTick,
  startupRemainingSimS,
  steadyStateC,
  tempTint,
  comfortWeight,
  roomSetpointC,
  COMFORT_IN_K,
  COMFORT_OUT_K,
  throwLengthU,
  timeToSetpointSimS,
  fillProgress,
  type SimState,
} from "../sim";
import { SimRuntime } from "../sim-runtime";

const SEED_DIR = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
function loadPack(): DataPack {
  const meta = JSON.parse(readFileSync(join(SEED_DIR, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(SEED_DIR, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const pack = loadPack();

/* a real split pairing from the shipped pack (5.0/6.0 kW hi-wall) */
const IDU_MODEL = "MSZ-LN50VG3V";
const ODU_MODEL = "MUZ-LN50VG3";
const pairRow = pack.pair_tables.find(
  (p) => p.idu_model === IDU_MODEL && p.odu_model === ODU_MODEL
);

const rect = (x: number, y: number, w: number, h: number) => ({
  kind: "polygon" as const,
  points: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
});

/** calibrated floor (10 mm/unit) with a 5×4 m room and a placed split pair;
    the IDU sits near the left (x=0) wall so facing must infer +x. */
function simDoc(): DesignDocument {
  const d = createDesign({ name: "Sim", mode: "blank", now: "2026-07-13T00:00:00.000Z" });
  d.floors = [
    { id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] },
  ];
  d.systems = [
    { id: "sys1", type: "split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: {} },
  ];
  d.settings.climateZone = "5";
  d.objects = [
    {
      id: "room1",
      type: "room",
      systemId: "sys1",
      floorId: "flr",
      geometry: rect(0, 0, 500, 400),
      plane: "room",
      props: { name: "Lounge", hasExternalWalls: true },
    },
    {
      id: "idu1",
      type: "unit",
      systemId: "sys1",
      floorId: "flr",
      geometry: { kind: "point", at: { x: 20, y: 200 } },
      plane: "room",
      props: { role: "idu", model: IDU_MODEL, roomId: "room1" },
    },
    {
      id: "odu1",
      type: "unit",
      systemId: "sys1",
      floorId: "flr",
      geometry: { kind: "point", at: { x: 900, y: 100 } },
      plane: "external-ground",
      props: { role: "odu", model: ODU_MODEL },
    },
  ] as DesignObject[];
  return d;
}

/** run n seconds of real time in fixed steps */
function run(model: ReturnType<typeof buildSimModel>, state: SimState, realS: number): SimState {
  let s = state;
  const step = 0.1;
  for (let t = 0; t < realS; t += step) s = simTick(model, s, step);
  return s;
}

it("the shipped pack still carries the pairing this suite leans on", () => {
  expect(pairRow).toBeDefined();
  expect(pairRow!.rated_heat_kw ?? 0).toBeGreaterThan(0);
  expect(pairRow!.rated_cool_kw ?? 0).toBeGreaterThan(0);
});

describe("buildSimModel", () => {
  it("derives one handler with real pair capacities and room params", () => {
    const m = buildSimModel(simDoc(), pack, "flr");
    expect(m.notReady).toEqual([]);
    expect(m.handlers).toHaveLength(1);
    const h = m.handlers[0];
    expect(h.ratedHeatKw).toBe(pairRow!.rated_heat_kw);
    expect(h.ratedCoolKw).toBe(pairRow!.rated_cool_kw);
    // MSZ hi-walls carry no airflow_ls → visual default from capacity
    expect(h.visualLs).toBeCloseTo(
      SIM.VISUAL_LS_PER_KW * Math.max(h.ratedHeatKw, h.ratedCoolKw),
      5
    );
    const r = m.rooms.find((x) => x.id === "room1")!;
    expect(r.areaM2).toBeCloseTo(20, 5);
    expect(r.volumeM3).toBeCloseTo(48, 5);
    expect(r.uaWK).toBeCloseTo(r.loadW / SIM.DT_DESIGN_K, 5);
    expect(r.capJK).toBeCloseTo(SIM.AIR_C_PER_M3 * 48 * SIM.K_FABRIC, 5);
  });

  it("infers facing off the nearest wall, pointing into the room", () => {
    const m = buildSimModel(simDoc(), pack, "flr");
    const dir = m.handlers[0].dir; // unit near the x=0 wall → +x
    expect(dir.x).toBeCloseTo(1, 5);
    expect(Math.abs(dir.y)).toBeLessThan(1e-6);
  });

  it("degrades with a reason instead of guessing", () => {
    const noIdu = simDoc();
    noIdu.objects = noIdu.objects.filter((o) => o.id !== "idu1");
    expect(buildSimModel(noIdu, pack, "flr").notReady[0].reason).toMatch(/no indoor unit/);

    const uncal = simDoc();
    uncal.floors[0].scaleMmPerUnit = null;
    const m = buildSimModel(uncal, pack, "flr");
    expect(m.handlers).toHaveLength(0);
    // uncalibrated → the room has no load either; it lands in unknownRooms
    expect(m.rooms).toHaveLength(0);
    expect(m.unknownRooms.map((r) => r.id)).toEqual(["room1"]);

    const strayIdu = simDoc();
    const idu = strayIdu.objects.find((o) => o.id === "idu1")!;
    delete idu.props.roomId;
    expect(buildSimModel(strayIdu, pack, "flr").notReady[0].reason).toMatch(/not inside a room/);

    // a stale roomId stamp (unit metres away from its room) fails loudly
    const stranded = simDoc();
    stranded.objects.find((o) => o.id === "idu1")!.geometry = {
      kind: "point",
      at: { x: -250, y: 200 }, // 2.5 m outside at 10 mm/unit
    };
    expect(buildSimModel(stranded, pack, "flr").notReady[0].reason).toMatch(/outside its room/);

    // mounted exactly ON the boundary is fine (wall units live there)
    const onEdge = simDoc();
    onEdge.objects.find((o) => o.id === "idu1")!.geometry = {
      kind: "point",
      at: { x: 0, y: 200 },
    };
    expect(buildSimModel(onEdge, pack, "flr").notReady).toEqual([]);

    // roomLock means the user attributed the room by hand, so the stamp
    // outranks the position — the same stray placement simulates fine
    const pinned = simDoc();
    const pinnedIdu = pinned.objects.find((o) => o.id === "idu1")!;
    pinnedIdu.geometry = { kind: "point", at: { x: -250, y: 200 } };
    pinnedIdu.props.roomLock = true;
    expect(buildSimModel(pinned, pack, "flr").notReady).toEqual([]);
  });
});

describe("simTick — heating scene (winter 5°, set 22°)", () => {
  const model = buildSimModel(simDoc(), pack, "flr");
  const h = model.handlers[0];

  it("rooms start at the free-running temp and the unit starts off", () => {
    const s0 = initSimState(model, { outdoorC: 5 });
    expect(s0.roomTempC.room1).toBeCloseTo(freeRunningC(5), 5);
    expect(s0.handlers[h.id].on).toBe(false);
    expect(s0.handlers[h.id].mode).toBe("heat"); // suggested by the scenario
  });

  it("warms the room to the setpoint band and settles without flapping", () => {
    let s = initSimState(model, { outdoorC: 5, speed: 60 });
    s = { ...s, handlers: { [h.id]: { ...s.handlers[h.id], on: true, setpointC: 22 } } };
    s = run(model, s, 60); // 60 real-s at 60× = one sim-hour
    expect(s.roomTempC.room1).toBeGreaterThan(21);
    expect(s.roomTempC.room1).toBeLessThan(23.2);
    // settled: modulating or cycling gently near setpoint, fan at least idling
    expect(s.handlers[h.id].outputKw).toBeLessThan(h.ratedHeatKw * 0.75);
    expect(s.handlers[h.id].fanFrac).toBeGreaterThan(0.1);
  });

  it("supply air lags through the coil, stays clamped, runs hotter on low fan", () => {
    let s = initSimState(model, { outdoorC: 5, speed: 60 });
    s = { ...s, handlers: { [h.id]: { ...s.handlers[h.id], on: true, setpointC: 22, fan: "hi" } } };
    const early = simTick(model, s, 0.1);
    // first air out is barely warmer than the room — the coil lag (§2c)
    expect(early.handlers[h.id].supplyC).toBeLessThan(s.roomTempC.room1 + 2);
    const sHi = run(model, s, 8);
    let sLo: SimState = {
      ...sHi,
      handlers: { [h.id]: { ...sHi.handlers[h.id], fan: "lo" } },
    };
    sLo = run(model, sLo, 8);
    // same kW through less air → hotter supply, never past the clamp
    expect(sLo.handlers[h.id].supplyC).toBeGreaterThan(sHi.handlers[h.id].supplyC);
    expect(sLo.handlers[h.id].supplyC).toBeLessThanOrEqual(SIM.SUPPLY_MAX_C);
  });

  it("cooling mode pulls a summer room down instead", () => {
    let s = initSimState(model, { outdoorC: 30, speed: 60 });
    expect(s.handlers[h.id].mode).toBe("cool");
    const start = s.roomTempC.room1;
    s = { ...s, handlers: { [h.id]: { ...s.handlers[h.id], on: true, setpointC: 23 } } };
    s = run(model, s, 60);
    expect(s.roomTempC.room1).toBeLessThan(start - 3);
    expect(s.roomTempC.room1).toBeGreaterThan(21.5);
  });

  it("a powered-off unit lets the room drift at the free-running temp", () => {
    let s = initSimState(model, { outdoorC: 5 });
    s = run(model, s, 20);
    expect(s.roomTempC.room1).toBeCloseTo(freeRunningC(5), 1);
  });

  it("nothing steps — per-tick movement respects every rate limit", () => {
    let s = initSimState(model, { outdoorC: 5, speed: 60 });
    s = { ...s, handlers: { [h.id]: { ...s.handlers[h.id], on: true, setpointC: 22 } } };
    const dt = 0.1;
    // fastest possible compressor rate (the faster, post-soft-start phase)
    const maxCompRate = (1 - SIM.AIRFLOW_ON_FRAC) / SIM.RAMP_FULL_S;
    for (let i = 0; i < 400; i++) {
      const n = simTick(model, s, dt);
      const dtSim = dt * s.speed;
      expect(
        Math.abs(n.handlers[h.id].compressorFrac - s.handlers[h.id].compressorFrac)
      ).toBeLessThanOrEqual(maxCompRate * dtSim + 1e-9);
      expect(Math.abs(n.handlers[h.id].fanFrac - s.handlers[h.id].fanFrac)).toBeLessThanOrEqual(
        dt / SIM.FAN_RAMP_S + 1e-9
      );
      expect(Math.abs(n.roomTempC.room1 - s.roomTempC.room1)).toBeLessThan(0.2);
      s = n;
    }
  });

  it("pause freezes thermal time but the fan keeps breathing", () => {
    let s = initSimState(model, { outdoorC: 5, speed: 60 });
    // compressor already up (gate open) so the fan can run on the mechanical clock
    s = {
      ...s,
      paused: true,
      handlers: {
        [h.id]: { ...s.handlers[h.id], on: true, running: true, setpointC: 22, compressorFrac: 1 },
      },
    };
    const n = run(model, s, 5);
    expect(n.tSim).toBe(0);
    expect(n.roomTempC.room1).toBe(s.roomTempC.room1);
    expect(n.handlers[h.id].fanFrac).toBeGreaterThan(0.3); // mechanical clock ran
  });
});

describe("estimates & visuals", () => {
  const model = buildSimModel(simDoc(), pack, "flr");
  const h = model.handlers[0];

  it("time-to-setpoint is finite for a covered room, and reaches it", () => {
    let s = initSimState(model, { outdoorC: 5, speed: 60 });
    s = { ...s, handlers: { [h.id]: { ...s.handlers[h.id], on: true, setpointC: 22 } } };
    const t = timeToSetpointSimS(model, s, h.id);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(60); // takes real minutes of sim time
    expect(t!).toBeLessThan(3 * 3600);
  });

  it("an undersized unit reports 'never' with the honest steady state", () => {
    const d = simDoc();
    // a 10× bigger room the same 5 kW unit can't carry (100 m² ≈ 14.5 kW load)
    const room = d.objects.find((o) => o.id === "room1")!;
    room.geometry = rect(0, 0, 1250, 800);
    const m = buildSimModel(d, pack, "flr");
    let s = initSimState(m, { outdoorC: 5 });
    const hid = m.handlers[0].id;
    s = { ...s, handlers: { [hid]: { ...s.handlers[hid], on: true, setpointC: 22 } } };
    expect(timeToSetpointSimS(m, s, hid)).toBeNull();
    const ss = steadyStateC(m, s, "room1")!;
    expect(ss).toBeLessThan(22);
    expect(ss).toBeGreaterThan(freeRunningC(5));
  });

  it("fill-front grows from the power-on baseline toward the setpoint", () => {
    const rt = new SimRuntime(simDoc(), pack, "flr", 5);
    const hid = rt.model.handlers[0].id;
    rt.setOn(hid, true);
    rt.setSetpoint(hid, 22);
    expect(fillProgress(rt.model, rt.state, "room1")).toBeCloseTo(0, 2);
    for (let i = 0; i < 300; i++) rt.advance(0.1); // 30 real-s at 60×
    const p = fillProgress(rt.model, rt.state, "room1");
    expect(p).toBeGreaterThan(0.3);
    expect(p).toBeLessThanOrEqual(1);
  });

  it("with no setpoint the tint is the plain 21° thermometer", () => {
    // an unconditioned room has no target, so it keeps the absolute read
    expect(tempTint(21)).toBeNull();
    expect(tempTint(15)!.rgb).toBe("56, 154, 232");
    expect(tempTint(27)!.rgb).toBe("255, 138, 0");
    expect(tempTint(13)!.alpha).toBeGreaterThan(tempTint(18)!.alpha);
    expect(tempTint(13)!.alpha).toBeLessThanOrEqual(0.35);
  });

  it("the tint anchors on the SETPOINT, not on 21°", () => {
    /* the bug this replaced: a room correctly held at 24° in winter read as
       permanently orange, because the anchor was a fixed 21°. */
    expect(tempTint(24, 24)!.rgb).toBe("0, 163, 137");
    // 18° is cool of a 24° target even though it is "warm" against 21°
    expect(tempTint(18, 24)!.rgb).toBe("56, 154, 232");
    // …and warm of a 15° cooling target
    expect(tempTint(18, 15)!.rgb).toBe("255, 138, 0");
    // further from target = stronger
    expect(tempTint(14, 24)!.alpha).toBeGreaterThan(tempTint(21, 24)!.alpha);
  });

  it("at temperature the room is coloured, never clear", () => {
    /* the whole point: arriving used to mean the tint vanished, so the one
       state worth showing was the one with no colour at all */
    for (const sp of [18, 21, 24, 26]) {
      const t = tempTint(sp, sp);
      expect(t).not.toBeNull();
      expect(t!.alpha).toBeGreaterThan(0.1);
      expect(t!.rgb).toBe("0, 163, 137");
    }
  });

  it("comfort crossfades rather than snapping, so cycling can't flash it", () => {
    expect(comfortWeight(21, 21)).toBe(1);
    expect(comfortWeight(21.2, 21)).toBe(1); // inside the band
    expect(comfortWeight(24, 21)).toBe(0); // well outside
    const mid = comfortWeight(21.75, 21);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // monotonic on the way out — no reversal a viewer would read as flicker
    expect(comfortWeight(21.5, 21)).toBeGreaterThan(comfortWeight(21.9, 21));
    // and the tint follows it continuously: no visible seam at the band edge
    const inside = tempTint(21 + COMFORT_IN_K - 0.001, 21)!;
    const outside = tempTint(21 + COMFORT_IN_K + 0.001, 21)!;
    expect(Math.abs(inside.alpha - outside.alpha)).toBeLessThan(0.01);
  });

  it("comfort is undefined without a setpoint", () => {
    expect(comfortWeight(21, null)).toBe(0);
  });

  it("roomSetpointC reports only a RUNNING handler's target", () => {
    const rt = new SimRuntime(simDoc(), pack, "flr", 5);
    const hid = rt.model.handlers[0].id;
    expect(roomSetpointC(rt.model, rt.state, "room1")).toBeNull();
    rt.setOn(hid, true);
    rt.setSetpoint(hid, 23);
    expect(roomSetpointC(rt.model, rt.state, "room1")).toBe(23);
    rt.setOn(hid, false);
    expect(roomSetpointC(rt.model, rt.state, "room1")).toBeNull();
  });

  it("a room driven to its setpoint ends up in the comfort colour", () => {
    const rt = new SimRuntime(simDoc(), pack, "flr", 5);
    const hid = rt.model.handlers[0].id;
    rt.setOn(hid, true);
    rt.setSetpoint(hid, 22);
    for (let i = 0; i < 4000; i++) rt.advance(0.1);
    const sp = roomSetpointC(rt.model, rt.state, "room1");
    const t = rt.state.roomTempC.room1;
    expect(Math.abs(t - 22)).toBeLessThan(COMFORT_OUT_K);
    expect(comfortWeight(t, sp)).toBeGreaterThan(0);
    expect(tempTint(t, sp)!.alpha).toBeGreaterThan(0.05);
  });
});

describe("the lock gate — sim never mutates the document", () => {
  it("a scripted session leaves the document byte-identical", () => {
    const doc = simDoc();
    const before = JSON.stringify(doc);
    const rt = new SimRuntime(doc, pack, "flr", 5);
    const hid = rt.model.handlers[0].id;
    rt.setOn(hid, true);
    rt.setMode(hid, "heat");
    rt.setSetpoint(hid, 23);
    rt.setFan(hid, "hi");
    rt.setOutdoor(0);
    rt.setSpeed(120);
    for (let i = 0; i < 600; i++) rt.advance(0.1);
    rt.setPaused(true);
    rt.rebuild(doc, pack, "flr");
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("rebuild carries temps and settings across a doc edit", () => {
    const doc = simDoc();
    const rt = new SimRuntime(doc, pack, "flr", 5);
    const hid = rt.model.handlers[0].id;
    rt.setOn(hid, true);
    rt.setSetpoint(hid, 24);
    for (let i = 0; i < 200; i++) rt.advance(0.1);
    const temp = rt.state.roomTempC.room1;
    const edited = { ...doc, objects: [...doc.objects] }; // any reference change
    rt.rebuild(edited, pack, "flr");
    expect(rt.state.roomTempC.room1).toBe(temp);
    expect(rt.state.handlers[hid].on).toBe(true);
    expect(rt.state.handlers[hid].setpointC).toBe(24);
  });
});

describe("inferFacing", () => {
  const room = rect(0, 0, 100, 100).points;
  it("points inward off each wall", () => {
    expect(inferFacing({ x: 2, y: 50 }, room).x).toBeCloseTo(1);
    expect(inferFacing({ x: 98, y: 50 }, room).x).toBeCloseTo(-1);
    expect(inferFacing({ x: 50, y: 2 }, room).y).toBeCloseTo(1);
    expect(inferFacing({ x: 50, y: 98 }, room).y).toBeCloseTo(-1);
  });
  it("falls back to plan-down on degenerate input", () => {
    expect(inferFacing({ x: 0, y: 0 }, [])).toEqual({ x: 0, y: 1 });
  });
});

/* Units can be turned on the plan now, so the wall the unit happens to sit
   near no longer gets to decide which way it blows. */
describe("facingOf (a turned unit answers for itself)", () => {
  const room = rect(0, 0, 100, 100).points;

  it("still infers from the wall when the unit was never turned", () => {
    expect(facingOf({ at: { x: 2, y: 50 } }, room).x).toBeCloseTo(1);
  });

  it("takes the rotation when there is one, wall or no wall", () => {
    // hard against the left wall (inference would say +x) but turned to blow up
    const up = facingOf({ at: { x: 2, y: 50 }, rotation: 180 }, room);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(-1);
    // a quarter-turn discharges to −x (SVG's sense, y down)
    const left = facingOf({ at: { x: 50, y: 50 }, rotation: 90 }, room);
    expect(left.x).toBeCloseTo(-1);
    expect(left.y).toBeCloseTo(0);
  });

  it("0° is a real answer — plan-down, the glyph's own louvre edge", () => {
    const d = facingOf({ at: { x: 2, y: 50 }, rotation: 0 }, room);
    expect(d.x).toBeCloseTo(0);
    expect(d.y).toBeCloseTo(1);
  });
});

describe("throw containment", () => {
  const room = rect(0, 0, 100, 100).points;

  it("rayExitDistance measures to the far wall along the facing", () => {
    expect(rayExitDistance({ x: 20, y: 50 }, { x: 1, y: 0 }, room)).toBeCloseTo(80);
    expect(rayExitDistance({ x: 50, y: 50 }, { x: 0, y: 1 }, room)).toBeCloseTo(50);
    expect(rayExitDistance({ x: 0, y: 0 }, { x: 1, y: 0 }, [])).toBe(0);
  });

  it("throw saturates with airflow and never leaves the room", () => {
    const model = buildSimModel(simDoc(), pack, "flr");
    const h = model.handlers[0];
    // unit at x=20 facing +x in a 500-unit (5 m) room → 480 units to the wall
    expect(h.roomExtentU).toBeCloseTo(480);
    const s = initSimState(model, { outdoorC: 5 });
    const hs = { ...s.handlers[h.id], on: true, running: true, fanFrac: 1, mode: "heat" as const };
    const t = throwLengthU(h, hs, model.mPerUnit);
    // 6 kW visual default = 330 L/s → (2 + 6.6) capped at 8 → ×0.7 heat = 5.6 m
    // = 560 units, but the wall is 480 away → clamped inside the room
    expect(t).toBeLessThanOrEqual(480 * 0.95 + 1e-9);
    expect(t).toBeGreaterThan(200); // still a real throw, not a fizzle
    // cooling reaches further than heating, but still respects the wall
    const cool = throwLengthU(h, { ...hs, mode: "cool" }, model.mPerUnit);
    expect(cool).toBeLessThanOrEqual(480 * 0.95 + 1e-9);
  });
});

describe("compressor ramp-up (the kick-in story)", () => {
  const model = buildSimModel(simDoc(), pack, "flr");
  const h = model.handlers[0];
  const on = (s: SimState, patch: Partial<SimState["handlers"][string]> = {}) =>
    ({ ...s, handlers: { [h.id]: { ...s.handlers[h.id], on: true, setpointC: 22, ...patch } } }) as SimState;

  it("airflowGate is 0 below 30% and rises to 1 by 60%", () => {
    expect(airflowGate(0)).toBe(0);
    expect(airflowGate(0.29)).toBe(0);
    expect(airflowGate(0.3)).toBe(0);
    expect(airflowGate(0.45)).toBeGreaterThan(0.2);
    expect(airflowGate(0.45)).toBeLessThan(0.8);
    expect(airflowGate(0.6)).toBeCloseTo(1, 5);
    expect(airflowGate(1)).toBe(1);
  });

  it("soft-starts to ~30% around 3 minutes, no airflow before then", () => {
    let s = on(initSimState(model, { outdoorC: 5, speed: 60 }));
    // ~3 sim-minutes (180 s) at 60× = 3 real-s
    s = run(model, s, 3);
    const frac = s.handlers[h.id].compressorFrac;
    expect(frac).toBeGreaterThan(0.24);
    expect(frac).toBeLessThan(0.4); // reached ~the airflow-on point, not full
    // the fan (and thus the plume) has barely engaged this early
    expect(s.handlers[h.id].fanFrac).toBeLessThan(0.25);
  });

  it("the room stays ~static through preheat, then moves once air flows", () => {
    let s = on(initSimState(model, { outdoorC: 5, speed: 60 }), { fan: "hi" });
    const start = s.roomTempC.room1;
    s = run(model, s, 2); // ~2 min: still preheating, gate shut
    expect(compressorPhase(model, s, h.id)).toBe("preheat");
    expect(Math.abs(s.roomTempC.room1 - start)).toBeLessThan(0.3); // barely moved
    // watch it ramp: the compressor climbs above full-airflow before setpoint
    let peakFrac = 0;
    for (let i = 0; i < 300; i++) {
      s = simTick(model, s, 0.1);
      peakFrac = Math.max(peakFrac, s.handlers[h.id].compressorFrac);
    }
    expect(peakFrac).toBeGreaterThan(0.85); // did reach (near) full output while warming
    expect(s.roomTempC.room1).toBeGreaterThan(start + 2); // and the room genuinely warmed
  });

  it("phase progresses off → preheat → running → easing", () => {
    let s = on(initSimState(model, { outdoorC: 5, speed: 60 }));
    // the instant it's switched on the compressor is still at 0 → "off"
    expect(compressorPct(s, h.id)).toBe(0);
    expect(compressorPhase(model, s, h.id)).toBe("off");
    s = run(model, s, 1); // heating, compressor rising, coil still warming
    expect(compressorPhase(model, s, h.id)).toBe("preheat");
    s = run(model, s, 60); // warm all the way to setpoint
    expect(s.roomTempC.room1).toBeGreaterThan(21);
    expect(compressorPhase(model, s, h.id)).toBe("easing");
    // easing = modulating down: compressor below full
    expect(s.handlers[h.id].compressorFrac).toBeLessThan(0.9);
  });

  it("preheat is HEATING-only and START-only — never cooling, off, or shutting down", () => {
    const set = (patch: Partial<SimState["handlers"][string]>) =>
      ({ ...initSimState(model, { outdoorC: 5, speed: 60 }),
        handlers: { [h.id]: { ...initSimState(model, { outdoorC: 5 }).handlers[h.id], on: true, ...patch } } }) as SimState;
    // cooling start-up (rising) is "starting", not preheat
    expect(compressorPhase(model, set({ mode: "cool", compressorFrac: 0.15, running: true, demand: 1 }), h.id)).toBe("starting");
    // heating but compressor FALLING (satisfied / shutting down) → not preheat
    expect(compressorPhase(model, set({ mode: "heat", compressorFrac: 0.2, running: false, demand: 0 }), h.id)).not.toBe("preheat");
    // compressor at 0 while powered on → "off" (not preheat)
    expect(compressorPhase(model, set({ mode: "heat", compressorFrac: 0, running: true, demand: 1 }), h.id)).toBe("off");
    // heating + rising + coil not yet warm → preheat
    expect(compressorPhase(model, set({ mode: "heat", compressorFrac: 0.15, running: true, demand: 1 }), h.id)).toBe("preheat");
  });

  it("modulates down (compressor eases) as the room reaches setpoint", () => {
    let s = on(initSimState(model, { outdoorC: 5, speed: 60 }));
    s = run(model, s, 10); // ramp up
    const peak = s.handlers[h.id].compressorFrac;
    expect(peak).toBeGreaterThan(0.7);
    s = run(model, s, 60); // approach setpoint
    expect(s.handlers[h.id].compressorFrac).toBeLessThan(peak); // eased back
  });

  it("startupRemaining adds the kick-in lag, then vanishes at full speed", () => {
    expect(startupRemainingSimS(1)).toBe(0);
    expect(startupRemainingSimS(0)).toBeGreaterThan(SIM.RAMP_FULL_S); // whole ramp ahead
    expect(startupRemainingSimS(0)).toBeGreaterThan(startupRemainingSimS(0.5));
    // a cold-start estimate is longer than a warmed-up one for the same room
    const cold = on(initSimState(model, { outdoorC: 5, speed: 60 }));
    const tCold = timeToSetpointSimS(model, cold, h.id);
    const warm = on({ ...cold, handlers: { [h.id]: { ...cold.handlers[h.id], on: true, compressorFrac: 1 } } });
    const tWarm = timeToSetpointSimS(model, warm, h.id);
    expect(tCold).not.toBeNull();
    expect(tWarm).not.toBeNull();
    expect(tCold!).toBeGreaterThan(tWarm!);
  });
});
