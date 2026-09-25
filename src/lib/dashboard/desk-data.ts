/* THE NEW HOME'S READS — one door, behind the flag (./desk-flag).

   Six areas are being built into the new Home — the day, the diary, the
   list, tasks, the calendar and Tiff — and every one of them needs
   something the old Home never read. Left to themselves they would each
   edit `loadDashboard`'s Promise.all, and two of them would read the same
   rows again: the list and the calendar both place things by the expiry
   window, and the calendar draws the org's credentials the bell already
   reads.

   So there is one door. `loadDashboard` calls `loadDesk` only when the
   viewer gets the new Home, inside the batch it already waits on, so the
   crew on today's Home pay for nothing here. Each area adds ONE field to
   `DeskData` and its read to `loadDesk`, and takes what it shares from the
   context rather than asking again.

   WHAT IS SHARED is read once, for everyone, before that batch: the expiry
   window and the org's credentials (which the bell's chips were already
   reading for themselves — `readHomeShared` is those same two reads moved
   up, not new ones). Which ServiceM8 person the viewer is comes from the
   link map, which is two reads in a row and so is NOT waited for before the
   batch: `loadDesk` starts with the batch and is handed the map's answer
   still coming (`mine`). A read that takes the whole context, `mineUuid`
   and all, waits for it; a read that asks nothing of it starts at once.

   The calendar asks nothing of it, and its own reads are two in a row (the
   workspace's state, then its holidays): started behind the map it was
   the page's slowest path by a round trip. The list is handed the whole
   context, as the areas still to come will be (the diary asks who the
   viewer is), and so goes once the map is in, which costs the page
   nothing: the map and the list's one read are back by the time the
   calendar's two are. */

import { loadCompanyCalendar } from "@/lib/calendar/query";
import type { CompanyCalendar } from "@/lib/calendar/items";
import { listOrgCredentials, orgExpiryWindow } from "@/lib/org/query";
import type { OrgCredential } from "@/lib/org/credentials";
import type { ExpiryWindow } from "@/lib/expiry";
import type { Capability } from "@/lib/permissions";
import { initialsFrom } from "@/lib/staff/derive";
import { taskOwners, type DeskDiary } from "./diary-doors";
import { loadDiaryFeed } from "./diary-query";
import { firstNames, type HomeListReads } from "./home-list";
import { loadHomeList } from "./home-list-query";
import type { StaffNames } from "./tasks-query";

/** The reads Home's chips and the new Home's areas share. */
export type HomeShared = {
  /** ONE NUMBER for every dated row on the page — lib/expiry.ts. */
  expiry: ExpiryWindow;
  /** Every one of the org's credentials — read for the OWNER only, the one
      person the Organisation screen admits; empty for anyone else. */
  orgCredentials: OrgCredential[];
};

export async function readHomeShared(orgId: string, isOwner: boolean): Promise<HomeShared> {
  const [expiry, orgCredentials] = await Promise.all([
    orgExpiryWindow(orgId),
    isOwner ? listOrgCredentials(orgId) : Promise.resolve([] as OrgCredential[]),
  ]);
  return { expiry, orgCredentials };
}

/** Everything `loadDashboard` knows when the batch starts, plus `mineUuid`,
    which is in once the link map is. */
export type DeskContext = DeskStart & {
  /** Which ServiceM8 person the viewer is, or null when nobody has said. */
  mineUuid: string | null;
};

/** Everything `loadDashboard` knows when the batch starts. */
export type DeskStart = {
  orgId: string;
  viewerStaffId: string | null;
  caps: ReadonlySet<Capability>;
  isOwner: boolean;
  /** Today in Sydney — timesheets, leave, expiries. */
  today: string;
  /** Today in the ServiceM8 account's zone — the day the bar draws. */
  railDay: string;
  tz: string | null;
  names: StaffNames;
  shared: HomeShared;
  /** Does the workspace hold a ServiceM8 copy at all — `sm8VendorOf`'s
      answer, which the page already reads for the day. Never guessed from
      the zone: an account row can carry none. */
  connected: boolean;
};

/** What the new Home carries beyond the old one's data. Null on
    `DashboardData` whenever the viewer is on today's Home. */
export type DeskData = {
  /** The expiry window, in days — the one the bell warns by, so the list's
      rows and the calendar's Due can never disagree with it. */
  warnDays: number;
  /** The right-hand list's own reads — the won jobs never booked and the
      visits with no day — placed on screen beside what the page already
      holds (`placeHomeList`, ./home-list). */
  list: HomeListReads;
  /** The Calendar face: the company's twelve months — public and school
      holidays, events and shutdowns, the noticeboard's events, and the
      renewals the viewer may see — on the workspace's day
      (lib/calendar/query). */
  calendar: CompanyCalendar;
  /** The Diary tab: your entries, newest first, with Today split off, and
      what it needs to say them — your initials, and the first names of the
      people their tasks are on (./diary-doors). */
  diary: DeskDiary;
};

export async function loadDesk(start: DeskStart, mine: Promise<string | null>): Promise<DeskData> {
  /** The whole context, once the link map is in. */
  const ctx = mine.then((mineUuid): DeskContext => ({ ...start, mineUuid }));
  /* Each area's read joins here as a Promise.all over its own gates. */
  const [list, calendar, diary] = await Promise.all([
    ctx.then(loadHomeList),
    loadCompanyCalendar(start),
    ctx.then(loadDeskDiary),
  ]);
  return { warnDays: start.shared.expiry.warnDays, list, calendar, diary };
}

/* THE DIARY, YOUR OWN ENTRIES FOR NOW. The ServiceM8 notes that @mention
   you come onto the page with their conversations (the Diary spec's second
   PR), and until then they are not read at all: a read the page cannot
   show would cost round trips, and would cut the column at the mentions'
   horizon (diary-feed's ONE HORIZON) for a source nobody can see. So the
   feed is asked as for a viewer with no ServiceM8 person — which is exactly
   the diary every viewer without one gets. */
async function loadDeskDiary(ctx: DeskContext): Promise<DeskDiary> {
  const feed = await loadDiaryFeed({ ...ctx, mineUuid: null });
  const first = firstNames(ctx.names);
  const names: Record<string, string> = {};
  for (const id of taskOwners(feed)) if (first[id]) names[id] = first[id];
  return {
    feed,
    you: initialsFrom(ctx.viewerStaffId ? ctx.names.get(ctx.viewerStaffId) : null),
    names,
  };
}
