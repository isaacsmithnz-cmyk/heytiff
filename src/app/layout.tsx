import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Jakarta is the only typeface in the system — no mono face, by design
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HeyTiff",
  description: "Operations & compliance for trades businesses",
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
