"use client";

import Link from "next/link";
import { Icon } from "@/components/shell/icon";

/* The two faces of the team Time & Pay screen: timesheets and leave. Sibling
   routes rather than in-component tabs, so each is linkable and the server
   decides what each holds. Both sit under `timepay_all`. */

export function TimepayNav({ active }: { active: "sheets" | "leave" }) {
  const tab = (key: "sheets" | "leave", href: string, icon: string, label: string) => (
    <Link href={href} className={`tp-tab${active === key ? " on" : ""}`}>
      <Icon name={icon} size={15} />
      {label}
    </Link>
  );
  return (
    <div className="tp-tabs">
      {tab("sheets", "/dashboard/timepay", "clock", "Timesheets")}
      {tab("leave", "/dashboard/timepay/leave", "calendar", "Leave")}
    </div>
  );
}
