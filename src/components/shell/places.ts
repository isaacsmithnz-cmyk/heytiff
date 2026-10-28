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
  /** shown to whoever holds any one of these (the Library: Tiff's documents or the field tools) */
  anyOf?: readonly Capability[];
  minRole?: Role;
  /** only for someone with a vehicle assigned to them (Your vehicle) */
  needsVehicle?: true;
};

export const PLACES: readonly Place[] = [
  /* To do's whole list, and the old desk (Diary, Tasks and the Calendar)
     until Conversations and Schedule take them in, are Home's */
  {
    key: "home",
    label: "Home",
    icon: "home",
    href: "/dashboard",
    under: ["/dashboard/todo", "/dashboard/feed", "/dashboard/desk", "/dashboard/action-required", "/dashboard/notices"],
  },
  /* a job's own page (step 5) lights Jobs before the list has a page */
  { key: "conversations", label: "Conversations", icon: "chat", href: "/dashboard/conversations", under: ["/dashboard/my-notes"], capability: "tiff" },
  /* the board's own pages (a project, a quote, the maintenance side, a job's card by `?job=`) are the Jobs place's: Jobs has their views */
  { key: "jobs", label: "Jobs", icon: "folder", href: "/dashboard/jobs", under: ["/dashboard/workboard"], capability: "workboard" },
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
  /* the field tools are the Library's Toolbox shelf; their own pages light it */
  { key: "library", label: "Library", icon: "books", href: "/dashboard/tiff/library", under: ["/dashboard/tiff", "/dashboard/toolbox"], anyOf: ["tiff", "toolbox"] },
  { key: "design", label: "Design", icon: "design", href: "/dashboard/studio", under: [], capability: "studio" },
  /* Time & Pay and Assets moved into Team (its Timesheets, Leave, Expenses and Vehicles views); their old addresses still light it */
  /* everyone has Team (Isaac, 20 October 2026); without `team` it is the colleagues' names and mobiles and the notices */
  { key: "team", label: "Team", icon: "users", href: "/dashboard/team", under: ["/dashboard/timepay", "/dashboard/assets", "/dashboard/vehicles"] },
];

/** Today's screens that keep a row until their v2 place takes them in. */
/* Empty since 20 October: the Workboard's views are Jobs' and Schedule's,
   the Toolbox is the Library's shelf. */
export const STILL_TO_MOVE: readonly Place[] = [];

/** Your name's menu (rule 7), in its order, then Sign out. */
export const YOURS: readonly Place[] = [
  { key: "card", label: "Your card", icon: "user", href: "/dashboard/profile", under: [] },
  { key: "timesheet", label: "Timesheet", icon: "clock", href: "/dashboard/my-timesheet", under: [] },
  { key: "leave", label: "Leave", icon: "calendar", href: "/dashboard/my-leave", under: [] },
  { key: "expenses", label: "Expense claims", icon: "receipt", href: "/dashboard/my-expenses", under: [] },
  /* the old Me card's last two faces, each a page of its own (24 October 2026) */
  { key: "myvehicle", label: "Your vehicle", icon: "car", href: "/dashboard/my-vehicle", under: [], needsVehicle: true },
  { key: "mynotes", label: "Notes", icon: "note", href: "/dashboard/my-notes", under: [] },
  /* the jobs' money opens its three views, the business's money Tax and EOFY (rule 7) */
  { key: "reports", label: "Reports", icon: "gauge", href: "/dashboard/analytics", under: [], anyOf: ["workboard_money", "financials"] },
  { key: "settings", label: "Settings", icon: "settings", href: "/dashboard/admin", under: [], minRole: "admin" },
];

export function placesFor(
  list: readonly Place[],
  viewer: { caps: ReadonlySet<Capability>; role: Role | null; hasVehicle?: boolean },
): Place[] {
  return list.filter(
    (p) =>
      (!p.needsVehicle || !!viewer.hasVehicle) &&
      (!p.capability || viewer.caps.has(p.capability)) &&
      (!p.anyOf || p.anyOf.some((c) => viewer.caps.has(c))) &&
      (!p.minRole || (viewer.role !== null && hasMinRole(viewer.role, p.minRole))),
  );
}

/** Is this place the one you're on? Home only on its own address. */
export function placeOn(p: Place, pathname: string): boolean {
  const at = (prefix: string) => pathname === prefix || pathname.startsWith(prefix + "/");
  if (p.href === "/dashboard") return pathname === "/dashboard" || p.under.some(at);
  return at(p.href) || p.under.some(at);
}
