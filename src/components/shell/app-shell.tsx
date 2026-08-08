"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { CommandPaletteProvider } from "./command-palette-context";
import { TiffButton } from "@/components/notes/tiff-button";

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
  children,
}: {
  /** Server slots, each pre-wrapped in <Suspense> by the layout. */
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  palette: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>(".spot");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);

  // tab switching for .ptab tabbed pages (Time & Pay, Assets) — matches the
  // original page's delegated click handler.
  const onClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const tab = target.closest<HTMLElement>(".ptab");
    if (!tab) return;
    const idx = tab.dataset.ptab;
    const tabs = tab.parentElement;
    if (!tabs) return;
    tabs.querySelectorAll(".ptab").forEach((t) => t.classList.toggle("on", t === tab));
    const panels = tabs.parentElement?.querySelector(".ptabpanels");
    panels
      ?.querySelectorAll<HTMLElement>(".ptabpanel")
      .forEach((p) => p.classList.toggle("on", p.dataset.ppanel === idx));
  }, []);

  return (
    <CommandPaletteProvider>
    <div className="fg" onMouseMove={onMouseMove} onClick={onClick}>
      <div className="gridbg" />
      {/* frame-level ambient fx: aurora blobs + rising orbs roam the whole black
          frame (behind the sidebar/topbar content and the floating light well) */}
      <div className="framefx" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      {sidebar}
      <div className="main">
        {topbar}
        {/* key by pathname so each screen remounts (and its entrance animation replays) on navigation */}
        <main className="outlet" key={pathname}>
          {children}
        </main>
      </div>
      {palette}
      {/* One way in, same corner of every screen. In the frame rather
          than on a page, so it does not remount as you navigate and
          does not need a `key` on the outlet to survive. */}
      <TiffButton />
    </div>
    </CommandPaletteProvider>
  );
}
