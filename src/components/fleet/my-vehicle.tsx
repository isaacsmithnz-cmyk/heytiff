"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import {
  type LogKind,
  type NewLog,
  type VehicleIdentity,
  type VehicleLog,
  type VehicleWithFacts,
  displayName,
  fmtKm,
  fuelEconomy,
  modelLabel,
  openIssueCount,
  vehicleChips,
  vehicleFacts,
} from "./logic";
import type { LogEdit } from "@/app/actions/fleet";
import { EditLogModal, LogModal, LogRow } from "./modals";
import { Plate } from "./plate";

/* "My vehicle" — the Staff lens: just the vehicle assigned to you, with log
   fuel / odometer / report-issue actions. No register, no other vehicles, no
   valuations (spec: Fleet ◐ own for every role). Off-road vehicles pause
   fuel/odo logging; reporting issues always works.

   The props are the projection made visible. `vehicle` is facts-width (no
   money, no assignment) and `pickable` is identity-width, because a driver
   without `assets_all` is sent exactly enough to name a pool vehicle and
   satisfy the odometer guardrail — see lib/projections.ts. */

/* WHICH FACE SHOWS WHICH LOGS, and what an empty one says. The empty line is
   per-face on purpose: "Nothing logged yet" under a tab called Issues reads as
   the screen being broken rather than as good news. */
export type VehicleFace = "vehicle" | "fuel" | "issues" | "services";

export const LOG_FACES: Record<
  Exclude<VehicleFace, "vehicle">,
  { kinds: LogKind[]; empty: string }
> = {
  fuel: {
    kinds: ["fuel", "odo"],
    empty: "No fill-ups yet — fuel and odometer readings land here.",
  },
  issues: {
    kinds: ["issue"],
    empty: "Nothing wrong with it — anything you report stays here until it is resolved.",
  },
  services: {
    kinds: ["service"],
    empty: "No service logged on this vehicle yet.",
  },
};

const QUICK: { kind: LogKind; icon: string; label: string; sub: string }[] = [
  { kind: "fuel", icon: "fuel", label: "Log fuel", sub: "Litres, cost & odo" },
  { kind: "odo", icon: "gauge", label: "Update odometer", sub: "Reading off the dash" },
  { kind: "issue", icon: "alert", label: "Report an issue", sub: "Flag something wrong" },
];

export function MyVehicle({
  vehicle,
  pickable,
  logs,
  error,
  onLog,
  onEditLog,
  onDeleteLog,
  today,
  viewerStaffId,
  face,
}: {
  /** The vehicle assigned to you, or null when you have none. */
  vehicle: VehicleWithFacts | null;
  /** Every vehicle you may log against — yours plus the pool. */
  pickable: VehicleIdentity[];
  /** History for your vehicle. */
  logs: VehicleLog[];
  error: string | null;
  onLog: (log: NewLog) => void;
  onEditLog: (logId: string, patch: LogEdit) => void;
  onDeleteLog: (logId: string) => void;
  /* Correcting your OWN entry needs no capability. This vehicle's history can
     contain other people's entries (a pool ute somebody else fuelled), so the
     affordance is per-row, not per-screen. */
  viewerStaffId: string | null;
  /** The server's AU calendar date — the ceiling on a receipt date, and never
      the browser's, which is the day before for most of the working morning. */
  today: string;
  /** Which face of the card to render. Absent = the pre-tabs combined page,
      which the Assets staff lens still draws. `vehicle` is the truck as it
      stands; the other three are the log, split by what you came to ask. */
  face?: VehicleFace;
}) {
  const [logKind, setLogKind] = useState<LogKind | null>(null);
  const [logTarget, setLogTarget] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<VehicleLog | null>(null);
  const mine = (l: VehicleLog) => viewerStaffId !== null && l.staffId === viewerStaffId;
  const closeLog = () => {
    setLogKind(null);
    setLogTarget(null);
  };
  const errBox = error ? <div className="fl-aierr">{error}</div> : null;

  /* THE LOG FACES. Handled before the no-vehicle branch so they still answer
     when nothing is assigned.

     THERE USED TO BE ONE OF THESE, CALLED HISTORY, and it was every log of
     every kind in one column — "History is too broad. Where can you see the
     issues that you have logged? Or your last services?" (Isaac, 2026-08-23).
     Which is the right question: nobody opens a vehicle asking "what has
     happened", they ask "is the thing I reported fixed" or "when was it last
     serviced". Three faces, one question each.

     Odometer readings ride with Fuel rather than taking a face of their own —
     they are the same act of running the truck, and the economy figure on a
     fill is computed FROM them. */
  if (face && face !== "vehicle") {
    const spec = LOG_FACES[face];
    const shown = logs.filter((l) => spec.kinds.includes(l.kind));
    /* Issues sort OPEN FIRST, then by recency. Everywhere else newest-first is
       right; here the question is "is it fixed", and an open fault from March
       outranks a resolved one from yesterday. */
    const ordered =
      face === "issues"
        ? [...shown].sort((a, b) => {
            const open = (l: VehicleLog) => (l.status === "open" ? 0 : 1);
            return open(a) - open(b) || a.ago - b.ago;
          })
        : shown;
    const eco = fuelEconomy(logs);
    return (
      <div>
        {errBox}
        {ordered.length === 0 ? (
          <div className="fl-hempty">{spec.empty}</div>
        ) : (
          ordered.map((l) => (
            <LogRow key={l.id} log={l} eco={eco[l.id]} onCorrect={mine(l) ? setCorrecting : undefined} />
          ))
        )}
        {correcting && (
          <EditLogModal
            log={correcting}
            today={today}
            onSave={(patch) => {
              onEditLog(correcting.id, patch);
              setCorrecting(null);
            }}
            onDelete={() => {
              onDeleteLog(correcting.id);
              setCorrecting(null);
            }}
            onClose={() => setCorrecting(null)}
          />
        )}
      </div>
    );
  }

  if (!vehicle) {
    // No assignment — but you can still fuel the pool ute you borrowed today.
    const fallback = pickable[0];
    return (
      <div>
        {errBox}
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
              Log fuel for company vehicle
            </button>
          </div>
        )}
        {logKind && fallback && (
          <LogModal
            kind={logKind}
            today={today}
            vehicle={fallback}
            fleetVehicles={pickable}
            onSave={(log) => {
              onLog(log);
              closeLog();
            }}
            onClose={closeLog}
          />
        )}
      </div>
    );
  }

  const paused = vehicle.status === "offroad";
  const borrowable = pickable.filter((v) => v.id !== vehicle.id && v.status === "active");
  const chips = vehicleChips(vehicle, openIssueCount(logs, vehicle.id));
  const eco = fuelEconomy(logs);
  const recent = logs.slice(0, 8);
  const tiles = vehicleFacts(vehicle).filter((f) => f.key !== "odo");

  return (
    <div className="fl-my">
      {errBox}
      <div className="fl-hero">
        <div className="fl-hlead">
          <div className="fl-htag">
            <Icon name="truck" size={12} />
            Your vehicle
          </div>
          <h2>{displayName(vehicle)}</h2>
          <div className="fl-hsub">
            {modelLabel(vehicle)}
            {vehicle.name && <Plate plate={vehicle.plate} state={vehicle.plateState} />}
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
          {/* `{" "}` or this reads "Hilux uteis off the road" — the block wraps
              and carries an entity, which costs the text its leading space.
              See lib/format/__tests__/jsx-entity-spacing. */}
          {displayName(vehicle)}{" "}
          is off the road — fuel &amp; odometer logging is paused. You can still report issues.
          {borrowable.length > 0 && (
            <button
              className="fl-offbtn"
              onClick={() => {
                setLogTarget(borrowable[0].id);
                setLogKind("fuel");
              }}
            >
              <Icon name="fuel" size={13} />
              Log fuel for another vehicle
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

      {/* Only the combined page keeps the recent-eight card — with tabs, the
          History face IS the history, all of it. */}
      {!face && (
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
            recent.map((l) => (
              <LogRow
                key={l.id}
                log={l}
                eco={eco[l.id]}
                onCorrect={mine(l) ? setCorrecting : undefined}
              />
            ))
          )}
        </div>
      )}

      {correcting && (
        <EditLogModal
          log={correcting}
          today={today}
          onSave={(patch) => {
            onEditLog(correcting.id, patch);
            setCorrecting(null);
          }}
          onDelete={() => {
            onDeleteLog(correcting.id);
            setCorrecting(null);
          }}
          onClose={() => setCorrecting(null)}
        />
      )}

      {logKind && (
        <LogModal
          kind={logKind}
          today={today}
          vehicle={(logTarget && pickable.find((v) => v.id === logTarget)) || vehicle}
          fleetVehicles={pickable}
          onSave={(log) => {
            onLog(log);
            closeLog();
          }}
          onClose={closeLog}
        />
      )}
    </div>
  );
}
