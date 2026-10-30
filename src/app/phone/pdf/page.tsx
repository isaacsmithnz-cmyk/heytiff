import type { Metadata, Viewport } from "next";
import { PhonePdf } from "./phone-pdf";

/* The phone's manual: a Library PDF read on a page of its own, for the
   HeyTiff app to show under the manual's search (phone-pdf.tsx). Public like
   /phone/3d, because it reads nothing: what it shows is only the link the
   app hands it, and only a link to HeyTiff's own storage. */

export const metadata: Metadata = { title: "HeyTiff manual", robots: { index: false, follow: false } };

/* two fingers zoom into a drawing, as in any PDF reader */
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 5, userScalable: true };

export default function Page() {
  return <PhonePdf />;
}
