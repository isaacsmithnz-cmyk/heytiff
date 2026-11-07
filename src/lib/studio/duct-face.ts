/* A DUCT COMES OFF THE UNIT'S FACE (the next flow). A duct drawn from a unit
   used to start at its middle, through the casing. It starts on the face its
   stream leaves by, in line with where it is going, and stays on that spot of
   the casing as the unit moves and turns: the spot is kept on the run's attach
   as an offset in the unit's own frame (attach.ts turns it with the unit). */

import type { Point } from "./document";

export interface DuctFaceIn {
  at: Point;
  /** degrees */
  rotation: number;
  /** the unit's footprint, world units */
  w: number;
  h: number;
  /** the unit's airFlip: its supply and return faces swapped */
  flip: boolean;
  stream: "supply" | "return";
  /** the duct's next point: the spot along the face lines up with it */
  toward: Point;
  /** the duct's width, world units: it stays on the casing */
  dia: number;
}

/** where on the face the duct starts, and that spot in the unit's own frame */
export function ductFaceSpot(a: DuctFaceIn): { point: Point; off: Point } {
  const rad = (a.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = a.toward.x - a.at.x;
  const dy = a.toward.y - a.at.y;
  const reach = Math.max(0, a.w / 2 - a.dia / 2);
  const along = Math.max(-reach, Math.min(reach, dx * c + dy * s));
  const side = (a.stream === "supply" ? 1 : -1) * (a.flip ? -1 : 1);
  const off = { x: along, y: (side * a.h) / 2 };
  return { point: offsetPoint(a.at, a.rotation, off), off };
}

/** a spot kept in a unit's own frame, on the plan */
export function offsetPoint(at: Point, rotation: number, off: Point): Point {
  const rad = (rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: at.x + off.x * c - off.y * s, y: at.y + off.x * s + off.y * c };
}
