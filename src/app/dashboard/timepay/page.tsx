import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { TimePay } from "@/components/timepay/timepay";
import {
  demoTimepayPeriods,
  demoTimepayStaff,
  demoTimepayToday,
  demoTimepayWeek,
} from "@/mock/demo";

// Capability-gated: this is the EVERYONE view — all staff timesheets, hourly
// rates and gross pay. `timepay_all` defaults to admin+; your own timesheet
// lives at /dashboard/my-timesheet (intrinsic, never gated) when it's built.

export default async function TimePayPage() {
  if (!(await can("timepay_all"))) redirect("/dashboard");

  return (
    <TimePay
      staff={demoTimepayStaff}
      week={demoTimepayWeek}
      today={demoTimepayToday}
      periods={demoTimepayPeriods}
    />
  );
}
