"use client";

/* Design Studio — the air-side tool chrome (Stage 7, Step 2): the component
   palette flyout (the built entries of the eight) and the options HUD framework with its first variant (plenum
   supply ⌇ return). The dock buttons themselves live in studio.tsx's
   toolrail; the canvas does the placing. Spec §3b–3c. */

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { Tooltip } from "@/components/parts/tooltip";
import type { AirComponentKind } from "./canvas";
import { GRILLE_SIZES, sizeText, typedGrilleMm, type GrilleSize } from "@/lib/studio/grilles";

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
  { kind: "grille", label: "Grille", icon: "square", enabled: true },
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
        {/* only what is built: the rest named the build plan's step
            ("coming — Step 6") to the person designing (walk of 29 October
            2026). Each turns up here when its entry is switched on. */}
        {PALETTE_ENTRIES.filter((e) => e.enabled).map((e) => (
          <button
            key={e.kind}
            role="menuitem"
            className="ds-pal-item"
            onClick={() => onPick(e.kind)}
          >
            <span className="ds-pal-ic">
              <Icon name={e.icon as never} size={16} />
            </span>
            <span className="ds-pal-nm">{e.label}</span>
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
  const ret = (
    <button
      className={`ds-hud-chip${stream === "return" ? " on" : ""}`}
      aria-pressed={stream === "return"}
      disabled={returnBuiltIn}
      onClick={() => onStream("return")}
    >
      Return
    </button>
  );
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
        {returnBuiltIn ? <Tooltip label="Return plenum is built into this air handler">{ret}</Tooltip> : ret}
      </div>
    </OptionsHud>
  );
}

/** Grille variant: supply or return and the face size, for the grille about
    to go down or the one picked on the plan. The usual sizes are one press;
    any other is typed, width × height in mm, and lands on Enter or on
    leaving the field. A grille is turned on the plan, on its ring. */
export function GrilleHud({
  stream,
  size,
  onStream,
  onSize,
}: {
  stream: "supply" | "return";
  size: GrilleSize;
  onStream: (s: "supply" | "return") => void;
  onSize: (s: GrilleSize) => void;
}) {
  const chip = (s: "supply" | "return", label: string) => (
    <button
      className={`ds-hud-chip${stream === s ? " on" : ""}`}
      aria-pressed={stream === s}
      onClick={() => onStream(s)}
    >
      {label}
    </button>
  );
  return (
    <OptionsHud label="Grille">
      <div className="ds-hud-seg">
        {chip("supply", "Supply")}
        {chip("return", "Return")}
      </div>
      <div className="ds-hud-seg">
        {GRILLE_SIZES[stream].map((s) => {
          const on = s.wMm === size.wMm && s.hMm === size.hMm;
          return (
            <button
              key={sizeText(s)}
              className={`ds-hud-chip${on ? " on" : ""}`}
              aria-pressed={on}
              onClick={() => onSize(s)}
            >
              {sizeText(s)}
            </button>
          );
        })}
      </div>
      {/* keyed by the size, so a press on a chip or a drag on the plan
          puts the fields back to what the grille now is */}
      <span className="ds-hud-size" key={sizeText(size)}>
        <MmField label="Width, mm" value={size.wMm} onCommit={(wMm) => onSize({ ...size, wMm })} />
        <span aria-hidden="true">×</span>
        <MmField label="Height, mm" value={size.hMm} onCommit={(hMm) => onSize({ ...size, hMm })} />
        <span className="ds-hud-unit">mm</span>
      </span>
    </OptionsHud>
  );
}

/** one face dimension, typed: a value out of range goes back to what it was */
function MmField({ label, value, onCommit }: { label: string; value: number; onCommit: (mm: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const land = () => {
    const mm = typedGrilleMm(draft);
    if (mm == null) setDraft(String(value));
    else if (mm !== value) onCommit(mm);
  };
  return (
    <input
      className="ds-hud-mm"
      inputMode="numeric"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={land}
      onKeyDown={(e) => {
        if (e.key === "Enter") land();
        if (e.key === "Escape") setDraft(String(value));
      }}
    />
  );
}
