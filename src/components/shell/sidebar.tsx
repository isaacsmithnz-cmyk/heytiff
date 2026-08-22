"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import { Chevron } from "../logo";
import { navGroupsFor, isActive } from "./nav";
import {
  railCollapsed,
  railServerSnapshot,
  subscribeRail,
  toggleRail,
} from "./rail-state";
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
  /** trading name from org settings; null (unset) hides the chip */
  orgName?: string | null;
}) {
  const pathname = usePathname();
  const groups = navGroupsFor({ caps: new Set(caps), role });
  /* collapsed = the 64px icon rail. CSS keys off html[data-rail] (set before
     paint by the layout's boot script); React reads it only for the toggle's
     label and the items' hover titles. */
  const rail = useSyncExternalStore(subscribeRail, railCollapsed, railServerSnapshot);

  return (
    <>
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
          {/* Whose account this is — the trading name from Organisation
              settings, chipped under the wordmark. A chip rather than a line of
              text because the two names are not the same kind of thing: HeyTiff
              is the software, this is the business using it, and a bare line
              underneath reads as a tagline for the word above it.

              The uploaded logo used to render here in place of a × glyph, and
              could not: what a business uploads is a LETTERHEAD — the one in
              prod is 3780×1064 — and a 224px rail has nowhere to put a wordmark
              that wide except a 40px box, where it came out 9px tall in its own
              dark ink on a near-black rail. The logo belongs on the surfaces a
              customer receives, which is where it is (org/letterhead.tsx). */}
          {orgName ? (
            <span className="ht-orgpill" title={orgName}>
              {orgName}
            </span>
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
                <Link
                  key={n.key}
                  href={n.href}
                  className={`ni${on ? " on" : ""}`}
                  /* collapsed rows are icon-only — the hover gives the word
                     back; expanded rows already wear it, so no tooltip */
                  title={rail ? n.label : undefined}
                >
                  <span className="nibg" />
                  <span className="nicon">
                    <Icon name={n.icon} size={16} sw={on ? 2.5 : 2} />
                  </span>
                  <span className="nlbl">{n.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>

    </aside>
    {/* the rail's two sizes — one control, a handle riding the SEAM between
        rail and content. It lives outside the aside: .side clips at its own
        edge (overflow:hidden contains the glow), which would cut the
        straddling chip in half. */}
    <button
      type="button"
      className="railtg"
      onClick={toggleRail}
      aria-label={rail ? "Expand navigation" : "Collapse navigation"}
      title={rail ? "Expand navigation" : "Collapse navigation"}
    >
      <Icon name={rail ? "chevR" : "chevL"} size={15} />
    </button>
    </>
  );
}
