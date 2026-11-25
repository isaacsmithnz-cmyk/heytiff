import Link from "next/link";
import { Chevron, Wordmark } from "@/components/logo";

/* THE TWO PAGES ANYONE CAN READ, signed in or not: /privacy and /support.
   The App Store needs both before it will list the phone app (25 November
   2026), and hey-tiff.com is a parked domain, so they live here. They are
   documents, drawn as the door is: ink on paper, one reading column, no
   frame. */

export const SUPPORT_EMAIL = "isaacsmithnz1@gmail.com";

export function PublicPage({ heading, updated, children }: { heading: string; updated?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface px-6 py-10 text-ink">
      <div className="mx-auto max-w-[680px]">
        <Link href="/" className="inline-flex items-center gap-2" aria-label="HeyTiff">
          <Chevron size={24} decorative />
          <Wordmark className="text-xl" />
        </Link>
        <h1 className="mt-10 text-2xl font-semibold">{heading}</h1>
        {updated ? <p className="mt-1 text-sm text-ink-2">Last updated {updated}</p> : null}
        <div className="mt-8 flex flex-col gap-8 text-base leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

export function Part({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{heading}</h2>
      {children}
    </section>
  );
}

export function Mail() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold underline decoration-1 underline-offset-4">
      {SUPPORT_EMAIL}
    </a>
  );
}
