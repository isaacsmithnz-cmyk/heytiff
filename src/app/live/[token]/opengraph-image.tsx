/* THE PICTURE A MESSAGING APP SHOWS BESIDE A LIVE DESIGN LINK.

   Next serves this file at /live/<token>/opengraph-image and writes the
   og:image tag for the page beside it. It is a request of its own — the
   messaging service's crawler makes it, not the customer's browser — so it
   loads the share for itself and says exactly what the page's metadata says
   (lib/studio/live-og.ts decides the words for both).

   Dynamic on purpose: the route reads a token and a row, and the doc
   changes under a live link, so the picture must not be baked at build. A
   missing or expired token gets the closed card, not a 404 — a broken image
   beside a link reads as a broken product. */

import { ImageResponse } from "next/og";
import { loadLiveShare } from "@/lib/studio/live-load";
import { liveOgModel } from "@/lib/studio/live-og";
import { jakartaFonts } from "@/lib/og/fonts";
import { LiveCard } from "@/lib/og/card";

export const dynamic = "force-dynamic";
export const alt = "Live design summary";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const m = liveOgModel(await loadLiveShare(token));
  const fonts = await jakartaFonts([500, 700]);
  return new ImageResponse(
    <LiveCard org={m.org} headline={m.headline} line={m.line} footer={m.footer} band={m.bandColor} closed={m.closed} />,
    { ...size, fonts }
  );
}
