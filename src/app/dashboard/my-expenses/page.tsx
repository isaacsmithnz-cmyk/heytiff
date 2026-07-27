import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { todayInAu } from "@/lib/au-dates";
import { myClaims } from "@/lib/expenses/query";
import { MyExpenses } from "@/components/expenses/my-expenses";

/* Your own expense claims. UNGATED, like My timesheet and My leave — spending
   your own money on the job and asking for it back is intrinsic to being a
   member of the workspace, not a capability someone grants.

   Reviewing OTHER people's claims is a different screen with a different gate
   (`approvals`); this one only ever reads the caller's own rows. */

export default async function MyExpensesPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  const orgId = session.orgId as string | undefined;
  const userId = session.user?.sub as string | undefined;
  if (!orgId || !userId) redirect("/dashboard");

  const staffId = await staffProfileIdFor(orgId, userId);
  // No staff card yet (a brand-new membership mid-provision) — the dashboard
  // creates one on demand, so send them there rather than showing a broken page.
  if (!staffId) redirect("/dashboard");

  return <MyExpenses claims={await myClaims(orgId, staffId)} today={todayInAu()} />;
}
