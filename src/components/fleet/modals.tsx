"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { Chevron } from "@/components/logo";
import { DateField } from "@/components/ui/date-field";
import { readFuelReceipt } from "@/app/actions/fleet-ai";
import { uploadFile } from "@/lib/documents/upload-client";
import { fileToUprightBase64 } from "@/lib/images/upright";
import type { LogEdit } from "@/app/actions/fleet";
import { Plate } from "./plate";
import {
  FUEL_PAYERS,
  FUEL_PAYER_LABEL,
  type FuelPayer,
  type LogKind,
  type NewLog,
  type Vehicle,
  type VehicleIdentity,
  type VehicleLog,
  serviceDueKm,
  serviceDueText,
  displayName,
  fmtCost,
  fmtKm,
  modelLabel,
  readReceiptOffline,
} from "./logic";

/* What is left here: the log modals (fuel / odometer / issue / service), the
   correction modal, the service history, and the shared FleetModal shell they
   stand on. The vehicle card, its renewal screens and the add/edit form live
   in ./vehicle-modal/ — one modal with screens, in the Sep 2026 design. */

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

/* ---------------- service history ---------------- */

/* Every service this vehicle has had, and the cycle they set.

   Deliberately NOT the renewal treatment twice over. A service does not
   supersede the one before it — each stands on its own, the way a fuel docket
   does, so nothing here is tagged Current or Previous; that tag belongs only
   to paper that REPLACES paper. And filing was never gated: Log service has
   always sat in the actions row. What was missing is only the view — services
   were mixed into one History list with fuel, odometer and issues, so "when
   was this last serviced, and what was done" had nowhere to be read. */
export function ServiceHistoryModal({
  vehicle,
  logs,
  onAdd,
  onCorrect,
  onClose,
}: {
  vehicle: Vehicle;
  /** This vehicle's logs — filtered to services here, so callers pass the lot. */
  logs: VehicleLog[];
  onAdd: () => void;
  onCorrect?: (log: VehicleLog) => void;
  onClose: () => void;
}) {
  const services = logs.filter((l) => l.kind === "service");
  const dueKm = serviceDueKm(vehicle);
  /* Both limits, each stated only if it applies — the vehicle falls due on
     whichever arrives first, so showing one of them would be showing half the
     answer, and showing a limit it hasn't got would be inventing one. */
  const every = [
    vehicle.serviceIntervalKm != null && vehicle.motorised
      ? `${fmtKm(vehicle.serviceIntervalKm)} km`
      : null,
    vehicle.serviceIntervalMonths != null
      ? `${vehicle.serviceIntervalMonths} month${vehicle.serviceIntervalMonths === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" or ");

  return (
    <FleetModal title="Service" sub={displayName(vehicle)} onClose={onClose}>
      <div className="fl-facts">
        <div className="fl-fact">
          <em>Next service</em>
          <b>{serviceDueText(vehicle) ?? "No cycle set"}</b>
        </div>
        {dueKm != null && (
          <div className="fl-fact">
            <em>Due at</em>
            <b>{fmtKm(dueKm)} km</b>
          </div>
        )}
        <div className="fl-fact">
          <em>Every</em>
          <b>{every || "—"}</b>
        </div>
      </div>

      <div className="fl-histadd">
        <button className="fl-btn primary" onClick={onAdd}>
          <Icon name="wrench" size={15} />
          Log service
        </button>
      </div>

      {services.length === 0 ? (
        /* The cycle above is read off last_service_odo, which a manager can set
           on the vehicle directly — so "none logged" is the honest line here.
           Saying "never serviced" would claim something the record cannot. */
        <div className="fl-hempty">No services logged yet</div>
      ) : (
        <div className="fl-hist full">
          {services.map((l) => (
            <LogRow key={l.id} log={l} manager onCorrect={onCorrect} />
          ))}
        </div>
      )}
    </FleetModal>
  );
}
