import Link from "next/link";
import { Icon } from "@/components/shell/icon";

/* The two faces of your own time: the hours you worked and the days you asked
   off. Sibling routes rather than in-component tabs, so each stays linkable —
   `requestLeave` revalidates both, the dashboard chips deep-link to either, and
   the timesheet still pushes `?period=` to itself.

   THE SAME CONTROL THE TEAM SCREEN USES (`.tp-tabs`, see timepay-nav.tsx),
   minus the Expenses tab you don't have on your own time. It was briefly a
   `.segsw` sliding-thumb switcher instead, which made your own time the only
   place in the app wearing that particular control — one switcher on one
   screen is not a design system, it is an exception to explain. Two tab bars
   that behave identically are worth more than a nicer one nobody else has.

   Plain <Link>s now: without a thumb to animate from, there is nothing the
   router.push dance was buying, and a real link is a real link. */

type Tab = "timesheet" | "leave";

const TABS: { key: Tab; href: string; icon: string; label: string }[] = [
  { key: "timesheet", href: "/dashboard/my-timesheet", icon: "clock", label: "Timesheet" },
  { key: "leave", href: "/dashboard/my-leave", icon: "calendar", label: "Leave" },
];

export function MyTimeNav({ active }: { active: Tab }) {
  return (
    <nav className="tp-tabs" aria-label="My time">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`tp-tab${active === t.key ? " on" : ""}`}
          aria-current={active === t.key ? "page" : undefined}
        >
          <Icon name={t.icon} size={15} />
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
