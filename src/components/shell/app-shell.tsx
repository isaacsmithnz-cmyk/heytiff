"use client";

import { useCallback, useEffect, useState } from "react";
import { Sidebar, type ShellUser } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";

export function AppShell({
  user,
  children,
}: {
  user: ShellUser;
  children: React.ReactNode;
}) {
  const [cmdOpen, setCmdOpen] = useState(false);

  const openCmd = useCallback(() => setCmdOpen(true), []);
  const closeCmd = useCallback(() => setCmdOpen(false), []);

  // ⌘K / Ctrl+K toggles the command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // spotlight follow for any .spot card (matches the original global handler)
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>(".spot");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);

  return (
    <div className="fg" onMouseMove={onMouseMove}>
      <div className="gridbg" />
      <Sidebar user={user} />
      <div className="main">
        <Topbar onOpenCommand={openCmd} />
        {/* The router swaps the page subtree on navigation, so each screen's
            `.page in` remounts and its entrance animation replays — no need to
            remount (and rebuild/scroll-reset) the whole <main>. */}
        <main className="outlet">{children}</main>
      </div>
      <CommandPalette open={cmdOpen} onClose={closeCmd} />
    </div>
  );
}
