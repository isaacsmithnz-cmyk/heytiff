/* Single source of truth for the shell nav. Drives the sidebar (grouped),
   active-state detection, and the ⌘K command palette.
   `key` matches the original v3 data-nav id; `href` is the App Router route.

   Visibility is driven by CAPABILITIES, not roles, so granting someone a
   capability makes its entry appear on their next request — without a
   re-login and without a code change. `minRole` remains for the handful of
   things that are role-intrinsic rather than grantable (the Admin section).
   Either way this only decides what we OFFER: every route gates itself. */

import { hasMinRole, type Role } from "@/lib/roles-shared";
import type { Capability } from "@/lib/permissions";

export type NavItem = {
  key: string;
  label: string;
  icon: string;
  href: string;
  hint: string;
  accent: string;
  /** pulsing dot in the sidebar when not active */
  dot?: boolean;
  /** hide unless the viewer holds this capability */
  capability?: Capability;
  /** hide below this role — for role-intrinsic sections only */
  minRole?: Role;
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { key: "home", label: "Dashboard", icon: "dashboard", href: "/dashboard", hint: "Workspace landing", accent: "#00E5C0" },
      { key: "toolbox", label: "Toolbox", icon: "wrench", href: "/dashboard/toolbox", hint: "Calculators & references", accent: "#8A2BE2", capability: "toolbox" },
      { key: "ductr", label: "Design Studio", icon: "wind", href: "/dashboard/studio", hint: "VRF design canvas", accent: "#FF8A00", capability: "studio" },
      { key: "tiff", label: "Tiff AI", icon: "sparkles", href: "/dashboard/tiff", hint: "Assistant & knowledge base", accent: "#2E68FF", dot: true, capability: "tiff" },
    ],
  },
  {
    label: "Operations",
    items: [
      { key: "people", label: "Team", icon: "users", href: "/dashboard/team", hint: "People & their day", accent: "#00A389", capability: "team" },
      { key: "timepay", label: "Time & Pay", icon: "clock", href: "/dashboard/timepay", hint: "Timesheets, leave & expenses", accent: "#2E68FF", capability: "timepay_all" },
      { key: "assets", label: "Assets", icon: "truck", href: "/dashboard/assets", hint: "Fleet & equipment", accent: "#FF8A00", capability: "assets_all" },
      // Role-intrinsic, not grantable: the section is admin+ (staff hidden
      // entirely) and the owner-only items inside it gate individually.
      { key: "admin", label: "Admin", icon: "shield", href: "/dashboard/admin", hint: "Compliance, documents & settings", accent: "#FF3366", minRole: "admin" },
    ],
  },
  {
    // Your own things, ungated — the group heading carries the "my", so the
    // labels don't repeat it. Timesheet joins this in Stage 5.
    label: "Personal",
    items: [
      { key: "myvehicle", label: "Vehicle", icon: "truck", href: "/dashboard/my-vehicle", hint: "Your vehicle, fuel & issues", accent: "#FF8A00" },
    ],
  },
];

/** Flat list (for the command palette). */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Who is looking: their capabilities, plus the role for role-intrinsic entries. */
export type NavViewer = { caps: ReadonlySet<Capability>; role: Role | null };

function visible(n: NavItem, viewer: NavViewer): boolean {
  if (n.capability && !viewer.caps.has(n.capability)) return false;
  if (n.minRole && !hasMinRole(viewer.role, n.minRole)) return false;
  return true;
}

/** Entries this viewer may see. */
export function navFor(viewer: NavViewer): NavItem[] {
  return NAV.filter((n) => visible(n, viewer));
}

/** Grouped entries this viewer may see; groups left empty are dropped. */
export function navGroupsFor(viewer: NavViewer): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => visible(n, viewer)) })).filter(
    (g) => g.items.length > 0
  );
}

/** Active item for a given pathname. /dashboard is an exact match; the rest match by prefix. */
export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/dashboard") return pathname === "/dashboard";
  return pathname === item.href || pathname.startsWith(item.href + "/");
}
