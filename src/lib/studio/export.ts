/* Design Studio — export/print model. Pure functions, zero deps, no React —
   the option set the export customizer edits, and the derivation that turns
   (documents, pack, options) into everything the print document renders.
   Kept out of the components so jest can pin the content rules (what a
   schedule-only export includes, which floors make pages, ref dedupe). */

import type { DesignDocument, Floor } from "./document";
import type { DataPack } from "./packs/schema";
import {
  buildMaterials,
  rollupUnits,
  type MaterialsSchedule,
  type RollupRow,
} from "./materials";
import { designBasis, type DesignBasis } from "./summary";

/* structurally identical to the canvas's LayerFlags — declared here so lib
   code never imports a component module */
export interface ExportLayers {
  plan: boolean;
  units: boolean;
  pipes: boolean;
  labels: boolean;
}

export type ExportContent = "full" | "plans" | "schedule";
export type ExportPaper = "A4" | "A3";
export type ExportOrientation = "portrait" | "landscape";

export interface ExportOptions {
  /** what the document contains: everything, plan pages only, tables only */
  content: ExportContent;
  /** floors of the PRIMARY document to print (sibling variants always print
      all of theirs — their floor ids are their own) */
  floorIds: string[];
  /** document ids to include — the open design and any chosen siblings */
  variantIds: string[];
  layers: ExportLayers;
  grayscale: boolean;
  legend: boolean;
  paper: ExportPaper;
  orientation: ExportOrientation;
}

export function defaultExportOptions(doc: DesignDocument): ExportOptions {
  return {
    content: "full",
    floorIds: doc.floors.map((f) => f.id),
    variantIds: [doc.id],
    layers: { plan: true, units: true, pipes: true, labels: true },
    grayscale: false,
    legend: false,
    paper: "A4",
    orientation: "portrait",
  };
}

/* ── the print model — one entry per included variant document ── */
export interface PrintVariant {
  doc: DesignDocument;
  /** the variant's label ("Option 2"), null when not part of a set */
  label: string | null;
  schedule: MaterialsSchedule;
  rollup: RollupRow[];
  /** the floors that get plan pages, already filtered + ordered by level */
  floors: Floor[];
  basis: DesignBasis;
}

export interface PrintModel {
  options: ExportOptions;
  variants: PrintVariant[];
}

/** docs[0] is the open design (floor selection applies to it); the rest are
    loaded siblings in the order chosen. */
export function buildPrintModel(
  docs: DesignDocument[],
  pack: DataPack | null,
  options: ExportOptions
): PrintModel {
  const variants: PrintVariant[] = docs.map((doc, i) => {
    const schedule =
      options.content === "plans"
        ? { systems: [] }
        : buildMaterials(doc, pack);
    const floors =
      options.content === "schedule"
        ? []
        : doc.floors
            .filter((f) => (i === 0 ? options.floorIds.includes(f.id) : true))
            .sort((a, b) => a.level - b.level);
    return {
      doc,
      label: doc.meta.variantLabel,
      schedule,
      rollup: rollupUnits(schedule),
      floors,
      basis: designBasis(doc),
    };
  });
  return { options, variants };
}

/** every plan-sheet image the print document will draw, deduped — the caller
    resolves these to URLs (signed for print, data: for PNG) before mounting */
export function collectSheetRefs(model: PrintModel): string[] {
  const refs = new Set<string>();
  for (const v of model.variants)
    for (const f of v.floors)
      for (const s of f.plans) if (s.imageRef) refs.add(s.imageRef);
  return [...refs];
}
