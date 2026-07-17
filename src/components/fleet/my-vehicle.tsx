"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { DemoStaff } from "@/mock/demo";
import type { FleetState } from "./fleet-state";
import {
  type LogKind,
  fmtKm,
  openIssueCount,
  serviceKmLeft,
  vehicleChips,
  vehicleName,
} from "./logic";
import { LogModal, LogRow } from "./modals";

/* "My vehicle" — the Staff lens on Assets → Fleet: just the vehicle assigned
   to you, with log fuel / odometer / report-issue actions. No register, no
   other vehicles, no valuations (spec: Fleet ◐ own for every role). */

const QUICK: { kind: LogKind; icon: string; label: string; sub: string }[] = [
  { kind: "fuel", icon: "fuel", label: "Log fuel", sub: "Litres, cost & odo" },
  { kind: "odo", icon: "gauge", label: "Update odometer", sub: "Reading off the dash" },
  { kind: "issue", icon: "alert", label: "Report an issue", sub: "Flag something wrong" },
];

export function MyVehicle({
  fleet,
  staff,
  viewerId,
}: {
  fleet: FleetState;
  staff: DemoStaff[];
  viewerId: string;
}) {
  const [logKind, setLogKind] = useState<LogKind | null>(null);
  const vehicle = fleet.vehicles.find((v) => v.assignedTo === viewerId);
  const viewer = staff.find((s) => s.id === viewerId);

  if (!vehicle) {
    return (
      <div className="emptybox">
        <span className="ei">
          <Icon name="truck" size={24} />
        </span>
        <b>No vehicle assigned</b>
        <em>When a vehicle is assigned to you, its rego, service status and fuel logging will live here.</em>
      </div>
    );
  }

  const chips = vehicleChips(vehicle, openIssueCount(fleet.logs, vehicle.id));
  const left = serviceKmLeft(vehicle);
  const myLogs = fleet.logs.filter((l) => l.vehicleId === vehicle.id).slice(0, 8);

  const upcoming: { label: string; text: string; state: "ok" | "warn" | "bad" }[] = [
    {
      label: "Next service",
      text: left < 0 ? `${fmtKm(-left)} km overdue` : `in ${fmtKm(left)} km`,
      state: left < 0 ? "bad" : left <= 1500 ? "warn" : "ok",
    },
    {
      label: "Rego",
      text: vehicle.regoDays < 0 ? `expired ${-vehicle.regoDays}d ago` : `renews in ${vehicle.regoDays}d`,
      state: vehicle.regoDays < 0 ? "bad" : vehicle.regoDays <= 30 ? "warn" : "ok",
    },
    {
      label: "Insurance",
      text: vehicle.insuranceDays < 0 ? "expired" : `renews in ${vehicle.insuranceDays}d`,
      state: vehicle.insuranceDays < 0 ? "bad" : vehicle.insuranceDays <= 30 ? "warn" : "ok",
    },
  ];

  return (
    <div className="fl-my">
      <div className="fl-hero">
        <div className="fl-hlead">
          <div className="fl-htag">
            <Icon name="truck" size={12} />
            Your vehicle
          </div>
          <h2>{vehicle.callsign}</h2>
          <div className="fl-hsub">
            {vehicleName(vehicle)}
            <span className="fl-plate2">{vehicle.plate}</span>
          </div>
          <div className="fl-hchips">
            {chips.length === 0 ? (
              <span className="dchip ok">
                <Icon name="check" size={12} />
                All good
              </span>
            ) : (
              chips.map((c) => (
                <span key={c.label} className={`dchip ${c.state}`}>
                  <Icon name={c.state === "bad" ? "alert" : "clock"} size={12} />
                  {c.label}
                </span>
              ))
            )}
          </div>
        </div>
        <div className="fl-odo">
          <b>{fmtKm(vehicle.odometer)}</b>
          <em>km on the clock</em>
        </div>
      </div>

      <div className="fl-quick">
        {QUICK.map((q) => (
          <button key={q.kind} className="fl-qa" onClick={() => setLogKind(q.kind)}>
            <span className={`fl-qi ${q.kind}`}>
              <Icon name={q.icon} size={19} />
            </span>
            <span>
              <b>{q.label}</b>
              <em>{q.sub}</em>
            </span>
          </button>
        ))}
      </div>

      <div className="fl-up">
        {upcoming.map((u) => (
          <div key={u.label} className={`fl-ut ${u.state}`}>
            <em>{u.label}</em>
            <b>{u.text}</b>
          </div>
        ))}
      </div>

      <div className="fl-card">
        <div className="fl-ch">
          <span className="fl-ci">
            <Icon name="clock" size={17} />
          </span>
          <span>
            <b>Recent activity</b>
            <em>Your fuel, odometer &amp; issue history on {vehicle.callsign}</em>
          </span>
        </div>
        {myLogs.length === 0 ? (
          <div className="fl-hempty">Nothing logged yet — your fuel, odo and issue reports land here.</div>
        ) : (
          myLogs.map((l) => <LogRow key={l.id} log={l} />)
        )}
      </div>

      {logKind && (
        <LogModal
          kind={logKind}
          vehicle={vehicle}
          loggedBy={{ id: viewerId, name: viewer?.name ?? "You" }}
          onSave={(log) => {
            fleet.addLog(log);
            setLogKind(null);
          }}
          onClose={() => setLogKind(null)}
        />
      )}
    </div>
  );
}
