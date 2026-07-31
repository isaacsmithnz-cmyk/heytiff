"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";

/* The two faces of your own time: the hours you worked and the days you asked
   off. Sibling routes rather than in-component tabs, so each stays linkable —
   `requestLeave` revalidates both, the dashboard chips deep-link to either, and
   the timesheet still pushes `?period=` to itself.

   Built on the shell's `.segsw`, the same sliding-thumb switcher the Workboard
   uses and the Design Studio's Design/Summary stepper started. It replaced a
   `.tp-tabs` pill group, which hopped a white background between two buttons
   and read as two controls rather than one with two positions.

   Buttons + router.push rather than <Link>: the thumb animates from whichever
   position it is in, and a full navigation would remount it at the new one
   with nothing to travel from. The routes stay real URLs either way. */

type Tab = "timesheet" | "leave";

const TABS: { key: Tab; href: string; icon: string; label: string }[] = [
  { key: "timesheet", href: "/dashboard/my-timesheet", icon: "clock", label: "Timesheet" },
  { key: "leave", href: "/dashboard/my-leave", icon: "calendar", label: "Leave" },
];

export function MyTimeNav({ active }: { active: Tab }) {
  const router = useRouter();
  return (
    <nav
      className="segsw mytime-segsw"
      aria-label="My time"
      data-active={TABS.findIndex((t) => t.key === active)}
    >
      <span className="segsw-thumb" aria-hidden="true" />
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`segsw-b${active === t.key ? " on" : ""}`}
          aria-current={active === t.key ? "page" : undefined}
          onClick={() => router.push(t.href)}
        >
          <Icon name={t.icon} size={15} />
          {t.label}
        </button>
      ))}
    </nav>
  );
}
