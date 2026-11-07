/* A duct in its size's colour at its true width: walls, body and, on flex,
   ribs. The canvas and the sheet both draw it through here, so screen and paper
   can never drift. */

import type { Point } from "@/lib/studio/document";
import { fittingShape } from "@/lib/studio/duct-fitting";
import { ductPaint, ductWidth, FITTING_PAINT, ribDash, RISER_PAINT, type RiserMark } from "@/lib/studio/duct-size";
import type { DuctJunction } from "@/lib/studio/run-legs";

export function PaintedDuct({
  d,
  points,
  diaMm,
  mmPerUnit,
  pen,
}: {
  /** a flex duct's curve */
  d?: string;
  /** a rigid duct's dots */
  points?: string;
  diaMm: number;
  mmPerUnit: number;
  /** a screen pixel, in world units */
  pen: number;
}) {
  const paint = ductPaint(diaMm);
  const width = ductWidth(diaMm, mmPerUnit, pen);
  const core = Math.max(width - 2 * pen, pen);
  const dash = d ? ribDash(mmPerUnit, 1 / pen) : null;
  const line = (stroke: string, strokeWidth: number, className?: string, strokeDasharray?: string) =>
    d ? (
      <path d={d} fill="none" className={className} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={strokeDasharray} />
    ) : (
      <polyline points={points} fill="none" className={className} stroke={stroke} strokeWidth={strokeWidth} />
    );
  return (
    <>
      {line(paint.edge, width)}
      {line(paint.body, core, "ds-duct-body")}
      {dash && line(paint.rib, core, undefined, dash)}
    </>
  );
}

const dotted = (points: readonly Point[]) => points.map((p) => `${p.x},${p.y}`).join(" ");

/** where ducts meet: the shape they make, in grey metal */
export function PaintedFitting({ j, mmPerUnit, pen }: { j: DuctJunction; mmPerUnit: number; pen: number }) {
  const { hubRadius, legs } = fittingShape(j, (dia) => ductWidth(dia, mmPerUnit, pen));
  const { body, edge } = FITTING_PAINT;
  return (
    <g className="ds-duct-fitting">
      {legs.map((l, i) => (
        <polygon key={i} points={dotted(l.outline)} fill={edge} stroke={edge} strokeWidth={2 * pen} strokeLinejoin="miter" />
      ))}
      <circle cx={j.at.x} cy={j.at.y} r={hubRadius + pen} fill={edge} />
      {legs.map((l, i) => (
        <polygon key={i} points={dotted(l.outline)} fill={body} />
      ))}
      <circle cx={j.at.x} cy={j.at.y} r={hubRadius} fill={body} />
      {legs.map((l, i) => (
        <polyline key={i} points={dotted(l.mouth)} fill="none" stroke={edge} strokeWidth={1.8 * pen} />
      ))}
    </g>
  );
}

/** a duct's free end: a circle of its size and colour, for another duct to be dropped on */
export function FreeDuctEnd({ j, mmPerUnit, pen }: { j: DuctJunction; mmPerUnit: number; pen: number }) {
  const paint = ductPaint(j.diasMm[0]);
  return (
    <circle
      cx={j.at.x}
      cy={j.at.y}
      r={(ductWidth(j.diasMm[0], mmPerUnit, pen) - 1.5 * pen) / 2}
      fill={paint.body}
      stroke={paint.edge}
      strokeWidth={1.5 * pen}
    />
  );
}

/** a riser: red, and DR or PR on it. A pipe riser's circle is the smaller */
export function RiserDisc({
  at,
  mark,
  mmPerUnit,
  pen,
  selected,
}: {
  at: Point;
  mark: RiserMark;
  mmPerUnit: number;
  pen: number;
  selected?: boolean;
}) {
  const duct = mark.diaMm != null;
  const r = duct ? Math.max(11 * pen, ductWidth(mark.diaMm!, mmPerUnit, pen) / 2) : 8 * pen;
  const size = (duct ? 9 : 7) * pen;
  return (
    <g className={`ds-riser-mark${selected ? " sel" : ""}`}>
      <circle cx={at.x} cy={at.y} r={r} fill={RISER_PAINT.body} stroke={RISER_PAINT.word} strokeWidth={1.5 * pen} />
      <text x={at.x} y={at.y + 0.36 * size} fontSize={size} fill={RISER_PAINT.word} fontWeight={700} style={{ textAnchor: "middle" }}>
        {mark.word}
      </text>
    </g>
  );
}
