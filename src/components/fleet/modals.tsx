"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import type { DemoStaff } from "@/mock/demo";
import {
  STATUS_LABEL,
  type LogKind,
  type StatusChip,
  type Vehicle,
  type VehicleStatus,
  type VehicleLog,
  aiValue,
  daysUntil,
  displayName,
  fmtCost,
  fmtKm,
  fmtMoney,
  modelLabel,
  slugId,
  vehicleFacts,
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
  hint,
}: {
  label: string;
  req?: boolean;
  children: React.ReactNode;
  span?: boolean;
  hint?: string;
}) {
  return (
    <label className={`fl-f${span ? " span" : ""}`}>
      <span>
        {label}
        {req && <i>*</i>}
      </span>
      {children}
      {hint && <em className="fl-warnhint">{hint}</em>}
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
          name: initial.name,
          plate: initial.plate,
          make: initial.make,
          model: initial.model,
          year: initial.year ? String(initial.year) : "",
          odometer: String(initial.odometer),
          rego: dateFromDays(initial.regoDays),
          insurance: dateFromDays(initial.insuranceDays),
          intervalKm: String(initial.serviceIntervalKm),
          lastServiceOdo: String(initial.lastServiceOdo),
          purchaseDate: initial.purchaseDateDays ? dateFromDays(-initial.purchaseDateDays) : "",
          purchasePrice: initial.purchasePrice ? String(initial.purchasePrice) : "",
          value: String(initial.value),
          status: initial.status as VehicleStatus,
          assignedTo: initial.assignedTo ?? "",
          notes: initial.notes ?? "",
        }
      : {
          name: "",
          plate: "",
          make: "",
          model: "",
          year: "",
          odometer: "",
          rego: "",
          insurance: "",
          intervalKm: "",
          lastServiceOdo: "",
          purchaseDate: "",
          purchasePrice: "",
          value: "",
          status: "active" as VehicleStatus,
          assignedTo: "",
          notes: "",
        },
  );
  const set =
    (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF((p) => ({ ...p, [k]: e.target.value }));

  const ready = f.plate.trim() && f.make.trim();

  const save = () => {
    if (!ready) return;
    const today = todayISO();
    const odometer = num(f.odometer);
    onSave({
      id: initial?.id ?? slugId(f.name.trim() || f.plate.trim(), takenIds),
      name: f.name.trim().toUpperCase(),
      plate: f.plate.trim().toUpperCase(),
      make: f.make.trim(),
      model: f.model.trim(),
      year: Math.round(num(f.year)),
      status: f.status,
      odometer,
      assignedTo: f.assignedTo || null,
      value: num(f.value),
      purchasePrice: num(f.purchasePrice),
      purchaseDateDays: f.purchaseDate ? Math.max(0, -daysUntil(f.purchaseDate, today)) : 0,
      regoDays: f.rego ? daysUntil(f.rego, today) : 365,
      insuranceDays: f.insurance ? daysUntil(f.insurance, today) : 365,
      serviceIntervalKm: num(f.intervalKm) || 10000,
      lastServiceOdo: f.lastServiceOdo.trim() ? num(f.lastServiceOdo) : odometer,
      notes: f.notes.trim() || undefined,
    });
  };

  return (
    <FleetModal
      title={initial ? `Edit ${displayName(initial)}` : "Add vehicle"}
      sub={initial ? modelLabel(initial) : "Register a vehicle in the fleet"}
      onClose={onClose}
    >
      <div className="fl-grid">
        <Field label="Rego plate" req>
          <input className="fl-i" placeholder="e.g. MKT482" value={f.plate} onChange={set("plate")} />
        </Field>
        <Field label="Name / fleet no.">
          <input className="fl-i" placeholder="Optional — e.g. VRF-09" value={f.name} onChange={set("name")} />
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
        <Field label="Service interval (km)">
          <input className="fl-i" type="number" placeholder="e.g. 10000" value={f.intervalKm} onChange={set("intervalKm")} />
        </Field>
        <Field label="Last service odo (km)">
          <input
            className="fl-i"
            type="number"
            placeholder="Blank = current odo"
            value={f.lastServiceOdo}
            onChange={set("lastServiceOdo")}
          />
        </Field>
        <Field label="Purchase date">
          <input className="fl-i" type="date" value={f.purchaseDate} onChange={set("purchaseDate")} />
        </Field>
        <Field label="Purchase price ($)">
          <input
            className="fl-i"
            type="number"
            placeholder="Feeds the Tiff estimate"
            value={f.purchasePrice}
            onChange={set("purchasePrice")}
          />
        </Field>
        <Field label="Book value ($)">
          <input className="fl-i" type="number" placeholder="e.g. 52000" value={f.value} onChange={set("value")} />
        </Field>
        <Field label="Status">
          <select className="fl-i" value={f.status} onChange={set("status")}>
            {(Object.keys(STATUS_LABEL) as VehicleStatus[]).map((k) => (
              <option key={k} value={k}>
                {STATUS_LABEL[k]}
              </option>
            ))}
          </select>
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

/* ---------------- log fuel / odometer / issue / service ---------------- */

const LOG_COPY: Record<LogKind, { title: string; sub: string; icon: string }> = {
  fuel: { title: "Log fuel", sub: "Fill-up against this vehicle", icon: "fuel" },
  odo: { title: "Update odometer", sub: "Current reading off the dash", icon: "gauge" },
  issue: { title: "Report an issue", sub: "Flag something wrong with this vehicle", icon: "alert" },
  service: { title: "Log service", sub: "Resets the service cycle from this odo", icon: "wrench" },
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

  const odoLow = odo.trim() !== "" && num(odo) < vehicle.odometer;
  const ready =
    kind === "fuel"
      ? litres.trim() !== ""
      : kind === "odo" || kind === "service"
        ? odo.trim() !== ""
        : note.trim() !== "";

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
    <FleetModal title={copy.title} sub={`${displayName(vehicle)} · ${modelLabel(vehicle)}`} onClose={onClose}>
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
          <Field
            label={kind === "service" ? "Serviced at odo (km)" : "Odometer (km)"}
            req={kind !== "fuel"}
            span={kind !== "fuel"}
            hint={odoLow ? `Lower than the current ${fmtKm(vehicle.odometer)} km — double-check the reading` : undefined}
          >
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
              kind === "issue"
                ? "e.g. Sliding door latch sticking — needs adjustment"
                : kind === "service"
                  ? "e.g. 85,000 km service — Braeside Auto"
                  : "Optional"
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
  eco,
  onResolve,
}: {
  log: VehicleLog;
  manager?: boolean;
  /** L/100km for this fill, when derivable. */
  eco?: number;
  onResolve?: (id: string) => void;
}) {
  const icon = LOG_COPY[log.kind].icon;
  const title =
    log.kind === "fuel"
      ? `Fuel — ${log.litres ? `${log.litres} L` : "fill-up"}${log.cost ? ` · ${fmtCost(log.cost)}` : ""}`
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
        <span className="fl-lr">
          {typeof eco === "number" && <span className="dchip2 ok">{eco} L/100km</span>}
          {typeof log.odo === "number" && <span className="fl-lo">{fmtKm(log.odo)} km</span>}
        </span>
      )}
    </div>
  );
}

export function DetailModal({
  vehicle,
  chips,
  logs,
  eco,
  staff,
  manager,
  onClose,
  onEdit,
  onAssign,
  onStatus,
  onLog,
  onResolve,
  onRemove,
}: {
  vehicle: Vehicle;
  chips: StatusChip[];
  logs: VehicleLog[];
  eco: Record<string, number>;
  staff: DemoStaff[];
  manager: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAssign: (staffId: string | null) => void;
  onStatus: (status: VehicleStatus) => void;
  onLog: (kind: LogKind) => void;
  onResolve: (logId: string) => void;
  onRemove: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const driver = staff.find((s) => s.id === vehicle.assignedTo);
  const facts = vehicleFacts(vehicle);
  const ai = aiValue(vehicle);
  const purchaseText = vehicle.purchasePrice
    ? `${fmtMoney(vehicle.purchasePrice)}${
        vehicle.purchaseDateDays ? ` · ${(vehicle.purchaseDateDays / 365.25).toFixed(1)} yrs ago` : ""
      }`
    : "—";

  return (
    <FleetModal
      title={displayName(vehicle)}
      sub={`${modelLabel(vehicle)} · ${vehicle.plate}`}
      wide
      onClose={onClose}
    >
      <div className="fl-chips">
        {vehicle.status === "sold" ? (
          <span className="dchip2 mute">Sold</span>
        ) : chips.length === 0 ? (
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
        {facts.map((fa) => (
          <div key={fa.key} className="fl-fact">
            <em>{fa.label}</em>
            <b>{fa.text}</b>
          </div>
        ))}
        {manager && (
          <>
            <div className="fl-fact">
              <em>Purchased</em>
              <b>{purchaseText}</b>
            </div>
            <div className="fl-fact">
              <em>Book value</em>
              <b>{fmtMoney(vehicle.value)}</b>
            </div>
            <div
              className="fl-fact tiff"
              title="Tiff AI market estimate from purchase price, age & kms — demo model"
            >
              <em>
                <Icon name="sparkles" size={11} />
                Tiff estimate
              </em>
              <b>{ai === null ? "—" : fmtMoney(ai)}</b>
            </div>
            <div className="fl-fact">
              <em>Status</em>
              <select
                className="fl-i slim"
                value={vehicle.status}
                onChange={(e) => onStatus(e.target.value as VehicleStatus)}
              >
                {(Object.keys(STATUS_LABEL) as VehicleStatus[]).map((k) => (
                  <option key={k} value={k}>
                    {STATUS_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
          </>
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
        <button className="fl-btn ghost" onClick={() => onLog("service")}>
          <Icon name="wrench" size={15} />
          Log service
        </button>
      </div>
      {manager && (
        <div className="fl-manage">
          <button className="fl-btn ghost" onClick={onEdit}>
            <Icon name="edit" size={15} />
            Edit vehicle
          </button>
          <button
            className={`fl-btn danger${confirmRemove ? " arm" : ""}`}
            onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
            onBlur={() => setConfirmRemove(false)}
          >
            <Icon name="x" size={15} />
            {confirmRemove ? "Confirm remove" : "Remove"}
          </button>
        </div>
      )}

      <div className="fl-hist">
        <div className="fl-hh">History</div>
        {logs.length === 0 ? (
          <div className="fl-hempty">No activity yet — fuel, odometer and issue logs land here.</div>
        ) : (
          logs.map((l) => <LogRow key={l.id} log={l} manager={manager} eco={eco[l.id]} onResolve={onResolve} />)
        )}
      </div>
    </FleetModal>
  );
}
