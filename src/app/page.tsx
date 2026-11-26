import type { Metadata } from "next";
import { Landing } from "@/components/landing/landing";

/* THE FRONT PAGE, for anyone signed out; a signed-in visit to `/` never
   reaches it, the proxy sends it Home (src/proxy.ts).

   It replaced the door (the logo, Create account and Sign in on white) on
   26 November 2026: on the ink, Tiff's mark in 3D, and the app's own screens
   as you scroll. Create account left with it, as new businesses join by
   invitation for now; the page is components/landing, and why it may break
   the app's rules is in docs/design.md under Named exemptions.

   The front door's old blurred light stays gone (frame-still.test): the one
   light here is the horizon's edge behind the quote, which is the page's,
   not the frame's. */

export const metadata: Metadata = {
  title: { absolute: "HeyTiff" },
  description: "The office for a trade business, with Tiff to run it.",
};

export default function Home() {
  return <Landing />;
}
