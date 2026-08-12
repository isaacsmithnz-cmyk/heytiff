"use client";

import { Icon } from "@/components/shell/icon";
import { useFleetActions } from "./fleet-state";
import type {
  AiValuation,
  FleetStaff,
  Vehicle,
  VehicleIdentity,
  VehicleLog,
  VehicleWithFacts,
} from "./logic";
import { MyVehicle } from "./my-vehicle";
import { FleetRegister } from "./register";

/* Assets — Fleet + Equipment tabs. The .ptab / .ptabpanel markup matches the
   old static screen: the shell's delegated click handler does the tab
   switching, so these classNames stay static (never re-rendered with state).

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

          <div className="ptabs">
            <button className="ptab on" data-ptab="0">
              Fleet
            </button>
            <button className="ptab" data-ptab="1">
              Equipment &amp; tools
            </button>
          </div>
          <div className="ptabpanels">
            <div className="ptabpanel on" data-ppanel="0">
              {staffLens ? (
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
                <FleetRegister
                  fleet={{ ...actions, ...register }}
                  staff={register.staff}
                  today={today}
                />
              )}
            </div>
            <div className="ptabpanel" data-ppanel="1">
              <div className="emptybox">
                <span className="ei">
                  <Icon name="box" size={24} />
                </span>
                <b>No equipment registered</b>
                <em>Register serials, holders and calibration / test-tag dates.</em>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
