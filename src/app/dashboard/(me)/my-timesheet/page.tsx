import { Button } from "@/components/parts/button";
import { Empty } from "@/components/parts/states";
import { MyTimesheet } from "@/components/timepay/my-timesheet";
import { loadMyTimesheet } from "@/lib/timepay/page-data";

/* YOUR TIMESHEET (v2, step 5; the board 6-timesheet): Your name ›
   Timesheet, a page of its own at the address it always had. It loads what
   the timesheet face of the Me card loaded, `loadMyTimesheet`, unchanged:
   the presumed week, and a sheet past its send moment sent on the way in.

   Ungated: your own timesheet is intrinsic, like your own vehicle.
   `timepay_all` gates everyone else's, never this. The period rides in the
   address, so paging through the weeks survives a reload and a shared link. */
export default async function MyTimesheetPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const data = await loadMyTimesheet(period);

  if (!data)
    return (
      <div className="wrap ts2">
        <h1 className="ts2-h1">Timesheet</h1>
        <Empty
          what="No staff card yet"
          line="Your timesheet appears once your card exists in Team."
          action={
            <Button href="/dashboard/profile" kind="second">
              Open your card
            </Button>
          }
        />
      </div>
    );

  if ("subcontractor" in data)
    return (
      <div className="wrap ts2">
        <h1 className="ts2-h1">Timesheet</h1>
        <Empty
          what="Subcontractors don’t keep a timesheet here"
          line="You invoice for your work rather than being paid through the pay run, so there are no hours to send. Send your invoice the way you normally do."
          action={null}
        />
      </div>
    );

  return <MyTimesheet {...data} />;
}
