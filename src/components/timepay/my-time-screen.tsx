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
   renders this shell, so the switch is pure state — and ONLY state.

   THE URL DELIBERATELY DOES NOT FOLLOW THE FACE. The first cut synced it with
   history.replaceState('/dashboard/my-leave'), and every tab click bounced
   back to the entry face with a full re-entrance: the dashboard shell keys
   its outlet on the pathname (`<main key={pathname}>`, app-shell.tsx), so a
   cross-PATH replaceState remounts the whole page tree and this component's
   state with it (Isaac hit it on prod within minutes, 2026-08-22). The org
   card's `?sec=` replaceState survives because search params don't change
   the pathname. Team's switcher never touches the URL either — that is the
   contract this shell copies, exactly. Both deep links stay real routes
   (`/dashboard/my-timesheet`, `/dashboard/my-leave`): each just picks which
   face opens first.

   The heading still swaps words per face (My timesheet / My leave) — these
   are two nav destinations sharing a card, unlike Time & Pay's one title. */

type TimesheetData = NonNullable<
  Awaited<ReturnType<typeof import("@/lib/timepay/page-data").loadMyTimesheet>>
>;
type LeaveData = Awaited<ReturnType<typeof import("@/lib/timepay/leave-page").loadMyLeave>>;

type Tab = "timesheet" | "leave";

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
            onGo={(k) => setTab(k as Tab)}
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
