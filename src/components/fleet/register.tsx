"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { DemoStaff } from "@/mock/demo";
import type { FleetState } from "./fleet-state";
import {
  type FleetSort,
  type FleetTab,
  type LogKind,
  filterVehicles,
  fleetValue,
  fmtMoney,
  openIssueCount,
  sortVehicles,
  vehicleChips,
  vehicleName,
  worstState,
} from "./logic";
import { DetailModal, LogModal, VehicleFormModal } from "./modals";

/* Fleet register — the Manager/Owner view: whole fleet, assignment, service
   schedule & valuations. Mirrors the Team directory's tabs → tools → rows shape. */

function driverHue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

type ModalState =
  | { t: "none" }
  | { t: "add" }
  | { t: "edit"; id: string }
  | { t: "detail"; id: string }
  | { t: "log"; id: string; kind: LogKind };

export function FleetRegister({ fleet, staff }: { fleet: FleetState; staff: DemoStaff[] }) {
  const { vehicles, logs } = fleet;
  const [tab, setTab] = useState<FleetTab>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<FleetSort>("attention");
  const [modal, setModal] = useState<ModalState>({ t: "none" });
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".dmorewrap")) setOpenMenu(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenu]);

  const staffName = useMemo(() => {
    const byId = new Map(staff.map((s) => [s.id, s.name]));
    return (id: string | null) => (id ? (byId.get(id) ?? "") : "");
  }, [staff]);

  const attention = vehicles.filter((v) => vehicleChips(v, openIssueCount(logs, v.id)).length > 0);
  const pool = vehicles.filter((v) => v.assignedTo === null);
  const rows = useMemo(
    () => sortVehicles(filterVehicles(vehicles, logs, tab, query, staffName), logs, sort),
    [vehicles, logs, tab, query, staffName, sort],
  );

  const openVehicle = "id" in modal ? vehicles.find((v) => v.id === modal.id) : undefined;
  const takenIds = vehicles.map((v) => v.id);

  const tabBtn = (key: FleetTab, val: number, label: string, sub: string) => (
    <button key={key} className={`dirtab${tab === key ? " on" : ""}`} onClick={() => setTab(key)}>
      <span className="dtval">{val}</span>
      <span className="dtlab">{label}</span>
      <span className="dtsub">{sub}</span>
    </button>
  );
  const tabIdx = tab === "all" ? 0 : tab === "attention" ? 1 : 2;

  if (vehicles.length === 0) {
    return (
      <div>
        <div className="emptybox">
          <span className="ei">
            <Icon name="truck" size={24} />
          </span>
          <b>No vehicles yet</b>
          <em>Assign vehicles, track service, rego &amp; insurance expiry and fuel.</em>
        </div>
        <div className="fl-emptyadd">
          <button className="pbtn primary" onClick={() => setModal({ t: "add" })}>
            <Icon name="plus" size={16} />
            Add your first vehicle
          </button>
        </div>
        {modal.t === "add" && (
          <VehicleFormModal
            initial={null}
            takenIds={takenIds}
            staff={staff}
            onSave={(v) => {
              fleet.saveVehicle(v);
              setModal({ t: "none" });
            }}
            onClose={() => setModal({ t: "none" })}
          />
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef}>
      <div className="dirtabs" data-view={tab === "attention" ? "warn" : tab} style={{ "--idx": tabIdx } as React.CSSProperties}>
        <span className="dirtab-slide" style={{ left: `calc(6px + ${tabIdx} * (100% - 12px) / 3)` }} />
        {tabBtn("all", vehicles.length, "Fleet", "All vehicles")}
        {tabBtn("attention", attention.length, "Need attention", "Expiries, service & issues")}
        {tabBtn("pool", pool.length, "Pool", "Unassigned & spare")}
      </div>

      <div className="dirtools">
        <div className="dsearch">
          <Icon name="search" size={17} />
          <input
            className="dsearchin"
            placeholder="Search callsign, plate or driver..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="dsortwrap">
          <Icon name="arrowDown" size={14} />
          <select className="dsort" value={sort} onChange={(e) => setSort(e.target.value as FleetSort)}>
            <option value="attention">Needs attention</option>
            <option value="callsign">Callsign (A–Z)</option>
            <option value="value">Value (high–low)</option>
          </select>
        </label>
        <button className="pbtn primary fl-add" onClick={() => setModal({ t: "add" })}>
          <Icon name="plus" size={16} />
          Add vehicle
        </button>
      </div>

      <div className="dir">
        <div className="dirhead flhead">
          <span>Vehicle</span>
          <span>Rego</span>
          <span>Driver</span>
          <span>Status</span>
          <span className="flval">Value</span>
          <span></span>
        </div>
        <div className="dirrows">
          {rows.map((v) => {
            const chips = vehicleChips(v, openIssueCount(logs, v.id));
            const chip = chips[0];
            const driver = staffName(v.assignedTo);
            return (
              <div key={v.id} className="dirrow flrow" onClick={() => setModal({ t: "detail", id: v.id })}>
                <span className="dname">
                  <span className={`fl-av ${worstState(chips)}`}>
                    <Icon name="truck" size={18} />
                  </span>
                  <span>
                    <b>{v.callsign}</b>
                    <em>{vehicleName(v)}</em>
                  </span>
                </span>
                <span className="fl-plate">{v.plate}</span>
                <span className="fl-driver">
                  {driver ? (
                    <>
                      <span className="fl-dav" style={{ background: `hsl(${driverHue(driver)} 64% 42%)` }}>
                        {driver
                          .split(" ")
                          .map((p) => p[0])
                          .join("")
                          .slice(0, 2)}
                      </span>
                      {driver}
                    </>
                  ) : (
                    <span className="fl-pool">Pool</span>
                  )}
                </span>
                <span className={`dchip ${chip ? chip.state : "ok"}`}>
                  <Icon name={chip ? (chip.state === "bad" ? "alert" : "clock") : "check"} size={12} />
                  {chip ? chip.label : "All good"}
                  {chips.length > 1 && <i className="fl-more">+{chips.length - 1}</i>}
                </span>
                <span className="fl-value">{fmtMoney(v.value)}</span>
                <span className="dmorewrap" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="dmore"
                    aria-label="Actions"
                    onClick={() => setOpenMenu(openMenu === v.id ? null : v.id)}
                  >
                    <Icon name="dots" size={18} />
                  </button>
                  {openMenu === v.id && (
                    <div className="dmenu open">
                      <button
                        onClick={() => {
                          setModal({ t: "detail", id: v.id });
                          setOpenMenu(null);
                        }}
                      >
                        <Icon name="arrowUR" size={15} />
                        View details
                      </button>
                      <button
                        onClick={() => {
                          setModal({ t: "edit", id: v.id });
                          setOpenMenu(null);
                        }}
                      >
                        <Icon name="edit" size={15} />
                        Edit vehicle
                      </button>
                      <button
                        onClick={() => {
                          setModal({ t: "log", id: v.id, kind: "service" });
                          setOpenMenu(null);
                        }}
                      >
                        <Icon name="wrench" size={15} />
                        Log service
                      </button>
                    </div>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {rows.length === 0 && <div className="direm on">No vehicles match your filters.</div>}
        <div className="fl-total">
          <span>
            {vehicles.length} vehicle{vehicles.length === 1 ? "" : "s"}
          </span>
          <span>
            Fleet value <b>{fmtMoney(fleetValue(vehicles))}</b>
          </span>
        </div>
      </div>

      {modal.t === "add" && (
        <VehicleFormModal
          initial={null}
          takenIds={takenIds}
          staff={staff}
          onSave={(v) => {
            fleet.saveVehicle(v);
            setModal({ t: "none" });
          }}
          onClose={() => setModal({ t: "none" })}
        />
      )}
      {modal.t === "edit" && openVehicle && (
        <VehicleFormModal
          initial={openVehicle}
          takenIds={takenIds}
          staff={staff}
          onSave={(v) => {
            fleet.saveVehicle(v);
            setModal({ t: "detail", id: v.id });
          }}
          onClose={() => setModal({ t: "detail", id: openVehicle.id })}
        />
      )}
      {modal.t === "detail" && openVehicle && (
        <DetailModal
          vehicle={openVehicle}
          chips={vehicleChips(openVehicle, openIssueCount(logs, openVehicle.id))}
          logs={logs.filter((l) => l.vehicleId === openVehicle.id)}
          staff={staff}
          manager
          onClose={() => setModal({ t: "none" })}
          onEdit={() => setModal({ t: "edit", id: openVehicle.id })}
          onAssign={(sid) => fleet.assignVehicle(openVehicle.id, sid)}
          onLog={(kind) => setModal({ t: "log", id: openVehicle.id, kind })}
          onResolve={fleet.resolveIssue}
          onRemove={() => {
            fleet.removeVehicle(openVehicle.id);
            setModal({ t: "none" });
          }}
        />
      )}
      {modal.t === "log" && openVehicle && (
        <LogModal
          kind={modal.kind}
          vehicle={openVehicle}
          loggedBy={{ id: null, name: "You" }}
          onSave={(log) => {
            fleet.addLog(log);
            setModal({ t: "detail", id: openVehicle.id });
          }}
          onClose={() => setModal({ t: "detail", id: openVehicle.id })}
        />
      )}
    </div>
  );
}
