"use client";

import { UNIT_WHERE, type UnitWhere } from "@/lib/studio/unit-where";

/* Design Studio — the air-side tool chrome (Stage 7, Step 2): the component
   palette flyout (the built entries of the eight) and the options HUD framework with its first variant (plenum
   supply ⌇ return). The dock buttons themselves live in studio.tsx's
   toolrail; the canvas does the placing. Spec §3b–3c. */

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { Tooltip } from "@/components/parts/tooltip";
import { Tray } from "@/components/parts/tabs";
import { StackGroup, StackHead, StackScreen, StackSection } from "./stack";
import type { AirComponentKind } from "./canvas";
import {
  GRILLE_MOUNTS,
  GRILLE_SIZES,
  GRILLE_STYLES,
  STYLE_SIZES,
  sizeText,
  sizesFor,
  typedGrilleMm,
  type GrilleMount,
  type GrilleSize,
  type GrilleStyle,
} from "@/lib/studio/grilles";

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
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  /** a bar with many choices: it wraps onto a second row rather than run off the plan */
  wide?: boolean;
}) {
  return (
    <div className={`ds-hud${wide ? " wide" : ""}`} role="toolbar" aria-label={`${label} options`}>
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
      onFocus={(e) => e.target.select()}
      onBlur={land}
      onKeyDown={(e) => {
        if (e.key === "Enter") land();
        if (e.key === "Escape") setDraft(String(value));
      }}
    />
  );
}

/* ── THE AIR SCREEN (the next flow; the "Air choices" page of the Tiff
   canvas, A, which Isaac picked on 3 November 2026): while the air side is
   armed the column is this screen, and nothing of it floats over the plan.
   What goes down next, as the bench's tools are drawn; then that thing's own
   choices, each under its name: supply or return, a grille's shape, where it
   sits and its size; a duct's size. A rigid duct is drawn straight, a flex
   one as a curve; both end on a grille. ── */

export type AirKind = "grille" | "duct" | "flex" | "arrow" | "sensor" | "controller";

export interface AirState {
  kind: AirKind;
  stream: "supply" | "return";
  /** a linear grille doing both: one face, a divider behind it */
  both: boolean;
  style: GrilleStyle;
  mount: GrilleMount;
  size: GrilleSize;
  ductMm: number;
}

export const DEFAULT_AIR: AirState = {
  kind: "grille",
  stream: "supply",
  both: false,
  style: "square",
  mount: "ceiling",
  size: { wMm: 300, hMm: 300 },
  ductMm: 250,
};

const KINDS: [AirKind, string, string][] = [
  ["grille", "Grille", "grille"],
  ["flex", "Flex", "flex"],
  ["duct", "Duct", "duct"],
  ["arrow", "Arrow", "arrowR"],
  ["sensor", "Sensor", "sensor"],
  ["controller", "Controller", "controller"],
];
const STYLE_WORDS: Record<GrilleStyle, string> = { square: "Square", round: "Round", linear: "Linear" };
const MOUNT_WORDS: Record<GrilleMount, string> = { ceiling: "Ceiling", wall: "Wall", floor: "Floor", kicker: "Kicker" };
export const DUCT_SIZES = [150, 200, 250, 300, 350, 400];

/** one choice under its name; `many` lays a long tray out in rows of three */
function AirField({ label, many, children }: { label: string; many?: boolean; children: React.ReactNode }) {
  return (
    <div className={`ds-air-field${many ? " ds-air-many" : ""}`}>
      <span className="ds-air-label">{label}</span>
      {children}
    </div>
  );
}

export function AirScreen({
  air,
  onAir,
  picked,
  supplyMm,
  onSupplyMm,
  back,
  onBack,
}: {
  air: AirState;
  onAir: (next: AirState) => void;
  /** a grille picked on the plan: its own choices, under its own name, and no kinds */
  picked?: boolean;
  /** a picked combined grille: how much of its face is supply */
  supplyMm?: number | null;
  onSupplyMm?: (mm: number) => void;
  /** the name of the screen behind */
  back: string;
  onBack: () => void;
}) {
  const set = (patch: Partial<AirState>) => onAir({ ...air, ...patch });
  const isGrille = air.kind === "grille";
  const grilleStyle = air.stream === "supply" ? air.style : null;
  const sizes = sizesFor(air.stream, grilleStyle);
  /* a duct is whatever it touches (duct-draw.ts): only what goes on a duct's end says */
  const isDuct = air.kind === "duct" || air.kind === "flex";
  const streams = air.kind !== "sensor" && air.kind !== "controller" && !isDuct;
  const stream = air.both ? "both" : air.stream;
  const kindWord = KINDS.find(([k]) => k === air.kind)?.[1] ?? "";
  const name = picked ? "Grille" : "Air";
  return (
    <StackScreen label={name}>
      <StackHead back={back} onBack={onBack} name={name} />
      {!picked && (
        <StackGroup>
          <div className="ds-air-kinds" role="radiogroup" aria-label="What goes down">
            {KINDS.map(([k, word, icon]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={air.kind === k}
                className="ds-air-kind"
                onClick={() => air.kind !== k && set({ kind: k })}
              >
                <Icon name={icon} size={16} />
                {word}
              </button>
            ))}
          </div>
        </StackGroup>
      )}
      {(streams || isGrille || isDuct) && (
        <>
          {!picked && <StackSection>{kindWord}</StackSection>}
          <StackGroup>
            {streams && (
              <AirField label="Supply or return">
                <Tray
                  ariaLabel="Supply or return"
                  options={[
                    { value: "supply", label: "Supply" },
                    { value: "return", label: "Return" },
                    ...(isGrille ? [{ value: "both", label: "Both" }] : []),
                  ]}
                  value={stream}
                  onChange={(v) => {
                    if (v === stream) return;
                    if (v === "supply") set({ stream: "supply", both: false, size: sizesFor("supply", air.style)[0] });
                    else if (v === "return") set({ stream: "return", both: false, size: GRILLE_SIZES.return[0] });
                    else set({ stream: "supply", both: true, style: "linear", size: air.style === "linear" ? air.size : STYLE_SIZES.linear[0] });
                  }}
                />
              </AirField>
            )}
            {isGrille && air.stream === "supply" && !air.both && (
              <AirField label="Shape">
                <Tray
                  ariaLabel="Shape"
                  options={GRILLE_STYLES.map((st) => ({ value: st, label: STYLE_WORDS[st] }))}
                  value={air.style}
                  onChange={(st) => st !== air.style && set({ style: st, size: sizesFor("supply", st)[0] })}
                />
              </AirField>
            )}
            {isGrille && (
              <AirField label="Sits in">
                <Tray
                  ariaLabel="Sits in"
                  options={GRILLE_MOUNTS.map((m) => ({ value: m, label: MOUNT_WORDS[m] }))}
                  value={air.mount}
                  onChange={(m) => set({ mount: m })}
                />
              </AirField>
            )}
            {isGrille && grilleStyle === "round" && (
              <AirField label="Size" many>
                <Tray
                  ariaLabel="Size"
                  options={sizes.map((sz) => ({ value: String(sz.wMm), label: `Ø${sz.wMm}` }))}
                  value={String(air.size.wMm)}
                  onChange={(v) => {
                    const sz = sizes.find((x) => String(x.wMm) === v);
                    if (sz) set({ size: sz });
                  }}
                />
              </AirField>
            )}
            {isGrille && grilleStyle !== "round" && (
              <AirField label="Size">
                {/* keyed by the size, so a drag on the plan puts the fields
                    back to what the grille now is */}
                <span className="ds-hud-size" key={sizeText(air.size)}>
                  <MmField label="Width, mm" value={air.size.wMm} onCommit={(wMm) => set({ size: { ...air.size, wMm } })} />
                  <span aria-hidden="true">×</span>
                  <MmField label="Height, mm" value={air.size.hMm} onCommit={(hMm) => set({ size: { ...air.size, hMm } })} />
                  <span className="ds-hud-unit">mm</span>
                </span>
              </AirField>
            )}
            {supplyMm != null && onSupplyMm && (
              <AirField label="Supply side">
                <span className="ds-hud-size" key={`s${supplyMm}`}>
                  <MmField label="Supply side, mm" value={supplyMm} onCommit={onSupplyMm} />
                  <span className="ds-hud-unit">mm, return {air.size.wMm - supplyMm}</span>
                </span>
              </AirField>
            )}
            {isDuct && (
              <AirField label="Size" many>
                <Tray
                  ariaLabel="Size"
                  options={DUCT_SIZES.map((mm) => ({ value: String(mm), label: `Ø${mm}` }))}
                  value={String(air.ductMm)}
                  onChange={(v) => set({ ductMm: Number(v) })}
                />
              </AirField>
            )}
          </StackGroup>
        </>
      )}
    </StackScreen>
  );
}

/** Where a picked indoor unit sits; under the floor, the space there against
    what it needs (the next flow). */
export function UnitWhereBar({
  where,
  onWhere,
  needMm,
  spaceMm,
  onSpace,
}: {
  where: UnitWhere;
  onWhere: (w: UnitWhere) => void;
  /** what it needs, hangers and all, when the pack knows its height */
  needMm: number | null;
  spaceMm: number | null;
  onSpace: (mm: number) => void;
}) {
  return (
    <OptionsHud label="Where">
      <div className="ds-hud-seg">
        {UNIT_WHERE.map(([w, word]) => (
          <button key={w} type="button" className={`ds-hud-chip${where === w ? " on" : ""}`} aria-pressed={where === w} onClick={() => onWhere(w)}>
            {word}
          </button>
        ))}
      </div>
      {where === "under-floor" && (
        <span className="ds-hud-size" key={spaceMm ?? "none"}>
          <MmField label="Space there, mm" value={spaceMm ?? 0} onCommit={onSpace} />
          <span className="ds-hud-unit">mm</span>
          {needMm != null && spaceMm != null && spaceMm > 0 && (
            <span className={spaceMm >= needMm ? "ds-hud-good" : "ds-hud-short"}>{spaceMm >= needMm ? "Fits" : `Needs ${needMm} mm`}</span>
          )}
        </span>
      )}
    </OptionsHud>
  );
}
