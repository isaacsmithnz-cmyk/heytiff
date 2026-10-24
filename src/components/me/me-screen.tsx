"use client";

import { useRouter } from "next/navigation";
import { ViewTabs } from "@/components/shell/view-tabs";
import { MyLeave } from "@/components/timepay/my-leave";
import type { MeData } from "@/lib/me/page-data";

/* WHAT IS LEFT OF THE ME CARD: Leave, under the old strip of Timesheet ·
   Leave · Expenses · Vehicle · Notes. The other four are pages of their own
   under Your name now (Isaac, 24 October 2026), so their tabs here go to
   them; Leave's own page replaces this screen, and the strip goes with it. */

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

/* EVERY FACE BUT LEAVE IS A PAGE OF ITS OWN in v2, under Your name
   (Isaac, 24 October 2026), so its tab here goes there rather than
   switching a face. Leave's own page replaces this screen next. */
const PAGE: Record<Exclude<Tab, "leave">, string> = {
  timesheet: "/dashboard/my-timesheet",
  expenses: "/dashboard/my-expenses",
  vehicle: "/dashboard/my-vehicle",
  notes: "/dashboard/my-notes",
};

export function MeScreen({ data }: { initialTab?: "leave"; data: MeData }) {
  const router = useRouter();

  return (
    /* THE PAGE IS PAPER TO THE FRAME (2026-09-20, the Workboard's frame on
       every screen with tabs): no grey margin, no card edge, no width cap —
       `full` is what asks for it, and shell.css does the rest. */
    <div className="page in full">
      <div className="wrap">
        <div className="stg tpr wb2">
          <ViewTabs
            ariaLabel="Yours"
            idPrefix="met"
            panelPrefix="mep"
            active="leave"
            onGo={(k) => k !== "leave" && router.push(PAGE[k as Exclude<Tab, "leave">])}
            items={TABS.map((t) => ({ ...t }))}
            lead={<h1 className="wb2-h1">My leave</h1>}
          />
          <div className="wb2-card">
            <div className="wb2-panel">
              <section id="mep-leave" role="tabpanel" aria-labelledby="met-leave" tabIndex={-1}>
                {leaveFace(data)}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* The empty branch keeps the frame it gained in #332: the tabs render above
   it, so someone with no staff card still has a way to Expenses. */

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
