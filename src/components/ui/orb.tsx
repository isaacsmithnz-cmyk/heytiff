import type { CSSProperties } from "react";

/* The orb: one sphere of dots, spun by the browser.

   IT IS TWO INSTRUMENTS, NOT ONE. The same shell serves every wait in the app
   (`Waiting`, below) and the microphone meter in dictation (`LevelOrb`,
   components/notes/dictation.tsx). Which one it is depends on a single
   inherited custom property: `--lvl`. Left unset it sits at full size and
   simply turns, which is a loader. Driven every frame from real audio it
   BREATHES, and the turning becomes the second, separate statement that the
   microphone is open at all.

   That pairing is the point. The meter it replaced was five bars that
   collapsed toward a flat line in a quiet room, and the whole difficulty with
   it — the one that reached prod, where a recording that captured nothing
   looked exactly like a microphone that had died — was that ONE channel had
   to carry both "hardware is alive" and "this is how loud you are". Here they
   are separate: the spin says live, the size says loud. A silent room now
   draws a small sphere still turning, which cannot be mistaken for a dead one.

   THE GEOMETRY IS THE BROWSER'S, NOT OURS. Every dot is placed on the surface
   by one 3D transform — `rotateY(λ) rotateX(-φ) translateZ(R)` puts a point at
   longitude λ, latitude φ on a sphere of radius R — and the whole shell then
   spins under a `perspective`. The foreshortening at the limb, the shrinking
   of the far side and the crowding toward the poles all fall out of the
   projection instead of being animated by hand. Nothing here holds a clock or
   a frame loop.

   ONLY ONE ELEMENT MOVES WITH THE VOICE. The level could scale each dot's own
   `translateZ`, and the first draft did — 54 style recalculations every
   animation frame, on the one screen already running an AudioContext and a
   speech socket. The scale lives on a single wrapper between the spin and the
   dots instead, so a frame costs one recalculation and the dots' transforms
   are computed once and never again. Scaling the wrapper grows the dots along
   with the radius, which is the behaviour we wanted anyway: loud is bigger AND
   heavier, not the same specks further apart.

   `backface-visibility` IS THE HIDDEN-SURFACE PASS. A dot on the far side is
   a disc pointing away from the camera, and the stylesheet drops it — the
   cheap version of the depth sort a renderer would do, and at these sizes the
   only one worth having: drawing both hemispheres stops reading as a sphere
   and starts reading as a smudge. A dot crossing the silhouette is edge-on
   and infinitely thin at the moment it goes, so nothing pops.

   IT SAYS NOTHING TO A SCREEN READER. Every caller already labels the region
   it sits in — "Listening", or the phase name beside it — and a sphere has
   nothing to add to either. */

/** Rings of latitude, from the south pole up. The poles themselves are left
    bare — a dot there is on the spin axis and would sit dead still while
    everything around it moved, which is the one thing that reads as a bug. */
const LATITUDES = [-60, -30, 0, 30, 60] as const;

/** Dots per ring, thinned toward the poles. A constant count would bunch them
    up where the rings are short and leave the equator sparse; these are
    picked so the spacing along each ring stays roughly even.

    THE FULL SPHERE SURVIVES 18px, which is why the meter gets the same one
    the transcript does. Sparser forms were tried against the real meter sizes
    — a single tilted ring, two rings, three — and every one of them reads as
    an arc or a pair of arcs rather than as a ball. Density is what buys the
    silhouette; taking it away to "fit" a small box loses the object. */
const DENSITY: Record<number, number> = { 60: 8, 30: 12, 0: 14 };

type Dot = { readonly lat: number; readonly lon: number };

/** Every dot on the shell, as (latitude, longitude) pairs in degrees. Computed
    once at module load: the sphere is the same sphere every time. */
export const DOTS: readonly Dot[] = LATITUDES.flatMap((lat) => {
  const n = DENSITY[Math.abs(lat)];
  return Array.from({ length: n }, (_, i) => ({ lat, lon: (360 / n) * i }));
});

export type OrbProps = {
  /** Diameter in pixels. OMIT IT to let the stylesheet decide through `--orb`
      — which is what the meter does, because its size is a property of the
      row it sits in and changes in four places. An inline style would win
      over every one of those. */
  size?: number;
  /** Extra class on the frame, for a caller that needs to reach the sphere. */
  className?: string;
};

/* THE SIZE IS A CUSTOM PROPERTY, NOT A STYLE ON EVERY DOT. The radius each
   dot is pushed out by is half the diameter, and it is read from `--orb` by
   the one transform in the stylesheet — so a caller changing the size moves
   fifty-four dots by writing one number, and the CSS keeps the arithmetic.

   The colour is `currentColor` for the same reason: the meter is recording
   red, the transcript's wait is teal, and the dark capture surface is brand
   green. None of that belongs to the sphere. */
export function Orb({ size, className }: OrbProps) {
  return (
    <span
      className={className ? `orb ${className}` : "orb"}
      style={size === undefined ? undefined : ({ "--orb": `${size}px` } as CSSProperties)}
      aria-hidden="true"
    >
      <span className="orb-spin">
        <span className="orb-ball">
          {DOTS.map((d, i) => (
            <i key={i} style={{ "--lat": `${d.lat}deg`, "--lon": `${d.lon}deg` } as CSSProperties} />
          ))}
        </span>
      </span>
    </span>
  );
}

export type WaitingProps = {
  /** What the wait is called. Rendered verbatim; the ellipsis is the
      stylesheet's, so the label stays a plain string a test can match and
      the vocabulary carries no punctuation. */
  note: string;
  /** Extra class on the chip, for a caller that needs it to sit in a slot
      some other line used to hold. */
  className?: string;
};

/* THE WAIT, NAMED — the orb with a word beside it.

   It stands wherever something is happening that has nothing to show for
   itself: Tiff searching the library, Tiff reading a recording back, and
   every note posture doing the same. All of those used to be flat grey text
   — or, in the transcript, three bouncing dots meaning "someone is typing"
   when nobody was.

   THE WORD IS THE LABEL, AND THE LABEL IS THE WORD. The indicator this
   replaced carried its meaning in an `aria-label` on a decorative span: a
   sentence written for screen readers about a state no sighted reader could
   name. Now there is one string, on the page, inside the live region, so
   `role="status"` announces what is actually there.

   IT TAKES ITS INK FROM THE SURFACE, like the sphere does. The same chip
   appears on Tiff's white sheet, under its ask bar, on the notes postures'
   light rows and on the capture sheet's dusk card — and a colour baked in
   here would be wrong on at least one of them. The stylesheet's `--say-ink`
   and `--say-lit` are what each surface sets. */
export function Waiting({ note, className }: WaitingProps) {
  return (
    <span className={className ? `orb-say ${className}` : "orb-say"} role="status">
      <Orb />
      <b>{note}</b>
    </span>
  );
}
