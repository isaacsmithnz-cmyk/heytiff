/* The fallback every dashboard route falls back to while its server render
   runs.

   This exists because of what the App Router does WITHOUT a Suspense boundary
   below the shared layout: on a client navigation it keeps the OLD page on
   screen until the new page's server render finishes. Every screen here is
   dynamic (session cookie → org → a handful of Supabase reads from Sydney to
   Singapore), so that was four-ish seconds of a dead-looking app after every
   click. The click now lands on this instead, immediately.

   Deliberately generic. Twenty-eight routes share it, so it claims only what
   they all have — a title block and some cards — rather than pretending to
   know the shape of the screen that's coming. Nothing here is real data and
   nothing here is interactive; it is a held place, not a preview. */

export function PageSkeleton() {
  return (
    <div className="page in" aria-busy="true" aria-live="polite">
      <div className="wrap">
        <span className="pk-sr">Loading</span>
        <div className="pk" aria-hidden="true">
          <div className="pk-head">
            <span className="pk-b pk-eyebrow" />
            <span className="pk-b pk-title" />
            <span className="pk-b pk-sub" />
          </div>
          <div className="pk-tiles">
            {[0, 1, 2, 3].map((i) => (
              <div className="pk-tile" key={i}>
                <span className="pk-b pk-tk" />
                <span className="pk-b pk-tv" />
              </div>
            ))}
          </div>
          <div className="pk-card">
            {[0, 1, 2, 3, 4].map((i) => (
              <div className="pk-row" key={i}>
                <span className="pk-b pk-dot" />
                <span className="pk-b pk-l1" />
                <span className="pk-b pk-l2" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
