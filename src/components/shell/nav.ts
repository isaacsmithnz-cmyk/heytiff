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

/* A FACE of a nav entry: it shares the parent's sidebar row (the parent lights
   up on any of them) but keeps its own ⌘K result, so folding a screen in costs
   it a row in the rail and nothing else.

   Most faces present as tabs on the page — Timesheet/Leave, Library/All
   documents —
   but that is those screens' own convention, not something this type enforces.
   What a face actually means is "same rail row, still findable", which is also
   the right shape for a detail view like Action required that Home summarises.

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

/* There used to be a `dot?: boolean` here — "pulsing dot in the sidebar when
   not active" — set on exactly one entry, by hand, with nothing behind it. It
   had pulsed on the Library since the day Tiff shipped and would have kept pulsing
   forever, because a hard-coded flag has no way to become false. A permanent
   unread mark is worse than none: it is the first thing a new person clicks and
   the first thing they learn to ignore, which spends the credibility of every
   real signal you might want to show them later.

   The field is gone rather than just its one use, so the next "let's draw
   attention to this screen" has to arrive with a source of truth attached. */
export type NavItem = NavSub & {
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
      /* Action required and the Noticeboard are both Home's detail views now,
         so both ride on Home's row rather than taking one each.

         THE TABS FINALLY EXIST. `subItems` has always meant "sibling route
         shown as a tab on the page rather than a row in the rail", and Action
         required has been declared one since the counters — but Home had no
         tab strip to draw it in, so the promise was only ever half kept. Home
         is a five-face card now (Journal · Urgent · Needs attention ·
         Noticeboard · Tasks), and these two ARE two of those faces.

         Neither loses its door. `NAV` is rows plus subItems and feeds ⌘K, so
         typing "notice" or "action" still finds them; only `NAV_ROWS`, the
         rail, drops them. Same move Leave made onto Timesheet and the catalogue
         onto the Library. The routes stay: posting, moderating and the full board
         all live at /dashboard/notices, which is where the tab's door lands. */
      { key: "home", label: "Home", icon: "dashboard", href: "/dashboard", hint: "Your day at a glance", accent: "#00E5C0",
        subItems: [
          { key: "actionreq", label: "Action required", icon: "alert", href: "/dashboard/action-required", hint: "Everything waiting on you", accent: "#FF3366" },
          { key: "notices", label: "Noticeboard", icon: "note", href: "/dashboard/notices", hint: "Announcements for the team", accent: "#8A2BE2" },
        ] },
      // Second on purpose, right under Home: Home is YOUR day, the Workboard
      // is the BUSINESS's — the two questions anyone opens the app to ask.
      // It lives in Workspace rather than Operations because unlike the rest
      // of that group it defaults to EVERYONE (`workboard` is a staff default).
      { key: "workboard", label: "Workboard", icon: "activity", href: "/dashboard/workboard", hint: "Maintenance & projects command centre", accent: "#00A8E0", capability: "workboard" },
      { key: "toolbox", label: "Toolbox", icon: "wrench", href: "/dashboard/toolbox", hint: "Calculators & references", accent: "#8A2BE2", capability: "toolbox" },
      { key: "ductr", label: "Design", icon: "wind", href: "/dashboard/studio", hint: "VRF design canvas", accent: "#FF8A00", capability: "studio" },
      /* The catalogue rides along as a tab, like Leave does on Timesheet: it is
         the same feature seen from the other end — you ask the library, and the
         library is where the answers come from. One rail row, two faces, and ⌘K
         still lists the catalogue in its own right. Only the FACE is listed
         here; the row itself is the asking surface.

         IT IS CALLED THE LIBRARY, EVERYWHERE — and it is NOT called AI. This
         row said "Tiff AI" over a sparkle, which is the badge every tool in the
         market is wearing this year and the badge people have learned to read
         as "may be making this up". What is actually behind the row is the
         opposite of that: a shelf of documents the company uploaded, and
         answers that cite the page they came from. So the row is named after
         the thing that makes it trustworthy, and the icon is a library rather
         than a sparkle. Tiff is still the one answering — the brand is fine,
         the category label is what was doing the damage.

         The FACE is "All documents", not "Library", because the section is the
         library now: two rows called Library in ⌘K would be exactly the "which
         one is which" tax the last rename paid to clear. All documents is a
         VIEW of the library, not a rival name for it. */
      { key: "tiff", label: "Library", icon: "library", href: "/dashboard/tiff", hint: "Ask your manuals, specs & SOPs", accent: "#2E68FF", capability: "tiff",
        subItems: [
          { key: "tiffkb", label: "All documents", icon: "library", href: "/dashboard/tiff/library", hint: "Every manual, spec & SOP Tiff reads", accent: "#2E68FF" },
        ] },
    ],
  },
  {
    /* Your own things, ungated — everyone has these, only some people manage.
       Sits above Operations for that reason.

       ONE ROW, FIVE FACES. This was five rows (Timesheet+Leave, Vehicle,
       Expenses, Notes) and the rail could not afford them: thirteen rows
       needed 999px of nav against a 733px window, so Operations and Admin sat
       below a fold that `.no-sb` gives no scrollbar to admit. Folding them
       took the rail to 711px, which fits a 13" laptop.

       The group heading used to carry the "my" so the labels didn't repeat it.
       There are no headings any more (sidebar.tsx), so the row carries it
       instead — which is the whole of what "Me" means here. Every face is
       still a real route and still its own ⌘K result. */
    label: "Personal",
    items: [
      { key: "me", label: "Me", icon: "user", href: "/dashboard/my-timesheet", hint: "Your hours, leave, expenses, vehicle & notes", accent: "#2E68FF",
        subItems: [
          { key: "mytimesheet", label: "Timesheet", icon: "clock", href: "/dashboard/my-timesheet", hint: "Your hours & submissions", accent: "#2E68FF" },
          { key: "myleave", label: "Leave", icon: "calendar", href: "/dashboard/my-leave", hint: "Book leave & see balances", accent: "#00A389" },
          // Ungated like the rest of this card: spending your own money on
          // the job and asking for it back is not a privilege.
          { key: "myexpenses", label: "Expenses", icon: "receipt", href: "/dashboard/my-expenses", hint: "Claim money you've spent", accent: "#8A2BE2" },
          { key: "myvehicle", label: "Vehicle", icon: "truck", href: "/dashboard/my-vehicle", hint: "Your vehicle, fuel & issues", accent: "#FF8A00" },
          /* The note cascade's floor, and the whole reason it may be a
             destination at all: a note that couldn't be filed against a job or
             handed to somebody as a task lands here, where its author reads
             it. */
          { key: "mynotes", label: "Notes", icon: "note", href: "/dashboard/my-notes", hint: "Anything that didn't belong to a job", accent: "#007FA8" },
        ] },
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

/* WHERE A SCREEN LIVES, ASKED BY NAME.

   This file already calls itself the single source of truth for the routes,
   and everything that DRAWS the nav reads them from here — but anything else
   linking to a screen wrote the path out by hand, so a route that moved left
   working copies of its old address scattered through the app. A rename that
   updates the rail then looks completely correct: the sidebar goes to the new
   place and the stray links 404, which nobody notices until they press one.

   So a caller that isn't the nav asks for the entry by KEY and gets whatever
   href that entry currently carries. Renaming a route stays a one-line edit
   here, and every asker moves with it.

   IT THROWS ON AN UNKNOWN KEY, deliberately: deleting an entry that something
   still links to fails that caller's test by name, rather than shipping a chip
   whose href is the empty string. */
export function navHref(key: string): string {
  const found = NAV.find((n) => n.key === key);
  if (!found)
    throw new Error(`No nav entry named "${key}" — something is linking to a screen that is gone.`);
  return found.href;
}

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
