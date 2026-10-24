import { auth0 } from "@/lib/auth0";
import { todayInAu } from "@/lib/au-dates";
import { ExpenseClaims } from "@/components/expenses/expense-claims";
import { jobCandidates } from "@/lib/dashboard/job-candidates";
import { myClaims } from "@/lib/expenses/query";
import { staffProfileIdFor } from "@/lib/fleet/query";

/* EXPENSE CLAIMS (v2): Your name › Expense claims, a page of its own like
   Timesheet. UNGATED — spending your own money on the job and asking for it
   back is intrinsic to being a member of the workspace, not a capability
   someone grants. Reviewing OTHER people's claims is a different screen with
   a different gate (`approvals`); this one only ever reads the caller's own
   rows, by staff id, and a missing staff card matches nothing, so the page
   shows its empty view rather than bouncing anywhere. */
export default async function MyExpensesPage() {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  const staffId = orgId && userId ? await staffProfileIdFor(orgId, userId) : null;
  const [claims, jobs] = await Promise.all([
    orgId && staffId ? myClaims(orgId, staffId) : Promise.resolve([]),
    /* the open work a receipt can be filed against: the SAME list the Tiff
       modal's "Which job is this for?" answers come from */
    orgId ? jobCandidates(orgId) : Promise.resolve([]),
  ]);
  return <ExpenseClaims claims={claims} today={todayInAu()} jobs={jobs} />;
}
