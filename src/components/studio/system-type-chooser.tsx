"use client";

import { Icon } from "@/components/shell/icon";
import type { SystemType } from "@/lib/studio/document";
import { MODULE_ORDER, SYSTEM_MODULES } from "@/lib/studio/modules";

/* System-type chooser (flow rework) — the FIRST thing the panel shows for a new
   system. Picking an available type creates the system as that module; the
   others are offered but disabled with their arrival stage. (feedback-design-
   flow-spec: type-first.) */

const TYPE_ICON: Record<SystemType, string> = {
  split: "thermo",
  "multi-split": "layers",
  ducted: "wind",
  vrf: "activity",
  ventilation: "cloud",
  "sheet-metal": "wrench",
};

export function SystemTypeChooser({
  onChoose,
  onCancel,
  heading = "New system",
  sub = "Choose a system type to design",
}: {
  onChoose: (type: SystemType) => void;
  onCancel?: () => void;
  heading?: string;
  sub?: string;
}) {
  return (
    <div className="ds-syscard ds-chooser">
      <div className="ds-chooser-head">
        <span className="ds-cardt">{heading}</span>
        <span className="ds-chooser-sub">{sub}</span>
      </div>
      <div className="ds-chooser-grid">
        {MODULE_ORDER.map((t) => {
          const m = SYSTEM_MODULES[t];
          return (
            <button
              key={t}
              className={`ds-chooser-card${m.available ? "" : " soon"}`}
              disabled={!m.available}
              onClick={() => m.available && onChoose(t)}
              title={m.available ? m.blurb : `${m.label} — coming at ${m.comingStage}`}
            >
              <span className="ds-chooser-ic">
                <Icon name={TYPE_ICON[t] as never} size={18} />
              </span>
              <span className="ds-chooser-label">{m.label}</span>
              <span className="ds-chooser-blurb">{m.blurb}</span>
              {!m.available && (
                <span className="ds-chooser-soon">Coming at {m.comingStage}</span>
              )}
            </button>
          );
        })}
      </div>
      {onCancel && (
        <button className="ds-calib-cancel ds-chooser-cancel" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
