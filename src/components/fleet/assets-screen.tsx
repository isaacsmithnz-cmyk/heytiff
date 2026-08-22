"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { ViewTabs } from "@/components/shell/view-tabs";
import { useFleetActions } from "./fleet-state";
import type {
  AiValuation,
  FleetStaff,
  FleetTab,
  Vehicle,
  VehicleIdentity,
  VehicleLog,
  VehicleWithFacts,
} from "./logic";
import { openIssueCount, vehicleChips } from "./logic";
import { MyVehicle } from "./my-vehicle";
import { FleetRegister } from "./register";

/* Assets — the register, on the board's card.

   ONE STRIP, FIVE FACES. This screen wore two switchers stacked: a `.ptabs`
   pill pair (Fleet | Equipment & tools) over the register's own four fat
   `.dirtabs` — two controls, two visual languages, one job. The register's
   views and the equipment placeholder are peers on the one `wb2-vtabs` strip
   now, the control every card in the app switches with.

   Role rules (docs/roles-and-permissions.md): `assets_all` gets the whole
   register incl. valuations; everyone else gets only their own vehicle. The
   two lenses take DIFFERENT props, not the same props filtered — `register`
   is simply absent from a staff member's payload, so there is nothing for a
   render bug to leak.

   The lens follows the PAYLOAD and nothing else. There was a manager-only
   "Preview: Manager / Staff" toggle here, from the days when this screen was a
   design shell with no routes behind it; /dashboard/my-vehicle is a real page
   now, so a manager who wants the staff view opens it. A control that made the
   page lie about who you are earned its keep once and stopped. */

export type OwnFleet = {
  vehicle: VehicleWithFacts | null;
  pickable: VehicleIdentity[];
  logs: VehicleLog[];
};

export type Register = {
  vehicles: Vehicle[];
  logs: VehicleLog[];
  aiValues: Record<string, AiValuation>;
  staff: FleetStaff[];
};

type AssetsView = FleetTab | "equipment";

export function AssetsScreen({
  own,
  register,
  today,
  viewerStaffId,
}: {
  own: OwnFleet;
  /** Present only for holders of `assets_all`. */
  register?: Register;
  today: string;
  viewerStaffId: string | null;
}) {
  const actions = useFleetActions();
  const staffLens = !register;
  const [view, setView] = useState<AssetsView>("all");

  /* The same slices the register itself filters by, counted here because the
     strip lives here. `working` deliberately includes vehicles off the road —
     off road is a state of a working vehicle, not an exit from the fleet. */
  const vehicles = register?.vehicles ?? [];
  const logs = register?.logs ?? [];
  const working = vehicles.filter((v) => v.status !== "sold");
  const sold = vehicles.filter((v) => v.status === "sold");
  const attention = working.filter(
    (v) => vehicleChips(v, openIssueCount(logs, v.id)).length > 0,
  );
  const pool = working.filter((v) => v.assignedTo === null);

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 24, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>
                Assets
              </h1>
            </div>
          </div>

          {staffLens ? (
            /* Unreachable in practice — the page redirects to /my-vehicle
               without `assets_all` — kept so a payload bug degrades to the
               person's own vehicle rather than a blank screen. */
            <MyVehicle
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
          ) : (
            <div className="wb2">
              <ViewTabs
                ariaLabel="Assets"
                idPrefix="ast"
                panelPrefix="astp"
                active={view}
                onGo={(k) => setView(k as AssetsView)}
                items={[
                  {
                    key: "all",
                    label: "Fleet",
                    count: working.length,
                    countLabel: (n) => `${n} working vehicles`,
                  },
                  {
                    key: "attention",
                    label: "Need attention",
                    count: attention.length,
                    tone: "warn",
                    countLabel: (n) => `${n} with expiries, service or issues`,
                  },
                  {
                    key: "pool",
                    label: "Pool",
                    count: pool.length,
                    countLabel: (n) => `${n} unassigned or spare`,
                  },
                  {
                    key: "sold",
                    label: "Sold",
                    count: sold.length,
                    countLabel: (n) => `${n} kept for history`,
                  },
                  { key: "equipment", label: "Equipment & tools" },
                ]}
              />
              {view === "equipment" ? (
                <div className="wb2-card">
                  <div className="ppanel2">
                    {/* No `.psec2`: the four register faces render through
                        FleetRegister's plain `.dir`, so a fade here made
                        Fleet→Equipment the only switch on this strip that
                        animated. One strip, one behaviour. */}
                    <section
                      id="astp-equipment"
                      role="tabpanel"
                      aria-labelledby="ast-equipment"
                      tabIndex={-1}
                    >
                      <div className="emptybox">
                        <span className="ei">
                          <Icon name="box" size={24} />
                        </span>
                        <b>No equipment registered</b>
                        <em>Register serials, holders and calibration / test-tag dates.</em>
                      </div>
                    </section>
                  </div>
                </div>
              ) : (
                <FleetRegister
                  fleet={{ ...actions, ...register }}
                  staff={register.staff}
                  today={today}
                  view={view}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
