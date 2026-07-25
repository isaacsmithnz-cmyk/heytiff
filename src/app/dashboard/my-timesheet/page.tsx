import { MyTimesheet } from "@/components/timepay/my-timesheet";
import { loadMyTimesheet } from "@/lib/timepay/page-data";

/* Ungated: your own timesheet is intrinsic, like your own vehicle.
   `timepay_all` gates everyone else's, never this. */

export default async function MyTimesheetPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const data = await loadMyTimesheet(period);

  if (!data) {
    return (
      <div className="page in">
        <div className="wrap">
          <div className="stg">
            <div className="emptybox">
              <b>No staff record yet</b>
              <em>Your timesheet appears once your card exists in Team.</em>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <MyTimesheet
      me={data.me}
      week={data.week}
      today={data.today}
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
