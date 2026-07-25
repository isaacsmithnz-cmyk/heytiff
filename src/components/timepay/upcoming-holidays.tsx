import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { upcomingHolidays } from "@/lib/timepay/leave";

/* The one upcoming-public-holidays panel, shared by My timesheet and My leave
   so the two screens can't disagree about what's coming. The loaders feed it
   a 12-month horizon; the whole year renders (roughly a dozen rows), nearest
   day first and flagged, so "the next day off" is obvious at a glance.

   No hooks — server-renderable, and client screens can embed it as-is. */

export function UpcomingHolidays({
  holidays,
  today,
}: {
  holidays: { date: string; name: string }[];
  today: string;
}) {
  const upcoming = upcomingHolidays(holidays, today);
  if (upcoming.length === 0) return null;

  return (
    <div className="mts-hols">
      <div className="mts-holh">
        <Icon name="calendar" size={14} />
        Public holidays coming up
      </div>
      <div className="mts-hollist">
        {upcoming.map((h, i) => (
          <div className={`mts-hol${i === 0 ? " next" : ""}`} key={h.date}>
            <b>{fmtAuWeekdayDayMonth(h.date)}</b>
            <em>{h.name}</em>
            {i === 0 && <span className="mts-holnext">Next</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
