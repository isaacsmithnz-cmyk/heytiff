import { Chevron } from "../logo";
import { Icon } from "./icon";

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
    <aside className="side" aria-hidden="true">
      <div className="glow" />
      <div className="brand">
        <div className="ht-brandcol">
          <div className="ht-logo">
            <Chevron size={40} gradient />
            <span className="ht-wm">
              Hey<span>Tiff</span>
            </span>
          </div>
        </div>
      </div>
      <div className="nav no-sb">
        {[4, 3, 3].map((count, g) => (
          <div className="navgrp" key={g}>
            <div className="navlbl">
              <span />
              <i className="sk-dark sk-navlbl" />
            </div>
            {Array.from({ length: count }, (_, i) => (
              <div className="ni" key={i}>
                <span className="nicon">
                  <i className="sk-dark sk-navicon" />
                </span>
                <i className="sk-dark sk-navtext" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

export function TopbarSkeleton() {
  return (
    <header className="topbar" id="fg-topbar">
      {/* The search button is real and useful before we know who you are —
          but it opens a palette whose entries are capability-filtered, so it
          stays inert until the real topbar swaps in. */}
      <div className="searchbtn" aria-hidden="true">
        <span className="si">
          <Icon name="search" size={18} />
        </span>
        <div className="sf">Search workspaces, tools, or ask Tiff...</div>
      </div>
      <div className="tbr" aria-hidden="true">
        {/* The clock's two lines, held open: the real one arrives with a date
            already in it, so without this the whole control cluster slides
            when the chrome resolves. */}
        <div className="tbclock">
          <i className="sk-dark sk-time" />
          <i className="sk-dark sk-date" />
        </div>
        <span className="sep" />
        <span className="bell">
          <Icon name="bell" size={20} />
        </span>
        <span className="sep" />
        <div className="me-top">
          <div className="me-trigger">
            <span className="av">
              <span className="ring">
                <span className="inner" />
              </span>
            </span>
            <span className="mk">
              <i className="sk-dark sk-name" />
              <i className="sk-dark sk-role" />
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
