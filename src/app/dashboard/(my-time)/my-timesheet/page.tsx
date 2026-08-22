import { MyTimeScreen } from "@/components/timepay/my-time-screen";
import { loadMyTimesheet } from "@/lib/timepay/page-data";
import { loadMyLeave } from "@/lib/timepay/leave-page";

/* Ungated: your own timesheet is intrinsic, like your own vehicle.
   `timepay_all` gates everyone else's, never this.

   BOTH FACES LOAD HERE. Timesheet and Leave used to be served one at a time
   and joined by route-navigation tabs; a tab click was a server round trip
   that read as a page reload next to Team's instant switcher. The two loads
   are independent and go out together, and the shell switches faces without
   the server — see my-time-screen.tsx for the URL contract. */

export default async function MyTimesheetPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const [timesheet, leave] = await Promise.all([loadMyTimesheet(period), loadMyLeave()]);

  return <MyTimeScreen initialTab="timesheet" timesheet={timesheet} leave={leave} />;
}
