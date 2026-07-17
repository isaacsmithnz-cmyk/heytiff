"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import type { DemoStaff } from "@/mock/demo";
import {
  type LogKind,
  type StatusChip,
  type Vehicle,
  type VehicleLog,
  daysUntil,
  fmtKm,
  fmtMoney,
  serviceKmLeft,
  slugId,
  vehicleName,
} from "./logic";

/* Modals portal to <body> (fl-ov is unscoped in shell.css, like .fg-cmd) —
   .page.in's will-change would trap position:fixed inside the shell. */

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateFromDays(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

function num(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function FleetModal({
  title,
  sub,
  wide,
  onClose,
  children,
}: {
  title: string;
  sub?: string;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fl-ov" onClick={onClose}>
      <div className={`fl-modal${wide ? " wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="fl-mh">
          <span>
            <b>{title}</b>
            {sub && <em>{sub}</em>}
          </span>
          <button className="fl-x" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="fl-mb">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function Field({
  label,
  req,
  children,
  span,
}: {
  label: string;
  req?: boolean;
  children: React.ReactNode;
  span?: boolean;
}) {
  return (
    <label className={`fl-f${span ? " span" : ""}`}>
      <span>
        {label}
        {req && <i>*</i>}
      </span>
      {children}
    </label>
  );
}

/* ---------------- add / edit vehicle ---------------- */

export function VehicleFormModal({
  initial,
  takenIds,
  staff,
  onSave,
  onClose,
}: {
  initial: Vehicle | null;
  takenIds: string[];
  staff: DemoStaff[];
  onSave: (v: Vehicle) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState(() =>
    initial
      ? {
          callsign: initial.callsign,
          make: initial.make,
          model: initial.model,
          year: initial.year ? String(initial.year) : "",
          plate: initial.plate,
          odometer: String(initial.odometer),
          rego: dateFromDays(initial.regoDays),
          insurance: dateFromDays(initial.insuranceDays),
          serviceDueKm: String(initial.serviceDueKm),
          value: String(initial.value),
          assignedTo: initial.assignedTo ?? "",
          notes: initial.notes ?? "",
        }
      : {
          callsign: "",
          make: "",
          model: "",
          year: "",
          plate: "",
          odometer: "",
          rego: "",
          insurance: "",
          serviceDueKm: "",
          value: "",
          assignedTo: "",
          notes: "",
        },
  );
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const ready = f.callsign.trim() && f.make.trim() && f.plate.trim();

  const save = () => {
    if (!ready) return;
    const today = todayISO();
    const odometer = num(f.odometer);
    onSave({
      id: initial?.id ?? slugId(f.callsign, takenIds),
      callsign: f.callsign.trim().toUpperCase(),
      make: f.make.trim(),
      model: f.model.trim(),
      year: Math.round(num(f.year)),
      plate: f.plate.trim().toUpperCase(),
      odometer,
      assignedTo: f.assignedTo || null,
      value: num(f.value),
      regoDays: f.rego ? daysUntil(f.rego, today) : 365,
      insuranceDays: f.insurance ? daysUntil(f.insurance, today) : 365,
      serviceDueKm: num(f.serviceDueKm) || odometer + 10000,
      notes: f.notes.trim() || undefined,
    });
  };

  return (
    <FleetModal
      title={initial ? `Edit ${initial.callsign}` : "Add vehicle"}
      sub={initial ? vehicleName(initial) : "Register a vehicle in the fleet"}
      onClose={onClose}
    >
      <div className="fl-grid">
        <Field label="Callsign" req>
          <input className="fl-i" placeholder="e.g. VRF-09" value={f.callsign} onChange={set("callsign")} />
        </Field>
        <Field label="Rego plate" req>
          <input className="fl-i" placeholder="e.g. MKT482" value={f.plate} onChange={set("plate")} />
        </Field>
        <Field label="Make" req>
          <input className="fl-i" placeholder="e.g. Toyota" value={f.make} onChange={set("make")} />
        </Field>
        <Field label="Model">
          <input className="fl-i" placeholder="e.g. Hiace ZR" value={f.model} onChange={set("model")} />
        </Field>
        <Field label="Year">
          <input className="fl-i" type="number" placeholder="e.g. 2022" value={f.year} onChange={set("year")} />
        </Field>
        <Field label="Odometer (km)">
          <input className="fl-i" type="number" placeholder="e.g. 84120" value={f.odometer} onChange={set("odometer")} />
        </Field>
        <Field label="Rego expiry">
          <input className="fl-i" type="date" value={f.rego} onChange={set("rego")} />
        </Field>
        <Field label="Insurance expiry">
          <input className="fl-i" type="date" value={f.insurance} onChange={set("insurance")} />
        </Field>
        <Field label="Next service due (km)">
          <input className="fl-i" type="number" placeholder="e.g. 85500" value={f.serviceDueKm} onChange={set("serviceDueKm")} />
        </Field>
        <Field label="Value ($)">
          <input className="fl-i" type="number" placeholder="e.g. 52000" value={f.value} onChange={set("value")} />
        </Field>
        <Field label="Assigned driver" span>
          <select className="fl-i" value={f.assignedTo} onChange={set("assignedTo")}>
            <option value="">Pool / unassigned</option>
            {staff
              .filter((s) => s.status === "Active")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.role}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Notes" span>
          <textarea
            className="fl-i"
            placeholder="e.g. Pool ute — site runs & tip loads"
            value={f.notes}
            onChange={set("notes")}
          />
        </Field>
      </div>
      <div className="fl-foot">
        <button className="fl-btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="fl-btn primary" disabled={!ready} onClick={save}>
          <Icon name="check" size={15} />
          {initial ? "Save changes" : "Add vehicle"}
        </button>
      </div>
    </FleetModal>
  );
}

/* ---------------- log fuel / odometer / issue ---------------- */

const LOG_COPY: Record<LogKind, { title: string; sub: string; icon: string }> = {
  fuel: { title: "Log fuel", sub: "Fill-up against this vehicle", icon: "fuel" },
  odo: { title: "Update odometer", sub: "Current reading off the dash", icon: "gauge" },
  issue: { title: "Report an issue", sub: "Flag something wrong with this vehicle", icon: "alert" },
  service: { title: "Log service", sub: "Record completed servicing", icon: "wrench" },
};

export function LogModal({
  kind,
  vehicle,
  loggedBy,
  onSave,
  onClose,
}: {
  kind: LogKind;
  vehicle: Vehicle;
  loggedBy: { id: string | null; name: string };
  onSave: (log: Omit<VehicleLog, "id" | "when" | "ago">) => void;
  onClose: () => void;
}) {
  const [litres, setLitres] = useState("");
  const [cost, setCost] = useState("");
  const [odo, setOdo] = useState("");
  const [note, setNote] = useState("");
  const copy = LOG_COPY[kind];

  const ready =
    kind === "fuel" ? litres.trim() !== "" : kind === "odo" ? odo.trim() !== "" : note.trim() !== "";

  const save = () => {
    if (!ready) return;
    onSave({
      vehicleId: vehicle.id,
      staffId: loggedBy.id,
      staffName: loggedBy.name,
      kind,
      litres: kind === "fuel" ? num(litres) : undefined,
      cost: kind === "fuel" && cost.trim() ? num(cost) : undefined,
      odo: kind !== "issue" && odo.trim() ? num(odo) : undefined,
      note: note.trim() || undefined,
      status: kind === "issue" ? "open" : undefined,
    });
  };

  return (
    <FleetModal title={copy.title} sub={`${vehicle.callsign} · ${vehicleName(vehicle)}`} onClose={onClose}>
      <div className="fl-grid">
        {kind === "fuel" && (
          <>
            <Field label="Litres" req>
              <input className="fl-i" type="number" placeholder="e.g. 62.4" value={litres} onChange={(e) => setLitres(e.target.value)} />
            </Field>
            <Field label="Cost ($)">
              <input className="fl-i" type="number" placeholder="e.g. 158.40" value={cost} onChange={(e) => setCost(e.target.value)} />
            </Field>
          </>
        )}
        {kind !== "issue" && (
          <Field label="Odometer (km)" req={kind === "odo"} span={kind !== "fuel"}>
            <input
              className="fl-i"
              type="number"
              placeholder={`Currently ${fmtKm(vehicle.odometer)}`}
              value={odo}
              onChange={(e) => setOdo(e.target.value)}
            />
          </Field>
        )}
        <Field label={kind === "issue" ? "What's wrong" : "Note"} req={kind === "issue"} span>
          <textarea
            className="fl-i"
            placeholder={
              kind === "issue" ? "e.g. Sliding door latch sticking — needs adjustment" : "Optional"
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
      <div className="fl-foot">
        <button className="fl-btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="fl-btn primary" disabled={!ready} onClick={save}>
          <Icon name={copy.icon} size={15} />
          {copy.title}
        </button>
      </div>
    </FleetModal>
  );
}

/* ---------------- vehicle detail + history ---------------- */

export function LogRow({
  log,
  manager,
  onResolve,
}: {
  log: VehicleLog;
  manager?: boolean;
  onResolve?: (id: string) => void;
}) {
  const icon = LOG_COPY[log.kind].icon;
  const title =
    log.kind === "fuel"
      ? `Fuel — ${log.litres ? `${log.litres} L` : "fill-up"}${log.cost ? ` · ${fmtMoney(log.cost)}` : ""}`
      : log.kind === "odo"
        ? "Odometer updated"
        : log.kind === "service"
          ? `Service — ${log.note ?? "completed"}`
          : `Issue — ${log.note ?? "reported"}`;
  return (
    <div className={`fl-log${log.kind === "issue" && log.status === "open" ? " open" : ""}`}>
      <span className={`fl-li ${log.kind}`}>
        <Icon name={icon} size={15} />
      </span>
      <span className="fl-lk">
        <b>{title}</b>
        <em>
          {log.when}
          {log.staffName ? ` · ${log.staffName}` : ""}
        </em>
      </span>
      {log.kind === "issue" ? (
        <span className="fl-lr">
          {log.status === "open" && manager && onResolve && (
            <button className="fl-btn tiny" onClick={() => onResolve(log.id)}>
              <Icon name="check" size={13} />
              Resolve
            </button>
          )}
          <span className={`dchip2 ${log.status === "open" ? "warn" : "ok"}`}>
            {log.status === "open" ? "Open" : "Resolved"}
          </span>
        </span>
      ) : (
        typeof log.odo === "number" && <span className="fl-lo">{fmtKm(log.odo)} km</span>
      )}
    </div>
  );
}

export function DetailModal({
  vehicle,
  chips,
  logs,
  staff,
  manager,
  onClose,
  onEdit,
  onAssign,
  onLog,
  onResolve,
  onRemove,
}: {
  vehicle: Vehicle;
  chips: StatusChip[];
  logs: VehicleLog[];
  staff: DemoStaff[];
  manager: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAssign: (staffId: string | null) => void;
  onLog: (kind: LogKind) => void;
  onResolve: (logId: string) => void;
  onRemove: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const left = serviceKmLeft(vehicle);
  const driver = staff.find((s) => s.id === vehicle.assignedTo);

  return (
    <FleetModal title={vehicle.callsign} sub={`${vehicleName(vehicle)} · ${vehicle.plate}`} wide onClose={onClose}>
      <div className="fl-chips">
        {chips.length === 0 ? (
          <span className="dchip2 ok">
            <Icon name="check" size={12} />
            All good
          </span>
        ) : (
          chips.map((c) => (
            <span key={c.label} className={`dchip2 ${c.state}`}>
              <Icon name={c.state === "bad" ? "alert" : "clock"} size={12} />
              {c.label}
            </span>
          ))
        )}
      </div>

      <div className="fl-facts">
        <div className="fl-fact">
          <em>Odometer</em>
          <b>{fmtKm(vehicle.odometer)} km</b>
        </div>
        <div className="fl-fact">
          <em>Next service</em>
          <b>{left < 0 ? `${fmtKm(-left)} km overdue` : `in ${fmtKm(left)} km`}</b>
        </div>
        <div className="fl-fact">
          <em>Rego expiry</em>
          <b>{vehicle.regoDays < 0 ? `${-vehicle.regoDays}d ago` : `in ${vehicle.regoDays}d`}</b>
        </div>
        <div className="fl-fact">
          <em>Insurance</em>
          <b>{vehicle.insuranceDays < 0 ? "expired" : `in ${vehicle.insuranceDays}d`}</b>
        </div>
        {manager && (
          <div className="fl-fact">
            <em>Value</em>
            <b>{fmtMoney(vehicle.value)}</b>
          </div>
        )}
        <div className="fl-fact">
          <em>Driver</em>
          {manager ? (
            <select
              className="fl-i slim"
              value={vehicle.assignedTo ?? ""}
              onChange={(e) => onAssign(e.target.value || null)}
            >
              <option value="">Pool / unassigned</option>
              {staff
                .filter((s) => s.status === "Active")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          ) : (
            <b>{driver?.name ?? "Pool / unassigned"}</b>
          )}
        </div>
      </div>

      {vehicle.notes && <div className="fl-note">{vehicle.notes}</div>}

      <div className="fl-actions">
        <button className="fl-btn ghost" onClick={() => onLog("fuel")}>
          <Icon name="fuel" size={15} />
          Log fuel
        </button>
        <button className="fl-btn ghost" onClick={() => onLog("odo")}>
          <Icon name="gauge" size={15} />
          Update odo
        </button>
        <button className="fl-btn ghost" onClick={() => onLog("issue")}>
          <Icon name="alert" size={15} />
          Report issue
        </button>
        {manager && (
          <>
            <span className="fl-gap" />
            <button className="fl-btn ghost" onClick={onEdit}>
              <Icon name="edit" size={15} />
              Edit
            </button>
            <button
              className={`fl-btn danger${confirmRemove ? " arm" : ""}`}
              onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
              onBlur={() => setConfirmRemove(false)}
            >
              <Icon name="x" size={15} />
              {confirmRemove ? "Confirm remove" : "Remove"}
            </button>
          </>
        )}
      </div>

      <div className="fl-hist">
        <div className="fl-hh">History</div>
        {logs.length === 0 ? (
          <div className="fl-hempty">No activity yet — fuel, odometer and issue logs land here.</div>
        ) : (
          logs.map((l) => <LogRow key={l.id} log={l} manager={manager} onResolve={onResolve} />)
        )}
      </div>
    </FleetModal>
  );
}
