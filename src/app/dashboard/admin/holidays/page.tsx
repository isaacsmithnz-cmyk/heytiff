import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";
import { todayInAu } from "@/lib/au-dates";
import { HolidayManager } from "@/components/timepay/holiday-manager";
import { listOrgHolidays, stateFor } from "@/lib/timepay/leave-query";

/* Admin+, like the section it sits in. The maintenance path for the org's
   public-holiday calendar now that no government feed covers future years. */

export default async function AdminHolidaysPage() {
  const [role, session] = await Promise.all([getDbRole(), auth0.getSession()]);
  if (!hasMinRole(role, "admin")) redirect("/dashboard");
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const today = todayInAu();
  // show this year onward — past holidays are history, not something to manage
  const [holidays, orgState] = await Promise.all([
    listOrgHolidays(orgId, `${today.slice(0, 4)}-01-01`),
    stateFor(orgId, ""),
  ]);

  return <HolidayManager holidays={holidays} orgState={orgState} today={today} />;
}
