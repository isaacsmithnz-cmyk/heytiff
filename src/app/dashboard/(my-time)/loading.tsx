/* What sits under the tabs while the other half of your time loads.

   The point is what it does NOT cover. `dashboard/loading.tsx` is the boundary
   that used to catch a Timesheet↔Leave navigation, and its fallback replaces
   the whole screen — so the heading and the tab row you had just clicked went
   grey along with everything else. This boundary is below the layout that owns
   those, so they stay on screen and only the card is held.

   One card-shaped block, because that is genuinely all these two routes have in
   common below the tabs. It claims no rows, no rail and no totals: the two
   screens disagree about all three, and a fallback that guesses wrong reads as
   the page loading twice. */

export default function Loading() {
  return (
    <div className="wb2-card tp-card" aria-busy="true" aria-live="polite">
      <span className="pk-sr">Loading</span>
      <div className="pk" aria-hidden="true">
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
  );
}
