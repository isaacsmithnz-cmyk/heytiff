import type { ReactNode } from "react";
import { TimepayHead } from "@/components/timepay/timepay-nav";

/* The frame all three faces of team Time & Pay share.

   IT EXISTS TO STOP THE TAB SWITCH LOOKING LIKE A PAGE LOAD — the same fix
   `(my-time)/layout.tsx` carries, for the same reason, one segment over. On a
   client navigation Next re-renders only what sits BELOW the layout the routes
   share. Without this file that was `dashboard/layout.tsx`, so the boundary
   catching a Timesheets→Leave click was `dashboard/loading.tsx`, whose
   fallback is `PageSkeleton`: the whole screen, heading and tab row included,
   blanked to grey bars and rebuilt. Clicking a tab read as leaving the page.

   No route group is needed here, unlike My time: `expenses` and `leave` are
   already CHILDREN of the `timepay` segment rather than its siblings, so a
   layout beside them covers all three including the index.

   THE HEADING CAME UP HERE TOO, and it was worse than it looked. The three
   faces each wrote their own and no two agreed:

     Timesheets  .stg tpr wb2  + .rhead    → h1 38px, "Time & Pay"
     Leave       .stg wb2      + .rhead    → h1 32px, "Time & Pay"
     Expenses    .stg wb2      + .v2head   → h1 44px, "Expenses"

   Leave's 32px is the interesting one: every `.rhead` rule in shell.css is
   scoped `.fg .tpr .rhead`, and that screen's root had no `tpr` — so its
   heading markup selected NOTHING and fell back to a bare h1. Valid CSS
   matching no element, which nothing in the local loop catches.

   `tpr` lives here now, once, which fixes that and hands both of the other two
   screens the design tokens they were missing (`--gray600`, `--amber-d`,
   `--red-d` were simply unset on them, and `--teal` resolved to the frame's
   cyan rather than the board's green).

   SYNCHRONOUS, like `dashboard/layout.tsx` and `(my-time)/layout.tsx`. An
   `await` here would put the frame back inside the thing being waited for,
   which is the bug this file exists to fix. The title is a constant and the
   live tab comes from the pathname. */

export default function TimepayLayout({ children }: { children: ReactNode }) {
  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg tpr wb2">
          <TimepayHead />
          {children}
        </div>
      </div>
    </div>
  );
}
