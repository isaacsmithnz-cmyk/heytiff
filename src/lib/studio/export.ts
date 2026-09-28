/* Design Studio — export/print model. Pure functions, zero deps, no React —
   the option set the export customizer edits, and the derivation that turns
   (documents, pack, options) into everything the print document renders.
   Kept out of the components so jest can pin the content rules (what a
   schedule-only export includes, which floors make pages, ref dedupe). */

import type { DesignDocument, Floor } from "./document";
import type { DataPack } from "./packs/schema";
import {
  buildSummaryModel,
  buildDesignSnapshot,
  designBasis,
  type DesignBasis,
  type DesignSnapshot,
  type SummaryModel,
} from "./summary";

/* structurally identical to the canvas's LayerFlags — declared here so lib
   code never imports a component module */
export interface ExportLayers {
  plan: boolean;
  units: boolean;
  pipes: boolean;
  labels: boolean;
}

/* WHICH PARTS OF THE SHEET GO IN. The Send dialog ticks these one by one, so a
   customer's copy can leave out the picklist and the pipe runs while the
   crew's keeps them. Plan pages are not a section: they are `floorIds`, and
   an empty list is a document with no plans. */
export interface SheetSections {
  /** the row of six: heat load, capacity, climate zone and the rest */
  figures: boolean;
  /** a block per system with its rooms table */
  systems: boolean;
  /** each system's pipe, electrical and components */
  lines: boolean;
  /** the whole job's material picklist */
  picklist: boolean;
}

export const ALL_SECTIONS: SheetSections = {
  figures: true,
  systems: true,
  lines: true,
  picklist: true,
};

/** whether any of the sheet itself goes in, or only plan pages */
export const hasSheet = (s: SheetSections): boolean =>
  s.figures || s.systems || s.lines || s.picklist;

export type ExportPaper = "A4" | "A3";
export type ExportOrientation = "portrait" | "landscape";

export interface ExportOptions {
  /** which parts of the sheet go in */
  sections: SheetSections;
  /** floors of the PRIMARY document to print. Empty means no plan pages at
      all; otherwise sibling variants print every floor of their own, since
      their floor ids are not this document's */
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
    sections: ALL_SECTIONS,
    floorIds: doc.floors.map((f) => f.id),
    variantIds: [doc.id],
    layers: { plan: true, units: true, pipes: true, labels: true },
    grayscale: false,
    legend: false,
    paper: "A4",
    orientation: "portrait",
  };
}

/* ── the print model — one entry per included variant document ──
      The variant carries the SAME merged sheet model the screen renders
      (coverage AND takeoff per system, plus the Material picklist), so the
      paper can never disagree with the screen — one derivation, two faces. */
export interface PrintVariant {
  doc: DesignDocument;
  /** the variant's label ("Option 2"), null when not part of a set */
  label: string | null;
  sheet: SummaryModel;
  snapshot: DesignSnapshot;
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
    const sheet = hasSheet(options.sections)
      ? buildSummaryModel(doc, pack)
      : { systems: [], unserved: [], picklist: [] };
    const floors =
      options.floorIds.length === 0
        ? []
        : doc.floors
            .filter((f) => (i === 0 ? options.floorIds.includes(f.id) : true))
            .sort((a, b) => a.level - b.level);
    return {
      doc,
      label: doc.meta.variantLabel,
      sheet,
      snapshot: buildDesignSnapshot(doc),
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
