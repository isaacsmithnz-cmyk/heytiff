import type { Metadata, Viewport } from "next";
import { PhonePick } from "./phone-pick";

/* The phone's PDF picker: a button on a page of its own, for the HeyTiff app
   to show in its Add to the Library sheet (phone-pick.tsx). Public like
   /phone/pdf, because it reads nothing and knows nobody. */

export const metadata: Metadata = { title: "HeyTiff add a manual", robots: { index: false, follow: false } };

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function Page() {
  return <PhonePick />;
}
