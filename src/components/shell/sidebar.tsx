"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import { NAV, isActive } from "./nav";

export type ShellUser = {
  name: string;
  roleLabel: string;
  initials: string;
};

export function Sidebar({ user }: { user: ShellUser }) {
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
        <div className="navgrp">
          {NAV.map((n) => {
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
      </div>

      <div className="sfoot">
        <div className="pro">
          <div className="pg" />
          <div className="pt">
            Pro Access <Icon name="sparkles" size={12} />
          </div>
          <div className="pd">VRF commissioning &amp; live team sync</div>
          <button className="pb">Upgrade Now</button>
        </div>
        <div className="me">
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
          <a href="/auth/logout" title="Sign out" aria-label="Sign out" className="mg">
            <Icon name="settings" size={16} />
          </a>
        </div>
      </div>
    </aside>
  );
}
