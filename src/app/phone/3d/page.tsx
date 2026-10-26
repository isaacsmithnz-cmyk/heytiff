import type { Metadata, Viewport } from "next";
import "@/components/studio/studio.css";
import { Phone3D } from "./phone-3d";

/* The phone's 3D: the web's own 3D view on a page of its own, for the
   HeyTiff app to show (phone-3d.tsx). Public like /live, because it reads
   nothing: what it draws is only what the app hands it. */

export const metadata: Metadata = { title: "HeyTiff 3D", robots: { index: false, follow: false } };

/* the app's fingers turn and zoom the house, never the page */
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default function Page() {
  return <Phone3D />;
}
