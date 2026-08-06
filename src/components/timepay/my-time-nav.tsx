import { BoardTabs, type BoardTab } from "@/components/shell/board-tabs";

/* The two faces of your own time: the hours you worked and the days you asked
   off. Sibling routes rather than in-component tabs, so each stays linkable —
   `requestLeave` revalidates both, the dashboard chips deep-link to either, and
   the timesheet still pushes `?period=` to itself.

   THE SAME CONTROL THE TEAM SCREEN USES, one tab shorter. It was a `.segsw`
   sliding-thumb switcher, then briefly the `.tp-tabs` pill group; both made
   your own time the only place in the app wearing a control of its own. Now it
   is the board's tab row, on the board's card, like everything else. */

type Tab = "timesheet" | "leave";

const TABS: readonly BoardTab[] = [
  { key: "timesheet", href: "/dashboard/my-timesheet", label: "Timesheet" },
  { key: "leave", href: "/dashboard/my-leave", label: "Leave" },
];

export function MyTimeNav({ active }: { active: Tab }) {
  return <BoardTabs tabs={TABS} active={active} label="My time" />;
}
