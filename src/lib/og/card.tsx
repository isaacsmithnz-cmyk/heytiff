/* THE PREVIEW CARD, DRAWN THE WAY THE APP IS DECIDED TO LOOK.

   docs/design.md: ink and paper, no accent. The card is white with ink type,
   the chevron in ink with its second stroke at 55%, and teal on the "Tiff" of
   the wordmark only — the one dot. The live card adds a band across the top
   in the business's own brand colour when it has one, because that is what
   the design sheet wears, and the preview should look like the thing it is a
   preview of.

   Satori draws this, not a browser: flex only, no grid, every element with
   more than one child declares `display: flex`, and the font is whatever the
   route passed in (or the renderer's default when the fetch failed). Sizes
   are in px for a 1200 × 630 canvas. */

import type { CSSProperties, ReactNode } from "react";

const INK = "#050505";
const QUIET = "#5f6a79";
const TEAL = "#00E5C0";
const FONT = "Plus Jakarta Sans";

/** The mark, as the app draws it: a 7% stroke, butt caps, round joins, the
    second stroke at 55%. Same geometry as components/logo.tsx. */
export function Chevron({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <path d="M22 24 L40 24 L62 50 L40 76 L22 76 L44 50 Z" stroke={color} strokeWidth={7} strokeLinejoin="round" />
      <path d="M54 24 L72 24 L90 46" stroke={color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} />
    </svg>
  );
}

export function Wordmark({ size }: { size: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(size * 0.35) }}>
      <Chevron size={Math.round(size * 1.3)} color={INK} />
      <div style={{ display: "flex", fontFamily: FONT, fontWeight: 700, fontSize: size, color: INK, letterSpacing: -0.5 }}>
        <span>Hey</span>
        <span style={{ color: TEAL }}>Tiff</span>
      </div>
    </div>
  );
}

const page: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  background: "#ffffff",
  color: INK,
  fontFamily: FONT,
};

/** The frame every card shares: an optional band at the top, then padding. */
export function Card({ band, children }: { band: string | null; children: ReactNode }) {
  return (
    <div style={page}>
      {band ? <div style={{ display: "flex", height: 14, width: "100%", background: band }} /> : null}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "64px 72px 56px" }}>{children}</div>
    </div>
  );
}

/** The card for a live design link. */
export function LiveCard({
  org,
  headline,
  line,
  footer,
  band,
  closed,
}: {
  org: string;
  headline: string;
  line: string;
  footer: string;
  band: string | null;
  closed: boolean;
}) {
  return (
    <Card band={closed ? null : band}>
      <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: INK }}>{org}</div>
      <div style={{ display: "flex", width: 96, height: 3, background: INK, marginTop: 18 }} />
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "center",
          gap: 22,
          paddingRight: 120,
        }}
      >
        <div style={{ display: "flex", fontSize: closed ? 56 : 66, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1.5, color: INK }}>{headline}</div>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 500, color: QUIET, lineHeight: 1.3 }}>{line}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ display: "flex", fontSize: 24, fontWeight: 500, color: QUIET }}>{footer}</div>
        <Wordmark size={30} />
      </div>
    </Card>
  );
}

/** The card for the front door and any page without its own. */
export function BrandCard({ line }: { line: string }) {
  return (
    <Card band={null}>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: 40 }}>
        <Wordmark size={92} />
        <div style={{ display: "flex", fontSize: 34, fontWeight: 500, color: QUIET, maxWidth: 900, lineHeight: 1.3 }}>{line}</div>
      </div>
    </Card>
  );
}
