/* Design Studio — grilles: a supply diffuser or a return grille the person
   puts on the plan from the component palette (Isaac, 28 October 2026: "Drop
   the unit, then add pipe duct drain cables, whatever you want to put on …
   Do not attach things to it"). Nothing makes one for them: a grille is on
   the plan because somebody placed it, at the size they picked.

   A grille belongs to the system it was placed for, so the sheet and Tiff
   count it with that system's air side. Its shape is pure geometry here,
   called by the canvas and the sheet alike. */

import type { DesignObject, Point } from "./document";
import { newId } from "./document";
import type { AirStream } from "./airflow-marks";

export const GRILLE_TYPE = "grille";

export interface GrilleSize {
  wMm: number;
  hMm: number;
}

/** the sizes the palette offers, face width × height, mm. Squares are
    ceiling diffusers; the long thin ones are linear and kicker grilles */
export const GRILLE_SIZES: Record<AirStream, GrilleSize[]> = {
  supply: [
    { wMm: 300, hMm: 300 },
    { wMm: 450, hMm: 450 },
    { wMm: 600, hMm: 100 },
    { wMm: 1200, hMm: 100 },
  ],
  return: [
    { wMm: 600, hMm: 400 },
    { wMm: 750, hMm: 400 },
    { wMm: 600, hMm: 100 },
    { wMm: 1200, hMm: 150 },
  ],
};

export const sizeText = (s: GrilleSize): string => `${s.wMm} × ${s.hMm}`;

export type Grille = DesignObject & {
  type: typeof GRILLE_TYPE;
  geometry: { kind: "point"; at: Point; rotation?: number };
  props: { stream: AirStream; wMm: number; hMm: number };
};

export function isGrille(o: DesignObject): o is Grille {
  return o.type === GRILLE_TYPE && o.geometry.kind === "point";
}

export const grilleStream = (o: Grille): AirStream => (o.props.stream === "return" ? "return" : "supply");

export function grilleSize(o: Grille): GrilleSize {
  const w = Number(o.props.wMm);
  const h = Number(o.props.hMm);
  return { wMm: w > 0 ? w : 300, hMm: h > 0 ? h : 300 };
}

/** a new grille, centred where it was clicked; `deg` turns it (90 stands a
    linear grille up the plan) */
export function grille(
  floorId: string,
  systemId: string | null,
  at: Point,
  stream: AirStream,
  size: GrilleSize,
  deg = 0
): Grille {
  return {
    id: newId("obj"),
    type: GRILLE_TYPE,
    systemId,
    floorId,
    plane: "room",
    geometry: { kind: "point", at, ...(deg ? { rotation: deg } : {}) },
    props: { stream, wMm: size.wMm, hMm: size.hMm },
  } as Grille;
}

/** what a grille is called on the sheet and to Tiff: a square supply is a
    diffuser, a long one a linear bar grille, any return a return air grille */
export function grilleName(stream: AirStream, s: GrilleSize): string {
  if (stream === "return") return `Return air grille ${sizeText(s)}`;
  return s.wMm === s.hMm ? `Square diffuser ${sizeText(s)}` : `Linear bar grille ${sizeText(s)}`;
}

/** the face's corners and the lines across it, world units. A square
    diffuser wears its two diagonals; a linear one its bars along it; a
    return its egg-crate lines across */
export function grilleShape(
  at: Point,
  deg: number,
  stream: AirStream,
  s: GrilleSize,
  mmPerUnit: number
): { outline: Point[]; lines: [Point, Point][] } {
  const hw = s.wMm / 2 / mmPerUnit;
  const hh = s.hMm / 2 / mmPerUnit;
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const n = Math.sin(rad);
  const p = (x: number, y: number): Point => ({ x: at.x + x * c - y * n, y: at.y + x * n + y * c });
  const outline = [p(-hw, -hh), p(hw, -hh), p(hw, hh), p(-hw, hh)];
  const lines: [Point, Point][] = [];
  if (stream === "supply" && s.wMm === s.hMm) {
    lines.push([outline[0], outline[2]], [outline[1], outline[3]]);
  } else if (stream === "supply") {
    for (const f of [-1 / 3, 1 / 3]) lines.push([p(-hw, hh * f * 2), p(hw, hh * f * 2)]);
  } else {
    const k = Math.max(2, Math.round(s.wMm / 150));
    for (let i = 1; i < k; i++) {
      const x = -hw + (2 * hw * i) / k;
      lines.push([p(x, -hh), p(x, hh)]);
    }
  }
  return { outline, lines };
}

/** is a point on a grille? within its face plus `tol` world units */
export function hitGrille(o: Grille, w: Point, mmPerUnit: number, tol: number): boolean {
  const s = grilleSize(o);
  const rad = ((o.geometry.rotation ?? 0) * Math.PI) / 180;
  const v = { x: w.x - o.geometry.at.x, y: w.y - o.geometry.at.y };
  const along = v.x * Math.cos(rad) + v.y * Math.sin(rad);
  const across = -v.x * Math.sin(rad) + v.y * Math.cos(rad);
  return Math.abs(along) <= s.wMm / 2 / mmPerUnit + tol && Math.abs(across) <= s.hMm / 2 / mmPerUnit + tol;
}
