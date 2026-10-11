"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import { Clock } from "./clock";
import { Bell } from "./bell";
import { TiffButton } from "@/components/notes/tiff-button";
import type { ShellUser } from "./sidebar";
import { useCommandPalette } from "./command-palette-context";

/** What the search finds, for this viewer, in a few words. */
function searchSaid(caps: ShellUser["caps"]): string {
  if (caps.includes("workboard")) return "Find a job, client or screen…";
  if (caps.includes("team")) return "Find a person or screen…";
  return "Jump to a screen…";
}

export function Topbar({ user, today }: { user: ShellUser; today: string }) {
  /* The opener comes from context, not a prop: this component is rendered as a
     SERVER slot (it needs the viewer's name and role), and a server slot can't
     be handed a client callback. */
  const { open: onOpenCommand } = useCommandPalette();
  const meRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  /* Store the route the menu was opened on rather than a plain boolean, so
     navigating away closes it by construction — no setState-in-effect. */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const menuOpen = openedAt === pathname;
  const closeMenu = () => setOpenedAt(null);

  // close on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!meRef.current?.contains(e.target as Node)) setOpenedAt(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenedAt(null);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <header className="topbar" id="fg-topbar">
      <button className="searchbtn" onClick={onOpenCommand} type="button">
        <span className="si">
          <Icon name="search" size={18} />
        </span>
        {/* SAY WHAT IT DOES. This read "Search workspaces, tools, or ask Tiff"
            and promised three things it did not do. It then said "Jump to a
            screen…", which was true until the palette learned to find jobs,
            clients and people, open a job where you are, and hand your words
            to Tiff. It says what it finds for this viewer, as the palette's
            own box does. */}
        <div className="sf">{searchSaid(user.caps)}</div>
        <span className="kbd">
          <Icon name="command" size={10} /> K
        </span>
      </button>

      <div className="tbr">
        {/* The when, then the doing, then you. The clock is not a control, so
            it sits outside the pair below and the existing hairline separates
            them — the same divider already doing the same job before the
            avatar. */}
        <Clock today={today} />
        <span className="sep" />
        {/* Left of the bell, deliberately: the two controls on this side are
            "say something" and "something needs you", and the one you reach
            for on purpose sits before the one that interrupts you. */}
        <TiffButton />
        <Bell />
        <span className="sep" />
        <div className="me-top" ref={meRef}>
          <button
            className={`me-trigger${menuOpen ? " on" : ""}`}
            type="button"
            onClick={() => setOpenedAt((o) => (o === pathname ? null : pathname))}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="av">
              <span className="ring">
                <span className="inner">{user.initials}</span>
              </span>
            </span>
            <span className="mk">
              <b>{user.name}</b>
              <em>{user.roleLabel}</em>
            </span>
            <span className="me-gear">
              <Icon name="settings" size={17} />
            </span>
          </button>

          {menuOpen && (
            <div className="me-menu" role="menu">
              <Link
                href="/dashboard/profile"
                className="me-item"
                role="menuitem"
                onClick={closeMenu}
              >
                <span className="mi">
                  <Icon name="user" size={16} />
                </span>
                <span className="mk2">
                  {/* No "My" in nav labels — the menu hangs off your own
                      avatar and name, so it's already yours. The possessive
                      survives only in page headings (the profile page's
                      breadcrumb reads "My profile"), where it distinguishes
                      your card from Team / Staff / someone-else. */}
                  <b>Profile</b>
                  <em>Your staff card &amp; details</em>
                </span>
              </Link>
              <div className="me-div" />
              <a href="/auth/logout" className="me-item danger" role="menuitem">
                <span className="mi">
                  <Icon name="logout" size={16} />
                </span>
                <span className="mk2">
                  <b>Sign out</b>
                </span>
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
