"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { Chevron } from "@/components/logo";
import { DateField } from "@/components/ui/date-field";
import { readFuelReceipt } from "@/app/actions/fleet-ai";
import { uploadFile } from "@/lib/documents/upload-client";
import { dateFromDays } from "@/lib/fleet/map";
import type { LogEdit } from "@/app/actions/fleet";
import { Plate } from "./plate";
import {
  FUEL_PAYERS,
  FUEL_PAYER_LABEL,
  type FuelPayer,
  STATUS_LABEL,
  type AiValuation,
  type LogKind,
  type FleetStaff,
  type NewLog,
  type StatusChip,
  type Vehicle,
  type VehicleIdentity,
  type VehicleStatus,
  type VehicleLog,
  daysUntil,
  displayName,
  fmtCost,
  fmtKm,
  fmtMoney,
  modelLabel,
  readReceiptOffline,
  vehicleFacts,
} from "./logic";

/* Modals portal to <body> (fl-ov is unscoped in shell.css, like .fg-cmd) —
   .page.in's will-change would trap position:fixed inside the shell. */

function num(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function FleetModal({
  title,
  sub,
  wide,
  onClose,
  children,
}: {
  title: string;
  /* ReactNode, not string: the detail modal sets its rego as a <Plate>, and a
     plate that only renders inside the register is half a component. */
  sub?: React.ReactNode;
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
  /** "warn" for a caution; the default just explains what the field means. */
  hintTone = "muted",
}: {
  label: string;
  req?: boolean;
  children: React.ReactNode;
  span?: boolean;
  hint?: string;
  hintTone?: "warn" | "muted";
}) {
  return (
    <label className={`fl-f${span ? " span" : ""}`}>
      <span>
        {label}
        {req && <i>*</i>}
      </span>
      {children}
      {hint && <em className={hintTone === "warn" ? "fl-warnhint" : "fl-hint"}>{hint}</em>}
    </label>
  );
}

/* ---------------- add / edit vehicle ---------------- */

/** An AU rego plate is only unique within its state or territory, so the
    register stores which one it came from (matching the DB check constraint). */
const AU_STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"] as const;

export function VehicleFormModal({
  initial,
  staff,
  today,
  onSave,
  onClose,
}: {
  initial: Vehicle | null;
  staff: FleetStaff[];
  /** The AU calendar date, from the server. The browser's clock is not the
      anchor: the day-counts this form produces are converted back to dates
      server-side against the same day, and the two must agree. */
  today: string;
  onSave: (v: Vehicle) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState(() =>
    initial
      ? {
          name: initial.name,
          plate: initial.plate,
          plateState: initial.plateState ?? "",
          make: initial.make,
          model: initial.model,
          year: initial.year ? String(initial.year) : "",
          odometer: String(initial.odometer),
          rego: dateFromDays(initial.regoDays, today),
          insurance: dateFromDays(initial.insuranceDays, today),
          intervalKm: String(initial.serviceIntervalKm),
          lastServiceOdo: String(initial.lastServiceOdo),
          purchaseDate: initial.purchaseDateDays ? dateFromDays(-initial.purchaseDateDays, today) : "",
          purchasePrice: initial.purchasePrice ? String(initial.purchasePrice) : "",
          value: String(initial.value),
          status: initial.status as VehicleStatus,
          assignedTo: initial.assignedTo ?? "",
          notes: initial.notes ?? "",
        }
      : {
          name: "",
          plate: "",
          plateState: "",
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
  /* DateField hands back an ISO date or null, not an event — the form keeps
     dates as "" when unset, which is what `save` already reads. */
  const setDate = (k: keyof typeof f) => (iso: string | null) =>
    setF((p) => ({ ...p, [k]: iso ?? "" }));

  const ready = f.plate.trim() && f.make.trim();

  const save = () => {
    if (!ready) return;
    const odometer = num(f.odometer);
    onSave({
      // blank id = a new row; the database mints the uuid
      id: initial?.id ?? "",
      name: f.name.trim().toUpperCase(),
      plate: f.plate.trim().toUpperCase(),
      plateState: f.plateState || null,
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
        <Field label="Registered in" hint="Plates are only unique within a state" hintTone="warn">
          <select className="fl-i" value={f.plateState} onChange={set("plateState")}>
            <option value="">Not stated</option>
            {AU_STATES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
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
          <DateField size="lg" clearable today={today} value={f.rego || null} onChange={setDate("rego")} />
        </Field>
        <Field label="Insurance expiry">
          <DateField size="lg" clearable today={today} value={f.insurance || null} onChange={setDate("insurance")} />
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
          <DateField
            size="lg"
            clearable
            today={today}
            value={f.purchaseDate || null}
            onChange={setDate("purchaseDate")}
          />
        </Field>
        <Field label="Purchase price ($)" hint="What you paid for it. Never changes — it's history, and it anchors Tiff's estimate.">
          <input
            className="fl-i"
            type="number"
            placeholder="What you paid"
            value={f.purchasePrice}
            onChange={set("purchasePrice")}
          />
        </Field>
        <Field label="Book value ($)" hint="What it's worth today. You keep this current; it's what the fleet total adds up.">
          <input className="fl-i" type="number" placeholder="What it's worth now" value={f.value} onChange={set("value")} />
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
                  {s.name}
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

/* ---------------- log fuel / odometer / issue / service ----------------
   Fuel opens in Scan mode: photograph or upload the receipt, Tiff reads
   litres/cost/station (offline fallback = deterministic demo read), then a
   confirm step with everything editable. Manual entry is one link away. */

const LOG_COPY: Record<LogKind, { title: string; sub: string; icon: string }> = {
  fuel: { title: "Log fuel", sub: "Scan the receipt — Tiff reads it", icon: "fuel" },
  odo: { title: "Update odometer", sub: "Current reading off the dash", icon: "gauge" },
  issue: { title: "Report an issue", sub: "Flag something wrong with this vehicle", icon: "alert" },
  service: { title: "Log service", sub: "Resets the service cycle from this odo", icon: "wrench" },
};

type FuelMode = "scan" | "reading" | "confirm" | "manual";

export function LogModal({
  kind,
  today,
  vehicle,
  fleetVehicles,
  onSave,
  onClose,
}: {
  kind: LogKind;
  /** The server's AU calendar date — the ceiling on a receipt date. */
  today: string;
  /** Identity width on purpose: logging needs a name, a plate and an odometer
      reading, which is exactly what someone without `assets_all` is sent. */
  vehicle: VehicleIdentity;
  /** Working fleet for the rego picker — lets a driver log against a borrowed
      or pool vehicle instead of their own. Omit to lock to `vehicle`. */
  fleetVehicles?: VehicleIdentity[];
  onSave: (log: NewLog) => void;
  onClose: () => void;
}) {
  const [vehicleId, setVehicleId] = useState(vehicle.id);
  const [litres, setLitres] = useState("");
  const [cost, setCost] = useState("");
  const [odo, setOdo] = useState("");
  const [note, setNote] = useState("");
  /* Company card is the default because it is the common case AND the one that
     raises nothing extra — the path with a consequence has to be chosen. */
  const [paidWith, setPaidWith] = useState<FuelPayer>("company");
  const [station, setStation] = useState("");
  const [gst, setGst] = useState("");
  const [abn, setAbn] = useState("");
  const [bought, setBought] = useState("");
  const [mode, setMode] = useState<FuelMode>(kind === "fuel" ? "scan" : "manual");
  const [thumb, setThumb] = useState<string | null>(null);
  const [scanTag, setScanTag] = useState<"tiff" | "offline" | null>(null);
  /* The stored docket. Uploaded while Tiff reads it, so by the time the person
     has checked the figures the photo is already in the bucket and Save only
     has to point the log at it. Null means the figures will be saved with
     nothing behind them — allowed, and said out loud on screen. */
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [receiptWarn, setReceiptWarn] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const copy = LOG_COPY[kind];

  // rego picker: default vehicle first, then the rest of the working fleet by plate
  const pickable = [...(fleetVehicles ?? [])]
    .filter((v) => v.status !== "sold")
    .sort(
      (a, b) =>
        (a.id === vehicle.id ? -1 : 0) - (b.id === vehicle.id ? -1 : 0) ||
        a.plate.localeCompare(b.plate),
    );
  const target = pickable.find((v) => v.id === vehicleId) ?? vehicle;
  const vehiclePicker = pickable.length > 1 && (
    /* A native <option> can only hold text, so the list stays plain and the
       CHOSEN vehicle gets the plate beside the select — which is the one that
       matters anyway: it's the answer to "am I about to log this against the
       right van", asked at the moment the fuel docket is in the other hand. */
    <Field label="Vehicle / rego" span>
      <div className="fl-pickrow">
        <select className="fl-i" value={target.id} onChange={(e) => setVehicleId(e.target.value)}>
          {pickable.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate} — {v.name || modelLabel(v)}
            </option>
          ))}
        </select>
        <Plate plate={target.plate} state={target.plateState} size="sm" />
      </div>
    </Field>
  );

  useEffect(() => {
    return () => {
      if (thumb) URL.revokeObjectURL(thumb);
    };
  }, [thumb]);

  const handleFile = async (file: File | null | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    setThumb(URL.createObjectURL(file));
    setMode("reading");
    setReceiptWarn(null);

    /* Two jobs, side by side, because they are independent: KEEPING the docket
       and READING it. The read is a convenience — the fields are editable
       either way — but the file is the thing the ATO wants five years from
       now, so a failed read must not cost the photo, and a failed upload must
       not cost the reading. Promise.all, not a chain. */
    const [stored, read] = await Promise.all([
      uploadFile(file, "fuel_receipt").catch(() => ({ ok: false, error: "upload" }) as const),
      fileToBase64(file)
        .then((b64) => readFuelReceipt(b64, file.type))
        .catch(() => ({ ok: false, reason: "offline" }) as const),
    ]);

    if (stored.ok) setReceiptId(stored.file.documentId);
    else setReceiptWarn("Couldn't store the photo — the entry will save without it.");

    let filled = false;
    if (read.ok) {
      if (read.litres !== null) setLitres(String(read.litres));
      if (read.cost !== null) setCost(read.cost.toFixed(2));
      if (read.station) setStation(read.station);
      if (read.gst !== null) setGst(read.gst.toFixed(2));
      if (read.abn) setAbn(read.abn);
      if (read.date) setBought(read.date);
      setScanTag("tiff");
      filled = true;
    }
    if (!filled) {
      const off = readReceiptOffline(file.size);
      setLitres(String(off.litres));
      setCost(off.cost.toFixed(2));
      setStation(off.station);
      setScanTag("offline");
    }
    setMode("confirm");
  };

  const rescan = () => {
    setScanTag(null);
    setLitres("");
    setCost("");
    setStation("");
    setGst("");
    setAbn("");
    setBought("");
    /* The old photo is NOT deleted — it is an unadopted document with no log
       pointing at it, which every read already ignores. Deleting it here would
       mean a delete round trip on the way to a re-scan, and the thing being
       thrown away is the one thing worth keeping if the second scan fails. */
    setReceiptId(null);
    setReceiptWarn(null);
    setMode("scan");
  };

  const odoLow = odo.trim() !== "" && num(odo) < target.odometer;
  /* The two tax figures get checked HERE as well as on the server, because
     these are the ones somebody types from a photo they are squinting at.
     The server still refuses either one — this is the warning, not the gate. */
  const gstOver = gst.trim() !== "" && cost.trim() !== "" && num(gst) > num(cost) / 11 + 0.01;
  const abnBad = abn.trim() !== "" && abn.replace(/\D/g, "").length !== 11;
  /* A tank on a personal card cannot be reimbursed without an amount, and the
     server refuses it — say so here rather than letting them press Save. */
  const owingNoCost = paidWith === "own" && cost.trim() === "";
  const ready =
    kind === "fuel"
      ? litres.trim() !== "" && !gstOver && !abnBad && !owingNoCost && (mode === "confirm" || mode === "manual")
      : kind === "odo" || kind === "service"
        ? odo.trim() !== ""
        : note.trim() !== "";

  const save = () => {
    if (!ready) return;
    onSave({
      vehicleId: target.id,
      kind,
      litres: kind === "fuel" ? num(litres) : undefined,
      cost: kind === "fuel" && cost.trim() ? num(cost) : undefined,
      odo: kind !== "issue" && odo.trim() ? num(odo) : undefined,
      note: note.trim() || undefined,
      station: kind === "fuel" && station.trim() ? station.trim() : undefined,
      source: kind === "fuel" ? (scanTag ? "scan" : "manual") : undefined,
      gst: kind === "fuel" && gst.trim() ? num(gst) : undefined,
      abn: kind === "fuel" && abn.trim() ? abn.trim() : undefined,
      purchasedOn: kind === "fuel" && bought.trim() ? bought.trim() : undefined,
      receiptDocumentId: kind === "fuel" ? receiptId ?? undefined : undefined,
      paidWith: kind === "fuel" ? paidWith : undefined,
    });
  };

  const fuelFields = (
    <>
      {/* FIRST, because it decides what this log produces beyond itself: a
          company card stops at the vehicle log, a personal one also raises a
          reimbursement. Two buttons rather than a select — there are two
          answers and the consequence of each is worth spelling out. */}
      <Field label="Paid with" req>
        <div className="fl-pay">
          {FUEL_PAYERS.map((p) => (
            <button
              key={p}
              type="button"
              className={"fl-payb" + (paidWith === p ? " on" : "")}
              aria-pressed={paidWith === p}
              onClick={() => setPaidWith(p)}
            >
              <b>{FUEL_PAYER_LABEL[p]}</b>
              <em>{p === "company" ? "Logged against the vehicle" : "Also claimed back to you"}</em>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Litres" req>
        <input className="fl-i" type="number" placeholder="e.g. 62.4" value={litres} onChange={(e) => setLitres(e.target.value)} />
      </Field>
      <Field
        label="Cost ($)"
        req={paidWith === "own"}
        hint={owingNoCost ? "Needed — this is what gets reimbursed" : undefined}
        hintTone={owingNoCost ? "warn" : "muted"}
      >
        <input className="fl-i" type="number" placeholder="e.g. 158.40" value={cost} onChange={(e) => setCost(e.target.value)} />
      </Field>
      <Field label="Station">
        <input className="fl-i" placeholder="e.g. Shell Coburg" value={station} onChange={(e) => setStation(e.target.value)} />
      </Field>
      {/* The docket's own date, not today's. A fill on Friday that gets logged
          on Monday belongs to Friday — and in June that is the difference
          between two financial years. */}
      <Field label="Date on receipt" hint={bought ? undefined : "Blank means today"}>
        <DateField
          size="lg"
          clearable
          today={today}
          max={today}
          value={bought || null}
          onChange={(iso) => setBought(iso ?? "")}
        />
      </Field>
      <Field
        label="GST ($)"
        hint={gstOver ? "More than an eleventh of the total — check the docket" : "Only if the receipt shows it"}
        hintTone={gstOver ? "warn" : "muted"}
      >
        <input className="fl-i" type="number" placeholder="e.g. 14.40" value={gst} onChange={(e) => setGst(e.target.value)} />
      </Field>
      <Field
        label="Supplier ABN"
        hint={abnBad ? "An ABN is eleven digits" : undefined}
        hintTone={abnBad ? "warn" : "muted"}
      >
        <input className="fl-i" inputMode="numeric" placeholder="e.g. 51 824 753 556" value={abn} onChange={(e) => setAbn(e.target.value)} />
      </Field>
      <Field
        label="Odometer (km)"
        hint={odoLow ? `Lower than the current ${fmtKm(target.odometer)} km — double-check the reading` : undefined}
      >
        <input
          className="fl-i"
          type="number"
          placeholder={`Currently ${fmtKm(target.odometer)}`}
          value={odo}
          onChange={(e) => setOdo(e.target.value)}
        />
      </Field>
      <Field label="Note" span>
        <textarea className="fl-i" placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </>
  );

  return (
    <FleetModal title={copy.title} sub={`${displayName(target)} · ${modelLabel(target)}`} onClose={onClose}>
      {kind === "fuel" && mode === "scan" && (
        <>
          {vehiclePicker && <div className="fl-grid" style={{ marginBottom: 14 }}>{vehiclePicker}</div>}
          <label
            className={`fl-scan${dragOver ? " over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void handleFile(e.dataTransfer.files?.[0]);
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            {/* the camera, not a sparkle: this tile's job is "point your
                phone at the docket", and the line under it already says who
                reads it. The glyph should name the ACTION you take. */}
            <span className="fl-scanic">
              <Icon name="cam" size={22} />
            </span>
            <b>Snap or upload the receipt</b>
            <em>Tiff reads the litres, cost &amp; servo for you</em>
          </label>
          <button className="fl-modeline" onClick={() => setMode("manual")}>
            enter manually instead
          </button>
        </>
      )}

      {kind === "fuel" && mode === "reading" && (
        <div className="fl-readingwrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {thumb && <img className="fl-scanthumb" src={thumb} alt="Receipt" />}
          <div className="fl-reading">
            <Chevron size={20} gradient decorative />
            Tiff is reading the receipt…
          </div>
        </div>
      )}

      {kind === "fuel" && mode === "confirm" && (
        <>
          <div className="fl-scanhead">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {thumb && <img className="fl-scanthumb small" src={thumb} alt="Receipt" />}
            <span className={`dchip2 ${scanTag === "tiff" ? "ok" : "mute"}`}>
              <Chevron size={15} gradient decorative />
              {scanTag === "tiff" ? "Read by Tiff — check & save" : "Demo read — Tiff offline"}
            </span>
            <button className="fl-modeline inline" onClick={rescan}>
              re-scan
            </button>
          </div>
          {/* Whether the docket itself was KEPT is a separate fact from whether
              Tiff could read it, and it is the one that matters at tax time —
              so it gets said, either way, rather than being assumed. */}
          <div className={`fl-keptline${receiptId ? "" : " warn"}`}>
            <Icon name={receiptId ? "check" : "alert"} size={13} />
            {receiptId
              ? "Receipt saved — it'll be filed against this financial year"
              : receiptWarn ?? "This entry will save without the receipt photo."}
          </div>
          <div className="fl-grid">{vehiclePicker}{fuelFields}</div>
        </>
      )}

      {kind === "fuel" && mode === "manual" && <div className="fl-grid">{vehiclePicker}{fuelFields}</div>}

      {kind !== "fuel" && (
        <div className="fl-grid">
          {vehiclePicker}
          {kind !== "issue" && (
            <Field
              label={kind === "service" ? "Serviced at odo (km)" : "Odometer (km)"}
              req
              span
              hint={odoLow ? `Lower than the current ${fmtKm(target.odometer)} km — double-check the reading` : undefined}
            >
              <input
                className="fl-i"
                type="number"
                placeholder={`Currently ${fmtKm(target.odometer)}`}
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
      )}

      <div className="fl-foot">
        <button className="fl-btn ghost" onClick={onClose}>
          Cancel
        </button>
        {(kind !== "fuel" || mode === "confirm" || mode === "manual") && (
          <button className="fl-btn primary" disabled={!ready} onClick={save}>
            <Icon name={copy.icon} size={15} />
            {copy.title}
          </button>
        )}
      </div>
    </FleetModal>
  );
}

/* ---------------- correcting an entry ---------------- */

/* Editing a log, and removing one.

   A SEPARATE MODAL from LogModal, deliberately. That one is a capture flow: it
   opens on a camera, it has a scan step, and its whole shape is "get the
   docket into the app". This is the opposite job — the figures already exist
   and one of them is wrong — so it opens on the fields, filled in, with no
   camera anywhere near it. Bending the capture modal into doing both would
   have meant a mode flag threaded through every branch of it.

   THE RECEIPT IS NOT REPLACEABLE HERE. A stored docket is the evidence for
   this entry; swapping it for a different photo after the fact is not a
   correction, it is a substitution. Wrong photo means remove the entry and log
   it again, which leaves both acts on the record. */
export function EditLogModal({
  log,
  today,
  onSave,
  onDelete,
  onClose,
}: {
  log: VehicleLog;
  today: string;
  onSave: (patch: LogEdit) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [litres, setLitres] = useState(log.litres != null ? String(log.litres) : "");
  const [cost, setCost] = useState(log.cost != null ? log.cost.toFixed(2) : "");
  const [odo, setOdo] = useState(log.odo != null ? String(log.odo) : "");
  const [note, setNote] = useState(log.note ?? "");
  const [station, setStation] = useState(log.station ?? "");
  const [gst, setGst] = useState(log.gst != null ? log.gst.toFixed(2) : "");
  const [abn, setAbn] = useState(log.abn ?? "");
  const [bought, setBought] = useState(isoOf(log, today));
  const [confirming, setConfirming] = useState(false);

  const isFuel = log.kind === "fuel";
  const gstOver = gst.trim() !== "" && cost.trim() !== "" && num(gst) > num(cost) / 11 + 0.01;
  const abnBad = abn.trim() !== "" && abn.replace(/\D/g, "").length !== 11;
  /* Who paid is NOT editable here. The claim raised at logging time is a real
     row somebody is waiting on; flipping the payer afterwards would have to
     raise or withdraw a reimbursement, which is a conversation, not a field. */
  const ready = !gstOver && !abnBad && (isFuel ? litres.trim() !== "" : true);

  const save = () => {
    if (!ready) return;
    onSave({
      note: note.trim(),
      odo: odo.trim() ? num(odo) : undefined,
      ...(isFuel
        ? {
            litres: litres.trim() ? num(litres) : undefined,
            cost: cost.trim() ? num(cost) : undefined,
            station: station.trim(),
            gst: gst.trim() ? num(gst) : 0,
            abn: abn.trim(),
            purchasedOn: bought.trim() || undefined,
          }
        : {}),
    });
  };

  return (
    <FleetModal
      title="Correct this entry"
      sub={`${LOG_COPY[log.kind].title} · ${log.when}`}
      onClose={onClose}
    >
      {confirming ? (
        /* The one destructive act in the fleet screens, so it asks — and says
           what actually happens, because "delete" is not quite what this does
           and a person about to press it deserves the real answer. */
        <div className="fl-danger">
          <b>Remove this entry?</b>
          <em>
            It disappears from the history, the vehicle&rsquo;s odometer is recalculated from what
            is left, and it stops counting towards tax.
            {log.hasReceipt && " The receipt stays on file."} The entry is kept, hidden, so a
            figure that has already gone to your accountant can still be accounted for.
          </em>
          <div className="fl-foot">
            <button className="fl-btn ghost" onClick={() => setConfirming(false)}>
              Keep it
            </button>
            <button className="fl-btn danger arm" onClick={onDelete}>
              <Icon name="x" size={15} />
              Remove entry
            </button>
          </div>
        </div>
      ) : (
        <>
          {log.hasReceipt && (
            <div className="fl-keptline">
              <Icon name="receipt" size={13} />
              The receipt on this entry stays as it is — to change the photo, remove the entry and
              log it again.
            </div>
          )}
          <div className="fl-grid">
            {isFuel && (
              <>
                <Field label="Litres" req>
                  <input className="fl-i" type="number" value={litres} onChange={(e) => setLitres(e.target.value)} />
                </Field>
                <Field label="Cost ($)">
                  <input className="fl-i" type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
                </Field>
                <Field label="Station">
                  <input className="fl-i" value={station} onChange={(e) => setStation(e.target.value)} />
                </Field>
                <Field label="Date on receipt">
                  <DateField
                    size="lg"
                    clearable
                    today={today}
                    max={today}
                    value={bought || null}
                    onChange={(iso) => setBought(iso ?? "")}
                  />
                </Field>
                <Field
                  label="GST ($)"
                  hint={gstOver ? "More than an eleventh of the total — check the docket" : "Only if the receipt shows it"}
                  hintTone={gstOver ? "warn" : "muted"}
                >
                  <input className="fl-i" type="number" value={gst} onChange={(e) => setGst(e.target.value)} />
                </Field>
                <Field
                  label="Supplier ABN"
                  hint={abnBad ? "An ABN is eleven digits" : undefined}
                  hintTone={abnBad ? "warn" : "muted"}
                >
                  <input className="fl-i" inputMode="numeric" value={abn} onChange={(e) => setAbn(e.target.value)} />
                </Field>
              </>
            )}
            {log.kind !== "issue" && (
              <Field label="Odometer (km)" span={!isFuel}>
                <input className="fl-i" type="number" value={odo} onChange={(e) => setOdo(e.target.value)} />
              </Field>
            )}
            <Field label={log.kind === "issue" ? "What's wrong" : "Note"} span>
              <textarea className="fl-i" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>

          <div className="fl-foot spread">
            <button className="fl-btn danger" onClick={() => setConfirming(true)}>
              <Icon name="x" size={15} />
              Remove
            </button>
            <span className="fl-footright">
              <button className="fl-btn ghost" onClick={onClose}>
                Cancel
              </button>
              <button className="fl-btn primary" disabled={!ready} onClick={save}>
                <Icon name="check" size={15} />
                Save correction
              </button>
            </span>
          </div>
        </>
      )}
    </FleetModal>
  );
}

/* The log's date back as ISO. VehicleLog carries a DISPLAY date ("Wed 15 Jul")
   plus how many days ago it was, which is all every other screen needed — and
   `ago` is exact, so the date is recoverable without widening the projection.

   Anchored on the SERVER's `today`, never on Date.now(): the browser clock is
   the previous day for most of an Australian working morning, and this value
   goes back as the date a purchase happened. */
function isoOf(log: VehicleLog, today: string): string {
  const t = Date.parse(`${today}T00:00:00Z`) - log.ago * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/* ---------------- vehicle detail + history ---------------- */

export function LogRow({
  log,
  manager,
  eco,
  onResolve,
  onCorrect,
}: {
  log: VehicleLog;
  manager?: boolean;
  /** L/100km for this fill, when derivable. */
  eco?: number;
  onResolve?: (id: string) => void;
  /* Present only when this viewer may correct THIS row — the caller works out
     "mine, or I hold the register" once, rather than every row asking. */
  onCorrect?: (log: VehicleLog) => void;
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
  const meta = [log.when, log.staffName, log.station, log.edited ? "edited" : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={`fl-log${log.kind === "issue" && log.status === "open" ? " open" : ""}`}>
      <span className={`fl-li ${log.kind}`}>
        <Icon name={icon} size={15} />
      </span>
      <span className="fl-lk">
        <b>{title}</b>
        <em>{meta}</em>
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
          {/* The docket is kept, so the history says so — this row is what
              somebody looks at when the question is "do we have the receipt
              for that fill", months before the Tax screen is opened. */}
          {log.kind === "fuel" && log.hasReceipt && (
            <span className="dchip2 ok" title="Receipt stored for tax">
              <Icon name="receipt" size={12} />
              Receipt
            </span>
          )}
          {typeof eco === "number" && <span className="dchip2 ok">{eco} L/100km</span>}
          {typeof log.odo === "number" && <span className="fl-lo">{fmtKm(log.odo)} km</span>}
        </span>
      )}
      {/* Deliberately quiet: correcting an entry is rare, and a button that
          shouted would make every row look like a problem. */}
      {onCorrect && (
        <button className="fl-lfix" onClick={() => onCorrect(log)} aria-label="Correct this entry">
          <Icon name="edit" size={13} />
        </button>
      )}
    </div>
  );
}

export function DetailModal({
  vehicle,
  chips,
  logs,
  eco,
  valuation,
  valuationIsStale,
  staff,
  manager,
  onClose,
  onEdit,
  onAssign,
  onStatus,
  onLog,
  onResolve,
  onRemove,
  onCorrect,
}: {
  vehicle: Vehicle;
  chips: StatusChip[];
  logs: VehicleLog[];
  eco: Record<string, number>;
  valuation?: AiValuation;
  valuationIsStale?: boolean;
  staff: FleetStaff[];
  manager: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAssign: (staffId: string | null) => void;
  onStatus: (status: VehicleStatus) => void;
  onLog: (kind: LogKind) => void;
  onResolve: (logId: string) => void;
  onRemove: () => void;
  /* Every row is correctable here: reaching this modal at all means holding
     `assets_all`, which is the tier that fixes anyone's entry. */
  onCorrect?: (log: VehicleLog) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const driver = staff.find((s) => s.id === vehicle.assignedTo);
  const facts = vehicleFacts(vehicle);
  const purchaseText = vehicle.purchasePrice
    ? `${fmtMoney(vehicle.purchasePrice)}${
        vehicle.purchaseDateDays ? ` · ${(vehicle.purchaseDateDays / 365.25).toFixed(1)} yrs ago` : ""
      }`
    : "—";
  const tiffTitle = valuation
    ? valuationIsStale
      ? "Odometer has moved since Tiff valued this — run Value with Tiff again"
      : valuation.note || "Tiff's AU-market estimate"
    : "Run “Value with Tiff” in the register to get a live AI valuation";

  return (
    <FleetModal
      title={displayName(vehicle)}
      sub={
        <>
          {modelLabel(vehicle)}
          <Plate plate={vehicle.plate} state={vehicle.plateState} size="sm" />
        </>
      }
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
            <div className={`fl-fact tiff${valuationIsStale ? " stale" : ""}`} title={tiffTitle}>
              <em>
                <Chevron size={14} gradient decorative />
                Tiff value
              </em>
              <b>{valuation ? fmtMoney(valuation.point) : "—"}</b>
              {valuation && (
                <span className="fl-range">
                  {fmtMoney(valuation.low)}–{fmtMoney(valuation.high)}
                </span>
              )}
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
          logs.map((l) => (
            <LogRow
              key={l.id}
              log={l}
              manager={manager}
              eco={eco[l.id]}
              onResolve={onResolve}
              onCorrect={onCorrect}
            />
          ))
        )}
      </div>
    </FleetModal>
  );
}
