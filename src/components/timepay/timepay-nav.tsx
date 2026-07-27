"use client";

import Link from "next/link";
import { Icon } from "@/components/shell/icon";

/* The three faces of the team Time & Pay screen: timesheets, leave and
   expenses. Sibling routes rather than in-component tabs, so each is linkable
   and the server decides what each holds. All three sit under `timepay_all`;
   what you can DO inside each is gated separately (`approvals` to decide,
   `financials` to record a payment). */

type Tab = "sheets" | "leave" | "expenses";

export function TimepayNav({ active }: { active: Tab }) {
  const tab = (key: Tab, href: string, icon: string, label: string) => (
    <Link href={href} className={`tp-tab${active === key ? " on" : ""}`}>
      <Icon name={icon} size={15} />
      {label}
    </Link>
  );
  return (
    <div className="tp-tabs">
      {tab("sheets", "/dashboard/timepay", "clock", "Timesheets")}
      {tab("leave", "/dashboard/timepay/leave", "calendar", "Leave")}
      {tab("expenses", "/dashboard/timepay/expenses", "receipt", "Expenses")}
    </div>
  );
}
