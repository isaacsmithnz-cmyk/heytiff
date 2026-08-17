/* HeyTiff brand marks. The chevron is the logo; `gradient` paints it teal→blue,
   otherwise it inherits `currentColor` (use white on dark, ink on light).
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
  gradient = false,
  className,
  decorative = false,
}: {
  size?: number;
  gradient?: boolean;
  className?: string;
  /** Beside a word that already names the control. The mark defaults to
      `role="img"` with a "HeyTiff" label, which is right when it stands
      alone and wrong inside a labelled button: it joined the name, and the
      debrief's button became "HeyTiff Debrief". Decoration announces
      nothing. */
  decorative?: boolean;
}) {
  // The gradient is a single fixed brand gradient, so a stable constant id is
  // safe (identical defs never visually collide) and — unlike a render-time
  // counter — stays identical between server and client, avoiding a hydration
  // mismatch. Works in both Server and Client Components (no hook needed).
  const gid = "htGrad";
  const stroke = gradient ? `url(#${gid})` : "currentColor";
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
      {gradient && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#00E5C0" />
            <stop offset="1" stopColor="#2E68FF" />
          </linearGradient>
        </defs>
      )}
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

/* "HeyTiff" wordmark as HTML text (uses the page's Plus Jakarta Sans).
   `inkColor` is the "Hey" colour; "Tiff" always uses the teal-AA accent. */
export function Wordmark({
  inkColor = "#0A0B10",
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
      style={{ fontWeight: 800, letterSpacing: "-0.03em", ...style }}
    >
      <span style={{ color: inkColor }}>Hey</span>
      <span style={{ color: "#00A389" }}>Tiff</span>
    </span>
  );
}
