import { auth0 } from "@/lib/auth0";
import { todayInAu } from "@/lib/au-dates";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { loadFleetPage } from "@/lib/fleet/page-data";
import { loadMyTimesheet } from "@/lib/timepay/page-data";
import { loadMyLeave } from "@/lib/timepay/leave-page";
import { myClaims } from "@/lib/expenses/query";
import { listArchivedNotes, listMyNotes } from "@/lib/notes/my-notes-query";

/* EVERYTHING THAT IS YOURS, LOADED ONCE.

   The five personal screens are one card with five faces now, so all five
   arrive together and the switch never touches the server — the shape My
   timesheet and My leave already had, widened to the rest of the group. That
   was worth doing for the rail: thirteen rows needed 999px of nav and a 900px
   window drew 733 of it, so the bottom of the list lived below a fold with no
   scrollbar to admit it. Four rows became one.

   THE LOADS ARE INDEPENDENT AND GO OUT TOGETHER, so the cost is the slowest
   one rather than the sum — every query here reads the caller's own rows by
   staff id, which is the cheapest shape a query in this app has.

   NOBODY IS REDIRECTED FOR A MISSING STAFF CARD ANY MORE. My expenses and My
   notes each used to bounce to /dashboard when `staffId` came back null, which
   cannot survive the merge: one absent face would take the other four with it.
   They return empty and their faces say why, which is what the timesheet face
   has always done (`emptybox`, "Your timesheet appears once your card exists
   in Team"). Scoping is unchanged — every read is still by staff id, and a
   null id can match nothing. */

export type MeData = {
  timesheet: Awaited<ReturnType<typeof loadMyTimesheet>>;
  leave: Awaited<ReturnType<typeof loadMyLeave>>;
  fleet: Awaited<ReturnType<typeof loadFleetPage>>;
  claims: Awaited<ReturnType<typeof myClaims>>;
  notes: Awaited<ReturnType<typeof listMyNotes>>;
  archived: Awaited<ReturnType<typeof listArchivedNotes>>;
  /** null = no staff card yet; the faces that need one say so. */
  staffId: string | null;
  today: string;
};

export async function loadMe(period?: string): Promise<MeData> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  const staffId = orgId && userId ? await staffProfileIdFor(orgId, userId) : null;

  const [timesheet, leave, fleet, claims, notes, archived] = await Promise.all([
    loadMyTimesheet(period),
    loadMyLeave(),
    loadFleetPage({ withRegister: false }),
    orgId && staffId ? myClaims(orgId, staffId) : Promise.resolve([]),
    orgId && staffId ? listMyNotes(orgId, staffId) : Promise.resolve([]),
    orgId && staffId ? listArchivedNotes(orgId, staffId) : Promise.resolve([]),
  ]);

  return { timesheet, leave, fleet, claims, notes, archived, staffId, today: todayInAu() };
}
