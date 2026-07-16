/* Fixtures for the AI plan-extraction pipeline.

   `hollingshedExtraction` is a canned RawExtraction shaped like the real
   Hollingshed St ground-floor sheet (2400×1697 raster, floor calibrated at
   17.362 mm/px): four spaces including an unlabeled hallway and a garage,
   a hinged door, a window, a cased opening, and bed/bath/wc fixtures. Round
   numbers so the derived geometry is hand-checkable. */

import type { DesignDocument, RawExtraction } from "../../document";
import { createDesign } from "../../document";

export const SCALE_MM_PER_PX = 17.362;

export function hollingshedExtraction(): RawExtraction {
  return {
    imageWidth: 2400,
    imageHeight: 1697,
    spaces: [
      {
        name: "Master Bed 1",
        kind: "room",
        polygon: [
          { x: 200, y: 200 },
          { x: 600, y: 200 },
          { x: 600, y: 500 },
          { x: 200, y: 500 },
        ],
      },
      {
        name: "",
        kind: "hallway",
        polygon: [
          { x: 600, y: 350 },
          { x: 1000, y: 350 },
          { x: 1000, y: 450 },
          { x: 600, y: 450 },
        ],
      },
      {
        name: "Bed 2",
        kind: "room",
        polygon: [
          { x: 1000, y: 200 },
          { x: 1400, y: 200 },
          { x: 1400, y: 500 },
          { x: 1000, y: 500 },
        ],
      },
      {
        name: "",
        kind: "garage",
        polygon: [
          { x: 200, y: 600 },
          { x: 700, y: 600 },
          { x: 700, y: 1000 },
          { x: 200, y: 1000 },
        ],
      },
    ],
    openings: [
      {
        // hinged door hallway → Bed 2, swing drawn
        kind: "door",
        center: { x: 1000, y: 400 },
        widthPx: 60,
        orientation: "v",
        hinge: { x: 1000, y: 372 },
        swingToward: { x: 1050, y: 420 },
      },
      {
        // window on Master's top wall — no leaf (sentinels == center)
        kind: "window",
        center: { x: 400, y: 200 },
        widthPx: 120,
        orientation: "h",
        hinge: { x: 400, y: 200 },
        swingToward: { x: 400, y: 200 },
      },
      {
        // cased opening Master → hallway
        kind: "cased-opening",
        center: { x: 600, y: 400 },
        widthPx: 70,
        orientation: "v",
        hinge: { x: 600, y: 400 },
        swingToward: { x: 600, y: 400 },
      },
    ],
    fixtures: [
      { kind: "bed", x: 250, y: 230, w: 140, h: 180, rotationDeg: 0 },
      { kind: "bath", x: 1050, y: 220, w: 120, h: 60, rotationDeg: 0 },
      { kind: "wc", x: 1340, y: 220, w: 40, h: 60, rotationDeg: 90 },
    ],
    notes: {
      hasNorthArrow: true,
      northDeg: 347,
      uncertainties: ["Site-plan surroundings were ignored"],
    },
  };
}

/** A v7 document whose ground floor carries the fixture extraction, with the
    sheet placed at (sheetX, sheetY) in the floor's world space. */
export function extractionDoc(sheetX = 0, sheetY = 0): {
  doc: DesignDocument;
  floorId: string;
} {
  const doc = createDesign({
    name: "fixture",
    mode: "blank",
    now: "2026-07-16T00:00:00.000Z",
  });
  const floor = doc.floors[0];
  floor.scaleMmPerUnit = SCALE_MM_PER_PX;
  floor.plans = [
    {
      id: "sht_1",
      imageRef: "org/o/plan_1.png",
      pageNumber: null,
      name: "Ground floor",
      width: 2400,
      height: 1697,
      x: sheetX,
      y: sheetY,
    },
  ];
  floor.simplePlan = {
    generatedAt: "2026-07-16T00:00:00.000Z",
    model: "claude-opus-4-8",
    sheets: [
      {
        sheetId: "sht_1",
        imageRef: "org/o/plan_1.png",
        extraction: hollingshedExtraction(),
      },
    ],
  };
  return { doc, floorId: floor.id };
}
