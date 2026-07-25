import { redirect } from "next/navigation";
import { can, getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";
import { TimePay } from "@/components/timepay/timepay";
import { loadTimepay } from "@/lib/timepay/page-data";
import { loadHolidayManager } from "@/lib/timepay/leave-page";

/* Capability-gated: this is the EVERYONE view. Your own timesheet lives at
   /dashboard/my-timesheet and is never gated.

   `financials` decides whether the query selects the wage column at all — so
   without it this screen is hours-only for everyone, INCLUDING the viewer's
   own row. Your own figures live on My timesheet; this screen is about other
   people, so it stays uniformly money-free rather than showing one row
   differently.

   The settings gear serves two audiences: pay settings need `financials`,
   the public-holiday calendar needs admin+ (it's the org's operational
   calendar, same tier as the old admin page it replaced). Either unlocks the
   gear; each section gates itself inside. */

export default async function TimePayPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  if (!(await can("timepay_all"))) redirect("/dashboard/my-timesheet");

  const [{ period }, pay, approvals, role] = await Promise.all([
    searchParams,
    can("financials"),
    can("approvals"),
    getDbRole(),
  ]);
  const canHolidays = hasMinRole(role, "admin");
  const [data, holidayData] = await Promise.all([
    loadTimepay({ pay }, period),
    canHolidays ? loadHolidayManager() : Promise.resolve(null),
  ]);
  if (!data) redirect("/dashboard");

  return (
    <TimePay
      staff={data.staff}
      week={data.week}
      today={data.today}
      periods={data.periods}
      periodIndex={data.periodIndex}
      settings={data.settings}
      configured={data.configured}
      sheets={data.sheets}
      canApprove={approvals}
      financials={pay}
      holidayData={holidayData}
    />
  );
}
