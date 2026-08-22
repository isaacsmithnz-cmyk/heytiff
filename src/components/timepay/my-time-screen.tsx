"use client";

import { useState } from "react";
import { ViewTabs } from "@/components/shell/view-tabs";
import { MyTimesheet } from "./my-timesheet";
import { MyLeave } from "./my-leave";

/* The two faces of your own time, on one card — SWITCHED ON THE CLIENT.

   These were sibling routes joined by `BoardTabs`, and the frame held (the
   `(my-time)` layout's whole job), but every tab click was still a server
   round trip: RSC fetch, loading skeleton, card streams back in. Beside Team's
   instant switcher that read as the page reloading — same strip, different
   physics — which is the exact inconsistency the card-switcher sweep exists
   to kill (Isaac, 2026-08-22, prod walk).

   BOTH FACES ARRIVE TOGETHER now: each route loads timesheet AND leave and
   renders this shell, so the switch is pure state. The URL still follows the
   face via history.replaceState — the router syncs usePathname from it, so
   the rail highlight moves, refresh lands on the face you're on, and both
   deep links (`/dashboard/my-timesheet`, `/dashboard/my-leave`) stay real
   routes that `requestLeave` already revalidates. replaceState, not push:
   flicking between tabs is one place, not a trail of history entries — the
   Team directory set that expectation.

   The heading still swaps words per face (My timesheet / My leave) — these
   are two nav destinations sharing a card, unlike Time & Pay's one title. */

type TimesheetData = NonNullable<
  Awaited<ReturnType<typeof import("@/lib/timepay/page-data").loadMyTimesheet>>
>;
type LeaveData = Awaited<ReturnType<typeof import("@/lib/timepay/leave-page").loadMyLeave>>;

type Tab = "timesheet" | "leave";

const HREF: Record<Tab, string> = {
  timesheet: "/dashboard/my-timesheet",
  leave: "/dashboard/my-leave",
};

export function MyTimeScreen({
  initialTab,
  timesheet,
  leave,
}: {
  initialTab: Tab;
  /** null = no staff card yet; the subcontractor variant says so plainly. */
  timesheet: TimesheetData | null;
  leave: LeaveData;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  const go = (k: string) => {
    const next = k as Tab;
    setTab(next);
    /* Native history — no router.push: a push would refetch the sibling
       route's RSC payload, which is the reload this shell exists to remove. */
    window.history.replaceState(null, "", HREF[next]);
  };

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg tpr wb2">
          <div className="rhead">
            <div>
              <h1>{tab === "leave" ? "My leave" : "My timesheet"}</h1>
            </div>
          </div>
          <ViewTabs
            ariaLabel="My time"
            idPrefix="mtt"
            panelPrefix="mtp"
            active={tab}
            onGo={go}
            items={[
              { key: "timesheet", label: "Timesheet" },
              { key: "leave", label: "Leave" },
            ]}
          />
          <section
            key={tab}
            id={`mtp-${tab}`}
            role="tabpanel"
            aria-labelledby={`mtt-${tab}`}
            tabIndex={-1}
            className="psec2"
          >
            {tab === "timesheet" ? timesheetFace(timesheet) : leaveFace(leave)}
          </section>
        </div>
      </div>
    </div>
  );
}

/* The empty branches keep the frame they gained in #332: the tabs render
   above every one of these, so a subcontractor still has a way to Leave. */

function timesheetFace(data: TimesheetData | null) {
  if (!data) {
    return (
      <div className="emptybox">
        <b>No staff record yet</b>
        <em>Your timesheet appears once your card exists in Team.</em>
      </div>
    );
  }
  if ("subcontractor" in data) {
    return (
      <div className="emptybox">
        <b>Subcontractors don&rsquo;t keep a timesheet here</b>
        <em>
          You invoice for your work rather than being paid through the pay run, so there are no
          hours to submit. Send your invoice the way you normally do.
        </em>
      </div>
    );
  }
  return <MyTimesheet {...data} />;
}

function leaveFace(data: LeaveData) {
  if (!data) {
    return (
      <div className="emptybox">
        <b>No staff record yet</b>
        <em>Your leave appears once your card exists in Team.</em>
      </div>
    );
  }
  return <MyLeave {...data} />;
}
