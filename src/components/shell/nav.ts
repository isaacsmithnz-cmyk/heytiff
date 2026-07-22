/* Single source of truth for the shell nav. Drives the sidebar (grouped),
   active-state detection, and the ⌘K command palette.
   `key` matches the original v3 data-nav id; `href` is the App Router route. */

import { hasMinRole, type Role } from "@/lib/roles-shared";

export type NavItem = {
  key: string;
  label: string;
  icon: string;
  href: string;
  hint: string;
  accent: string;
  /** pulsing dot in the sidebar when not active */
  dot?: boolean;
  /** hide the entry below this role. The route must gate itself too — this
      only stops us offering a link that would bounce the user straight back. */
  minRole?: Role;
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { key: "home", label: "Dashboard", icon: "dashboard", href: "/dashboard", hint: "Workspace landing", accent: "#00E5C0" },
      { key: "toolbox", label: "Toolbox", icon: "wrench", href: "/dashboard/toolbox", hint: "Calculators & references", accent: "#8A2BE2" },
      { key: "ductr", label: "Design Studio", icon: "wind", href: "/dashboard/studio", hint: "VRF design canvas", accent: "#FF8A00" },
      { key: "tiff", label: "Tiff AI", icon: "sparkles", href: "/dashboard/tiff", hint: "Assistant & knowledge base", accent: "#2E68FF", dot: true },
    ],
  },
  {
    label: "Operations",
    items: [
      { key: "people", label: "Team", icon: "users", href: "/dashboard/team", hint: "People & their day", accent: "#00A389", minRole: "admin" },
      { key: "timepay", label: "Time & Pay", icon: "clock", href: "/dashboard/timepay", hint: "Timesheets, leave & expenses", accent: "#2E68FF", minRole: "admin" },
      { key: "assets", label: "Assets", icon: "truck", href: "/dashboard/assets", hint: "Fleet & equipment", accent: "#FF8A00" },
      // Section is admin+ (staff hidden entirely); the owner-only items inside
      // it — invites/users/roles, financial tools — gate individually.
      { key: "admin", label: "Admin", icon: "shield", href: "/dashboard/admin", hint: "Compliance, documents & settings", accent: "#FF3366", minRole: "admin" },
    ],
  },
];

/** Flat list (for the command palette). */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Entries this role may see. */
export function navFor(role: Role | null): NavItem[] {
  return NAV.filter((n) => !n.minRole || hasMinRole(role, n.minRole));
}

/** Grouped entries this role may see; groups left empty are dropped. */
export function navGroupsFor(role: Role | null): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((n) => !n.minRole || hasMinRole(role, n.minRole)),
  })).filter((g) => g.items.length > 0);
}

/** Active item for a given pathname. /dashboard is an exact match; the rest match by prefix. */
export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/dashboard") return pathname === "/dashboard";
  return pathname === item.href || pathname.startsWith(item.href + "/");
}
