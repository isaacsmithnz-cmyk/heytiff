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
   up, not new ones), and which ServiceM8 person the viewer is, so a read
   that needs `mineUuid` can ride the batch instead of queueing behind it. */

import { listOrgCredentials, orgExpiryWindow } from "@/lib/org/query";
import type { OrgCredential } from "@/lib/org/credentials";
import type { ExpiryWindow } from "@/lib/expiry";
import type { Capability } from "@/lib/permissions";
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

/** Everything `loadDashboard` already knows when the batch starts. */
export type DeskContext = {
  orgId: string;
  viewerStaffId: string | null;
  caps: ReadonlySet<Capability>;
  isOwner: boolean;
  /** Today in Sydney — timesheets, leave, expiries. */
  today: string;
  /** Today in the ServiceM8 account's zone — the day the bar draws. */
  railDay: string;
  tz: string | null;
  /** Which ServiceM8 person the viewer is, or null when nobody has said. */
  mineUuid: string | null;
  names: StaffNames;
  shared: HomeShared;
};

/** What the new Home carries beyond the old one's data. Null on
    `DashboardData` whenever the viewer is on today's Home. */
export type DeskData = {
  /** The expiry window, in days — the one the bell warns by, so the list's
      rows and the calendar's Due can never disagree with it. */
  warnDays: number;
};

export async function loadDesk(ctx: DeskContext): Promise<DeskData> {
  /* Each area's read joins here as a Promise.all over its own gates. */
  return { warnDays: ctx.shared.expiry.warnDays };
}
