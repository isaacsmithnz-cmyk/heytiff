/* HeyTiff brand marks. The chevron is the logo, in one colour: it takes
   `currentColor`, white on the ink and ink on paper (v2, rules 8 and 9: "HeyTiff
   in one colour. The teal leaves the app."). The teal-to-blue gradient it
   wore until 18 October 2026 is gone, and so is the prop that asked for it.
   Source: public/brand/heytiff-*.svg */

/* THE MARK'S GEOMETRY, AS DATA. The two strokes used to be typed into the JSX
   below and nowhere else, which was fine while the SVG was the only thing that
   drew them. The capture card now renders the same chevron as a field of dots
   (lib/ui/dot-mark), and a second copy of these numbers is a second logo that
   drifts the first time this one is touched — the same argument `TiffMark` was
   extracted for one level up. One array, two renderers.

   `viewBox` is 100 × 100 and the coordinates are in that space. */
export const CHEVRON_STROKES = [
  {
    d: "M22 24 L40 24 L62 50 L40 76 L22 76 L44 50 Z",
    width: 7,
    /** The tail is drawn at 55%, and anything rendering the mark owes it that. */
    opacity: 1,
    cap: "butt",
  },
  { d: "M54 24 L72 24 L90 46", width: 7, opacity: 0.55, cap: "round" },
] as const;

export function Chevron({
  size = 24,
  className,
  decorative = false,
}: {
  size?: number;
  className?: string;
  /** Beside a word that already names the control. The mark defaults to
      `role="img"` with a "HeyTiff" label, which is right when it stands
      alone and wrong inside a labelled button: it joined the name, and the
      debrief's button became "HeyTiff Debrief". Decoration announces
      nothing. */
  decorative?: boolean;
}) {
  const stroke = "currentColor";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "HeyTiff"}
      aria-hidden={decorative ? true : undefined}
      className={className}
    >
      {CHEVRON_STROKES.map((s, i) => (
        <path
          key={i}
          className={`htmk-p${i + 1}`}
          pathLength={1}
          d={s.d}
          fill="none"
          stroke={stroke}
          strokeWidth={s.width}
          strokeLinecap={s.cap}
          strokeLinejoin="round"
          opacity={s.opacity === 1 ? undefined : s.opacity}
        />
      ))}
    </svg>
  );
}

/* "HeyTiff" wordmark as HTML text (uses the page's Plus Jakarta Sans), in
   one colour (v2, rule 9): `inkColor` colours the whole word, ink by default
   and white on the ink. The "Tiff" was teal until 18 October 2026. */
export function Wordmark({
  inkColor = "var(--ink, #050505)",
  className,
  style,
}: {
  inkColor?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={className}
      style={{ fontWeight: 700, letterSpacing: "-0.03em", color: inkColor, ...style }}
    >
      Hey<span>Tiff</span>
    </span>
  );
}
