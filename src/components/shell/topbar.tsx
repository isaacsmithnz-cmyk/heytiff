"use client";

import { Icon } from "./icon";

export function Topbar({ onOpenCommand }: { onOpenCommand: () => void }) {
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
      </div>
    </header>
  );
}
