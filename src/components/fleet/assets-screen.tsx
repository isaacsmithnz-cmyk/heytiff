"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { ViewTabs } from "@/components/shell/view-tabs";
import { useFleetActions } from "./fleet-state";
import type {
  AiValuation,
  FleetStaff,
  Vehicle,
  VehicleFinance,
  VehicleIdentity,
  VehiclePolicy,
  VehicleLog,
  VehicleWithFacts,
} from "./logic";
import type { StoredDocument } from "@/lib/documents/query";
import { MyVehicle } from "./my-vehicle";
import { FleetRegister } from "./register";

/* Assets — the register, on the board's card.

   ONE STRIP, TWO FACES. The strip once carried five: Fleet's slices (Need
   attention / Pool / Sold) sat as tabs beside Equipment & tools, so two
   different KINDS of switch — "which asset class" and "which slice of the
   fleet" — shared one row. Isaac read it as noise. The strip now switches
   asset class only (Fleet | Equipment & tools), and the slices are a filter
   in the register's own toolbar, next to Value with Tiff, where the other
   list controls live.

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
  /** The paper trail, per vehicle: its own documents plus its logs' dockets. */
  documents: Record<string, StoredDocument[]>;
  /** Renewals on file, per vehicle, newest first. */
  policies: Record<string, VehiclePolicy[]>;
  /** Finance agreements on file, per vehicle, newest first. */
  finance: Record<string, VehicleFinance[]>;
};

type AssetsView = "fleet" | "equipment";

export function AssetsScreen({
  own,
  register,
  today,
  viewerStaffId,
  openVehicleId = null,
}: {
  own: OwnFleet;
  /** Present only for holders of `assets_all`. */
  register?: Register;
  today: string;
  viewerStaffId: string | null;
  /** `?v=` — a vehicle to open on arrival, read on the server by the page and
      passed through. A staff card's plate is the caller. */
  openVehicleId?: string | null;
}) {
  const actions = useFleetActions();
  const staffLens = !register;
  const [view, setView] = useState<AssetsView>("fleet");

  /* `working` deliberately includes vehicles off the road — off road is a
     state of a working vehicle, not an exit from the fleet. The finer slices
     (attention / pool / sold) are the register's filter now, counted there. */
  const vehicles = register?.vehicles ?? [];
  const working = vehicles.filter((v) => v.status !== "sold");

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
                    key: "fleet",
                    label: "Fleet",
                    count: working.length,
                    countLabel: (n) => `${n} working vehicles`,
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
                  openVehicleId={openVehicleId}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
