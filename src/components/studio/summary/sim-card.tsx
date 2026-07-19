"use client";

/* Simulate action card — launches the same present mode as the canvas pill.
   The readiness verdict is derived in the Editor (buildSimModel over the
   active floor) so this card renders, never computes. */

export interface SimReady {
  ok: boolean;
  /** why not, when !ok — shown in place of the pitch line */
  reason: string;
  /** the floor toggleSim will run — named so the button says what it does */
  floorName: string;
}

export function SimCard({
  ready,
  onSimulate,
}: {
  ready: SimReady;
  onSimulate: () => void;
}) {
  return (
    <div className="ds-act-card">
      <span className="ds-act-t">
        <span className="ds-sim-play" aria-hidden>
          ▶
        </span>
        Simulate
      </span>
      <span className="ds-act-s">
        {ready.ok
          ? `Run the live model on ${ready.floorName} — room temperatures and the compressor ramp, read-only.`
          : ready.reason}
      </span>
      <div className="ds-act-row">
        <button
          className="ds-tbbtn ds-act-go"
          onClick={onSimulate}
          disabled={!ready.ok}
        >
          Simulate {ready.ok ? ready.floorName : ""}
        </button>
      </div>
    </div>
  );
}
