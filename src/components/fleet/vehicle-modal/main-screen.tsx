"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { Chevron } from "@/components/logo";
import type { StoredDocument } from "@/lib/documents/query";
import { dateFromDays } from "@/lib/fleet/map";
import { Plate } from "../plate";
import { LogRow } from "../modals";
import {
  STATUS_LABEL,
  displayName,
  fmtKm,
  fmtMoney,
  modelLabel,
  serviceDueText,
  type AiValuation,
  type FleetStaff,
  type LogKind,
  type Vehicle,
  type VehicleFinance,
  type VehicleLog,
  type VehiclePolicy,
  type VehicleStatus,
} from "../logic";
import {
  STATUS_DOT,
  complianceRows,
  currentFinance,
  financePosition,
  fmtDay,
  historyEvents,
  historyLine,
  historyTabs,
  logKinds,
  photoSrc,
  regoAlert,
  repaymentLabel,
  specRows,
  type HistoryTab,
  type Screen,
} from "./derive";
import { Btn, Card, DetailGrid, Eyebrow, IconBtn, Inline, Segmented } from "./parts";

/* The main screen: everything about one vehicle at a glance, and a door into
   each of its records.

   Layout follows the design handoff (Sep 2026) to the pixel where the app's
   own primitives allow: header with photo, name, plate and status; the amber
   rego bar; three vitals; compliance beside history; the money summary; the
   specs grid; a footer. Colour is the app's — ink, quiet, ok-teal, warn-amber,
   bad-red — because a modal in its own palette reads as a different product
   from the register behind it, and the handoff said to substitute the
   codebase's primitives.

   TWO THINGS THE DESIGN LEFT OUT are kept from the modal this replaces, on
   purpose. Logging (fuel, odometer, issue, service) had no entry point on any
   of the five screens; it lives here as the + on the History card, because a
   manager at the register is where a pool vehicle's fuel gets logged. And
   "Sold" stays in the status select beside the design's "For sale" — for sale
   is a vehicle still in the fleet, sold is the exit, and the register's Sold
   filter needs the second to mean anything. */

const LOG_LABEL: Record<LogKind, string> = {
  fuel: "Log fuel",
  odo: "Update odometer",
  issue: "Report an issue",
  service: "Log service",
};
const LOG_ICON: Record<LogKind, string> = { fuel: "fuel", odo: "gauge", issue: "alert", service: "wrench" };

export function MainScreen({
  vehicle,
  logs,
  eco,
  valuation,
  valuationIsStale,
  documents,
  policies,
  finance,
  staff,
  today,
  error,
  onOpen,
  onServiceHistory,
  onEdit,
  onRemove,
  onClose,
  onStatus,
  onAssign,
  onLog,
  onOdometer,
  onPhoto,
  onResolve,
  onCorrect,
}: {
  vehicle: Vehicle;
  logs: VehicleLog[];
  eco: Record<string, number>;
  valuation?: AiValuation;
  valuationIsStale?: boolean;
  documents: StoredDocument[];
  policies: VehiclePolicy[];
  finance: VehicleFinance[];
  staff: FleetStaff[];
  today: string;
  error?: string | null;
  /** Opens a renewal screen, or the money. */
  onOpen: (screen: Exclude<Screen, "main">) => void;
  onServiceHistory: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onClose: () => void;
  onStatus: (status: VehicleStatus) => void;
  onAssign: (staffId: string | null) => void;
  onLog: (kind: LogKind) => void;
  /** An odometer reading typed straight on the card. */
  onOdometer: (reading: number) => void;
  onPhoto: (file: File) => void;
  onResolve: (logId: string) => void;
  onCorrect: (log: VehicleLog) => void;
}) {
  const [tab, setTab] = useState<HistoryTab>("all");
  const [fullHistory, setFullHistory] = useState(false);
  const [logMenu, setLogMenu] = useState(false);
  const [editingOdo, setEditingOdo] = useState(false);
  const [odoDraft, setOdoDraft] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  const alert = regoAlert(vehicle);
  const rows = complianceRows(vehicle, policies);
  const specs = specRows(vehicle);
  const tabs = historyTabs(vehicle);
  const events = historyEvents(logs, tab);
  const photo = photoSrc(vehicle, documents);
  const service = serviceDueText(vehicle);
  const fin = currentFinance(finance);
  const finPos = fin ? financePosition(fin, today) : null;
  const moneyDocs = documents.filter((d) => d.kind === "purchase_invoice" || d.kind === "finance_agreement").length;

  const startOdo = () => {
    setOdoDraft(String(vehicle.odometer));
    setEditingOdo(true);
  };
  const commitOdo = () => {
    const n = parseInt(odoDraft.replace(/\D/g, ""), 10);
    setEditingOdo(false);
    if (Number.isFinite(n) && n !== vehicle.odometer) onOdometer(n);
  };

  return (
    <>
      {/* ---- header ---- */}
      <div className="vm-head">
        <div className="vm-headl">
          <button
            type="button"
            className="vm-photo"
            aria-label="Change photo"
            onClick={() => photoInput.current?.click()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed, expiring URL; next/image would need a remote pattern per bucket host */}
            <img src={photo.src} alt="" className={photo.own ? "own" : "placeholder"} />
            <span className="vm-photochange">CHANGE</span>
          </button>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPhoto(f);
              e.target.value = "";
            }}
          />
          <div className="vm-titles">
            <div className="vm-titlerow">
              <h2 className="vm-title">{displayName(vehicle)}</h2>
              <Plate plate={vehicle.plate} state={vehicle.plateState} size="sm" />
            </div>
            <div className="vm-model">{modelLabel(vehicle)}</div>
          </div>
        </div>
        <div className="vm-headr">
          <label className="vm-statuspill">
            <span className="vm-dot" style={{ background: STATUS_DOT[vehicle.status] }} />
            <select
              aria-label="Status"
              value={vehicle.status}
              onChange={(e) => onStatus(e.target.value as VehicleStatus)}
            >
              {(Object.keys(STATUS_LABEL) as VehicleStatus[]).map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <IconBtn icon="x" label="Close" onClick={onClose} />
        </div>
      </div>

      <div className="vm-body">
        {error && <div className="vm-err">{error}</div>}

        {/* ---- rego alert: only inside the warning window ---- */}
        {alert && (
          <div className="vm-alert">
            <span>{alert}</span>
            <Btn kind="warn" onClick={() => onOpen("rego")}>
              Update rego
            </Btn>
          </div>
        )}

        {/* ---- vitals ---- */}
        <div className={`vm-vitals${vehicle.motorised ? "" : " two"}`}>
          {vehicle.motorised && (
            <Card>
              <div className="vm-cardhead">
                <Eyebrow>ODOMETER</Eyebrow>
                <Inline onClick={editingOdo ? commitOdo : startOdo}>{editingOdo ? "Save" : "Update"}</Inline>
              </div>
              {editingOdo ? (
                <div className="vm-odoedit">
                  <input
                    autoFocus
                    inputMode="numeric"
                    aria-label="Odometer reading"
                    value={odoDraft}
                    onChange={(e) => setOdoDraft(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitOdo();
                      if (e.key === "Escape") setEditingOdo(false);
                    }}
                  />
                  <span>km</span>
                </div>
              ) : (
                <div className="vm-big">{fmtKm(vehicle.odometer)} km</div>
              )}
            </Card>
          )}
          <Card onClick={onServiceHistory} ariaLabel="Service history">
            <div className="vm-cardhead">
              <Eyebrow>NEXT SERVICE</Eyebrow>
              <Icon name="chevR" size={14} />
            </div>
            <div className="vm-big">{service ?? "No cycle set"}</div>
          </Card>
          <Card>
            <Eyebrow>{vehicle.motorised ? "DRIVER" : "TOWED BY"}</Eyebrow>
            <select
              className="vm-bare"
              aria-label={vehicle.motorised ? "Driver" : "Towed by"}
              value={vehicle.assignedTo ?? ""}
              onChange={(e) => onAssign(e.target.value || null)}
            >
              <option value="">Pool / unassigned</option>
              {staff
                .filter((s) => s.status === "Active" || s.id === vehicle.assignedTo)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Card>
        </div>

        {/* ---- compliance beside history ---- */}
        <div className="vm-two">
          <Card className="vm-compliance">
            {rows.map((r) => (
              <button
                key={r.kind}
                type="button"
                className={`vm-crow${r.unset ? " unset" : ""}`}
                onClick={() => onOpen(r.kind)}
              >
                <span className="vm-crowl">
                  <Eyebrow>{r.label}</Eyebrow>
                  <b className={r.unset ? "faint" : r.state}>{r.value}</b>
                </span>
                {r.unset ? <span className="vm-pill">Add</span> : <Icon name="chevR" size={14} />}
              </button>
            ))}
          </Card>

          <Card className="vm-history">
            <div className="vm-cardhead">
              <Eyebrow>HISTORY</Eyebrow>
              <div className="vm-histtools">
                <Segmented items={tabs} active={tab} onSelect={setTab} ariaLabel="History filter" />
                <div className="vm-menuwrap">
                  <button
                    type="button"
                    className="vm-plus"
                    aria-label="Log something"
                    aria-expanded={logMenu}
                    onClick={() => setLogMenu((o) => !o)}
                  >
                    <Icon name="plus" size={14} />
                  </button>
                  {logMenu && (
                    <div className="vm-menu" role="menu">
                      {logKinds(vehicle).map((k) => (
                        <button
                          key={k}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setLogMenu(false);
                            onLog(k);
                          }}
                        >
                          <Icon name={LOG_ICON[k]} size={15} />
                          {LOG_LABEL[k]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {fullHistory ? (
              <div className="vm-fulllog">
                {logs.length === 0 ? (
                  <div className="vm-empty">No activity yet.</div>
                ) : (
                  logs.map((l) => (
                    <LogRow key={l.id} log={l} manager eco={eco[l.id]} onResolve={onResolve} onCorrect={onCorrect} />
                  ))
                )}
              </div>
            ) : events.length === 0 ? (
              <div className="vm-empty">Nothing logged{tab === "all" ? " yet" : " under this tab"}.</div>
            ) : (
              events.map((l) => (
                <div key={l.id} className="vm-evrow">
                  <span>{historyLine(l)}</span>
                  <span className="vm-evdate">{l.when}</span>
                </div>
              ))
            )}
            <Inline onClick={() => setFullHistory((f) => !f)}>
              {fullHistory ? "Show recent" : "View full history"}
            </Inline>
          </Card>
        </div>

        {/* ---- money, as it stands: no forecast, no invented figure. The card
             is the door to the Financials screen. ---- */}
        <Card className="vm-money" onClick={() => onOpen("financials")} ariaLabel="Financials">
          <div className="vm-cardhead">
            <Eyebrow>FINANCIALS</Eyebrow>
            <span className="vm-doccount">
              {moneyDocs === 1 ? "1 document" : `${moneyDocs} documents`}
              <Icon name="chevR" size={14} />
            </span>
          </div>
          <div className="vm-moneycols">
            <div>
              <span className="vm-fl">
                <Chevron size={12} gradient decorative />
                TIFF VALUE
              </span>
              {valuation ? (
                <>
                  <b className={valuationIsStale ? "stale" : undefined}>{fmtMoney(valuation.point)}</b>
                  <em>
                    {fmtMoney(valuation.low)}–{fmtMoney(valuation.high)}
                    {valuationIsStale ? " · odometer has moved since" : ""}
                  </em>
                </>
              ) : (
                <>
                  <b className="faint">—</b>
                  <em>Run “Value with Tiff” in the register</em>
                </>
              )}
            </div>
            <div>
              <span className="vm-fl">PURCHASED</span>
              {vehicle.purchasePrice ? (
                <>
                  <b>{fmtMoney(vehicle.purchasePrice)}</b>
                  <em>{vehicle.purchaseDateDays ? fmtDay(dateFromDays(-vehicle.purchaseDateDays, today)) : "Date not recorded"}</em>
                </>
              ) : (
                <>
                  <b className="faint">—</b>
                  <em>Not recorded</em>
                </>
              )}
            </div>
            <div>
              <span className="vm-fl">FINANCE</span>
              {fin ? (
                <>
                  <b>{repaymentLabel(fin) ?? fin.lender}</b>
                  <em>
                    {repaymentLabel(fin) ? `${fin.lender} · ` : ""}
                    {finPos?.ended ? "schedule ended" : `${finPos?.made ?? 0} of ${finPos?.total ?? 0} on schedule`}
                  </em>
                </>
              ) : (
                <>
                  <b className="faint">—</b>
                  <em>No finance agreement recorded</em>
                </>
              )}
            </div>
          </div>
        </Card>

        {/* ---- the certificate's facts ---- */}
        <Card>
          <div className="vm-cardhead">
            <Eyebrow>VEHICLE DETAILS</Eyebrow>
          </div>
          {specs.length > 0 ? (
            <DetailGrid cols={4} items={specs.map((s) => ({ label: s.label, value: s.value, wide: s.wide }))} />
          ) : (
            <div className="vm-empty">
              No details recorded yet — scan the rego certificate from Edit vehicle to fill them in.
            </div>
          )}
        </Card>

        {vehicle.notes && <Card className="vm-notes">{vehicle.notes}</Card>}
      </div>

      {/* ---- footer ---- */}
      <div className="vm-foot between">
        <Btn
          kind="danger"
          onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
        >
          {confirmRemove ? "Confirm remove" : "Remove vehicle"}
        </Btn>
        <Btn kind="primary" onClick={onEdit}>
          Edit vehicle
        </Btn>
      </div>
    </>
  );
}
