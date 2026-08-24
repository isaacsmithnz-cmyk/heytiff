"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { Chevron } from "@/components/logo";
import type { FleetAiVehicle, ValueFleetResult } from "@/lib/fleet/valuation";
import type { FleetState } from "./fleet-state";
import {
  STATUS_LABEL,
  type FleetSort,
  type FleetStaff,
  type FleetTab,
  type LogKind,
  type VehicleLog,
  displayName,
  filterVehicles,
  fleetAiValue,
  fleetValue,
  fmtMoney,
  fuelEconomy,
  logsFor,
  modelLabel,
  openIssueCount,
  parseValuations,
  sortVehicles,
  valuationStale,
  vehicleChips,
  worstState,
} from "./logic";
import { DetailModal, EditLogModal, LogModal, VehicleFormModal } from "./modals";
import { Plate } from "./plate";

/* Fleet register — the Manager/Owner view: whole fleet, assignment, service
   schedule & valuations (book + Tiff estimate). Mirrors the Team directory's
   tabs → tools → rows shape. */

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
  | { t: "log"; id: string; kind: LogKind }
  | { t: "fix"; id: string; log: VehicleLog };

export function FleetRegister({
  fleet,
  staff,
  today,
  view,
  openVehicleId = null,
}: {
  fleet: FleetState;
  staff: FleetStaff[];
  today: string;
  /** Which slice of the fleet to show — the Assets screen owns the tab strip
      now, so the register renders one face rather than carrying its own. */
  view: FleetTab;
  /** `?v=` — a vehicle to open on arrival, from a plate clicked elsewhere.
      Looked up against the whole fleet, not the current face, so a link to a
      sold or pooled vehicle still opens from the Fleet tab. */
  openVehicleId?: string | null;
}) {
  const { vehicles, logs } = fleet;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<FleetSort>("attention");
  /* ?v=<id> OPENS THAT VEHICLE, which is what makes the plate on a staff card a
     door rather than a signpost. The id is read on the SERVER and handed down —
     `useSearchParams` would put this whole tree behind a Suspense boundary,
     which is the call Studio, Organisation and the profile all made too. A
     param and not a path segment, either: the app shell keys its outlet on
     pathname, so a link that writes the path remounts the page it lands on.

     IT SEEDS THE STATE, it does not sync it. An effect would have to remember
     which id it had already honoured or the close button would fight the URL
     and the modal would spring back open — and setState in an effect is a
     cascading render the lint rule is right to refuse. The initialiser runs
     once, at mount, which is exactly when a link arrives; from then on the
     register owns its own modal. Looked up against the whole fleet rather than
     the current face, so a link to a sold or pooled vehicle still opens. */
  const [modal, setModal] = useState<ModalState>(() =>
    openVehicleId && vehicles.some((v) => v.id === openVehicleId)
      ? { t: "detail", id: openVehicleId }
      : { t: "none" },
  );
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [valuing, setValuing] = useState(false);
  const [valueErr, setValueErr] = useState<string | null>(null);
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

  const working = vehicles.filter((v) => v.status !== "sold");
  const sold = vehicles.filter((v) => v.status === "sold");
  const rows = useMemo(
    () => sortVehicles(filterVehicles(vehicles, logs, view, query, staffName), logs, sort),
    [vehicles, logs, view, query, staffName, sort],
  );

  const openVehicle = "id" in modal ? vehicles.find((v) => v.id === modal.id) : undefined;
  const aiTotal = fleetAiValue(vehicles, fleet.aiValues);

  const runValuation = async () => {
    if (valuing) return;
    setValuing(true);
    setValueErr(null);
    const payload: FleetAiVehicle[] = working.map((v) => ({
      id: v.id,
      make: v.make,
      model: v.model,
      year: v.year,
      odometerKm: v.odometer,
      status: STATUS_LABEL[v.status],
      purchasePriceAud: v.purchasePrice || null,
      ageYears: v.purchaseDateDays ? Math.round((v.purchaseDateDays / 365.25) * 10) / 10 : null,
      notes: v.notes,
    }));
    try {
      /* A route handler, not an action — pricing against live listings runs
         long enough to need its own maxDuration (see the route's comment). */
      const res = (await (
        await fetch("/api/fleet/value", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vehicles: payload }),
        })
      ).json()) as ValueFleetResult;
      if (res.ok) fleet.setValuations(parseValuations(res, vehicles));
      else setValueErr(res.reason === "no-key" ? "Tiff is offline — no API key configured." : res.reason);
    } catch {
      setValueErr("Tiff couldn't be reached.");
    }
    setValuing(false);
  };

  if (vehicles.length === 0) {
    return (
      <div className="wb2-card">
        <div className="ppanel2">
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
            staff={staff}
            today={today}
            onSave={(v) => {
              fleet.saveVehicle(v);
              setModal({ t: "none" });
            }}
            onClose={() => setModal({ t: "none" })}
          />
        )}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef}>
      <div
        className="dir"
        id={`astp-${view}`}
        role="tabpanel"
        aria-labelledby={`ast-${view}`}
        tabIndex={-1}
      >
        {/* The card's own toolbar — it sat between the tab strip and the card,
            which the joined strip leaves no room for. */}
        <div className="dirtools">
          <div className="dsearch">
            <Icon name="search" size={17} />
            <input
              className="dsearchin"
              placeholder="Search rego, name or driver..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <label className="dsortwrap">
            <Icon name="arrowDown" size={14} />
            <select className="dsort" value={sort} onChange={(e) => setSort(e.target.value as FleetSort)}>
              <option value="attention">Needs attention</option>
              <option value="name">Name (A–Z)</option>
              <option value="value">Value (high–low)</option>
            </select>
          </label>
          <button
            className={`pbtn ghost fl-add fl-valuebtn${valuing ? " busy" : ""}`}
            disabled={valuing}
            onClick={runValuation}
            title="Tiff estimates each vehicle's AU market value — Manager+ only"
          >
            <Chevron size={19} gradient decorative />
            {valuing ? "Tiff is valuing…" : "Value with Tiff"}
          </button>
          <button className="pbtn primary fl-add" onClick={() => setModal({ t: "add" })}>
            <Icon name="plus" size={16} />
            Add vehicle
          </button>
        </div>
        {valueErr && <div className="fl-aierr">{valueErr}</div>}
        {fleet.error && <div className="fl-aierr">{fleet.error}</div>}

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
            const isSold = v.status === "sold";
            const val = fleet.aiValues[v.id];
            const stale = valuationStale(v, val);
            return (
              <div
                key={v.id}
                className={`dirrow flrow${isSold ? " off" : ""}`}
                onClick={() => setModal({ t: "detail", id: v.id })}
              >
                <span className="dname">
                  <span className={`fl-av ${isSold ? "ok" : worstState(chips)}`}>
                    <Icon name="truck" size={18} />
                  </span>
                  <span>
                    <b>{displayName(v)}</b>
                    <em>{modelLabel(v)}</em>
                  </span>
                </span>
                <Plate plate={v.plate} state={v.plateState} size="sm" />
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
                    <span className="fl-pool">{isSold ? "—" : "Pool"}</span>
                  )}
                </span>
                {isSold ? (
                  <span className="dchip mute">Sold</span>
                ) : (
                  <span className={`dchip ${chip ? chip.state : "ok"}`}>
                    <Icon name={chip ? (chip.state === "bad" ? "alert" : "clock") : "check"} size={12} />
                    {chip ? chip.label : "All good"}
                    {chips.length > 1 && <i className="fl-more">+{chips.length - 1}</i>}
                  </span>
                )}
                <span className="fl-value">
                  <b>{fmtMoney(v.value)}</b>
                  {!isSold && val && (
                    <em
                      className={`fl-tiff${stale ? " stale" : ""}`}
                      title={
                        stale
                          ? "Odometer has moved since Tiff valued this — run Value with Tiff again"
                          : `Tiff: ${fmtMoney(val.low)}–${fmtMoney(val.high)}${val.note ? ` · ${val.note}` : ""}`
                      }
                    >
                      <Chevron size={14} gradient decorative />
                      {fmtMoney(val.point)}
                    </em>
                  )}
                </span>
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
            {working.length} vehicle{working.length === 1 ? "" : "s"}
            {sold.length > 0 && ` · ${sold.length} sold`}
          </span>
          <span>
            Fleet value <b>{fmtMoney(fleetValue(vehicles))}</b>
            {aiTotal !== null && (
              <em className="fl-tiff">
                <Chevron size={14} gradient decorative />
                Tiff ≈ {fmtMoney(aiTotal)}
              </em>
            )}
          </span>
        </div>
      </div>

      {modal.t === "add" && (
        <VehicleFormModal
          initial={null}
          staff={staff}
          today={today}
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
          staff={staff}
          today={today}
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
          logs={logsFor(logs, openVehicle.id)}
          eco={fuelEconomy(logsFor(logs, openVehicle.id))}
          valuation={fleet.aiValues[openVehicle.id]}
          valuationIsStale={valuationStale(openVehicle, fleet.aiValues[openVehicle.id])}
          staff={staff}
          manager
          onClose={() => setModal({ t: "none" })}
          onEdit={() => setModal({ t: "edit", id: openVehicle.id })}
          onAssign={(sid) => fleet.assignVehicle(openVehicle.id, sid)}
          onStatus={(status) => fleet.saveVehicle({ ...openVehicle, status })}
          onLog={(kind) => setModal({ t: "log", id: openVehicle.id, kind })}
          onResolve={fleet.resolveIssue}
          onCorrect={(log) => setModal({ t: "fix", id: openVehicle.id, log })}
          onRemove={() => {
            fleet.removeVehicle(openVehicle.id);
            setModal({ t: "none" });
          }}
        />
      )}
      {modal.t === "fix" && openVehicle && (
        <EditLogModal
          log={modal.log}
          today={today}
          onSave={(patch) => {
            fleet.editLog(modal.log.id, patch);
            setModal({ t: "detail", id: openVehicle.id });
          }}
          onDelete={() => {
            fleet.deleteLog(modal.log.id);
            setModal({ t: "detail", id: openVehicle.id });
          }}
          onClose={() => setModal({ t: "detail", id: openVehicle.id })}
        />
      )}
      {modal.t === "log" && openVehicle && (
        <LogModal
          kind={modal.kind}
          today={today}
          vehicle={openVehicle}
          fleetVehicles={vehicles}
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
