/* The placement drawing — an ELEVATION: a section through the side yard, seen
   front on. Elevation rather than plan because the mounting-height rule is the
   one that can't be drawn from above; here all three measured rules read at
   once — 450 mm back to the fence, 1 m across to the neighbour's bedroom, and
   1.8 m up from the ground to the top of the unit.

   Built in the Design Studio's drawing language so it reads as the same
   product: amber building fabric, the neighbour's place ghosted-and-dashed
   ("not mine"), slate chrome, hatched ground, white text halos, hairline
   strokes via vector-effect.

   The outdoor unit is the studio's own ODU glyph — rect + condenser fan + hub +
   four blades. Geometry mirrors unitGlyph(role "odu") in studio/canvas.tsx; it
   is repeated rather than imported so the Toolbox bundle doesn't pull in the
   whole canvas module. If that glyph changes, change it here too.

   Deliberately no scale bar: this is a generic schematic, not a site drawing.

   Colour is class-driven — no colour attributes in the markup — so states come
   from the `--m` custom property in the .oup-dia CSS block. `marks` comes from
   marksFor() in lib; the three rules drawn here go green when met and red when
   missed. Colour is never the only channel: the list states it in words.
   Arrowheads are inline paths, not <marker> defs, because a marker renders in
   its own context and won't inherit the group's state colour. */

import type { Mark } from "@/lib/toolbox/outdoor-unit";

/* condenser fan blades, on the 45° diagonals */
const BLADES = [0, 1, 2, 3].map((i) => (Math.PI / 2) * i + Math.PI / 4);

/* the section, in drawing units */
const GND = 228; // ground line
const FENCE = 300; // boundary
const WALL = 560; // face of the house
const U = { x: 440, y: 150, w: 120, h: 56 }; // the unit, hung off the wall
const WIN = { x: 70, y: 112, w: 90, h: 56 }; // their bedroom window

export function PlacementDiagram({
  marks = {},
}: {
  marks?: Partial<Record<Mark, "ok" | "bad">>;
}) {
  const mk = (m: Mark) => (marks[m] === "ok" ? " mk-ok" : marks[m] === "bad" ? " mk-bad" : "");

  const ucx = U.x + U.w / 2;
  const ucy = U.y + U.h / 2;
  const fr = Math.min(U.w, U.h) * 0.34;

  return (
    <svg
      className="oup-dia"
      viewBox="0 0 960 280"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-labelledby="oup-dia-t oup-dia-d"
    >
      <title id="oup-dia-t">Where the outdoor unit can sit</title>
      <desc id="oup-dia-d">
        Elevation through the side yard. The outdoor unit is fixed to the house
        wall at least 450 mm back from the boundary fence, at least a metre from
        the neighbour&apos;s bedroom window, and no more than 1.8 m above the
        ground at its highest point.
      </desc>

      <defs>
        <pattern id="oup-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <line className="hatch" x1="0" y1="0" x2="0" y2="8" />
        </pattern>
      </defs>

      {/* sky / paper */}
      <rect className="paper" x="0" y="0" width="960" height="280" rx="8" />

      {/* next door — ghosted and dashed: visible, clearly not this property */}
      <g className="ghost">
        <path className="bldg-g" d="M14 228 L14 76 L110 34 L206 76 L206 228 z" />
      </g>
      <rect className={"win" + mk("bedroom")} x={WIN.x} y={WIN.y} width={WIN.w} height={WIN.h} rx="2" />
      <text className="lb sm" x="14" y="26">
        Next door
      </text>
      <text className="lb sm" x={WIN.x + WIN.w / 2} y={WIN.y + WIN.h + 16} textAnchor="middle">
        bedroom window
      </text>

      {/* the house — amber fabric, simple eave */}
      <rect className="bldg" x={WALL} y="34" width="386" height={GND - 34} />
      <line className="eave" x1={WALL - 12} y1="34" x2="952" y2="34" />
      <text className="lb bldg-t" x={WALL + 200} y="120" textAnchor="middle">
        HOUSE
      </text>

      {/* the boundary fence */}
      <g className={"bdy" + mk("boundary")}>
        <line x1={FENCE} y1={GND} x2={FENCE} y2="132" />
        <line className="rail" x1={FENCE - 13} y1="140" x2={FENCE + 13} y2="140" />
      </g>
      <text className={"lb sm bdy-t" + mk("boundary")} x={FENCE + 10} y="126">
        boundary
      </text>

      {/* the outdoor unit, fixed to the wall */}
      <g className="unit">
        <rect x={U.x} y={U.y} width={U.w} height={U.h} rx="4" />
        <circle className="detail" cx={ucx} cy={ucy} r={fr} />
        <circle className="hub" cx={ucx} cy={ucy} r={fr * 0.16} />
        {BLADES.map((a, i) => (
          <line
            key={i}
            className="detail"
            x1={ucx + Math.cos(a) * fr * 0.3}
            y1={ucy + Math.sin(a) * fr * 0.3}
            x2={ucx + Math.cos(a) * fr * 0.9}
            y2={ucy + Math.sin(a) * fr * 0.9}
          />
        ))}
      </g>
      <text className="lb unit-t" x={ucx} y={U.y - 14} textAnchor="middle">
        OUTDOOR UNIT
      </text>

      {/* ground */}
      <rect className="soil" x="0" y={GND} width="960" height={280 - GND} />
      <rect x="0" y={GND} width="960" height={280 - GND} fill="url(#oup-hatch)" />
      <line className="gnd" x1="0" y1={GND} x2="960" y2={GND} />

      {/* 450 mm — fence back to the near face of the unit */}
      <g className={"dim" + mk("boundary")}>
        <line className="tick" x1={FENCE} y1="128" x2={FENCE} y2="86" />
        <line className="tick" x1={U.x} y1={U.y - 4} x2={U.x} y2="86" />
        <line x1={FENCE} y1="96" x2={U.x} y2="96" />
        <path className="head" d={`M${FENCE} 96 L${FENCE + 9} 92.5 L${FENCE + 9} 99.5 z`} />
        <path className="head" d={`M${U.x} 96 L${U.x - 9} 92.5 L${U.x - 9} 99.5 z`} />
        <text className="lb dim-t" x={(FENCE + U.x) / 2} y="86" textAnchor="middle">
          450 mm min
        </text>
      </g>

      {/* 1.8 m — ground up to the top of the unit */}
      <g className={"dim" + mk("height")}>
        <line className="tick" x1={U.x + U.w} y1={U.y} x2="660" y2={U.y} />
        <line x1="640" y1={U.y} x2="640" y2={GND} />
        <path className="head" d={`M640 ${U.y} L636.5 ${U.y + 9} L643.5 ${U.y + 9} z`} />
        <path className={"head"} d={`M640 ${GND} L636.5 ${GND - 9} L643.5 ${GND - 9} z`} />
        <text className="lb dim-t" x="652" y={(U.y + GND) / 2 - 2}>
          1.8 m max
        </text>
        <text className="lb sm" x="652" y={(U.y + GND) / 2 + 14}>
          above ground
        </text>
      </g>

      {/* 1 m — their window across to the unit, run low so it clears both */}
      <g className={"dim" + mk("bedroom")}>
        <line className="tick" x1={WIN.x + WIN.w} y1={WIN.y + WIN.h} x2={WIN.x + WIN.w} y2="222" />
        <line className="tick" x1={U.x} y1={U.y + U.h} x2={U.x} y2="222" />
        <line x1={WIN.x + WIN.w} y1="216" x2={U.x} y2="216" />
        <path className="head" d={`M${WIN.x + WIN.w} 216 L${WIN.x + WIN.w + 9} 212.5 L${WIN.x + WIN.w + 9} 219.5 z`} />
        <path className="head" d={`M${U.x} 216 L${U.x - 9} 212.5 L${U.x - 9} 219.5 z`} />
        <text className="lb dim-t" x={(WIN.x + WIN.w + U.x) / 2} y="208" textAnchor="middle">
          1 m min to their bedroom
        </text>
      </g>
    </svg>
  );
}
