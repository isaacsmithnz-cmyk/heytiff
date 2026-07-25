"use client";

import { HolidaySection } from "./holiday-section";
import type { Holiday } from "@/lib/timepay/leave-query";

/* The old standalone admin page shell around the holiday section. The section
   itself now lives in the Time & Pay settings modal; this page survives only
   until the Admin index restructure removes it. */

export function HolidayManager({
  holidays,
  orgState,
  today,
}: {
  holidays: Holiday[];
  orgState: string | null;
  today: string;
}) {
  return (
    <div className="wrap">
      <div className="stg">
        <div className="v2head" style={{ marginBottom: 8 }}>
          <div>
            <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
              Public holidays
            </h1>
          </div>
        </div>
        <p className="hol-intro">
          Your organisation&rsquo;s holiday calendar. Staff see these on their timesheet, and leave
          skips them when it suggests hours. The calendar keeps itself current for your state;
          add one-offs or remove days this business works.
        </p>
        <HolidaySection holidays={holidays} orgState={orgState} today={today} />
      </div>
    </div>
  );
}
