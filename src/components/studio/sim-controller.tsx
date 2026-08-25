"use client";

import { useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { SimRuntime } from "@/lib/studio/sim-runtime";
import { steadyStateC, timeToSetpointSimS, type SimFan, type SimMode } from "@/lib/studio/sim";

/* draggable floating card — reuses the room-modal header-drag idea: screen-px
   deltas, window listeners so the drag survives leaving the card, a transform
   over the CSS anchor, and a guard so clicking the controls never drags. */
function useCardDrag() {
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  const start = useRef<{ px: number; py: number; dx: number; dy: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, input, [role='radiogroup']")) return;
    start.current = { px: e.clientX, py: e.clientY, dx: drag.dx, dy: drag.dy };
    const onMove = (ev: PointerEvent) => {
      const s = start.current;
      if (s) setDrag({ dx: s.dx + (ev.clientX - s.px), dy: s.dy + (ev.clientY - s.py) });
    };
    const onUp = () => {
      start.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return { drag, onPointerDown };
}

/* The simulation's one input surface (spec §6): a floating wall-controller
   card over the canvas — power · mode · setpoint · fan · scenario · time.
   Everything it writes is SIM state on the runtime; the document is never
   touched. Split slice: one tab per ready split system. */

const FANS: SimFan[] = ["auto", "lo", "mid", "hi"];
const SPEEDS = [1, 30, 60];

function PowerIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path
        d="M6.6 6.6a8 8 0 1 0 10.8 0"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SimControllerCard({
  runtime,
  onExit,
}: {
  runtime: SimRuntime;
  /** absent on the public live link — there is nowhere to exit TO */
  onExit?: () => void;
}) {
  const state = useSyncExternalStore(
    (cb) => runtime.subscribe(cb),
    () => runtime.state,
    () => runtime.state
  );
  const { model } = runtime;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const active =
    model.handlers.find((h) => h.id === pickedId) ?? model.handlers[0] ?? null;
  const hs = active ? state.handlers[active.id] : null;

  const simMin = Math.floor(state.tSim / 60);
  const clock = `${String(Math.floor(simMin / 60)).padStart(2, "0")}:${String(simMin % 60).padStart(2, "0")}`;
  const { drag, onPointerDown } = useCardDrag();

  return (
    <div
      className="ds-sim-card"
      role="dialog"
      aria-label="Simulation controller"
      style={{ transform: `translate(${drag.dx}px, ${drag.dy}px)` }}
    >
      <div className="ds-sim-h ds-sim-drag" onPointerDown={onPointerDown}>
        <button
          className={`ds-sim-power${hs?.on ? " on" : ""}`}
          disabled={!active}
          onClick={() => active && runtime.setOn(active.id, !hs?.on)}
          title={hs?.on ? "Turn the system off" : "Turn the system on"}
          aria-label="Power"
        >
          <PowerIcon />
        </button>
        <span className="ds-sim-title">Simulate</span>
        <span className="ds-sim-clock">{clock}</span>
        {onExit && (
          <button className="ds-sim-x" onClick={onExit} title="Exit simulation" aria-label="Exit simulation">
            ×
          </button>
        )}
      </div>

      {model.handlers.length > 1 && (
        <div className="ds-sim-tabs">
          {model.handlers.map((h) => (
            <button
              key={h.id}
              className={`ds-sim-tab${h.id === active?.id ? " on" : ""}`}
              style={{ "--sys": h.colour } as CSSProperties}
              onClick={() => setPickedId(h.id)}
            >
              <span className="ds-sim-tabdot" />
              {h.systemName}
            </button>
          ))}
        </div>
      )}

      {active && hs ? (
        <div className={`ds-sim-body${hs.on ? "" : " off"}`}>
          <div className="ds-sim-chips ds-sim-mode" role="radiogroup" aria-label="Mode">
            {(["heat", "cool"] as SimMode[]).map((m) => (
              <button
                key={m}
                className={`ds-sim-chip${hs.mode === m ? ` on ${m}` : ""}`}
                onClick={() => runtime.setMode(active.id, m)}
              >
                {m === "heat" ? "Heat" : "Cool"}
              </button>
            ))}
          </div>

          <div className="ds-sim-set">
            <button
              className="ds-sim-step"
              onClick={() => runtime.setSetpoint(active.id, hs.setpointC - 0.5)}
              aria-label="Lower the set temperature"
            >
              −
            </button>
            <span className="ds-sim-temp">{hs.setpointC.toFixed(1)}°</span>
            <button
              className="ds-sim-step"
              onClick={() => runtime.setSetpoint(active.id, hs.setpointC + 0.5)}
              aria-label="Raise the set temperature"
            >
              +
            </button>
          </div>
          <div className="ds-sim-live">
            {`room ${(state.roomTempC[active.roomId] ?? 0).toFixed(1)}° · supply ${hs.supplyC.toFixed(0)}°`}
          </div>
          <div className="ds-sim-eta">{etaLine(runtime, active.id)}</div>

          <div className="ds-sim-row">
            <span className="ds-sim-lbl">Fan</span>
            <div className="ds-sim-chips" role="radiogroup" aria-label="Fan speed">
              {FANS.map((f) => (
                <button
                  key={f}
                  className={`ds-sim-chip${hs.fan === f ? " on" : ""}`}
                  onClick={() => runtime.setFan(active.id, f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="ds-sim-reasons">
          <div className="ds-sim-lbl">Nothing to simulate on this floor yet</div>
        </div>
      )}

      <div className="ds-sim-row">
        <span className="ds-sim-lbl">Outdoor temperature</span>
        <span className="ds-sim-outval">{Math.round(state.outdoorC)}°</span>
      </div>
      <div className="ds-sim-chips" role="radiogroup" aria-label="Outdoor scenario">
        <button
          className={`ds-sim-chip${state.outdoorC === 5 ? " on" : ""}`}
          onClick={() => runtime.setOutdoor(5)}
        >
          Winter 5°
        </button>
        <button
          className={`ds-sim-chip${state.outdoorC === 30 ? " on" : ""}`}
          onClick={() => runtime.setOutdoor(30)}
        >
          Summer 30°
        </button>
      </div>
      {/* drag the slider to set the outside temperature between the presets */}
      <input
        className="ds-sim-slider"
        type="range"
        min={-5}
        max={40}
        step={1}
        value={state.outdoorC}
        aria-label="Outdoor temperature"
        title="Outside air temperature"
        onChange={(e) => runtime.setOutdoor(Number(e.target.value))}
      />

      <div className="ds-sim-foot">
        <button
          className={`ds-sim-chip${state.paused ? " on" : ""}`}
          onClick={() => runtime.setPaused(!state.paused)}
          title={state.paused ? "Resume" : "Pause"}
        >
          {state.paused ? "▶" : "❚❚"}
        </button>
        <div className="ds-sim-chips" role="radiogroup" aria-label="Time compression">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={`ds-sim-chip${state.speed === s ? " on" : ""}`}
              onClick={() => runtime.setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      {model.notReady.length > 0 && (
        <div className="ds-sim-reasons">
          {model.notReady.map((n) => (
            <div key={n.systemId} className="ds-sim-reason">
              {`${n.systemName} — ${n.reason}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** the honest line under the setpoint: on the way / holding / never */
function etaLine(runtime: SimRuntime, handlerId: string): string {
  const { model, state } = runtime;
  const h = model.handlers.find((x) => x.id === handlerId);
  const s = h && state.handlers[h.id];
  if (!h || !s) return "";
  if (!s.on) return "off — the room drifts";
  const t = timeToSetpointSimS(model, state, handlerId);
  if (t === 0) return `holding ${s.setpointC.toFixed(1)}°`;
  if (t != null) return `${s.setpointC.toFixed(1)}° in ~${Math.max(1, Math.round(t / 60))} min`;
  const ss = steadyStateC(model, state, h.roomId);
  return ss == null
    ? ""
    : `won't reach ${s.setpointC.toFixed(1)}° — settles near ${ss.toFixed(1)}°`;
}
