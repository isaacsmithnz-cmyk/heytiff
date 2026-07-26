import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { TeamExpenses } from "@/components/timepay/team-expenses";
import { teamClaims } from "@/lib/expenses/query";

/* The Expenses face of team Time & Pay — same `timepay_all` gate as the other
   two faces. Your own claims live at /dashboard/my-expenses and are never
   gated.

   Two capabilities cross to the client, and they are genuinely different
   questions: `approvals` decides whether a spend was legitimate, `financials`
   records that the money moved. Someone can hold the first without the second,
   which is exactly the split docs/roles-and-permissions.md describes — a
   manager approves amounts without ever reaching payroll.

   No wage column is read anywhere in this path; an approver sees what was
   spent, never what anyone earns. */

export default async function TeamExpensesPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await can("timepay_all"))) redirect("/dashboard/my-expenses");

  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [claims, approvals, financials] = await Promise.all([
    teamClaims(orgId),
    can("approvals"),
    can("financials"),
  ]);

  return <TeamExpenses claims={claims} canApprove={approvals} canPay={financials} />;
}
