/* Design Studio — a VRF's pipe sizes where the fitter looks for them: on each
   drawn run, at each joint and box, and on the schematic (Isaac, 2026-09-29:
   "I need to see what size the pipes are to ensure that it's being allocated
   correctly"). One line stands for the liquid and gas pair; the pair's
   colour is its size, so a change of size shows at a glance.

   Pure: the sized tree (vrf-tree.ts) already knows each section's sizes and,
   since this file, which drawn runs make it up. */

import type { DesignDocument, DesignSystem } from "./document";
import type { DataPack } from "./packs/schema";
import { systemVrfTree, type SizedFitting, type SizedSection } from "./vrf-tree";

export type PipeUnits = "in" | "mm";

/* copper is sold in inches here: the metric figure is the tube's outside
   diameter written in mm, so each maps to one fraction */
const INCHES: [number, string][] = [
  [6.35, "1/4"],
  [9.52, "3/8"],
  [12.7, "1/2"],
  [15.88, "5/8"],
  [19.05, "3/4"],
  [22.2, "7/8"],
  [25.4, "1"],
  [28.58, "1 1/8"],
  [31.75, "1 1/4"],
  [34.92, "1 3/8"],
  [38.1, "1 1/2"],
  [41.28, "1 5/8"],
];

/** the copper sizes a size can be set to by hand, smallest first (mm) */
export const TUBE_SIZES_MM: number[] = INCHES.map(([mm]) => mm);

/** one tube: 3/8" or 9.52 */
export function tubeSize(mm: number, units: PipeUnits): string {
  if (units === "mm") return String(mm);
  const hit = INCHES.find(([m]) => Math.abs(m - mm) < 0.05);
  return hit ? `${hit[1]}"` : `${mm} mm`;
}

/** the pair, liquid then gas: 1/4" / 1/2", or 6.35 / 12.7 mm */
export function pairSize(liquidMm: number, gasMm: number, units: PipeUnits): string {
  return units === "mm"
    ? `${liquidMm} / ${gasMm} mm`
    : `${tubeSize(liquidMm, units)} / ${tubeSize(gasMm, units)}`;
}

/** the size's colour step, 1 (smallest) to 8, from the gas tube: the drawing
    wears `--pipe-<n>` (tokens.css). Past the eighth size they share the last. */
export function sizeTone(gasMm: number): number {
  const i = INCHES.findIndex(([m]) => Math.abs(m - gasMm) < 0.05);
  const step = i < 0 ? INCHES.filter(([m]) => m < gasMm).length : i;
  // gas starts at 3/8": the step counts from there
  return Math.max(1, Math.min(8, step));
}

export interface FittingView {
  fitting: SizedFitting;
  /** the section that feeds it */
  feed: SizedSection | null;
  /** the sections it feeds */
  outs: SizedSection[];
}

export interface VrfPipeView {
  systemId: string;
  /** a drawn run's id → the sized section it is part of */
  byRun: Map<string, SizedSection>;
  /** a joint's or box's object id → what goes in and out of it */
  fittings: Map<string, FittingView>;
  sections: SizedSection[];
}

/** every VRF system whose pipework is drawn to every head, sized: what the
    plan labels and colours. A system still being drawn has no sizes yet. */
export function vrfPipeViews(doc: DesignDocument, pack: DataPack | null): VrfPipeView[] {
  if (!pack) return [];
  const out: VrfPipeView[] = [];
  for (const sys of doc.systems) {
    const view = pipeViewOf(doc, pack, sys);
    if (view) out.push(view);
  }
  return out;
}

export function pipeViewOf(doc: DesignDocument, pack: DataPack, sys: DesignSystem): VrfPipeView | null {
  const tree = systemVrfTree(pack, sys, doc);
  if (!tree || tree.joined < tree.heads || tree.heads === 0) return null;
  const byRun = new Map<string, SizedSection>();
  for (const s of tree.sections) for (const e of s.edges) byRun.set(e, s);
  const fittings = new Map<string, FittingView>();
  for (const f of tree.fittings)
    fittings.set(f.nodeId, {
      fitting: f,
      feed: tree.sections.find((s) => s.to === f.nodeId) ?? null,
      outs: tree.sections.filter((s) => s.from === f.nodeId),
    });
  return { systemId: sys.id, byRun, fittings, sections: tree.sections };
}

/** a section's size set by hand on every run it is made of (props liquidMm /
    gasMm, the per-run override the sizer takes over the book's), or cleared
    back to the book's with null. Other objects are untouched. */
export function setRunSizes(
  doc: DesignDocument,
  runIds: string[],
  size: { liquidMm: number; gasMm: number } | null
): DesignDocument {
  const ids = new Set(runIds);
  return {
    ...doc,
    objects: doc.objects.map((o) => {
      if (!ids.has(o.id) || o.type !== "pipe-run") return o;
      const props = { ...o.props };
      if (size) {
        props.liquidMm = size.liquidMm;
        props.gasMm = size.gasMm;
      } else {
        delete props.liquidMm;
        delete props.gasMm;
      }
      return { ...o, props };
    }),
  };
}
