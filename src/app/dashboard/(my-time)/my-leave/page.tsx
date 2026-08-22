import { MyTimeScreen } from "@/components/timepay/my-time-screen";
import { loadMyTimesheet } from "@/lib/timepay/page-data";
import { loadMyLeave } from "@/lib/timepay/leave-page";

/* Ungated: your own leave is intrinsic, like your timesheet and vehicle.

   Same combined load as /dashboard/my-timesheet — this route only picks the
   Leave face first. Both URLs stay real (the rail links here, `requestLeave`
   revalidates both); the shell keeps whichever is open in the address bar. */

export default async function MyLeavePage() {
  const [timesheet, leave] = await Promise.all([loadMyTimesheet(), loadMyLeave()]);

  return <MyTimeScreen initialTab="leave" timesheet={timesheet} leave={leave} />;
}
