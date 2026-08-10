import type { ReactNode } from "react";
import { MyTimeHead } from "@/components/timepay/my-time-nav";

/* The frame both halves of your own time share: the heading, the tab row, and
   the card surface underneath them.

   IT EXISTS TO STOP THE TAB SWITCH LOOKING LIKE A PAGE LOAD. Timesheet and
   Leave are sibling routes, and on a client navigation Next re-renders only
   what sits BELOW the layout the two routes share. That used to be
   `dashboard/layout.tsx` — so the nearest Suspense boundary below it,
   `dashboard/loading.tsx`, is the one that caught the navigation, and its
   fallback is `PageSkeleton`: the entire screen, heading and tabs included,
   blanked to grey bars and rebuilt. Clicking a tab read as leaving the page,
   because everything that said which page you were on went away.

   A route group is the fix (`(my-time)` is not in the URL — the routes are
   still /dashboard/my-timesheet and /dashboard/my-leave). With the heading and
   tabs in a layout the two routes share, that layout becomes the entry point
   for the navigation between them, and the `loading.tsx` beside this file is a
   boundary BELOW it. The frame stays put; only the card is replaced.

   SYNCHRONOUS, and it has to stay that way — the same rule as
   `dashboard/layout.tsx`. An `await` here would put the frame back inside the
   thing being waited for, which is the bug this file exists to fix. It reads
   nothing: the title comes from the pathname. */

export default function MyTimeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg tpr wb2">
          <MyTimeHead />
          {children}
        </div>
      </div>
    </div>
  );
}
