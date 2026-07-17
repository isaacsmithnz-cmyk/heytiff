"use client";

import { Icon } from "./icon";
import type { ShellUser } from "./sidebar";

export function Topbar({
  user,
  onOpenCommand,
}: {
  user: ShellUser;
  onOpenCommand: () => void;
}) {
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
        <div className="me-top">
          <div className="av">
            <div className="ring">
              <div className="inner">{user.initials}</div>
            </div>
            <div className="st" />
          </div>
          <div className="mk">
            <b>{user.name}</b>
            <em>{user.roleLabel}</em>
          </div>
          <a
            href="/auth/logout"
            className="me-gear"
            title="Sign out"
            aria-label="Sign out"
          >
            <Icon name="settings" size={17} />
          </a>
        </div>
      </div>
    </header>
  );
}
