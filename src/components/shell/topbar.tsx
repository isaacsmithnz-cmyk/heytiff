"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import type { ShellUser } from "./sidebar";
import { useCommandPalette } from "./command-palette-context";

export function Topbar({ user }: { user: ShellUser }) {
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
        <div className="sf">Search workspaces, tools, or ask Tiff...</div>
        <span className="kbd">
          <Icon name="command" size={10} /> K
        </span>
      </button>

      <div className="tbr">
        <button className="bell" type="button">
          <Icon name="bell" size={20} />
          <span className="d" />
        </button>
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
              <span className="st" />
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
