"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import { Chevron } from "../logo";
import { navGroupsFor, isActive } from "./nav";
import type { Role } from "@/lib/roles-shared";
import type { Capability } from "@/lib/permissions";

export type ShellUser = {
  name: string;
  roleLabel: string;
  initials: string;
  /** org role — for the role-intrinsic Admin entry */
  role: Role | null;
  /** resolved capabilities; drives nav visibility. Routes gate themselves too. */
  caps: readonly Capability[];
};

export function Sidebar({
  role,
  caps,
  orgName = null,
}: {
  role: Role | null;
  caps: readonly Capability[];
  /** trading name from org settings; null (unset) hides the × line */
  orgName?: string | null;
}) {
  const pathname = usePathname();
  const groups = navGroupsFor({ caps: new Set(caps), role });

  return (
    <aside className="side">
      <div className="glow" />

      <div className="brand">
        <div className="ht-brandcol">
          <div className="ht-logo">
            <Chevron size={40} gradient />
            <span className="ht-wm">
              Hey<span>Tiff</span>
            </span>
          </div>
          {/* HeyTiff × the business — trading name from Organisation settings */}
          {orgName ? (
            <div className="ht-orgx" title={orgName}>
              <span className="x">×</span> {orgName}
            </div>
          ) : null}
        </div>
      </div>

      <div className="nav no-sb">
        {groups.map((group) => (
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
