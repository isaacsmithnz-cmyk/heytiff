import { Chevron } from "../logo";

/* What the frame holds while it is still finding out who you are.

   These are what Cache Components prerenders into the static shell — the only
   part of an auth-gated, entirely personalised app that CAN be prerendered. So
   they are not filler: on a cold load they are the first thing on screen, and
   they need to occupy the same space the real chrome will, or the sidebar
   jumps under the cursor the moment it resolves.

   The HeyTiff wordmark is real, not a grey block. It is the same for every
   viewer, costs nothing to know, and is the one piece of this frame that never
   needs a database. */

export function SidebarSkeleton() {
  return (
    <aside className="side fr-side" aria-hidden="true">
      <div className="fr-brand">
        <Chevron size={24} />
        <span className="fr-wm">HeyTiff</span>
      </div>
      <div className="fr-places">
        {Array.from({ length: 7 }, (_, i) => (
          <div className="fr-row" key={i}>
            <i className="fr-sk fr-sk-icon" />
            <i className="fr-sk fr-sk-word" />
          </div>
        ))}
      </div>
    </aside>
  );
}

/* The header holds the date's place; the tabs arrive with the page. */
export function TopbarSkeleton() {
  return (
    <header className="topbar fr-head" id="fg-topbar" aria-hidden="true">
      <i className="fr-sk fr-sk-date" />
    </header>
  );
}
