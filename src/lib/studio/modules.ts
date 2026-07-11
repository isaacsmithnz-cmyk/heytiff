/* Design Studio — system-module registry (flow rework).
   The chosen system TYPE is the module: it decides the panel layout, the
   post-rooms prompts, how units/grilles are placed, and what the summary shows
   (feedback-design-flow-spec; design-studio-plan Layer 3 "module contract").
   Pure config + declarations — no React. Split is the first live module; the
   rest are registered so the type chooser can offer them and they slot in at
   their stages without touching the framework. */

import type { SystemType } from "./document";

/** How a type gathers indoor units once rooms are configured. */
export type UnitFlow =
  | "pair" // split 1:1 — one IDU + one ODU, placed separately
  | "per-room" // multi / vrf — an IDU per room, one (suggested) ODU
  | "ducted"; // one air handler + grilles per room

/** What the live summary section emphasises for this type. */
export type SummaryKind =
  | "split" // pair · run length · badge
  | "capacity" // ODU + connected capacity gauge (green/amber/red) + IDU count
  | "ducted"; // system size · zones · outlets · grilles

export interface SystemModule {
  type: SystemType;
  label: string;
  blurb: string;
  /** false = registered but not built yet → chooser offers it disabled */
  available: boolean;
  /** shown on the "coming" panel + disabled chooser card */
  comingStage?: string;
  /** single room (split) vs many rooms sharing one outdoor (multi/vrf/ducted) */
  roomScope: "single" | "multi";
  unitFlow: UnitFlow;
  summary: SummaryKind;
}

export const SYSTEM_MODULES: Record<SystemType, SystemModule> = {
  split: {
    type: "split",
    label: "Split (1:1)",
    blurb: "One indoor unit to one outdoor unit — the simplest system.",
    available: true,
    roomScope: "single",
    unitFlow: "pair",
    summary: "split",
  },
  "multi-split": {
    type: "multi-split",
    label: "Multi-split",
    blurb: "Several rooms sharing one outdoor — an indoor unit per room.",
    available: false,
    comingStage: "Stage 5",
    roomScope: "multi",
    unitFlow: "per-room",
    summary: "capacity",
  },
  ducted: {
    type: "ducted",
    label: "Ducted",
    blurb: "One concealed air handler with ductwork and grilles to each room.",
    available: false,
    comingStage: "Stage 7",
    roomScope: "multi",
    unitFlow: "ducted",
    summary: "ducted",
  },
  vrf: {
    type: "vrf",
    label: "VRF / VRV",
    blurb: "Many indoor units on one refrigerant network with pipe sizing.",
    available: false,
    comingStage: "Stage 8",
    roomScope: "multi",
    unitFlow: "per-room",
    summary: "capacity",
  },
  ventilation: {
    type: "ventilation",
    label: "Ventilation",
    blurb: "Exhaust / supply / heat-recovery airflow instead of heating & cooling.",
    available: false,
    comingStage: "Stage 9",
    roomScope: "multi",
    unitFlow: "per-room",
    summary: "capacity",
  },
  "sheet-metal": {
    type: "sheet-metal",
    label: "Sheet metal ductwork",
    blurb: "Rectangular duct sizing from airflow, velocity and distance.",
    available: false,
    comingStage: "Stage 11",
    roomScope: "multi",
    unitFlow: "ducted",
    summary: "ducted",
  },
};

/** Registry order for the chooser — available types first, then by stage. */
export const MODULE_ORDER: SystemType[] = [
  "split",
  "multi-split",
  "ducted",
  "vrf",
  "ventilation",
  "sheet-metal",
];

export function moduleFor(type: SystemType): SystemModule {
  return SYSTEM_MODULES[type];
}

export const availableModules = (): SystemModule[] =>
  MODULE_ORDER.map((t) => SYSTEM_MODULES[t]).filter((m) => m.available);
