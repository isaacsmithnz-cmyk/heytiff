"use client";

import { useState } from "react";
import { ViewTabs } from "@/components/shell/view-tabs";
import { MyTimesheet } from "@/components/timepay/my-timesheet";
import { MyLeave } from "@/components/timepay/my-leave";
import { MyExpensesFace } from "@/components/expenses/my-expenses-face";
import { MyVehicleFace } from "@/components/fleet/my-vehicle-face";
import { MyNotesFace } from "@/components/notes/my-notes-face";
import type { MeData } from "@/lib/me/page-data";

/* EVERYTHING THAT IS YOURS, ON ONE CARD — five faces, switched on the client.

   These were five rows in the rail and five routes underneath, and the rail
   could not afford them: thirteen rows needed 999px of nav against a 733px
   window, so Operations and Admin sat below a fold that `.no-sb` gives no
   scrollbar to admit (Isaac, 2026-08-23). Four rows folded into one and the
   rail came down to 711px, which fits a 13" laptop.

   IT IS THE `(my-time)` SHAPE, WIDENED. Timesheet and Leave already shared a
   card this way: every route loads all the faces and the switch is pure state.
   Three more faces join them and the contract is unchanged.

   THE URL DELIBERATELY DOES NOT FOLLOW THE FACE. Syncing it with
   history.replaceState bounces straight back to the entry face, because the
   dashboard shell keys its outlet on the pathname (`<main key={pathname}>`,
   app-shell.tsx) and a cross-PATH replaceState remounts the whole page tree
   and this component's state with it — Isaac hit it on prod within minutes
   (2026-08-22). All five stay real routes, and each one only picks which face
   opens first; ⌘K still lists every one of them by name.

   The heading swaps words per face. These are five nav destinations sharing a
   card, not one screen with five sections, and each still says which it is. */

type Tab = "timesheet" | "leave" | "expenses" | "vehicle" | "notes";

/* ORDER IS AN ARGUMENT. Timesheet · Leave · Expenses is exactly Time & Pay's
   strip — the same three things, seen from the other end — so the person whose
   hours these are and the person approving them read them in the same order.
   Vehicle and Notes follow because they have no manager-side twin. */
const TABS = [
  { key: "timesheet", label: "Timesheet" },
  { key: "leave", label: "Leave" },
  { key: "expenses", label: "Expenses" },
  { key: "vehicle", label: "Vehicle" },
  { key: "notes", label: "Notes" },
] as const;

const TITLE: Record<Tab, string> = {
  timesheet: "My timesheet",
  leave: "My leave",
  expenses: "My expenses",
  vehicle: "My vehicle",
  notes: "Notes",
};

export function MeScreen({ initialTab, data }: { initialTab: Tab; data: MeData }) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg tpr wb2">
          <div className="rhead">
            <div>
              {/* THE HEADING IS THE ONLY THING IN HERE, and it has to be:
                  anything a single face adds changes the header's height, so
                  the card steps down when you land on that face and back up
                  when you leave. Notes' "Only you can see these" did exactly
                  that (Isaac, 2026-08-23) and now rides the switch row inside
                  the panel, where it costs nothing. */}
              <h1>{TITLE[tab]}</h1>
            </div>
          </div>
          <ViewTabs
            ariaLabel="Yours"
            idPrefix="met"
            panelPrefix="mep"
            active={tab}
            onGo={(k) => setTab(k as Tab)}
            items={TABS.map((t) => ({ ...t }))}
          />
          {/* No `key` and no `.psec2` — the panel swaps in place, like Team's.
              The pair unmounts and rebuilds the face on every click and fades
              it in from opacity 0 with a 12px rise, which on a timesheet grid
              reads as the content flashing (Isaac, 2026-08-22). The thumb
              slide IS the animation. */}
          <section id={`mep-${tab}`} role="tabpanel" aria-labelledby={`met-${tab}`} tabIndex={-1}>
            {face(tab, data)}
          </section>
        </div>
      </div>
    </div>
  );
}

function face(tab: Tab, data: MeData) {
  switch (tab) {
    case "timesheet":
      return timesheetFace(data);
    case "leave":
      return leaveFace(data);
    case "expenses":
      return <MyExpensesFace claims={data.claims} today={data.today} />;
    case "vehicle":
      return (
        <MyVehicleFace
          own={data.fleet.own}
          today={data.fleet.today}
          viewerStaffId={data.fleet.viewerStaffId}
        />
      );
    case "notes":
      return <MyNotesFace notes={data.notes} archived={data.archived} />;
  }
}

/* The empty branches keep the frame they gained in #332: the tabs render above
   every one of these, so a subcontractor still has a way to Leave. */

function timesheetFace(data: MeData) {
  const d = data.timesheet;
  if (!d) {
    return (
      <div className="emptybox">
        <b>No staff record yet</b>
        <em>Your timesheet appears once your card exists in Team.</em>
      </div>
    );
  }
  if ("subcontractor" in d) {
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
  return <MyTimesheet {...d} />;
}

function leaveFace(data: MeData) {
  if (!data.leave) {
    return (
      <div className="emptybox">
        <b>No staff record yet</b>
        <em>Your leave appears once your card exists in Team.</em>
      </div>
    );
  }
  return <MyLeave {...data.leave} />;
}
