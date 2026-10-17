import { Suspense } from "react";
import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { loadJobsList } from "@/lib/workboard/jobs-list-query";
import { readListState } from "@/lib/workboard/jobs-list";
import { JobsList } from "@/components/jobs/jobs-list";
import { Loading } from "@/components/parts/states";

/* JOBS, the list (v2, step 5; docs/plans/layout-2026-10, the board
   v2-board-jobs). Today's Workboard All jobs, Projects and Maintenance
   lists as one table with seven views. Gated like the Workboard, by
   `workboard`, here because a leaf route is deep-linkable. The view, the
   person, the sort and the search ride in the address, so a tab holds them.

   The wait is the page's own Suspense, not a loading.tsx, so a job's page
   under /dashboard/jobs/ never waits behind the list's skeleton (rule 41:
   nothing for half a second, then rows). */

type Params = Promise<Record<string, string | string[] | undefined>>;

async function JobsBody({ searchParams }: { searchParams: Params }) {
  const data = await loadJobsList();
  if (!data) redirect("/dashboard");
  const initial = readListState(await searchParams, data.moneyVisible);
  return <JobsList data={data} initial={initial} />;
}

export default async function JobsPage({ searchParams }: { searchParams: Params }) {
  if (!(await can("workboard"))) redirect("/dashboard");
  return (
    <Suspense
      fallback={
        <div className="jl">
          <Loading what="Loading jobs" shape="rows" count={8} />
        </div>
      }
    >
      <JobsBody searchParams={searchParams} />
    </Suspense>
  );
}
