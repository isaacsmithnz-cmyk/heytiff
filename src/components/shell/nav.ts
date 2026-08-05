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

/* A tabbed face of a nav entry: it shares the parent's sidebar row (the parent
   lights up on any of them) but keeps its own ⌘K result, so folding a screen
   into a tab costs it a row in the rail and nothing else.

   Deliberately carries NO gating of its own — a face is offered exactly when
   its parent is. Anything that needs its own capability is a nav entry, not a
   face of one. */
export type NavSub = {
  key: string;
  label: string;
  icon: string;
  href: string;
  hint: string;
  accent: string;
};

export type NavItem = NavSub & {
  /** pulsing dot in the sidebar when not active */
  dot?: boolean;
  /** hide unless the viewer holds this capability */
  capability?: Capability;
  /** hide below this role — for role-intrinsic sections only */
  minRole?: Role;
  /** sibling routes shown as tabs on the page rather than rows in the rail */
  subItems?: NavSub[];
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { key: "home", label: "Home", icon: "dashboard", href: "/dashboard", hint: "Your day at a glance", accent: "#00E5C0" },
      // Second on purpose, right under Home: Home is YOUR day, the Workboard
      // is the BUSINESS's — the two questions anyone opens the app to ask.
      // It lives in Workspace rather than Operations because unlike the rest
      // of that group it defaults to EVERYONE (`workboard` is a staff default).
      { key: "workboard", label: "Workboard", icon: "activity", href: "/dashboard/workboard", hint: "Maintenance & projects command centre", accent: "#00A8E0", capability: "workboard" },
      { key: "toolbox", label: "Toolbox", icon: "wrench", href: "/dashboard/toolbox", hint: "Calculators & references", accent: "#8A2BE2", capability: "toolbox" },
      { key: "ductr", label: "Design Studio", icon: "wind", href: "/dashboard/studio", hint: "VRF design canvas", accent: "#FF8A00", capability: "studio" },
      /* The knowledge base rides along as a tab, like Leave does on Timesheet:
         it is the same feature seen from the other end — the assistant answers
         out of the library, and the library is where the answers come from.
         One rail row, two faces, and ⌘K still lists the library in its own
         right. Only the FACE is listed here; the row itself is the assistant. */
      { key: "tiff", label: "Tiff AI", icon: "sparkles", href: "/dashboard/tiff", hint: "Assistant & knowledge base", accent: "#2E68FF", dot: true, capability: "tiff",
        subItems: [
          { key: "tiffkb", label: "Knowledge", icon: "library", href: "/dashboard/tiff/knowledge", hint: "Manuals, specs & SOPs Tiff reads", accent: "#2E68FF" },
        ] },
    ],
  },
  {
    // Your own things, ungated — the group heading carries the "my", so the
    // labels don't repeat it. Sits above Operations: everyone has these,
    // only some people manage.
    label: "Personal",
    items: [
      /* Leave rides along as a tab rather than a row of its own. The two are
         one calendar underneath — booking leave writes to the timesheet, which
         is why `requestLeave` revalidates both paths — so they were always
         going to be read together, and the rail was the wrong place to insist
         they're separate. ⌘K still lists Leave in its own right. */
      { key: "mytimesheet", label: "Timesheet", icon: "clock", href: "/dashboard/my-timesheet", hint: "Your hours & submissions", accent: "#2E68FF",
        subItems: [
          { key: "myleave", label: "Leave", icon: "calendar", href: "/dashboard/my-leave", hint: "Book leave & see balances", accent: "#00A389" },
        ] },
      { key: "myvehicle", label: "Vehicle", icon: "truck", href: "/dashboard/my-vehicle", hint: "Your vehicle, fuel & issues", accent: "#FF8A00" },
      // Ungated like the rest of this group: spending your own money on the
      // job and asking for it back is not a privilege.
      { key: "myexpenses", label: "Expenses", icon: "receipt", href: "/dashboard/my-expenses", hint: "Claim money you've spent", accent: "#8A2BE2" },
      /* The note cascade's floor, and the whole reason it may be a
         destination at all: a note that couldn't be filed against a job or
         handed to somebody as a task lands here, where its author reads it.
         Ungated like the rest of Personal — writing yourself a note is the
         least privileged thing in the app. */
      { key: "mynotes", label: "Notes", icon: "note", href: "/dashboard/my-notes", hint: "Anything that didn't belong to a job", accent: "#007FA8" },
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
];

/** Every entry, tabbed faces included — the palette's universe. */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) =>
  g.items.flatMap((n) => [n, ...(n.subItems ?? [])])
);

/** Just the rows the rail draws — one per entry, faces folded in. */
export const NAV_ROWS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Who is looking: their capabilities, plus the role for role-intrinsic entries. */
export type NavViewer = { caps: ReadonlySet<Capability>; role: Role | null };

function visible(n: NavItem, viewer: NavViewer): boolean {
  if (n.capability && !viewer.caps.has(n.capability)) return false;
  if (n.minRole && !hasMinRole(viewer.role, n.minRole)) return false;
  return true;
}

/** Entries this viewer may see, tabbed faces included — what ⌘K searches.
    Faces are expanded AFTER their parent is filtered, so one that has been
    folded in can never outlive the entry that gates it. */
export function navFor(viewer: NavViewer): NavItem[] {
  return NAV_ROWS.filter((n) => visible(n, viewer)).flatMap((n) => [n, ...(n.subItems ?? [])]);
}

/** Grouped entries this viewer may see; groups left empty are dropped. */
export function navGroupsFor(viewer: NavViewer): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => visible(n, viewer)) })).filter(
    (g) => g.items.length > 0
  );
}

/** /dashboard is an exact match; the rest match by prefix. */
function onHref(href: string, pathname: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

/** Active item for a given pathname. An entry stays lit on any of its tabbed
    faces — the row is the section, and the tabs move within it. */
export function isActive(item: NavItem, pathname: string): boolean {
  return (
    onHref(item.href, pathname) || (item.subItems ?? []).some((s) => onHref(s.href, pathname))
  );
}
