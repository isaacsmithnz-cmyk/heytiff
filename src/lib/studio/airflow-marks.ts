/* Design Studio — airflow marks: short wavy arrows put on the plan to show
   which way the air moves (Isaac, 2026-10-28: "airflow arrows for supply and
   return air that you can place on the plan", then "just short arrows. Maybe
   like two or three arrows. That are slightly squiggly", and "Blue for
   supply, red for return").

   A mark is part of the drawing, not the design: it sits on its floor like
   a note (systemId null), whichever system is picked, and prints on the
   plan sheet. Supply is three blue arrows, return two red, so the two still
   tell apart printed in black and white. The shape is pure geometry here,
   called by the canvas and the sheet's plan figure alike, so screen and
   paper can never drift. */

import type { DesignObject, Point } from "./document";
import { newId } from "./document";

export const AIRFLOW_TYPE = "airflow-mark";

export type AirStream = "supply" | "return";

/** the inks: the drawing's own, as the notes' are */
export const AIRFLOW_INKS: Record<AirStream, string> = { supply: "#2563EB", return: "#EF4444" };

/** how many arrows a mark has */
export const AIRFLOW_COUNT: Record<AirStream, number> = { supply: 3, return: 2 };

/** an arrow's length, the gap between arrows and the wave's height, mm */
const ARROW_MM = 750;
const GAP_MM = 220;
const WAVE_MM = 70;
/** how many half-waves an arrow wiggles */
const HALF_WAVES = 3;
/** the head's length and half-width, mm */
const HEAD_MM = 150;
const HEAD_HALF_MM = 80;

export type AirflowMark = DesignObject & {
  type: typeof AIRFLOW_TYPE;
  geometry: { kind: "point"; at: Point; rotation?: number };
  props: { stream: AirStream };
};

export function isAirflowMark(o: DesignObject): o is AirflowMark {
  return o.type === AIRFLOW_TYPE && o.geometry.kind === "point";
}

/** a new mark on a floor: centred where it was pressed, pointing `deg`
    (0 = along +x, clockwise on screen) */
export function airflowMark(floorId: string, at: Point, deg: number, stream: AirStream): AirflowMark {
  return {
    id: newId("obj"),
    type: AIRFLOW_TYPE,
    systemId: null,
    floorId,
    plane: "room",
    geometry: { kind: "point", at, rotation: deg },
    props: { stream },
  } as AirflowMark;
}

export const streamOf = (o: AirflowMark): AirStream => (o.props.stream === "return" ? "return" : "supply");

/** the way a press-and-pull points, degrees; a press that hardly moved
    points along +x */
export function pullDeg(a: Point, b: Point, minUnits: number): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < minUnits) return 0;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** a mark's arrows, in world units: each a wavy line and its filled head */
export function markShapes(
  at: Point,
  deg: number,
  stream: AirStream,
  mmPerUnit: number
): { line: string; head: string }[] {
  const u = (mm: number) => mm / mmPerUnit;
  const rad = (deg * Math.PI) / 180;
  const ax = { x: Math.cos(rad), y: Math.sin(rad) };
  const n = { x: -ax.y, y: ax.x };
  const count = AIRFLOW_COUNT[stream];
  const L = u(ARROW_MM);
  const body = L - u(HEAD_MM) * 0.6;
  const p = (along: number, off: number): Point => ({
    x: at.x + ax.x * along + n.x * off,
    y: at.y + ax.y * along + n.y * off,
  });
  const f = (v: number) => Math.round(v * 100) / 100;
  const out: { line: string; head: string }[] = [];
  for (let k = 0; k < count; k++) {
    const lane = (k - (count - 1) / 2) * u(GAP_MM);
    const pts: string[] = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      /* the wave dies away towards the head, so the head sits square */
      const off = lane + u(WAVE_MM) * Math.sin(t * Math.PI * HALF_WAVES) * (1 - t);
      const q = p(-L / 2 + t * body, off);
      pts.push(`${f(q.x)} ${f(q.y)}`);
    }
    const tip = p(L / 2, lane);
    const base = p(L / 2 - u(HEAD_MM), lane);
    const h = u(HEAD_HALF_MM);
    const head = `M${f(tip.x)} ${f(tip.y)} L${f(base.x + n.x * h)} ${f(base.y + n.y * h)} L${f(base.x - n.x * h)} ${f(base.y - n.y * h)} Z`;
    out.push({ line: `M${pts.join(" L")}`, head });
  }
  return out;
}

/** is a point on a mark? within its footprint plus `tol` world units */
export function hitMark(o: AirflowMark, w: Point, mmPerUnit: number, tol: number): boolean {
  const deg = o.geometry.rotation ?? 0;
  const rad = (deg * Math.PI) / 180;
  const v = { x: w.x - o.geometry.at.x, y: w.y - o.geometry.at.y };
  const along = v.x * Math.cos(rad) + v.y * Math.sin(rad);
  const across = -v.x * Math.sin(rad) + v.y * Math.cos(rad);
  const halfL = ARROW_MM / 2 / mmPerUnit;
  const halfW = (((AIRFLOW_COUNT[streamOf(o)] - 1) / 2) * GAP_MM + WAVE_MM + HEAD_HALF_MM) / mmPerUnit;
  return Math.abs(along) <= halfL + tol && Math.abs(across) <= halfW + tol;
}
