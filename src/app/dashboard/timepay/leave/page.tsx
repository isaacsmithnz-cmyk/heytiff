import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { TeamLeave } from "@/components/timepay/team-leave";
import { loadTeamLeave } from "@/lib/timepay/leave-page";

/* The Leave face of team Time & Pay — same gate as the timesheets face. Your
   own leave lives at /dashboard/my-leave and is never gated. */

export default async function TeamLeavePage() {
  if (!(await can("timepay_all"))) redirect("/dashboard/my-leave");

  // Balances are an HR figure (hours, never dollars): setting one needs `team`,
  // same as the action re-checks for itself.
  /* `approvals` is resolved BEFORE the load, because it decides whether the
     pending rows carry their medical certificates at all — see loadTeamLeave.
     Sequential on purpose: one extra round trip is the price of not shipping
     health information to a viewer who can't act on it. */
  const approvals = await can("approvals");
  const [data, team] = await Promise.all([loadTeamLeave(approvals), can("team")]);
  if (!data) redirect("/dashboard");

  return (
    <TeamLeave
      pending={data.pending}
      calendar={data.calendar}
      balances={data.balances}
      canApprove={approvals}
      canManage={team}
    />
  );
}
