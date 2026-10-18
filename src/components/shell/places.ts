/* THE SIDEBAR'S PLACES (docs/design.md rules 5 and 7).

   v2 has eight places: Home, Conversations, Jobs, Schedule, Documents,
   Library, Design, Team. Each points at its own page, or at the screen that
   does its job today until step 5 builds its page, and lights up on every
   route that will move into it. A place with no screen yet is left out
   rather than drawn as a dead row; it joins when its page lands.

   The screens v2 moves somewhere else (the Workboard into Schedule, Toolbox
   into the Library, Time & Pay and Assets into Team) keep a row of their own under the places until their
   step-5 page takes them in, so nothing a person uses today goes missing on
   the way. Each of those rows goes in the change that moves its screen.

   `nav.ts` stays the source for ⌘K, `navHref` and Tiff's screens; this file
   only decides what the rail draws. */

import { hasMinRole, type Role } from "@/lib/roles-shared";
import type { Capability } from "@/lib/permissions";

export type Place = {
  key: string;
  label: string;
  icon: string;
  href: string;
  /** Route prefixes that light this place. `href` is always one. */
  under: readonly string[];
  capability?: Capability;
  minRole?: Role;
};

export const PLACES: readonly Place[] = [
  /* To do's whole list, and the old desk (Diary, Tasks and the Calendar)
     until Conversations and Schedule take them in, are Home's */
  {
    key: "home",
    label: "Home",
    icon: "home",
    href: "/dashboard",
    under: ["/dashboard/todo", "/dashboard/desk", "/dashboard/action-required", "/dashboard/notices"],
  },
  /* a job's own page (step 5) lights Jobs before the list has a page */
  { key: "conversations", label: "Conversations", icon: "chat", href: "/dashboard/conversations", under: ["/dashboard/my-notes"], capability: "tiff" },
  { key: "jobs", label: "Jobs", icon: "folder", href: "/dashboard/jobs", under: [], capability: "workboard" },
  { key: "schedule", label: "Schedule", icon: "calendar", href: "/dashboard/schedule", under: [], capability: "workboard" },
  /* the Workboard's gate, which is the SWMS', the certificates' and the
     handover sheets' today; a SWMS's sign-on and a letter's editor are
     Documents' too */
  {
    key: "documents",
    label: "Documents",
    icon: "file",
    href: "/dashboard/documents",
    under: ["/dashboard/swms", "/dashboard/admin/letters"],
    capability: "workboard",
  },
  /* the Library lands on its documents (v2, step 5); asking it, today's
     /dashboard/tiff, is still the Library's */
  { key: "library", label: "Library", icon: "books", href: "/dashboard/tiff/library", under: ["/dashboard/tiff"], capability: "tiff" },
  { key: "design", label: "Design", icon: "design", href: "/dashboard/studio", under: [], capability: "studio" },
  /* Time & Pay and Assets moved into Team (its Timesheets, Leave, Expenses and Vehicles views); their old addresses still light it */
  { key: "team", label: "Team", icon: "users", href: "/dashboard/team", under: ["/dashboard/timepay", "/dashboard/assets", "/dashboard/vehicles"], capability: "team" },
];

/** Today's screens that keep a row until their v2 place takes them in. */
export const STILL_TO_MOVE: readonly Place[] = [
  /* the board keeps its row until Schedule (its day, its weeks, its display) is rebuilt */
  { key: "workboard", label: "Workboard", icon: "activity", href: "/dashboard/workboard", under: [], capability: "workboard" },
  { key: "toolbox", label: "Toolbox", icon: "wrench", href: "/dashboard/toolbox", under: [], capability: "toolbox" },
];

/** Your name's menu (rule 7), in its order, then Sign out. */
export const YOURS: readonly Place[] = [
  { key: "card", label: "Your card", icon: "user", href: "/dashboard/profile", under: [] },
  { key: "timesheet", label: "Timesheet", icon: "clock", href: "/dashboard/my-timesheet", under: [] },
  { key: "leave", label: "Leave", icon: "calendar", href: "/dashboard/my-leave", under: [] },
  { key: "expenses", label: "Expense claims", icon: "receipt", href: "/dashboard/my-expenses", under: [] },
  { key: "reports", label: "Reports", icon: "gauge", href: "/dashboard/analytics", under: [], capability: "workboard_money" },
  { key: "settings", label: "Settings", icon: "settings", href: "/dashboard/admin", under: [], minRole: "admin" },
];

export function placesFor(list: readonly Place[], viewer: { caps: ReadonlySet<Capability>; role: Role | null }): Place[] {
  return list.filter(
    (p) =>
      (!p.capability || viewer.caps.has(p.capability)) &&
      (!p.minRole || (viewer.role !== null && hasMinRole(viewer.role, p.minRole))),
  );
}

/** Is this place the one you're on? Home only on its own address. */
export function placeOn(p: Place, pathname: string): boolean {
  const at = (prefix: string) => pathname === prefix || pathname.startsWith(prefix + "/");
  if (p.href === "/dashboard") return pathname === "/dashboard" || p.under.some(at);
  return at(p.href) || p.under.some(at);
}
