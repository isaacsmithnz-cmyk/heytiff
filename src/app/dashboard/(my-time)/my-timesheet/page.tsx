import { MyTimesheet } from "@/components/timepay/my-timesheet";
import { loadMyTimesheet } from "@/lib/timepay/page-data";

/* Ungated: your own timesheet is intrinsic, like your own vehicle.
   `timepay_all` gates everyone else's, never this.

   The heading, the tabs and the page frame belong to `(my-time)/layout.tsx`
   now — including on the empty states, which is not decoration. This route is
   the only rail entry the pair has, so a subcontractor — who never gets past
   the "no timesheet here" branch — would otherwise have no way to reach their
   leave but ⌘K. Previously each branch had to remember to draw the tabs; now
   none of them can forget. */

export default async function MyTimesheetPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const data = await loadMyTimesheet(period);

  if (!data) {
    return (
      <div className="emptybox">
        <b>No staff record yet</b>
        <em>Your timesheet appears once your card exists in Team.</em>
      </div>
    );
  }

  /* A subcontractor has no timesheet, and says so plainly rather than showing
     an empty week that looks like something to fill in. */
  if ("subcontractor" in data) {
    return (
      <div className="emptybox">
        <b>Subcontractors don&rsquo;t keep a timesheet here</b>
        <em>
          You invoice for your work rather than being paid through the pay run, so there are no
          hours to submit. Send your invoice the way you normally do.
        </em>
      </div>
    );
  }

  return (
    <MyTimesheet
      me={data.me}
      sources={data.sources}
      normal={data.normal}
      ownNormal={data.ownNormal}
      workDays={data.workDays}
      ownWorkDays={data.ownWorkDays}
      employment={data.employment}
      salaried={data.salaried}
      unavailable={data.unavailable}
      week={data.week}
      today={data.today}
      through={data.through}
      todayISO={data.todayISO}
      periodStart={data.periodStart}
      periods={data.periods}
      periodIndex={data.periodIndex}
      settings={data.settings}
      sheet={data.sheet}
      holidays={data.holidays}
      state={data.state}
    />
  );
}
