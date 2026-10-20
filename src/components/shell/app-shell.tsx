"use client";

import { usePathname } from "next/navigation";
import { CommandPaletteProvider } from "./command-palette-context";
import { RecordDock } from "@/components/records/record-dock";

/* The app frame — and NOTHING in it knows who you are.

   The black frame, the grid, the aurora and the page outlet all render without
   a session, which is exactly what lets Cache Components prerender them into a
   static shell served straight off the CDN. The three pieces that DO need a
   name and a capability set arrive as SLOTS, each already wrapped in its own
   <Suspense> by the layout, and stream in behind their skeletons.

   Before this, the layout awaited all of it up front and the frame itself was
   the thing every screen waited on. */

export function AppShell({
  sidebar,
  topbar,
  palette,
  records,
  children,
}: {
  /** Server slots, each pre-wrapped in <Suspense> by the layout. */
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  palette: React.ReactNode;
  /** The record host's windows (components/records/record-host). */
  records?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <CommandPaletteProvider>
    <div className="fg">
      <div className="gridbg" />
      {sidebar}
      <div className="main">
        {topbar}
        {/* key by pathname so each screen remounts (and its entrance animation replays) on navigation */}
        <main className="outlet" key={pathname}>
          {children}
        </main>
        {/* the cards set aside, under the page and never over it */}
        <RecordDock />
      </div>
      {palette}
      {records}
    </div>
    </CommandPaletteProvider>
  );
}
