"use client";

import { useSyncExternalStore } from "react";
import type { SimRuntime } from "@/lib/studio/sim-runtime";
import {
  compressorPct,
  compressorPhase,
  timeToSetpointSimS,
  type CompressorPhase,
  type SimMode,
} from "@/lib/studio/sim";

/* Present-mode status card (top-left) — the read-only display the CUSTOMER
   watches: what the system is doing right now (preheating warning, compressor
   output %, easing to hold temperature), separate from the operator's control
   panel. Subscribes to the sim; never writes. */

function phaseCopy(
  phase: CompressorPhase,
  mode: SimMode
): { tag: string; desc: string; tone: string } {
  switch (phase) {
    case "preheat":
      return mode === "heat"
        ? { tag: "Preheating", desc: "Warming the coil before the fan starts — a system takes a few minutes to reach full output.", tone: "warn" }
        : { tag: "Pre-cooling", desc: "Chilling the coil before the fan starts — a system takes a few minutes to reach full output.", tone: "warn" };
    case "airflow":
      return { tag: "Airflow starting", desc: "Conditioned air is beginning to flow as the compressor ramps up.", tone: "ok" };
    case "running":
      return { tag: "Running", desc: "Delivering full output — the room is changing.", tone: "ok" };
    case "easing":
      return { tag: "Holding temperature", desc: "Easing the compressor down to maintain the set temperature.", tone: "cool" };
    default:
      return { tag: "Standby", desc: "System is off — the room drifts toward the outside temperature.", tone: "muted" };
  }
}

export function SimInfoCard({
  runtime,
  activeSystemId,
}: {
  runtime: SimRuntime;
  activeSystemId: string | null;
}) {
  const state = useSyncExternalStore(
    (cb) => runtime.subscribe(cb),
    () => runtime.state,
    () => runtime.state
  );
  const { model } = runtime;
  const h =
    model.handlers.find((x) => x.systemId === activeSystemId) ?? model.handlers[0] ?? null;
  const s = h && state.handlers[h.id];
  if (!h || !s) return null;

  const phase = compressorPhase(model, state, h.id);
  const pct = compressorPct(state, h.id);
  const copy = phaseCopy(phase, s.mode);
  const room = state.roomTempC[h.roomId] ?? 0;

  const t = s.on ? timeToSetpointSimS(model, state, h.id) : null;
  const eta =
    t == null ? null : t === 0 ? "holding" : `~${Math.max(1, Math.round(t / 60))} min to ${s.setpointC.toFixed(1)}°`;

  return (
    <div className="ds-sim-info" role="status" aria-label="System status">
      <div className="ds-sim-info-head">
        <span className={`ds-sim-info-mode ${s.mode}`}>
          {s.on ? (s.mode === "heat" ? "Heating" : "Cooling") : "Off"}
        </span>
        <span className="ds-sim-info-sys">{h.systemName}</span>
      </div>

      <div className={`ds-sim-info-phase tone-${copy.tone}`}>{copy.tag}</div>
      <div className="ds-sim-info-desc">{copy.desc}</div>

      <div className="ds-sim-info-comp">
        <div className="ds-sim-info-clabel">
          <span>Compressor</span>
          <span className="ds-sim-info-cpct">{pct}%</span>
        </div>
        <div
          className="ds-sim-compbar"
          role="progressbar"
          aria-label="Compressor output"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className={`ds-sim-compfill p-${phase}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="ds-sim-info-nums">
        <span>
          Room <b>{room.toFixed(1)}°</b> → {s.setpointC.toFixed(1)}°
        </span>
        {eta && <span className="ds-sim-info-eta">{eta}</span>}
      </div>
    </div>
  );
}
