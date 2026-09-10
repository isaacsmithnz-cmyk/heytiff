import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { metadataBaseFromEnv } from "@/lib/og/base";
import "./globals.css";

// Jakarta is the only typeface in the system — no mono face, by design
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

const DESCRIPTION = "Operations & compliance for trades businesses";

/* A HeyTiff link pasted into a chat used to arrive as a grey box: no
   description, no picture. `metadataBase` is the canonical host, the same
   APP_BASE_URL proxy.ts redirects to, so the picture's URL is absolute and
   right on every host. The picture itself is app/opengraph-image.tsx, which
   Next attaches to every route that has no picture of its own; the live
   design link has its own. */
export const metadata: Metadata = {
  metadataBase: metadataBaseFromEnv(process.env.APP_BASE_URL),
  title: "HeyTiff",
  description: DESCRIPTION,
  openGraph: {
    title: "HeyTiff",
    description: DESCRIPTION,
    siteName: "HeyTiff",
    type: "website",
    locale: "en_AU",
  },
  twitter: { card: "summary_large_image", title: "HeyTiff", description: DESCRIPTION },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /* suppressHydrationWarning: the dashboard layout's boot script stamps the
       remembered sidebar size (`data-rail`) on <html> BEFORE hydration — by
       design, so a collapsed rail never flashes wide. React would flag that
       attribute as a server/client mismatch on every load. The suppression is
       scoped to this one element; children are still checked. */
    <html
      lang="en"
      className={`${jakarta.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
