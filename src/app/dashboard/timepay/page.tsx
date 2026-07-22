import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { TimePay } from "@/components/timepay/timepay";
import { loadTimepay } from "@/lib/timepay/page-data";

/* Capability-gated: this is the EVERYONE view. Your own timesheet lives at
   /dashboard/my-timesheet and is never gated.

   `financials` decides whether the query selects the wage column at all — so
   without it this screen is hours-only for everyone, INCLUDING the viewer's
   own row. Your own figures live on My timesheet; this screen is about other
   people, so it stays uniformly money-free rather than showing one row
   differently. */

export default async function TimePayPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  if (!(await can("timepay_all"))) redirect("/dashboard/my-timesheet");

  const [{ period }, pay, approvals] = await Promise.all([
    searchParams,
    can("financials"),
    can("approvals"),
  ]);
  const data = await loadTimepay({ pay }, period);
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
    />
  );
}
