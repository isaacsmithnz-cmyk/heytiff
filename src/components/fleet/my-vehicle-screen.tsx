"use client";

import { useFleetActions } from "./fleet-state";
import type { OwnFleet } from "./assets-screen";
import { MyVehicle } from "./my-vehicle";

/* /dashboard/my-vehicle — the Personal group's own route for the staff lens.
   Same component and same narrow payload as the Assets tab; what's different
   is that it needs no capability and never mentions a register. */

export function MyVehicleScreen({ own }: { own: OwnFleet }) {
  const actions = useFleetActions();
  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 24, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
                My vehicle
              </h1>
            </div>
          </div>
          <MyVehicle
            vehicle={own.vehicle}
            pickable={own.pickable}
            logs={own.logs}
            error={actions.error}
            onLog={actions.addLog}
          />
        </div>
      </div>
    </div>
  );
}
