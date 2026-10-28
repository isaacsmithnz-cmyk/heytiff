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
import { PLACES, placeOn } from "./places";

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
  /** shown to whoever holds any one of these (the Library: Tiff's documents or the field tools) */
  anyOf?: readonly Capability[];
  /** sibling routes shown as tabs on the page rather than rows in the rail */
  subItems?: NavSub[];
};

export type NavGroup = { label: string; items: NavItem[] };

/* THE v2 PLACES, AND YOUR NAME'S MENU (docs/design.md rules 5 and 7;
   places.ts draws the rail from the same, less Design: since 28 October
   2026 the Studio opens from a job's quote, its Design step, and the rail
   has seven places. ⌘K and Tiff still know Design by name, and Tiff is
   told it's where you are while the Studio is open). The screens v2 retired
   (the Workboard, the Toolbox, Time & Pay, Assets, the Noticeboard, Action
   required) are gone from here too, names and all (Isaac, 23 October 2026:
   "Drop them entirely"): ⌘K and Tiff find a place by its v2 name. Their old
   addresses still redirect, for saved links. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Places",
    items: [
      { key: "home", label: "Home", icon: "home", href: "/dashboard", hint: "Your day and what's to do", accent: "#050505" },
      { key: "conversations", label: "Conversations", icon: "chat", href: "/dashboard/conversations", hint: "Talk to Tiff and the team", accent: "#050505", capability: "tiff" },
      { key: "jobs", label: "Jobs", icon: "folder", href: "/dashboard/jobs", hint: "Every job, its quote, visits and money", accent: "#050505", capability: "workboard" },
      { key: "schedule", label: "Schedule", icon: "calendar", href: "/dashboard/schedule", hint: "Who's on which job, by day and week", accent: "#050505", capability: "workboard" },
      { key: "documents", label: "Documents", icon: "file", href: "/dashboard/documents", hint: "SWMS, certificates, letters and handover sheets", accent: "#050505", capability: "workboard" },
      /* the Library's documents and its Toolbox shelf: shown for either */
      { key: "tiffkb", label: "Library", icon: "books", href: "/dashboard/tiff/library", hint: "Manuals, specs, SOPs and the field tools", accent: "#050505", anyOf: ["tiff", "toolbox"] },
      { key: "design", label: "Design", icon: "design", href: "/dashboard/studio", hint: "Design a system on the plans", accent: "#050505", capability: "studio" },
      /* everyone has Team (Isaac, 20 October 2026) */
      { key: "team", label: "Team", icon: "users", href: "/dashboard/team", hint: "People, timesheets, leave, expenses and vehicles", accent: "#050505",
        subItems: [{ key: "notices", label: "Notices", icon: "note", href: "/dashboard/team?view=notices", hint: "Announcements for the team", accent: "#050505" }] },
    ],
  },
  {
    label: "Yours",
    items: [
      { key: "card", label: "Your card", icon: "user", href: "/dashboard/profile", hint: "Your details and papers", accent: "#050505" },
      { key: "timesheet", label: "Timesheet", icon: "clock", href: "/dashboard/my-timesheet", hint: "Your hours and submissions", accent: "#050505" },
      { key: "leave", label: "Leave", icon: "calendar", href: "/dashboard/my-leave", hint: "Book leave and see balances", accent: "#050505" },
      { key: "expenses", label: "Expense claims", icon: "receipt", href: "/dashboard/my-expenses", hint: "Claim money you've spent", accent: "#050505" },
      /* your vehicle's own page, and your own notes (Isaac, 24 October 2026:
         the old Me card's faces each become a page under your name) */
      { key: "myvehicle", label: "Your vehicle", icon: "car", href: "/dashboard/my-vehicle", hint: "The vehicle you drive", accent: "#050505" },
      { key: "mynotes", label: "Notes", icon: "note", href: "/dashboard/my-notes", hint: "Your own notes, only you see them", accent: "#050505" },
      /* job money follows `workboard_money` (docs/job-analytics-plan.md), and
         Tax and EOFY, the business's own, `financials`: shown for either */
      { key: "reports", label: "Reports", icon: "gauge", href: "/dashboard/analytics", hint: "Win rate, prices, quotes, tax and EOFY", accent: "#050505", anyOf: ["workboard_money", "financials"] },
      { key: "settings", label: "Settings", icon: "settings", href: "/dashboard/admin", hint: "The business, its people and its settings", accent: "#050505", minRole: "admin" },
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
/** Every entry, rows and their faces, once each, for every viewer: the names
    Tiff may be asked for. A row's first face is usually the row itself
    (Home's faces start with Home), so a name is kept the first time it
    appears. What a given viewer may open is still `navFor`. */
export const ALL_SCREENS: NavItem[] = NAV.flatMap((n) => [n, ...(n.subItems ?? [])]).filter(
  (n, i, all) => all.findIndex((m) => m.label === n.label) === i
);

/** Other words people use for a screen, squashed as `squash` squashes them.
    Tiff's move test and `open_screen` read these; a label is always its own
    alias. */
export const SCREEN_ALIASES: Readonly<Record<string, string>> = {
  dashboard: "Home",
  home: "Home",
  chat: "Conversations",
  chats: "Conversations",
  mynotes: "Notes",
  myvehicle: "Your vehicle",
  myhours: "Timesheet",
  hours: "Timesheet",
  mytimesheet: "Timesheet",
  expenses: "Expense claims",
  myexpenses: "Expense claims",
  mycard: "Your card",
  profile: "Your card",
  analytics: "Reports",
  admin: "Settings",
  notices: "Notices",
  library: "Library",
  manuals: "Library",
  studio: "Design",
};

/** A screen name as people say it: lowercase, "&" read as "and", and
    spaces, hyphens and punctuation gone, so "work board", "Workboard." and
    "WORKBOARD" are one word, and "time and pay" is Time & Pay. */
export const squash = (s: string) =>
  s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

export type NavViewer = { caps: ReadonlySet<Capability>; role: Role | null };

function visible(n: NavItem, viewer: NavViewer): boolean {
  if (n.capability && !viewer.caps.has(n.capability)) return false;
  if (n.anyOf && !n.anyOf.some((c) => viewer.caps.has(c))) return false;
  if (n.minRole && !hasMinRole(viewer.role, n.minRole)) return false;
  return true;
}

/** Entries this viewer may see, tabbed faces included — what ⌘K searches.
    Faces are expanded AFTER their parent is filtered, so one that has been
    folded in can never outlive the entry that gates it. */
export function navFor(viewer: NavViewer): NavItem[] {
  return NAV_ROWS.filter((n) => visible(n, viewer)).flatMap((n) => [n, ...(n.subItems ?? [])]);
}

/** /dashboard is an exact match; the rest match by prefix. */
function onHref(href: string, pathname: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

/** The screen a pathname is on, by its nav name: the entry, row or face,
    whose own link is the longest that matches. Where a row and its face share
    a link (Me and Timesheet), the face wins, being the more exact name.
    "" off the nav. Shared by the Tiff modal's header and the page Tiff is
    told about. */
export function screenLabelFor(pathname: string): string {
  let best: NavItem | null = null;
  for (const n of ALL_SCREENS) {
    if (!onHref(n.href, pathname)) continue;
    if (!best || n.href.length >= best.href.length) best = n;
  }
  /* a page a place has taken in (a project, a quote at its old address) is that place's */
  return best?.label ?? PLACES.find((p) => placeOn(p, pathname))?.label ?? "";
}
