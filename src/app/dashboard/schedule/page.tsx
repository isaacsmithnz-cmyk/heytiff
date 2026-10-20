import { Suspense } from "react";
import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { loadSchedulePage } from "@/lib/schedule/schedule-page-query";
import { ScheduleBoard } from "@/components/schedule/schedule-board";
import { Loading } from "@/components/parts/states";

/* SCHEDULE (v2, step 5; docs/plans/layout-2026-10/6-revisions.md, 18
   October). A row per person, time across, for a day or a week, and Jobs on
   the right: drag a job onto someone's row to book them. Gated like the
   Workboard, by `workboard`. The view and the day ride in the address, so a
   tab holds them. */

type Params = Promise<Record<string, string | string[] | undefined>>;

async function ScheduleBody({ searchParams }: { searchParams: Params }) {
  const data = await loadSchedulePage(await searchParams);
  if (!data) redirect("/dashboard");
  return <ScheduleBoard key={`${data.view}:${data.day}`} data={data} />;
}

export default async function SchedulePage({ searchParams }: { searchParams: Params }) {
  if (!(await can("workboard"))) redirect("/dashboard");
  return (
    <Suspense
      fallback={
        <div className="sc">
          <Loading what="Loading the schedule" shape="rows" count={6} />
        </div>
      }
    >
      <ScheduleBody searchParams={searchParams} />
    </Suspense>
  );
}
