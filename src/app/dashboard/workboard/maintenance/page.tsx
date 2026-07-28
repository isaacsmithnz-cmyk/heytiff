import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { auth0 } from "@/lib/auth0";
import { ensureVisits } from "@/lib/workboard/visit-ensure";
import { listAgreements } from "@/lib/workboard/maintenance-query";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { MaintenanceScreen } from "@/components/workboard/maintenance-screen";

/* The agreements list. Ensure-on-read runs INLINE here (it's bounded and
   insert-only): opening this page is exactly the moment the horizon should
   be topped up, and a list that then reads stale would be lying about the
   thing it just fixed. */

export default async function WorkboardMaintenancePage() {
  if (!(await can("workboard"))) redirect("/dashboard");

  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const today = todayInZone(await getSm8Timezone(orgId));
  await ensureVisits(orgId, { today });

  const [agreements, manage] = await Promise.all([
    listAgreements(orgId, today),
    can("workboard_manage"),
  ]);

  return <MaintenanceScreen agreements={agreements} manage={manage} today={today} />;
}
