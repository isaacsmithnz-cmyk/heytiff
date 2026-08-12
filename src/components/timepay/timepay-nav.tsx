"use client";

import { usePathname } from "next/navigation";
import { BoardTabs, type BoardTab } from "@/components/shell/board-tabs";

/* The three faces of the team Time & Pay screen: timesheets, leave and
   expenses. Sibling routes rather than in-component tabs, so each is linkable
   and the server decides what each holds. All three sit under `timepay_all`;
   what you can DO inside each is gated separately (`approvals` to decide,
   `financials` to record a payment).

   The control itself is `BoardTabs` — see there for why it is a component and
   not a class. This file owns the three routes and the heading above them.

   THE HEADING IS ONE HEADING NOW, and it says "Time & Pay" on all three. Each
   face used to write its own: two said "Time & Pay" and one said "Expenses",
   at 38px, 32px and 44px respectively, in two different markup shapes. So the
   title changed its words, its size and its position as you moved along a
   single tab row — and the 32px one was `.rhead` markup on a root with no
   `tpr`, selecting nothing at all.

   It stays constant rather than naming the face, unlike `MyTimeHead`, and the
   difference is structural: My time is TWO nav destinations that happen to
   share a control, while Time & Pay is ONE nav item with three tabs inside it.
   The tab row directly beneath already says which face you are on; the title
   saying it too would be the same word twice.

   `usePathname` is safe here where `useSearchParams` would not be — it
   resolves synchronously on a client navigation and never suspends, so it
   can't push the frame back inside the boundary the layout sits above. */

const TABS: readonly BoardTab[] = [
  { key: "sheets", href: "/dashboard/timepay", label: "Timesheets" },
  { key: "leave", href: "/dashboard/timepay/leave", label: "Leave" },
  { key: "expenses", href: "/dashboard/timepay/expenses", label: "Expenses" },
];

export function TimepayHead() {
  const path = usePathname() ?? "";
  /* Longest match first: every one of these starts with the sheets href, so
     testing that one first would claim all three. */
  const active = path.startsWith("/dashboard/timepay/leave")
    ? "leave"
    : path.startsWith("/dashboard/timepay/expenses")
      ? "expenses"
      : "sheets";

  return (
    <>
      <div className="rhead">
        <div>
          <h1>Time &amp; Pay</h1>
        </div>
      </div>
      <BoardTabs tabs={TABS} active={active} label="Time and Pay" />
    </>
  );
}
