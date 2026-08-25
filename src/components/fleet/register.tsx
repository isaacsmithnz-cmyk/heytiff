"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { Chevron } from "@/components/logo";
import type { FleetState } from "./fleet-state";
import {
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
  sortVehicles,
  valuationStale,
  vehicleChips,
  worstState,
  type RenewalKind,
} from "./logic";
import {
  DetailModal,
  EditLogModal,
  LogModal,
  RenewalHistoryModal,
  RenewalModal,
  VehicleFormModal,
} from "./modals";
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
  | { t: "fix"; id: string; log: VehicleLog }
  | { t: "history"; id: string; kind: RenewalKind }
  /* `back` is where Cancel and Save return to. Filing from the history popup
     lands back in it, so the row you just added is visible rather than taken
     on trust. */
  | { t: "renew"; id: string; kind: RenewalKind; back: "detail" | "history" };

/* The reason a refused valuation gave, or a plain one. Read inside a
   try/catch, where a `??` is a value block React Compiler 1.0 cannot lower —
   it gives up on the whole component when it meets one. */
const valuationError = (reason: string | undefined) =>
  reason ?? "Tiff couldn't complete that.";

export function FleetRegister({
  fleet,
  staff,
  today,
  openVehicleId = null,
}: {
  fleet: FleetState;
  staff: FleetStaff[];
  today: string;
  /** `?v=` — a vehicle to open on arrival, from a plate clicked elsewhere.
      Looked up against the whole fleet, not the current face, so a link to a
      sold or pooled vehicle still opens from the Fleet tab. */
  openVehicleId?: string | null;
}) {
  const { vehicles, logs } = fleet;
  const [query, setQuery] = useState("");
  /* The slices that used to be tabs (Need attention / Pool / Sold) are a
     toolbar filter now — the strip above switches asset class, not fleet
     slices. Sold stays an OPTION rather than a face so sold vehicles remain
     reachable; "All vehicles" still excludes them, as the Fleet tab did. */
  const [filter, setFilter] = useState<FleetTab>("all");
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
  const router = useRouter();

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
  const attention = working.filter(
    (v) => vehicleChips(v, openIssueCount(logs, v.id)).length > 0,
  );
  const pool = working.filter((v) => v.assignedTo === null);
  const rows = useMemo(
    () => sortVehicles(filterVehicles(vehicles, logs, filter, query, staffName), logs, sort),
    [vehicles, logs, filter, query, staffName, sort],
  );

  const openVehicle = "id" in modal ? vehicles.find((v) => v.id === modal.id) : undefined;
  const aiTotal = fleetAiValue(vehicles, fleet.aiValues);

  /* The route owns the run now (issue #502): it reads the fleet, prices it,
     and PERSISTS before responding — this component is a viewer, not the
     courier the result has to survive in. So finishing, from here, is just
     refreshing the page data. `watchRun` covers the runs this tab didn't
     start (or lost): a reload mid-run finds the lease via GET and waits on it
     instead of showing an idle button. */
  const watchRun = useCallback(() => {
    setValuing(true);
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/fleet/value");
        /* two guards rather than one `&&`, because React Compiler 1.0 cannot
           lower a value block inside a try/catch — the short circuit is the
           same, the body still only runs on a finished run */
        if (!res.ok) return;
        const { running } = await res.json();
        if (running) return;
        clearInterval(poll);
        setValuing(false);
        router.refresh();
      } catch {
        /* transient — the next tick asks again */
      }
    }, 8000);
    return () => clearInterval(poll);
  }, [router]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    (async () => {
      try {
        const res = await fetch("/api/fleet/value");
        /* guards, not one `&&` chain — see the note in `watchRun` */
        if (gone) return;
        if (!res.ok) return;
        const { running } = await res.json();
        if (running) stop = watchRun();
      } catch {
        /* no answer, no spinner — the button stays pressable */
      }
    })();
    return () => {
      gone = true;
      stop?.();
    };
  }, [watchRun]);

  const runValuation = async () => {
    if (valuing) return;
    setValuing(true);
    setValueErr(null);
    try {
      /* A route handler, not an action — pricing against live listings runs
         long enough to need its own maxDuration (see the route's comment). */
      const res = (await (await fetch("/api/fleet/value", { method: "POST" })).json()) as {
        ok: boolean;
        running?: boolean;
        reason?: string;
      };
      if (res.ok) router.refresh();
      else if (res.running) {
        watchRun(); // someone else's press — wait for theirs instead of erroring
        return;
      } else setValueErr(valuationError(res.reason));
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
            onSave={(v, invoiceId) => {
              fleet.saveVehicle(v, invoiceId);
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
        id="astp-fleet"
        role="tabpanel"
        aria-labelledby="ast-fleet"
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
          <label className="dsortwrap">
            <Icon name="layers" size={14} />
            <select
              className="dsort"
              aria-label="Filter vehicles"
              value={filter}
              onChange={(e) => setFilter(e.target.value as FleetTab)}
            >
              <option value="all">All vehicles</option>
              <option value="attention">{`Needs attention (${attention.length})`}</option>
              <option value="pool">{`Pool (${pool.length})`}</option>
              <option value="sold">{`Sold (${sold.length})`}</option>
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
                      {/* The note was hover-only and Isaac found it by accident.
                          The ⓘ is the visible door; the detail modal prints the
                          source in full. */}
                      <button
                        className="fl-tiffinfo"
                        aria-label="How Tiff priced this"
                        onClick={(e) => {
                          e.stopPropagation();
                          setModal({ t: "detail", id: v.id });
                        }}
                      >
                        <Icon name="info" size={13} />
                      </button>
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
          onSave={(v, invoiceId) => {
            fleet.saveVehicle(v, invoiceId);
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
          onSave={(v, invoiceId) => {
            fleet.saveVehicle(v, invoiceId);
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
          documents={fleet.documents[openVehicle.id] ?? []}
          policies={fleet.policies[openVehicle.id] ?? []}
          onRenew={(kind) => setModal({ t: "renew", id: openVehicle.id, kind, back: "detail" })}
          onHistory={(kind) => setModal({ t: "history", id: openVehicle.id, kind })}
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
      {modal.t === "history" && openVehicle && (
        <RenewalHistoryModal
          vehicle={openVehicle}
          kind={modal.kind}
          documents={fleet.documents[openVehicle.id] ?? []}
          policies={fleet.policies[openVehicle.id] ?? []}
          onAdd={() =>
            setModal({ t: "renew", id: openVehicle.id, kind: modal.kind, back: "history" })
          }
          onClose={() => setModal({ t: "detail", id: openVehicle.id })}
        />
      )}
      {modal.t === "renew" && openVehicle && (
        <RenewalModal
          vehicle={openVehicle}
          kind={modal.kind}
          today={today}
          onSave={(input) => {
            fleet.recordRenewal({ ...input, vehicleId: openVehicle.id });
            setModal(
              modal.back === "history"
                ? { t: "history", id: openVehicle.id, kind: modal.kind }
                : { t: "detail", id: openVehicle.id },
            );
          }}
          onClose={() =>
            setModal(
              modal.back === "history"
                ? { t: "history", id: openVehicle.id, kind: modal.kind }
                : { t: "detail", id: openVehicle.id },
            )
          }
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
