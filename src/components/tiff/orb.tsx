/* The orb: what Tiff shows while it is still working.

   WHY A SPHERE AND NOT THREE DOTS. Three bouncing dots are a borrowed idiom —
   they mean "someone is typing", and nobody is typing. What is actually
   happening is a search across five shelves and a model reading what came
   back, and the old indicator had no way to say either. This one has two
   moving parts and both of them carry a fact: the orb says work is still in
   flight, and the word beside it says which kind.

   THE GEOMETRY IS THE BROWSER'S, NOT OURS. Every dot is placed on the surface
   by one 3D transform — `rotateY(λ) rotateX(-φ) translateZ(R)` puts a point at
   longitude λ, latitude φ on a sphere of radius R — and the whole shell then
   spins under a `perspective`. So the foreshortening at the limb, the
   shrinking of the far side and the crowding toward the poles all fall out of
   the projection instead of being animated by hand. Nothing here holds a
   clock or a frame loop; the single rotation is a CSS animation on one
   element, and the fifty dots are along for the ride on the same compositor
   layer.

   `backface-visibility` IS THE HIDDEN-SURFACE PASS. A dot on the far side is
   a disc pointing away from the camera, and the stylesheet drops it — which
   is the cheap version of the depth sort a renderer would do, and at 30px the
   only one worth having: drawing both hemispheres at this size stops reading
   as a sphere and starts reading as a smudge. A dot crossing the silhouette
   is edge-on and infinitely thin at the moment it goes, so nothing pops.

   IT SAYS NOTHING TO A SCREEN READER, twice over: the orb is decoration, and
   the word beside it is already the label on the live region. */

import type { CSSProperties } from "react";

/** Rings of latitude, from the south pole up. The poles themselves are left
    bare — a dot there is on the spin axis and would sit dead still while
    everything around it moved, which is the one thing that reads as a bug. */
const LATITUDES = [-60, -30, 0, 30, 60] as const;

/** Dots per ring, thinned toward the poles. A constant count would bunch them
    up where the rings are short and leave the equator sparse; these are
    picked so the spacing along each ring stays roughly even. */
const DENSITY: Record<number, number> = { 60: 8, 30: 12, 0: 14 };

type Dot = { readonly lat: number; readonly lon: number };

/** Every dot on the shell, as (latitude, longitude) pairs in degrees. Computed
    once at module load: the sphere is the same sphere every time. */
export const DOTS: readonly Dot[] = LATITUDES.flatMap((lat) => {
  const n = DENSITY[Math.abs(lat)];
  return Array.from({ length: n }, (_, i) => ({ lat, lon: (360 / n) * i }));
});

export type OrbProps = {
  /** Diameter in pixels. Below about 24 the dots merge into a disc. */
  size?: number;
};

/* THE SIZE IS A CUSTOM PROPERTY, NOT A STYLE ON EVERY DOT. The radius each
   dot is pushed out by is half the diameter, and it is read from `--tk-orb`
   by the one transform in the stylesheet — so a caller changing the size
   moves fifty dots by writing one number, and the CSS keeps the arithmetic. */
export function TiffOrb({ size = 30 }: OrbProps) {
  return (
    <span className="tk-orb" style={{ "--tk-orb": `${size}px` } as CSSProperties} aria-hidden="true">
      <span className="tk-orb-shell">
        {DOTS.map((d, i) => (
          <i key={i} style={{ "--lat": `${d.lat}deg`, "--lon": `${d.lon}deg` } as CSSProperties} />
        ))}
      </span>
    </span>
  );
}

export type WorkingProps = {
  /** What the wait is called — a phase from the research machine, never a
      countdown and never a guess. Rendered verbatim; the ellipsis is the
      stylesheet's, so the label stays a plain string a test can match. */
  note: string;
};

/* THE WORD IS THE LABEL, AND THE LABEL IS THE WORD. This used to be an
   `aria-label` on a decorative span — a string that existed only for screen
   readers, saying something no sighted reader could see. Now the same
   sentence is on the page, so `role="status"` announcing it is announcing
   what is actually there, and a phase change is one announcement rather than
   a new element to notice.

   THE SHIMMER RUNS ON THE TEXT, NOT UNDER IT. A sweep clipped to the glyphs
   reads as the word itself being lit; a bar sliding behind it reads as a
   skeleton, which is a different promise — a skeleton says "this box will
   become content", and this box is going to be replaced outright. */
export function TiffWorking({ note }: WorkingProps) {
  return (
    <span className="tk-work" role="status">
      <TiffOrb />
      <b>{note}</b>
    </span>
  );
}
