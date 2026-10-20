import type { KmChart } from "@/lib/fleet/vehicle-page";

/* THE KILOMETRES LINE (the board v2-board-vehicle-km): the readings of the
   last twelve months as one line in ink, a dot on each reading, the scale
   in the quiet grey, and the next service as a dashed line where it falls
   inside the scale. No fill, no gradient, no colour: a line on paper
   (docs/design.md, flat; rule 20, a mark with its figure beside it). The
   geometry is lib/fleet/vehicle-page's `kmChart`; this only draws it.
   text-anchor is written as the attribute and never in the sheet, which
   would beat it. */

export function KmLine({ chart, label }: { chart: KmChart; label: string }) {
  const left = chart.yTicks.length ? 48 : 0;
  const right = chart.width - 16;
  return (
    <svg className="vp-km" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={label}>
      {chart.yTicks.map((t) => (
        <g key={t.label}>
          <line className="vp-km-grid" x1={left} x2={right} y1={t.y} y2={t.y} />
          <text className="vp-km-tick" x={left - 8} y={t.y + 4} textAnchor="end">
            {t.label}
          </text>
        </g>
      ))}
      {chart.xTicks.map((t) => (
        <text key={`${t.label}-${t.x}`} className="vp-km-tick" x={t.x} y={chart.height - 4} textAnchor="middle">
          {t.label}
        </text>
      ))}
      {chart.due && (
        <g>
          <line className="vp-km-due" x1={left} x2={right} y1={chart.due.y} y2={chart.due.y} />
          <text className="vp-km-tick" x={left + 8} y={chart.due.y - 6} textAnchor="start">
            {chart.due.label}
          </text>
        </g>
      )}
      <path className="vp-km-line" d={chart.path} />
      {chart.points.map((p) => (
        <circle key={p.id} className="vp-km-dot" cx={p.x} cy={p.y} r={3} />
      ))}
      {chart.last && (
        <text className="vp-km-last" x={chart.last.x - 8} y={chart.last.y - 10} textAnchor="end">
          {chart.last.label}
        </text>
      )}
    </svg>
  );
}
