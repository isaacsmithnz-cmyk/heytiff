"use client";

/* Design Studio — the air-side tool chrome (Stage 7, Step 2): the component
   palette flyout (all eight entries, unbuilt ones disabled with their coming
   step) and the options HUD framework with its first variant (plenum
   supply ⌇ return). The dock buttons themselves live in studio.tsx's
   toolrail; the canvas does the placing. Spec §3b–3c. */

import { useEffect, useRef } from "react";
import { Icon } from "@/components/shell/icon";
import type { AirComponentKind } from "./canvas";

export interface PaletteEntry {
  kind: AirComponentKind;
  label: string;
  icon: string;
  enabled: boolean;
  /** shown on disabled entries — which step ships it */
  reason?: string;
}

/* Spec §3b order. The palette ships ONCE with all eight entries so each later
   step just flips its entry on and the progression stays visible. */
export const PALETTE_ENTRIES: PaletteEntry[] = [
  { kind: "takeoff", label: "Takeoff", icon: "circle", enabled: false, reason: "coming — Step 4" },
  { kind: "joiner", label: "Joiner", icon: "minus", enabled: false, reason: "coming — Step 6" },
  { kind: "reducer", label: "Reducer", icon: "chevR", enabled: false, reason: "coming — Step 6" },
  { kind: "zone-motor", label: "Zone motor", icon: "zap", enabled: false, reason: "coming — Step 6" },
  { kind: "plenum", label: "Plenum", icon: "wind", enabled: true },
  { kind: "grille", label: "Grille", icon: "square", enabled: false, reason: "coming — Step 3" },
  { kind: "wall-controller", label: "Wall controller", icon: "calc", enabled: false, reason: "coming — Step 5" },
  { kind: "zone-sensor", label: "Zone sensor", icon: "thermo", enabled: false, reason: "coming — Step 6" },
];

/** 2-column flyout anchored to the dock's Component button. Picking an
    enabled entry closes the palette and arms it (the parent owns both). */
export function ComponentPalette({
  onPick,
  onClose,
}: {
  onPick: (kind: AirComponentKind) => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="ds-pal" role="menu" aria-label="Air components" ref={boxRef}>
      <div className="ds-pal-grid">
        {PALETTE_ENTRIES.map((e) => (
          <button
            key={e.kind}
            role="menuitem"
            className={`ds-pal-item${e.enabled ? "" : " off"}`}
            disabled={!e.enabled}
            title={e.enabled ? e.label : `${e.label} — ${e.reason}`}
            onClick={() => e.enabled && onPick(e.kind)}
          >
            <span className="ds-pal-ic">
              <Icon name={e.icon as never} size={16} />
            </span>
            <span className="ds-pal-nm">{e.label}</span>
            {!e.enabled && <span className="ds-pal-why">{e.reason}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The options-HUD strip (floating pill, top-centre of the canvas while a
    tool with options is armed). Generic shell — variants compose into it. */
export function OptionsHud({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ds-hud" role="toolbar" aria-label={`${label} options`}>
      <span className="ds-hud-label">{label}</span>
      {children}
    </div>
  );
}

/** Plenum variant: the supply ⌇ return toggle. The return side disables with
    its reason when the chosen AHU's return plenum is built in (spec §3c). */
export function PlenumHud({
  stream,
  onStream,
  returnBuiltIn,
}: {
  stream: "supply" | "return";
  onStream: (s: "supply" | "return") => void;
  returnBuiltIn: boolean;
}) {
  return (
    <OptionsHud label="Plenum">
      <div className="ds-hud-seg">
        <button
          className={`ds-hud-chip${stream === "supply" ? " on" : ""}`}
          aria-pressed={stream === "supply"}
          onClick={() => onStream("supply")}
        >
          Supply
        </button>
        <button
          className={`ds-hud-chip${stream === "return" ? " on" : ""}`}
          aria-pressed={stream === "return"}
          disabled={returnBuiltIn}
          title={
            returnBuiltIn
              ? "Return plenum is built into this air handler"
              : undefined
          }
          onClick={() => onStream("return")}
        >
          Return
        </button>
      </div>
    </OptionsHud>
  );
}
