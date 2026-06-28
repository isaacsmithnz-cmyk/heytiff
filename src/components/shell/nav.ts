/* Single source of truth for the shell nav. Drives the sidebar (grouped),
   active-state detection, and the ⌘K command palette.
   `key` matches the original v3 data-nav id; `href` is the App Router route. */

export type NavItem = {
  key: string;
  label: string;
  icon: string;
  href: string;
  hint: string;
  accent: string;
  /** pulsing dot in the sidebar when not active */
  dot?: boolean;
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
      { key: "people", label: "Team", icon: "users", href: "/dashboard/team", hint: "People & their day", accent: "#00A389" },
      { key: "timepay", label: "Time & Pay", icon: "clock", href: "/dashboard/timepay", hint: "Timesheets, leave & expenses", accent: "#2E68FF" },
      { key: "assets", label: "Assets", icon: "truck", href: "/dashboard/assets", hint: "Fleet & equipment", accent: "#FF8A00" },
      { key: "admin", label: "Admin", icon: "shield", href: "/dashboard/admin", hint: "Owner, financial & compliance", accent: "#FF3366" },
    ],
  },
];

/** Flat list (for the command palette). */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Active item for a given pathname. /dashboard is an exact match; the rest match by prefix. */
export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/dashboard") return pathname === "/dashboard";
  return pathname === item.href || pathname.startsWith(item.href + "/");
}
