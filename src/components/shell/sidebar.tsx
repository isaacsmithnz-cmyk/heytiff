"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import { NAV_GROUPS, isActive } from "./nav";

export type ShellUser = {
  name: string;
  roleLabel: string;
  initials: string;
};

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="side">
      <div className="glow" />

      <div className="brand">
        <div className="logo">
          <Icon name="hexagon" size={24} />
        </div>
        <div>
          <div className="bt">
            HeyTiff <i>✦</i>
          </div>
          <div className="bs">Platform</div>
        </div>
      </div>

      <div className="nav no-sb">
        {NAV_GROUPS.map((group) => (
          <div className="navgrp" key={group.label}>
            <div className="navlbl">
              <span />
              {group.label}
            </div>
            {group.items.map((n) => {
              const on = isActive(n, pathname);
              return (
                <Link key={n.key} href={n.href} className={`ni${on ? " on" : ""}`}>
                  <span className="nibg" />
                  <span className="nicon">
                    <Icon name={n.icon} size={16} sw={on ? 2.5 : 2} />
                  </span>
                  <span className="nlbl">{n.label}</span>
                  {n.dot && !on ? <span className="pdot" /> : null}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
