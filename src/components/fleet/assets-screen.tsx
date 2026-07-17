"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { DemoStaff } from "@/mock/demo";
import { useFleetState } from "./fleet-state";
import type { Vehicle, VehicleLog } from "./logic";
import { MyVehicle } from "./my-vehicle";
import { FleetRegister } from "./register";

/* Assets — Fleet + Equipment tabs. The .ptab / .ptabpanel markup matches the
   old static screen: the shell's delegated click handler does the tab
   switching, so these classNames stay static (never re-rendered with state).

   Role rules (docs/roles-and-permissions.md): Manager/Owner get the whole
   register incl. valuations; Staff get only their assigned vehicle ("My
   vehicle") with log fuel/odo/issue actions. Managers also get a Staff
   preview toggle so the staff lens can be reviewed without switching accounts
   (demo-only affordance, like the directory's deactivate). */

export function AssetsScreen({
  manager,
  staff,
  vehicles,
  logs,
  viewerId,
}: {
  manager: boolean;
  staff: DemoStaff[];
  vehicles: Vehicle[];
  logs: VehicleLog[];
  viewerId: string;
}) {
  const fleet = useFleetState(vehicles, logs);
  const [preview, setPreview] = useState<"manager" | "staff">("manager");
  const staffLens = !manager || preview === "staff";

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
            {manager && (
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
                <MyVehicle fleet={fleet} staff={staff} viewerId={viewerId} />
              ) : (
                <FleetRegister fleet={fleet} staff={staff} />
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
