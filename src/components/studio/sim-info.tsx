"use client";

import { useSyncExternalStore } from "react";
import type { SimRuntime } from "@/lib/studio/sim-runtime";
import {
  compressorPct,
  compressorPhase,
  timeToSetpointSimS,
  type CompressorPhase,
} from "@/lib/studio/sim";

/* Operation status — the read-only line the CUSTOMER watches, shown in the
   present-mode HEADER (in line with the design name + system). What the system
   is doing right now, grounded in real inverter behaviour. Subscribes to the
   sim; never writes. */

function phaseCopy(
  phase: CompressorPhase,
  on: boolean
): { tag: string; desc: string; tone: string } {
  switch (phase) {
    case "preheat":
      // heating cold-blow prevention (verified real behaviour): the fan is held
      // until the coil warms so the unit never blows cold air
      return {
        tag: "Preheating",
        desc: "Warming the coil before the fan starts — so it never blows cold air.",
        tone: "warn",
      };
    case "starting":
      return {
        tag: "Starting up",
        desc: "Compressor ramping up — coming up to full output.",
        tone: "ok",
      };
    case "running":
      return {
        tag: "Running",
        desc: "At full output — conditioning the room.",
        tone: "ok",
      };
    case "easing":
      return {
        tag: "Holding temperature",
        desc: "Easing the compressor down to maintain the set temperature.",
        tone: "cool",
      };
    default:
      return on
        ? {
            tag: "Compressor off",
            desc: "At temperature — the compressor has cycled off.",
            tone: "muted",
          }
        : {
            tag: "System off",
            desc: "Not running — the room drifts toward the outside temperature.",
            tone: "muted",
          };
  }
}

export function SimHeaderStatus({
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
  const copy = phaseCopy(phase, s.on);
  const room = state.roomTempC[h.roomId] ?? 0;

  const t = s.on ? timeToSetpointSimS(model, state, h.id) : null;
  const eta =
    t == null ? null : t === 0 ? "holding" : `~${Math.max(1, Math.round(t / 60))} min`;

  return (
    <div className="ds-present-status" role="status" aria-label="System status">
      <div className="ds-present-stat-phase">
        <span className={`ds-present-stat-tag tone-${copy.tone}`}>{copy.tag}</span>
        <span className="ds-present-stat-desc">{copy.desc}</span>
      </div>

      <div className="ds-present-stat-comp">
        <span className="ds-present-stat-lbl">Compressor</span>
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
        <span className="ds-present-stat-pct">{pct}%</span>
      </div>

      <div className="ds-present-stat-nums">
        <span>
          Room <b>{room.toFixed(1)}°</b> → {s.setpointC.toFixed(1)}°
        </span>
        {eta && <span className="ds-present-stat-eta">{eta}</span>}
      </div>
    </div>
  );
}
