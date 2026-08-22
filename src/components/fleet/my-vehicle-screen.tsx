"use client";

import { useState } from "react";
import { useFleetActions } from "./fleet-state";
import { ViewTabs } from "@/components/shell/view-tabs";
import type { OwnFleet } from "./assets-screen";
import { MyVehicle } from "./my-vehicle";

/* /dashboard/my-vehicle — the Personal group's own route for the staff lens.
   Same component and same narrow payload as the Assets tab; what's different
   is that it needs no capability and never mentions a register.

   TWO FACES ON THE BOARD'S CARD. Vehicle is the truck as it stands — hero,
   quick logging, the fact tiles; History is every log ever taken on it. The
   old single page showed the newest eight logs and simply ended: log nine
   existed in the table and nowhere on screen. */

export function MyVehicleScreen({
  own,
  today,
  viewerStaffId,
}: {
  own: OwnFleet;
  today: string;
  viewerStaffId: string | null;
}) {
  const actions = useFleetActions();
  const [tab, setTab] = useState<"vehicle" | "history">("vehicle");

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 24, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>
                My vehicle
              </h1>
            </div>
          </div>

          <div className="wb2">
            <ViewTabs
              ariaLabel="Your vehicle"
              idPrefix="mvt"
              panelPrefix="mvp"
              active={tab}
              onGo={(k) => setTab(k as "vehicle" | "history")}
              items={[
                { key: "vehicle", label: "Vehicle" },
                {
                  key: "history",
                  label: "History",
                  count: own.logs.length,
                  countLabel: (n) => `${n} logged`,
                },
              ]}
            />
            <div className="wb2-card">
              <div className="ppanel2">
                <section
                  key={tab}
                  id={`mvp-${tab}`}
                  role="tabpanel"
                  aria-labelledby={`mvt-${tab}`}
                  tabIndex={-1}
                  className="psec2"
                >
                  <MyVehicle
                    face={tab}
                    vehicle={own.vehicle}
                    pickable={own.pickable}
                    logs={own.logs}
                    error={actions.error}
                    onLog={actions.addLog}
                    onEditLog={actions.editLog}
                    onDeleteLog={actions.deleteLog}
                    viewerStaffId={viewerStaffId}
                    today={today}
                  />
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
