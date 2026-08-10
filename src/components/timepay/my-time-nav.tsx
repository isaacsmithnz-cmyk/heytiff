"use client";

import { usePathname } from "next/navigation";
import { BoardTabs, type BoardTab } from "@/components/shell/board-tabs";

/* The two faces of your own time: the hours you worked and the days you asked
   off. Sibling routes rather than in-component tabs, so each stays linkable —
   `requestLeave` revalidates both, the dashboard chips deep-link to either, and
   the timesheet still pushes `?period=` to itself.

   THE SAME CONTROL THE WORKBOARD USES, one tab shorter. It was a `.segsw`
   sliding-thumb switcher, then briefly the `.tp-tabs` pill group; both made
   your own time the only place in the app wearing a control of its own. Now it
   is the board's tab row, on the board's card, like everything else.

   THE HEADING COMES WITH IT, and that is the point of `MyTimeHead`. The two
   pages used to write their own: Timesheet an `.rhead` with a 38px `h1`, Leave
   a `.v2head` with a 44px one inline and twelve fewer pixels beneath it. So
   switching tabs moved the title, resized it, and shifted the tab row you had
   just clicked — on top of the skeleton described in the layout beside this.
   One header, rendered above the routes rather than inside each of them, and
   there is nothing left to disagree.

   Which tab is live is read from the PATH rather than passed in: the layout
   renders this once for both routes and has no props to pass it. `usePathname`
   is safe here where `useSearchParams` would not be — it resolves synchronously
   on a client navigation and never suspends, so it can't push the frame back
   inside the boundary the layout exists to sit above. */

const TABS: readonly BoardTab[] = [
  { key: "timesheet", href: "/dashboard/my-timesheet", label: "Timesheet" },
  { key: "leave", href: "/dashboard/my-leave", label: "Leave" },
];

const TITLE: Record<string, string> = {
  timesheet: "My timesheet",
  leave: "My leave",
};

export function MyTimeHead() {
  const path = usePathname();
  /* startsWith, not equality: the timesheet carries `?period=` and either may
     grow a sub-path later. Unknown paths park on the timesheet, which is the
     entry the rail links to. */
  const active = path?.startsWith("/dashboard/my-leave") ? "leave" : "timesheet";

  return (
    <>
      <div className="rhead">
        <div>
          <h1>{TITLE[active]}</h1>
        </div>
      </div>
      <BoardTabs tabs={TABS} active={active} label="My time" />
    </>
  );
}
