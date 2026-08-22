"use client";

import { useState } from "react";
import { ViewTabs } from "@/components/shell/view-tabs";
import { TimePay } from "./timepay";
import { TeamLeave } from "./team-leave";
import { TeamExpenses } from "./team-expenses";
import type { TimepaySection } from "@/lib/timepay/section";

/* The three faces of team Time & Pay, on one card — SWITCHED ON THE CLIENT.

   Same conversion as `my-time-screen.tsx`, for the same reason: these were
   sibling routes joined by BoardTabs, and every tab click round-tripped the
   server — a page reload next to Team's instant switcher (Isaac, 2026-08-22,
   prod walk). All three payloads arrive with the page now and the switch is
   pure state — and ONLY state: the URL deliberately stays wherever you
   entered. See my-time-screen.tsx for the wreck the first cut made of this —
   the dashboard shell keys its outlet on the pathname, so a cross-path
   replaceState remounts the page and resets the open tab. Team's switcher
   never touches the URL; this copies it exactly. The three real routes —
   the Home chips deep-link to them — each just pick which face opens first.

   THE TITLE STAYS "Time & Pay" on every face, the rule the old TimepayHead
   pinned: this is ONE nav item with three tabs inside it, and the tab row
   directly beneath already says which face you are on. */

type Tab = "sheets" | "leave" | "expenses";

export function TimepayScreen({
  initialTab,
  section,
}: {
  initialTab: Tab;
  section: TimepaySection;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  const s = section;
  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg tpr wb2">
          <div className="rhead">
            <div>
              <h1>Time &amp; Pay</h1>
            </div>
          </div>
          <ViewTabs
            ariaLabel="Time and Pay"
            idPrefix="tpt"
            panelPrefix="tpp"
            active={tab}
            onGo={(k) => setTab(k as Tab)}
            items={[
              { key: "sheets", label: "Timesheets" },
              { key: "leave", label: "Leave" },
              { key: "expenses", label: "Expenses" },
            ]}
          />
          <section
            key={tab}
            id={`tpp-${tab}`}
            role="tabpanel"
            aria-labelledby={`tpt-${tab}`}
            tabIndex={-1}
            className="psec2"
          >
            {tab === "sheets" && (
              <TimePay
                staff={s.sheets.staff}
                week={s.sheets.week}
                today={s.sheets.today}
                through={s.sheets.through}
                periods={s.sheets.periods}
                periodIndex={s.sheets.periodIndex}
                settings={s.sheets.settings}
                configured={s.sheets.configured}
                sheets={s.sheets.sheets}
                canApprove={s.canApprove}
                financials={s.financials}
                canHolidays={s.canHolidays}
                xeroConnected={s.xeroConnected}
                wageDrift={s.wageDrift}
                expenses={s.expenses}
              />
            )}
            {tab === "leave" && (
              <TeamLeave
                pending={s.leave.pending}
                calendar={s.leave.calendar}
                balances={s.leave.balances}
                canApprove={s.canApprove}
                canManage={s.canManage}
              />
            )}
            {tab === "expenses" && (
              <TeamExpenses claims={s.claims} canApprove={s.canApprove} canPay={s.financials} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
