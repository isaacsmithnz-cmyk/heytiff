import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { loadJobsList } from "@/lib/workboard/jobs-list-query";
import { readListState } from "@/lib/workboard/jobs-list";
import { JobsList } from "@/components/jobs/jobs-list";

/* JOBS, the list (v2, step 5; docs/plans/layout-2026-10, the board
   v2-board-jobs). Today's Workboard All jobs, Projects and Maintenance
   lists as one table with seven views. Gated like the Workboard, by
   `workboard`, here because a leaf route is deep-linkable. The view, the
   person, the sort and the search ride in the address, so a tab holds them.

   The wait is the route's own, dashboard/loading.tsx: Tiff's mark and
   nothing after it (rule 41). No loading.tsx here, so a job's page under
   /dashboard/jobs/ never waits behind the list's; and no Suspense of its
   own, which put a skeleton after the mark (Isaac, 25 October 2026). */

type Params = Promise<Record<string, string | string[] | undefined>>;

export default async function JobsPage({ searchParams }: { searchParams: Params }) {
  if (!(await can("workboard"))) redirect("/dashboard");
  const data = await loadJobsList();
  if (!data) redirect("/dashboard");
  const initial = readListState(await searchParams, data.moneyVisible);
  return <JobsList data={data} initial={initial} />;
}
