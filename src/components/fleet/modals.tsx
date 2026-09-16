"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { Chevron } from "@/components/logo";
import { DateField } from "@/components/ui/date-field";
import { scanInProgress } from "@/components/record-modal/scan-card";
import { readFuelReceipt, readServiceRecord } from "@/app/actions/fleet-ai";
import { uploadFile } from "@/lib/documents/upload-client";
import { fileToUprightBase64 } from "@/lib/images/upright";
import type { LogEdit } from "@/app/actions/fleet";
import { Plate } from "./plate";
import { LOG_WORD, fmtDay, logIso } from "./vehicle-modal/derive";
import {
  FUEL_PAYERS,
  FUEL_PAYER_LABEL,
  type FuelPayer,
  type LogKind,
  type NewLog,
  type VehicleIdentity,
  type VehicleLog,
  displayName,
  fmtCost,
  fmtKm,
  modelLabel,
} from "./logic";

/* What is left here: the log modals (fuel / odometer / issue / service), the
   correction modal, and the shared FleetModal shell they stand on. The vehicle
   card, its renewal screens, the service history, one entry read on its own,
   and the add/edit form live in ./vehicle-modal/ — one modal with screens, in
   the Sep 2026 design. */

/* Modals portal to <body> (fl-ov is unscoped in shell.css, like .fg-cmd) —
   .page.in's will-change would trap position:fixed inside the shell. */

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
  /* ReactNode, not string: the detail modal sets its rego as a <Plate>, and a
     plate that only renders inside the register is half a component. */
  sub?: React.ReactNode;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  /* Escape and the backdrop close the modal, except while a scan in it is being
     read or waits to be checked — today, the fuel docket: then they do nothing
     (see scanInProgress). The X still closes. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !scanInProgress()) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fl-ov" onClick={() => (scanInProgress() ? undefined : onClose())}>
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

/* ---------------- log fuel / odometer / issue / service ----------------
   Fuel opens in Scan mode: photograph or upload the receipt, Tiff reads
   litres/cost/station (offline fallback = deterministic demo read), then a
   confirm step with everything editable. Manual entry is one link away. */

const LOG_COPY: Record<LogKind, { title: string; sub: string; icon: string }> = {
  fuel: { title: "Log fuel", sub: "Scan the receipt — Tiff reads it", icon: "fuel" },
  odo: { title: "Update odometer", sub: "Current reading off the dash", icon: "gauge" },
  issue: { title: "Report an issue", sub: "Flag something wrong with this vehicle", icon: "alert" },
  service: { title: "Log service", sub: "Scan the invoice — Tiff reads it", icon: "wrench" },
};

/* The capture flow's step. Fuel and service both open on a scan — the docket,
   the workshop's invoice — and land on a confirm step with every field
   editable; odometer and issue have no paper and open on the fields. */
type CaptureMode = "scan" | "reading" | "confirm" | "manual";

/* What is scanned for each kind that scans, and what it is called. */
const SCAN_COPY = {
  fuel: {
    prompt: "Snap or upload the receipt",
    hint: "Tiff reads the litres, cost & servo for you",
    reading: "Tiff is reading the receipt…",
    kept: "Receipt saved — it'll be filed against this financial year",
    lost: "Couldn't store the photo — the entry will save without it.",
    without: "This entry will save without the receipt photo.",
    docKind: "fuel_receipt",
    icon: "cam",
    accept: "image/*",
  },
  service: {
    prompt: "Snap or upload the service invoice",
    hint: "Tiff reads the work done, the cost & the workshop for you",
    reading: "Tiff is reading the invoice…",
    kept: "Service record saved — it'll be filed against this vehicle",
    lost: "Couldn't store the record — the entry will save without it.",
    without: "This entry will save without the service record.",
    docKind: "service_record",
    icon: "upload",
    accept: "image/*,application/pdf",
  },
} as const;

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
  /* Service only: the itemised work, one line per item, as the invoice lists
     it. `note` stays the one line the history prints. */
  const [workDone, setWorkDone] = useState("");
  const scans = kind === "fuel" || kind === "service";
  const [mode, setMode] = useState<CaptureMode>(scans ? "scan" : "manual");
  const [thumb, setThumb] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [scanTag, setScanTag] = useState<"tiff" | null>(null);
  /* A record Tiff could not read is still kept; the fields open empty and
     this says why. Fuel has no such state — its offline fallback is a demo
     read, tagged as one. */
  const [readWarn, setReadWarn] = useState<string | null>(null);
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
    /* two statements, not one `||`: React Compiler 1.0 refuses a logical
       whose test is a ternary and gives up on the whole component */
    .sort((a, b) => {
      const byDefault = (a.id === vehicle.id ? -1 : 0) - (b.id === vehicle.id ? -1 : 0);
      if (byDefault !== 0) return byDefault;
      return a.plate.localeCompare(b.plate);
    });
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
    if (!file) return;
    const image = file.type.startsWith("image/");
    if (kind === "fuel" ? !image : !(image || file.type === "application/pdf")) return;
    setThumb(image ? URL.createObjectURL(file) : null);
    setFileName(file.name);
    setMode("reading");
    setReceiptWarn(null);
    setReadWarn(null);

    if (kind === "service") {
      /* The same two independent jobs as the docket below — keep the invoice,
         read the invoice — and the same rule: a failed read costs nothing but
         the typing, and a failed upload costs nothing but the file. */
      const [stored, read] = await Promise.all([
        uploadFile(file, "service_record").catch(() => ({ ok: false, error: "upload" }) as const),
        fileToUprightBase64(file)
          .then((img) => readServiceRecord(img.data, img.mediaType))
          .catch(() => ({ ok: false, reason: "offline" }) as const),
      ]);
      if (stored.ok) setReceiptId(stored.file.documentId);
      else setReceiptWarn(SCAN_COPY.service.lost);
      if (read.ok) {
        if (read.workshop) setStation(read.workshop);
        if (read.cost !== null) setCost(read.cost.toFixed(2));
        if (read.gst !== null) setGst(read.gst.toFixed(2));
        if (read.abn) setAbn(read.abn);
        if (read.servicedOn) setBought(read.servicedOn);
        if (read.odometer !== null) setOdo(String(read.odometer));
        if (read.summary) setNote(read.summary);
        if (read.workDone.length > 0) setWorkDone(read.workDone.join("\n"));
        setScanTag("tiff");
      } else {
        /* Nothing read, nothing invented: the fields open empty and the
           record, if it landed, is still filed. Said plainly. */
        setScanTag(null);
        setReadWarn("Tiff couldn't read that one — enter the details below.");
      }
      setMode("confirm");
      return;
    }

    /* Two jobs, side by side, because they are independent: KEEPING the docket
       and READING it. The read is a convenience — the fields are editable
       either way — but the file is the thing the ATO wants five years from
       now, so a failed read must not cost the photo, and a failed upload must
       not cost the reading. Promise.all, not a chain. */
    const [stored, read] = await Promise.all([
      uploadFile(file, "fuel_receipt").catch(() => ({ ok: false, error: "upload" }) as const),
      fileToUprightBase64(file)
        .then((img) => readFuelReceipt(img.data, img.mediaType))
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
      /* NOTHING READ, NOTHING INVENTED. This filled the fill in from the
         image's FILE SIZE — 45 to 75 litres, a price per litre, and a servo
         off a list of five — and labelled it "Demo read — Tiff offline". It
         ran on every failure, not just a missing key: a refusal, a file too
         large, a dropped connection. On "My own money" those invented
         figures became a reimbursement and a tax line, off a docket that
         says something else. The card's own screen already answers this way,
         and the docket is still kept either way. */
      setScanTag(null);
      setReadWarn("Tiff couldn't read that one — enter the details below.");
    }
    setMode("confirm");
  };

  const rescan = () => {
    setScanTag(null);
    setReadWarn(null);
    setFileName(null);
    setLitres("");
    setCost("");
    setStation("");
    setGst("");
    setAbn("");
    setBought("");
    setOdo("");
    setNote("");
    setWorkDone("");
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
      : kind === "service"
        ? odo.trim() !== "" && !gstOver && !abnBad && (mode === "confirm" || mode === "manual")
        : kind === "odo"
          ? odo.trim() !== ""
          : note.trim() !== "";

  const save = () => {
    if (!ready) return;
    onSave({
      vehicleId: target.id,
      kind,
      litres: kind === "fuel" ? num(litres) : undefined,
      // fuel and servicing are the two things a vehicle costs that get logged
      cost: (kind === "fuel" || kind === "service") && cost.trim() ? num(cost) : undefined,
      odo: kind !== "issue" && odo.trim() ? num(odo) : undefined,
      note: note.trim() || undefined,
      station: scans && station.trim() ? station.trim() : undefined,
      source: scans ? (scanTag ? "scan" : "manual") : undefined,
      gst: scans && gst.trim() ? num(gst) : undefined,
      abn: scans && abn.trim() ? abn.trim() : undefined,
      purchasedOn: scans && bought.trim() ? bought.trim() : undefined,
      receiptDocumentId: scans ? receiptId ?? undefined : undefined,
      paidWith: kind === "fuel" ? paidWith : undefined,
      workDone: kind === "service" && workDone.trim() ? workDone.trim() : undefined,
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

  /* The service, as the workshop's invoice states it: who did it, when, at
     what reading, for how much, the GST and ABN the tax export wants, the one
     line the history prints, and the itemised work under it. Fuel's tax
     fields are the same fields with the same checks. */
  const serviceFields = (
    <>
      <Field label="Workshop">
        <input className="fl-i" placeholder="e.g. Braeside Auto" value={station} onChange={(e) => setStation(e.target.value)} />
      </Field>
      <Field label="Date on invoice" hint={bought ? undefined : "Blank means today"}>
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
        label="Serviced at odo (km)"
        req
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
      <Field label="Cost ($)" hint="What the service cost — it feeds the card's cost to run">
        <input className="fl-i" type="number" placeholder="e.g. 480" value={cost} onChange={(e) => setCost(e.target.value)} />
      </Field>
      <Field
        label="GST ($)"
        hint={gstOver ? "More than an eleventh of the total — check the invoice" : "Only if the invoice shows it"}
        hintTone={gstOver ? "warn" : "muted"}
      >
        <input className="fl-i" type="number" placeholder="e.g. 43.64" value={gst} onChange={(e) => setGst(e.target.value)} />
      </Field>
      <Field
        label="Supplier ABN"
        hint={abnBad ? "An ABN is eleven digits" : undefined}
        hintTone={abnBad ? "warn" : "muted"}
      >
        <input className="fl-i" inputMode="numeric" placeholder="e.g. 51 824 753 556" value={abn} onChange={(e) => setAbn(e.target.value)} />
      </Field>
      <Field label="Summary" span>
        <input className="fl-i" placeholder="e.g. 100,000 km logbook service" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label="Work done" span>
        <textarea className="fl-i tall" placeholder="One line per item, as the invoice lists them" value={workDone} onChange={(e) => setWorkDone(e.target.value)} />
      </Field>
    </>
  );

  const scan = scans ? SCAN_COPY[kind] : null;
  const fields = kind === "fuel" ? fuelFields : kind === "service" ? serviceFields : null;

  return (
    <FleetModal title={copy.title} sub={`${displayName(target)}, ${modelLabel(target)}`} onClose={onClose}>
      {scan && mode === "scan" && (
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
            {/* The docket is a phone photo, so its input opens the camera. A
                service invoice is as often a dealer's PDF, so its input opens
                the picker, where the camera is one choice among files. */}
            <input
              ref={fileRef}
              type="file"
              accept={scan.accept}
              capture={kind === "fuel" ? "environment" : undefined}
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            {/* the camera, not a sparkle: this tile's job is "point your
                phone at the docket", and the line under it already says who
                reads it. The glyph should name the ACTION you take. */}
            <span className="fl-scanic">
              <Icon name={scan.icon} size={22} />
            </span>
            <b>{scan.prompt}</b>
            <em>{scan.hint}</em>
          </label>
          <button className="fl-modeline" onClick={() => setMode("manual")}>
            enter manually instead
          </button>
        </>
      )}

      {/* Both marked, so a stray Escape can't throw away a docket being read or
          waiting to be checked — see scanInProgress. */}
      {scan && mode === "reading" && (
        <div className="fl-readingwrap" data-scan-in-progress="">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {thumb && <img className="fl-scanthumb" src={thumb} alt="Receipt" />}
          <div className="fl-reading">
            <Chevron size={20} gradient decorative />
            {scan.reading}
          </div>
        </div>
      )}

      {scan && mode === "confirm" && (
        <>
          <div className="fl-scanhead" data-scan-in-progress="">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {thumb && <img className="fl-scanthumb small" src={thumb} alt="Receipt" />}
            {scanTag ? (
              <span className="dchip2 ok">
                <Chevron size={15} gradient decorative />
                Read by Tiff — check &amp; save
              </span>
            ) : (
              <span className="dchip2 warn">{readWarn ?? fileName}</span>
            )}
            <button className="fl-modeline inline" onClick={rescan}>
              re-scan
            </button>
          </div>
          {/* Whether the paper itself was KEPT is a separate fact from whether
              Tiff could read it, and it is the one that matters at tax time —
              so it gets said, either way, rather than being assumed. */}
          <div className={`fl-keptline${receiptId ? "" : " warn"}`}>
            <Icon name={receiptId ? "check" : "alert"} size={13} />
            {receiptId ? scan.kept : receiptWarn ?? scan.without}
          </div>
          <div className="fl-grid">{vehiclePicker}{fields}</div>
        </>
      )}

      {scan && mode === "manual" && <div className="fl-grid">{vehiclePicker}{fields}</div>}

      {!scan && (
        <div className="fl-grid">
          {vehiclePicker}
          {kind === "odo" && (
            <Field
              label="Odometer (km)"
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
              placeholder={kind === "issue" ? "e.g. Sliding door latch sticking — needs adjustment" : "Optional"}
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
        {(!scan || mode === "confirm" || mode === "manual") && (
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
   it again, which leaves both acts on the record. The same holds for a
   service record. An entry logged WITHOUT its paper can be given it from the
   entry screen — adding evidence is not swapping it. */
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
  const [bought, setBought] = useState(logIso(log, today));
  const [workDone, setWorkDone] = useState(log.workDone ?? "");
  const [confirming, setConfirming] = useState(false);

  const isFuel = log.kind === "fuel";
  const isService = log.kind === "service";
  /* The two purchases: a fill and a service. Both carry a supplier, a cost,
     a date on the paper and the tax figures the export wants. */
  const purchase = isFuel || isService;
  const paper = isFuel ? "receipt" : "service record";
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
      ...(purchase
        ? {
            cost: cost.trim() ? num(cost) : undefined,
            station: station.trim(),
            gst: gst.trim() ? num(gst) : 0,
            abn: abn.trim(),
            purchasedOn: bought.trim() || undefined,
          }
        : {}),
      ...(isFuel ? { litres: litres.trim() ? num(litres) : undefined } : {}),
      ...(isService ? { workDone: workDone.trim() } : {}),
    });
  };

  return (
    <FleetModal
      title="Correct this entry"
      sub={`${LOG_WORD[log.kind]}, ${fmtDay(logIso(log, today))}`}
      onClose={onClose}
    >
      {confirming ? (
        /* The one destructive act in the fleet screens, so it asks — and says
           what actually happens, because "delete" is not quite what this does
           and a person about to press it deserves the real answer. */
        <div className="fl-danger">
          <b>Remove this entry?</b>
          <em>
            It disappears from the history and the vehicle&rsquo;s odometer is recalculated from
            what is left.{" "}
            {log.kind === "fuel" && log.paidWith === "own"
              ? /* The claim outlives the log on purpose — the money still left
                   somebody's account — and the tax screen reads it instead
                   from that moment. Saying "it stops counting towards tax"
                   here was false for exactly the fills that cost a person
                   their own money. */
                "The reimbursement it raised stays, and becomes this purchase's tax line."
              : "It stops counting towards tax."}
            {log.hasReceipt && ` The ${paper} stays on file.`} The entry is kept, hidden, so a
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
              The {paper} on this entry stays as it is — to change the {isFuel ? "photo" : "document"}, remove the entry and
              log it again.
            </div>
          )}
          {/* The fields in the ORDER THE LOG MODAL ASKS THEM, per kind, so
              correcting reads like logging did — a fill: litres, cost, station,
              date, GST, ABN, odometer, note; a service: workshop, date,
              odometer, cost, GST, ABN, summary, work done. */}
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
              </>
            )}
            {isService && (
              <Field label="Workshop">
                <input className="fl-i" value={station} onChange={(e) => setStation(e.target.value)} />
              </Field>
            )}
            {purchase && (
              <Field label={isFuel ? "Date on receipt" : "Date on invoice"}>
                <DateField
                  size="lg"
                  clearable
                  today={today}
                  max={today}
                  value={bought || null}
                  onChange={(iso) => setBought(iso ?? "")}
                />
              </Field>
            )}
            {isService && (
              <>
                <Field label="Serviced at odo (km)">
                  <input className="fl-i" type="number" value={odo} onChange={(e) => setOdo(e.target.value)} />
                </Field>
                <Field label="Cost ($)">
                  <input className="fl-i" type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
                </Field>
              </>
            )}
            {purchase && (
              <>
                <Field
                  label="GST ($)"
                  hint={gstOver ? `More than an eleventh of the total — check the ${paper}` : `Only if the ${paper} shows it`}
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
            {(isFuel || log.kind === "odo") && (
              <Field label="Odometer (km)" span={!isFuel}>
                <input className="fl-i" type="number" value={odo} onChange={(e) => setOdo(e.target.value)} />
              </Field>
            )}
            {isService ? (
              <>
                <Field label="Summary" span>
                  <input className="fl-i" value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <Field label="Work done" span>
                  <textarea className="fl-i tall" value={workDone} onChange={(e) => setWorkDone(e.target.value)} />
                </Field>
              </>
            ) : (
              <Field label={log.kind === "issue" ? "What's wrong" : "Note"} span>
                <textarea className="fl-i" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            )}
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
      ? `Fuel — ${log.litres ? `${log.litres} L` : "fill-up"}${log.cost ? `, ${fmtCost(log.cost)}` : ""}`
      : log.kind === "odo"
        ? "Odometer updated"
        : log.kind === "service"
          ? `Service — ${log.note ?? "completed"}`
          : `Issue — ${log.note ?? "reported"}`;
  const meta = [log.when, log.staffName, log.station, log.edited ? "edited" : null]
    .filter(Boolean)
    .join(", ");
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
