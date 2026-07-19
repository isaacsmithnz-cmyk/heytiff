"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { DemoStaff } from "@/mock/demo";
import type { FleetState } from "./fleet-state";
import {
  type LogKind,
  displayName,
  fmtKm,
  fuelEconomy,
  logsFor,
  modelLabel,
  openIssueCount,
  vehicleChips,
  vehicleFacts,
} from "./logic";
import { LogModal, LogRow } from "./modals";

/* "My vehicle" — the Staff lens on Assets → Fleet: just the vehicle assigned
   to you, with log fuel / odometer / report-issue actions. No register, no
   other vehicles, no valuations (spec: Fleet ◐ own for every role). Off-road
   vehicles pause fuel/odo logging; reporting issues always works. */

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
  const [logTarget, setLogTarget] = useState<string | null>(null);
  const vehicle = fleet.vehicles.find((v) => v.assignedTo === viewerId && v.status !== "sold");
  const viewer = staff.find((s) => s.id === viewerId);
  const loggedBy = { id: viewerId, name: viewer?.name ?? "You" };
  const working = fleet.vehicles.filter((v) => v.status !== "sold");
  const closeLog = () => {
    setLogKind(null);
    setLogTarget(null);
  };

  if (!vehicle) {
    // No assignment — but you can still fuel the pool ute you borrowed today.
    const fallback = working.find((v) => v.assignedTo === null) ?? working[0];
    return (
      <div>
        <div className="emptybox">
          <span className="ei">
            <Icon name="truck" size={24} />
          </span>
          <b>No vehicle assigned</b>
          <em>When a vehicle is assigned to you, its rego, service status and fuel logging will live here.</em>
        </div>
        {fallback && (
          <div className="fl-emptyadd">
            <button className="pbtn ghost" onClick={() => setLogKind("fuel")}>
              <Icon name="fuel" size={16} />
              Lodge fuel for company vehicle
            </button>
          </div>
        )}
        {logKind && fallback && (
          <LogModal
            kind={logKind}
            vehicle={fallback}
            fleetVehicles={working}
            loggedBy={loggedBy}
            onSave={(log) => {
              fleet.addLog(log);
              closeLog();
            }}
            onClose={closeLog}
          />
        )}
      </div>
    );
  }

  const paused = vehicle.status === "offroad";
  const borrowable = working.filter((v) => v.id !== vehicle.id && v.status === "active");
  const chips = vehicleChips(vehicle, openIssueCount(fleet.logs, vehicle.id));
  const vLogs = logsFor(fleet.logs, vehicle.id);
  const eco = fuelEconomy(vLogs);
  const recent = vLogs.slice(0, 8);
  const tiles = vehicleFacts(vehicle).filter((f) => f.key !== "odo");

  return (
    <div className="fl-my">
      <div className="fl-hero">
        <div className="fl-hlead">
          <div className="fl-htag">
            <Icon name="truck" size={12} />
            Your vehicle
          </div>
          <h2>{displayName(vehicle)}</h2>
          <div className="fl-hsub">
            {modelLabel(vehicle)}
            {vehicle.name && <span className="fl-plate2">{vehicle.plate}</span>}
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
        {QUICK.map((q) => {
          const off = paused && q.kind !== "issue";
          return (
            <button
              key={q.kind}
              className={`fl-qa${off ? " paused" : ""}`}
              disabled={off}
              onClick={() => setLogKind(q.kind)}
            >
              <span className={`fl-qi ${q.kind}`}>
                <Icon name={q.icon} size={19} />
              </span>
              <span>
                <b>{q.label}</b>
                <em>{off ? "Paused while off road" : q.sub}</em>
              </span>
            </button>
          );
        })}
      </div>

      {paused && (
        <div className="fl-offnote">
          <Icon name="alert" size={15} />
          {displayName(vehicle)} is off the road — fuel &amp; odometer logging is paused. You can still
          report issues.
          {borrowable.length > 0 && (
            <button
              className="fl-offbtn"
              onClick={() => {
                setLogTarget(borrowable[0].id);
                setLogKind("fuel");
              }}
            >
              <Icon name="fuel" size={13} />
              Lodge fuel for another vehicle
            </button>
          )}
        </div>
      )}

      <div className="fl-up">
        {tiles.map((u) => (
          <div key={u.key} className={`fl-ut ${u.state}`}>
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
            <em>Your fuel, odometer &amp; issue history on {displayName(vehicle)}</em>
          </span>
        </div>
        {recent.length === 0 ? (
          <div className="fl-hempty">Nothing logged yet — your fuel, odo and issue reports land here.</div>
        ) : (
          recent.map((l) => <LogRow key={l.id} log={l} eco={eco[l.id]} />)
        )}
      </div>

      {logKind && (
        <LogModal
          kind={logKind}
          vehicle={(logTarget && working.find((v) => v.id === logTarget)) || vehicle}
          fleetVehicles={working}
          loggedBy={loggedBy}
          onSave={(log) => {
            fleet.addLog(log);
            closeLog();
          }}
          onClose={closeLog}
        />
      )}
    </div>
  );
}
