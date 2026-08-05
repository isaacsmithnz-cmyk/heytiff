import { BoardTabs, type BoardTab } from "@/components/shell/board-tabs";

/* The three faces of the team Time & Pay screen: timesheets, leave and
   expenses. Sibling routes rather than in-component tabs, so each is linkable
   and the server decides what each holds. All three sit under `timepay_all`;
   what you can DO inside each is gated separately (`approvals` to decide,
   `financials` to record a payment).

   The control itself is `BoardTabs` — see there for why it is a component and
   not a class. This file owns only the three routes. */

type Tab = "sheets" | "leave" | "expenses";

const TABS: readonly BoardTab[] = [
  { key: "sheets", href: "/dashboard/timepay", label: "Timesheets" },
  { key: "leave", href: "/dashboard/timepay/leave", label: "Leave" },
  { key: "expenses", href: "/dashboard/timepay/expenses", label: "Expenses" },
];

export function TimepayNav({ active }: { active: Tab }) {
  return <BoardTabs tabs={TABS} active={active} label="Time and Pay" />;
}
