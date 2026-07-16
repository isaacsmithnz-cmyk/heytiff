/* Fixtures for the simple-plan renderer.

   `realTwelveFf` is the ACTUAL traced geometry from the live design
   "12 ff" (dsn_mrhaynrcxenvph, ground floor) — three rooms traced by hand
   against a calibrated raster. It carries the two properties the welder must
   prove it handles: Room 1's and Room 2's left edges are 63 mm out of
   alignment (must weld onto one line), while the 1.25 m gap between Room 1's
   bottom and Room 2's top is a real corridor (must NOT weld).

   `syntheticHouse` is a fuller Hollingshed-style floor: six rooms traced the
   way a designer would (shared walls coincident, one deliberate 40 mm sloppy
   trace), exercising shared-wall detection across a whole plan. */

import type { DesignDocument, DesignObject } from "../../document";
import { createDesign } from "../../document";

function doc(opts: {
  scaleMmPerUnit: number;
  rooms: {
    id: string;
    name: string;
    points: { x: number; y: number }[];
    externalWalls?: number[];
  }[];
}): { doc: DesignDocument; floorId: string } {
  const d = createDesign({ name: "fixture", mode: "blank", now: "2026-07-15T00:00:00.000Z" });
  const floorId = d.floors[0].id;
  d.floors[0].scaleMmPerUnit = opts.scaleMmPerUnit;
  d.objects = opts.rooms.map(
    (r): DesignObject => ({
      id: r.id,
      type: "room",
      systemId: null,
      floorId,
      geometry: { kind: "polygon", points: r.points },
      plane: "room",
      props: {
        name: r.name,
        ...(r.externalWalls
          ? { externalWalls: r.externalWalls, hasExternalWalls: r.externalWalls.length > 0 }
          : {}),
      },
    })
  );
  return { doc: d, floorId };
}

/** Real traced document: "12 ff" ground floor, scale 17.362 mm/unit. */
export function realTwelveFf(): { doc: DesignDocument; floorId: string } {
  return doc({
    scaleMmPerUnit: 17.361982617381965,
    rooms: [
      {
        id: "obj_mrkgc512e4mfyy",
        name: "Room 1",
        points: [
          { x: 642.4696100246538, y: 392.8578481164117 },
          { x: 865.4660369445927, y: 392.8578481164117 },
          { x: 865.4660369445927, y: 561.577851523104 },
          { x: 642.4696100246538, y: 561.577851523104 },
        ],
        externalWalls: [0, 3],
      },
      {
        id: "obj_mrkgcao7z8sgij",
        name: "Room 2",
        points: [
          { x: 638.8631801495866, y: 633.4157195527524 },
          { x: 871.2044829454194, y: 633.4157195527524 },
          { x: 871.2044829454194, y: 808.7878901570255 },
          { x: 638.8631801495866, y: 808.7878901570255 },
        ],
      },
      {
        id: "obj_mrkgcjbbuvxt3e",
        name: "Living / Dining",
        points: [
          { x: 1043.7939571777595, y: 396.10432721699993 },
          { x: 1463.9949536001707, y: 396.10432721699993 },
          { x: 1463.9949536001707, y: 630.3353715788468 },
          { x: 1043.7939571777595, y: 630.3353715788468 },
        ],
      },
    ],
  });
}

/** Six-room floor at 10 mm/unit (1 unit = 1 cm). Master suite left, beds
    right, hallway between — shared walls traced coincident except Bed 2's
    left edge, drawn 4 units (40 mm) off the hallway's right edge. */
export function syntheticHouse(): { doc: DesignDocument; floorId: string } {
  return doc({
    scaleMmPerUnit: 10,
    rooms: [
      {
        id: "master",
        name: "Master bed",
        points: [
          { x: 0, y: 0 },
          { x: 390, y: 0 },
          { x: 390, y: 300 },
          { x: 0, y: 300 },
        ],
        externalWalls: [0, 3],
      },
      {
        id: "wir",
        name: "WIR",
        points: [
          { x: 0, y: 300 },
          { x: 390, y: 300 },
          { x: 390, y: 610 },
          { x: 0, y: 610 },
        ],
        externalWalls: [2, 3],
      },
      {
        id: "hall",
        name: "Hall",
        points: [
          { x: 390, y: 0 },
          { x: 500, y: 0 },
          { x: 500, y: 610 },
          { x: 390, y: 610 },
        ],
        externalWalls: [0],
      },
      {
        id: "bed2",
        name: "Bed 2",
        // left edge deliberately 4 units (40 mm) off the hall's right edge
        points: [
          { x: 504, y: 0 },
          { x: 870, y: 0 },
          { x: 870, y: 290 },
          { x: 504, y: 290 },
        ],
        externalWalls: [0, 1],
      },
      {
        id: "bed3",
        name: "Bed 3",
        points: [
          { x: 500, y: 290 },
          { x: 870, y: 290 },
          { x: 870, y: 610 },
          { x: 500, y: 610 },
        ],
        externalWalls: [1, 2],
      },
      {
        id: "bath",
        name: "Bathroom",
        points: [
          { x: 200, y: 610 },
          { x: 500, y: 610 },
          { x: 500, y: 800 },
          { x: 200, y: 800 },
        ],
        externalWalls: [1, 2, 3],
      },
    ],
  });
}
