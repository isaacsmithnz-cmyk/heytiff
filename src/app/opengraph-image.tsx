/* THE PICTURE BESIDE ANY HEYTIFF LINK THAT HAS NO PICTURE OF ITS OWN.

   The front door most of all: a link to the app pasted into a chat used to
   arrive as a grey box. Served at /opengraph-image and applied by Next to
   every route that does not declare its own (the live design link does).
   Nothing here changes per request, so it is built once. */

import { ImageResponse } from "next/og";
import { jakartaFonts } from "@/lib/og/fonts";
import { BrandCard } from "@/lib/og/card";

export const alt = "HeyTiff";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const fonts = await jakartaFonts([500, 700]);
  return new ImageResponse(<BrandCard line="Operations and compliance for trades businesses." />, {
    ...size,
    fonts,
  });
}
