/* HeyTiff brand marks. The chevron is the logo; `gradient` paints it teal→blue,
   otherwise it inherits `currentColor` (use white on dark, ink on light).
   Source: public/brand/heytiff-*.svg */

let gradSeq = 0;

export function Chevron({
  size = 24,
  gradient = false,
  className,
}: {
  size?: number;
  gradient?: boolean;
  className?: string;
}) {
  // unique gradient id per instance to avoid collisions when several render
  const gid = `htGrad-${gradient ? ++gradSeq : 0}`;
  const stroke = gradient ? `url(#${gid})` : "currentColor";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="HeyTiff"
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
      <path
        className="htmk-p1"
        pathLength={1}
        d="M22 24 L40 24 L62 50 L40 76 L22 76 L44 50 Z"
        fill="none"
        stroke={stroke}
        strokeWidth={7}
        strokeLinejoin="round"
      />
      <path
        className="htmk-p2"
        pathLength={1}
        d="M54 24 L72 24 L90 46"
        fill="none"
        stroke={stroke}
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.55}
      />
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
