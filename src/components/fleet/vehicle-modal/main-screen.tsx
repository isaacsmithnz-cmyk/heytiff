"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { ConfirmDialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextInput } from "@/components/parts/field";
import { Chooser } from "@/components/parts/chooser";
import { Menu } from "@/components/parts/menu";
import { ViewTabs } from "@/components/parts/tabs";
import { StateWord } from "@/components/parts/state";
import type { StoredDocument } from "@/lib/documents/query";
import { dateFromDays } from "@/lib/fleet/map";
import { Plate } from "../plate";
import { EventRow, VehicleLead } from "./event-row";
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
  complianceRows,
  currentFinance,
  financePosition,
  fmtDay,
  historyEvents,
  historyTabs,
  addScreen,
  logKinds,
  logScreen,
  photoSrc,
  regoAlert,
  repaymentLabel,
  specRows,
  type HistoryTab,
  type Screen,
} from "./derive";
import { DetailGrid, FrameFoot, FrameTitle, Group, Nothing, RecordError } from "@/components/record-modal/parts";

/* The main screen: everything about one vehicle at a glance, and a door into
   each of its records.

   Layout follows the design handoff (Sep 2026) to the pixel where the app's
   own primitives allow, and since 27 October 2026 in the record window's dress
   (the old-modals mock): the photo, the status and the driver; the rego's
   word when it runs out; three vitals; compliance beside history; the money;
   the specs; the foot.

   TWO THINGS THE DESIGN LEFT OUT are kept from the modal this replaces, on
   purpose. Logging (fuel, odometer, issue, service) had no entry point on any
   of the five screens; it lives here as Log on the History group, because a
   manager at the register is where a pool vehicle's fuel gets logged. And
   "Sold" stays in the status chooser beside the design's "For sale" — for sale
   is a vehicle still in the fleet, sold is the exit, and the register's Sold
   filter needs the second to mean anything.

   EVERY HISTORY ROW IS A DOOR (Sep 2026). The rows were text with a pencil;
   the docket behind a fill and the invoice behind a service could be stored
   but not seen from here. A row opens its entry on its own screen now, and
   correcting and resolving moved there with it, so the card has one kind of
   row and the card is wide enough (1200px) for the history to read. */

const LOG_LABEL: Record<LogKind, string> = {
  fuel: "Log fuel",
  odo: "Update odometer",
  issue: "Report an issue",
  service: "Log service",
};
/** How many rows the History group shows before "View full history". */
const RECENT = 6;

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
  warnDays,
  error,
  onOpen,
  onEdit,
  onRemove,
  onClose,
  onStatus,
  onAssign,
  onOdometer,
  onPhoto,
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
  warnDays: number;
  error?: string | null;
  /** Opens a renewal screen, the money, the services, or one entry. */
  onOpen: (screen: Exclude<Screen, "main">) => void;
  onEdit: () => void;
  onRemove: () => void;
  onClose: () => void;
  onStatus: (status: VehicleStatus) => void;
  onAssign: (staffId: string | null) => void;
  /** An odometer reading typed straight on the card. */
  onOdometer: (reading: number) => void;
  onPhoto: (file: File) => void;
}) {
  const [tab, setTab] = useState<HistoryTab>("all");
  const [fullHistory, setFullHistory] = useState(false);
  const [logMenu, setLogMenu] = useState(false);
  const [editingOdo, setEditingOdo] = useState(false);
  const [odoDraft, setOdoDraft] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const logButton = useRef<HTMLButtonElement>(null);

  const alert = regoAlert(vehicle, warnDays);
  const rows = complianceRows(vehicle, policies, warnDays);
  const specs = specRows(vehicle);
  const tabs = historyTabs(vehicle);
  const events = historyEvents(logs, tab, fullHistory ? Infinity : RECENT);
  /* "View full history" only when there is more than the recent six to see —
     a link that shows the same rows again is a link that does nothing. */
  const more = historyEvents(logs, tab, Infinity).length > RECENT;
  const photo = photoSrc(vehicle, documents);
  const service = serviceDueText(vehicle, warnDays);
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

  const toneOf = (state: string) => (state === "bad" ? "wrong" : state === "warn" ? "look" : null);
  const drivers = [
    { value: "", label: "Pool, unassigned" },
    ...staff.filter((st) => st.status === "Active" || st.id === vehicle.assignedTo).map((st) => ({ value: st.id, label: st.name })),
  ];

  return (
    <>
      <FrameTitle>{displayName(vehicle)}</FrameTitle>
      {error && <RecordError>{error}</RecordError>}

      {/* ---- who it is: the photo, the model, the status and the driver ---- */}
      <div className="rcw-vhead">
        <button type="button" className="rcw-photo" aria-label="Change photo" onClick={() => photoInput.current?.click()}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed, expiring URL; next/image would need a remote pattern per bucket host */}
          <img src={photo.src} alt="" className={photo.own ? "own" : "placeholder"} />
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
        <div className="rcw-vhead-k">
          <VehicleLead name={modelLabel(vehicle)} plate={<Plate plate={vehicle.plate} state={vehicle.plateState} size="sm" />} />
          {/* the rego's word, only inside the warning window: rego is the one
              whose lapse makes the vehicle illegal to drive tomorrow */}
          {alert && (
            <div className="rcw-vhead-alert">
              <StateWord tone={(vehicle.regoDays ?? 0) < 0 ? "wrong" : "look"}>{alert}</StateWord>
              <Button kind="second" size={32} onClick={() => onOpen("rego")}>
                Update rego
              </Button>
            </div>
          )}
        </div>
        <div className="mk-records-grid mk-records-grid--2 rcw-vhead-pick">
          <Field label="Status">
            <Chooser
              options={(Object.keys(STATUS_LABEL) as VehicleStatus[]).map((k) => ({ value: k, label: STATUS_LABEL[k] }))}
              value={vehicle.status}
              onChange={(v) => onStatus(v as VehicleStatus)}
            />
          </Field>
          <Field label={vehicle.motorised ? "Driver" : "Towed by"}>
            <Chooser options={drivers} value={vehicle.assignedTo ?? ""} onChange={(v) => onAssign(v || null)} />
          </Field>
        </div>
      </div>

      {/* ---- vitals ---- */}
      <div className="rcw-vitals">
        {vehicle.motorised && (
          <Group
            name="Odometer"
            action={
              <Button kind="quiet" size={32} onClick={editingOdo ? commitOdo : startOdo}>
                {editingOdo ? "Save reading" : "Update reading"}
              </Button>
            }
          >
            {editingOdo ? (
              <TextInput
                autoFocus
                inputMode="numeric"
                aria-label="Odometer reading"
                value={odoDraft}
                onChange={(e) => setOdoDraft(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitOdo();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setEditingOdo(false);
                  }
                }}
              />
            ) : (
              <span className="rcw-fig">{fmtKm(vehicle.odometer)} km</span>
            )}
          </Group>
        )}
        <Group
          name="Next service"
          action={
            <Button kind="quiet" size={32} onClick={() => onOpen("services")}>
              Service history
            </Button>
          }
        >
          <span className="rcw-fig">{service ?? "No cycle set"}</span>
        </Group>
      </div>

      {/* ---- compliance beside history ---- */}
      <div className="rcw-two">
        <Group name="Compliance">
          <div className="rcw-evrows">
            {rows.map((r) => {
              const tone = r.unset ? null : toneOf(r.state);
              return (
                <button key={r.kind} type="button" className="rcw-evrow" onClick={() => onOpen(r.kind)}>
                  <span className="rcw-histk">
                    <b>{r.label}</b>
                    {tone ? <StateWord tone={tone}>{r.value}</StateWord> : <span>{r.value}</span>}
                  </span>
                  {r.unset ? (
                    <span className="rcw-histfig">Add</span>
                  ) : (
                    <span className="rcw-chev">
                      <Icon name="chevR" size={14} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Group>

        <Group
          name="History"
          action={
            <>
              <Button ref={logButton} kind="second" size={32} aria-expanded={logMenu} onClick={() => setLogMenu((o) => !o)}>
                Log something
              </Button>
              <Menu
                open={logMenu}
                anchor={logButton}
                label="Log something"
                align="end"
                items={logKinds(vehicle).map((k) => ({ key: k, label: LOG_LABEL[k] }))}
                onClose={() => setLogMenu(false)}
                onSelect={(k) => onOpen(addScreen(k as LogKind))}
              />
            </>
          }
        >
          <ViewTabs items={tabs} current={tab} onGo={(k) => setTab(k as HistoryTab)} ariaLabel="History filter" />
          {events.length === 0 ? (
            <Nothing>Nothing logged{tab === "all" ? " yet" : " under this tab"}.</Nothing>
          ) : (
            <div className="rcw-evrows">
              {events.map((l) => (
                <EventRow key={l.id} log={l} eco={eco[l.id]} onOpen={(x) => onOpen(logScreen(x.id))} />
              ))}
            </div>
          )}
          {more && (
            <span>
              <Button kind="quiet" size={32} onClick={() => setFullHistory((f) => !f)}>
                {fullHistory ? "Show recent" : "View full history"}
              </Button>
            </span>
          )}
        </Group>
      </div>

      {/* ---- money, as it stands: no forecast, no invented figure ---- */}
      <Group
        name="Financials"
        aside={moneyDocs === 1 ? "1 document" : `${moneyDocs} documents`}
        action={
          <Button kind="quiet" size={32} onClick={() => onOpen("financials")}>
            Open financials
          </Button>
        }
      >
        <dl className="rcw-facts">
          <div className="rcw-fact">
            <dt>Tiff value</dt>
            <dd className={valuation ? "rcw-fact-v" : "rcw-fact-v rcw-fact-v--faint"}>
              <span className="rcw-fact-stack">
                <b className={valuationIsStale ? "rcw-stale" : undefined}>{valuation ? fmtMoney(valuation.point) : "—"}</b>
                <span>
                  {valuation
                    ? `${fmtMoney(valuation.low)}–${fmtMoney(valuation.high)}${valuationIsStale ? ", odometer has moved since" : ""}`
                    : "Run Value with Tiff in the register"}
                </span>
              </span>
            </dd>
          </div>
          <div className="rcw-fact">
            <dt>Purchased</dt>
            <dd className={vehicle.purchasePrice ? "rcw-fact-v" : "rcw-fact-v rcw-fact-v--faint"}>
              <span className="rcw-fact-stack">
                <b>{vehicle.purchasePrice ? fmtMoney(vehicle.purchasePrice) : "—"}</b>
                <span>
                  {vehicle.purchasePrice
                    ? vehicle.purchaseDateDays
                      ? fmtDay(dateFromDays(-vehicle.purchaseDateDays, today))
                      : "Date not recorded"
                    : "Not recorded"}
                </span>
              </span>
            </dd>
          </div>
          <div className="rcw-fact">
            <dt>Finance</dt>
            <dd className={fin ? "rcw-fact-v" : "rcw-fact-v rcw-fact-v--faint"}>
              <span className="rcw-fact-stack">
                <b>{fin ? (repaymentLabel(fin) ?? fin.lender) : "—"}</b>
                <span>
                  {fin
                    ? `${repaymentLabel(fin) ? `${fin.lender}, ` : ""}${finPos?.ended ? "schedule ended" : `${finPos?.made ?? 0} of ${finPos?.total ?? 0} on schedule`}`
                    : "No finance agreement recorded"}
                </span>
              </span>
            </dd>
          </div>
        </dl>
      </Group>

      {/* ---- the certificate's facts ---- */}
      <Group name="Vehicle details">
        {specs.length > 0 ? (
          <DetailGrid cols={4} items={specs.map((sp) => ({ label: sp.label, value: sp.value, wide: sp.wide }))} />
        ) : (
          <Nothing>No details recorded yet. Scan the rego certificate from Edit vehicle to fill them in.</Nothing>
        )}
      </Group>

      {vehicle.notes && (
        <Group name="Notes">
          <p className="rcw-note">{vehicle.notes}</p>
        </Group>
      )}

      <FrameFoot>
        <Button kind="delete" onClick={() => setConfirmRemove(true)}>
          Remove vehicle
        </Button>
        <span className="mk-gap" />
        <Button kind="quiet" onClick={onClose}>
          Close
        </Button>
        <Button kind="main" onClick={onEdit}>
          Edit vehicle
        </Button>
      </FrameFoot>
      <ConfirmDialog
        open={confirmRemove}
        heading={`Remove ${displayName(vehicle)}?`}
        confirm="Remove vehicle"
        onConfirm={() => {
          setConfirmRemove(false);
          onRemove();
        }}
        onClose={() => setConfirmRemove(false)}
      >
        <p>It comes off the fleet register with its history. There is no undo.</p>
      </ConfirmDialog>
    </>
  );
}
