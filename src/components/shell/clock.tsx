"use client";

import { useEffect, useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { fmtAuTime, fmtAuWeekdayDayMonth, todayInAu } from "@/lib/au-dates";

/* The date and time, in the FRAME rather than on a page.

   It used to be a teal uppercase pill inside the dashboard hero reading
   "SUNDAY, 9 AUGUST 2026" — the template's status-pill idiom applied to a date,
   which carries no status, on the one screen in the app that had it. What day
   it is belongs to the app, not to Home: up here every screen gets it, and Home
   gets the space back.

   THE TIME IS CLIENT-ONLY, DELIBERATELY. A clock rendered on the server and
   hydrated a minute later is a text mismatch, and a mismatch in a render body
   fails hydration for the whole tree (see lib/use-hydrated, which exists for
   exactly this). So the server emits the DATE — stable for a day — and the
   minute only appears once there is a browser to own it. The slot reserves its
   width in CSS, so nothing reflows when it lands. */

export function Clock({ today }: { today: string }) {
  const hydrated = useHydrated();

  /* Computed during render on the server too, and thrown away there unread —
     that is what keeps a time out of the emitted markup. */
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    /* ON the minute, not every 60s from mount: the displayed minute should
       flip when the yard's clock does, not whenever this happened to mount.
       Scheduling from inside the callback keeps the state update async — a
       synchronous setState in an effect body cascades a second render on every
       mount and is a lint error in this codebase. */
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const d = new Date();
      timer = setTimeout(
        () => {
          setNow(new Date());
          schedule();
        },
        60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()),
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  /* Once there is a browser the date comes off the same clock as the time, so
     an app left open overnight rolls over instead of insisting it is still
     yesterday. Before that it is the server's AU date, which the greeting and
     every chip on the page were derived from. */
  const date = fmtAuWeekdayDayMonth(hydrated ? todayInAu(now) : today);

  return (
    <div className="tbclock">
      <b>{hydrated ? fmtAuTime(now) : ""}</b>
      <em>{date}</em>
    </div>
  );
}
