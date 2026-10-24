import type { BodyType } from "../logic";

/* THE VEHICLE'S SHAPE, while it has no photo: an outline in the line's own
   grey on the photo square's soft fill (Isaac's mock, 24 October 2026). The
   same five shapes as the placeholders in public/fleet/, drawn in
   currentColor so the sheet decides the colour and nothing here is a hex. */

const SHAPES: Record<BodyType, { paths: string[]; wheels: [number, number][] }> = {
  van: { paths: ["M3 17V7a1 1 0 0 1 1-1h11.5a1 1 0 0 1 .8.4L20 11h1a1 1 0 0 1 1 1v5", "M15 6v5h6", "M3 17h2M9 17h6M20 17h2"], wheels: [[7, 17], [18, 17]] },
  ute: { paths: ["M2 17v-5a1 1 0 0 1 1-1h1l2.5-4.4A1 1 0 0 1 7.4 6H12a1 1 0 0 1 1 1v4h8a1 1 0 0 1 1 1v5", "M13 11H4", "M2 17h2M8 17h8M20 17h2"], wheels: [[6, 17], [18, 17]] },
  car: {
    paths: ["M2 16v-3.5a1.5 1.5 0 0 1 1.1-1.45L5 10.6l2.2-3.3A1.5 1.5 0 0 1 8.45 6.6h6.1a1.5 1.5 0 0 1 1.25.7L18 10.6l3 .9a1.5 1.5 0 0 1 1 1.4V16", "M5 10.6h13", "M2 16h2M8 16h8M20 16h2"],
    wheels: [[6, 16], [18, 16]],
  },
  truck: {
    paths: ["M2 16V6a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v10", "M15 8h3.5a1 1 0 0 1 .8.4L21.5 11a1 1 0 0 1 .2.6V16", "M15 12h6.7", "M2 16h2M8 16h1M13 16h4M21 16h1"],
    wheels: [[6, 16], [11, 16], [19, 16]],
  },
  trailer: { paths: ["M3 15V8a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v7", "M17 15h1.5", "M3 15h1.5M8.5 15h5.5", "M18.5 15H21a1 1 0 0 0 1-1v-1", "M4 10h12"], wheels: [[6, 15], [14, 15]] },
};

export function VehicleOutline({ type }: { type: BodyType }) {
  const shape = SHAPES[type];
  return (
    <svg className="vp-outline" viewBox="1 4 22 16" width={40} height={29} aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        {shape.paths.map((d) => (
          <path key={d} d={d} />
        ))}
        {shape.wheels.map(([cx, cy]) => (
          <circle key={cx} cx={cx} cy={cy} r={2} />
        ))}
      </g>
    </svg>
  );
}
