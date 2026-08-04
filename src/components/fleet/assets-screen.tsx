"use client";

import { useState } from "react";
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
   render bug to leak. Managers also get a Staff preview toggle so the staff
   lens can be reviewed without switching accounts. */

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
}: {
  own: OwnFleet;
  /** Present only for holders of `assets_all`. */
  register?: Register;
  today: string;
}) {
  const actions = useFleetActions();
  const [preview, setPreview] = useState<"manager" | "staff">("manager");
  const staffLens = !register || preview === "staff";

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 24, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
                Assets
              </h1>
            </div>
            {register && (
              <div className="fl-seg" title="Preview how this page looks for each role">
                <em>Preview</em>
                <button className={preview === "manager" ? "on" : ""} onClick={() => setPreview("manager")}>
                  <Icon name="shield" size={13} />
                  Manager
                </button>
                <button className={preview === "staff" ? "on" : ""} onClick={() => setPreview("staff")}>
                  <Icon name="users" size={13} />
                  Staff
                </button>
              </div>
            )}
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
