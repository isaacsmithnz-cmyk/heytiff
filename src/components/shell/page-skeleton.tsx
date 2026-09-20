import { ScreenBand, ScreenPanel } from "@/components/shell/screen-band";

/* The fallback every dashboard route falls back to while its server render
   runs.

   This exists because of what the App Router does WITHOUT a Suspense boundary
   below the shared layout: on a client navigation it keeps the OLD page on
   screen until the new page's server render finishes. Every screen here is
   dynamic (session cookie → org → a handful of Supabase reads from Sydney to
   Singapore), so that was four-ish seconds of a dead-looking app after every
   click. The click now lands on this instead, immediately.

   IT HOLDS THE FRAME (2026-09-20), not a shape of its own: `.page.full`, the
   band, the panel. Every screen that has taken the frame paints its own band
   exactly where this one is, so the title stops moving when the page lands —
   and the held place is white, like the page coming, rather than the grey
   well that used to flash first. The screens still on the well (Projects,
   the Library, the tool pages, the Studio…) paint their grey over this; that
   mismatch goes as each one converts.

   Deliberately generic. Twenty-eight routes share it, so it claims only what
   they all have — a title and some rows — rather than pretending to know the
   shape of the screen that's coming. It does not draw tabs: half of these
   screens have none, and a row of tabs that then vanishes is a worse hold
   than no tabs at all. Nothing here is real data and nothing here is
   interactive; it is a held place, not a preview. */

export function PageSkeleton() {
  return (
    <div className="page in full" aria-busy="true" aria-live="polite">
      <div className="wrap">
        <div className="stg">
          <span className="pk-sr">Loading</span>
          <ScreenBand title={<span className="pk-b pk-title" aria-hidden="true" />} />
          <ScreenPanel>
            {/* `pk` marks this as the light page hold — the Data Library's
                own boundary is asserted on it, so it does not inherit the
                Studio's dark one (see app/dashboard/studio/data-library). */}
            <div className="pk" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <div className="pk-row" key={i}>
                  <span className="pk-b pk-dot" />
                  <span className="pk-b pk-l1" />
                  <span className="pk-b pk-l2" />
                </div>
              ))}
            </div>
          </ScreenPanel>
        </div>
      </div>
    </div>
  );
}
