"use client";

import Link from "next/link";
import { Icon } from "@/components/shell/icon";

/* The two faces of your own time: the hours you worked and the days you asked
   off. Sibling routes rather than in-component tabs, so each stays linkable —
   `requestLeave` revalidates both, the dashboard chips deep-link to either, and
   the timesheet still pushes `?period=` to itself.

   This is the personal mirror of TimepayNav, which does the same job for the
   team-wide screens. Neither face is gated: your own timesheet and your own
   leave are intrinsic, and `timepay_all` only ever gates everyone else's. */

type Tab = "timesheet" | "leave";

export function MyTimeNav({ active }: { active: Tab }) {
  const tab = (key: Tab, href: string, icon: string, label: string) => (
    <Link href={href} className={`tp-tab${active === key ? " on" : ""}`}>
      <Icon name={icon} size={15} />
      {label}
    </Link>
  );
  return (
    <div className="tp-tabs">
      {tab("timesheet", "/dashboard/my-timesheet", "clock", "Timesheet")}
      {tab("leave", "/dashboard/my-leave", "calendar", "Leave")}
    </div>
  );
}
