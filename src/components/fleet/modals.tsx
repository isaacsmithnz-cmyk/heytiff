"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import { DateField } from "@/components/ui/date-field";
import { ConfirmDialog, Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextArea, TextInput } from "@/components/parts/field";
import { Chooser } from "@/components/parts/chooser";
import { Tray } from "@/components/parts/tabs";
import { StateWord } from "@/components/parts/state";
import { scanInProgress } from "@/components/record-modal/scan-card";
import { readFuelReceipt, readServiceRecord } from "@/app/actions/fleet-ai";
import { uploadFile } from "@/lib/documents/upload-client";
import type { FuelHandoff } from "@/lib/fleet/fuel-handoff";
import { fileToUprightBase64 } from "@/lib/images/upright";
import type { LogEdit } from "@/app/actions/fleet";
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

/* What is left here: the log dialogs (fuel / odometer / issue / service) and
   the correction dialog, on the v2 Dialog part (old-modals mock, 27 October
   2026). The vehicle card, its renewal screens, the service history, one
   entry read on its own, and the add/edit form live in ./vehicle-modal/. */

function num(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/* ---------------- log fuel / odometer / issue / service ----------------
   Fuel opens in Scan mode: photograph or upload the receipt, Tiff reads
   litres/cost/station, then a confirm step with everything editable.
   Entering it by hand is one press away. */

const LOG_COPY: Record<LogKind, { title: string; icon: string }> = {
  fuel: { title: "Log fuel", icon: "fuel" },
  odo: { title: "Update odometer", icon: "gauge" },
  issue: { title: "Report an issue", icon: "alert" },
  service: { title: "Log service", icon: "wrench" },
};

/* The capture flow's step. Fuel and service both open on a scan — the docket,
   the workshop's invoice — and land on a confirm step with every field
   editable; odometer and issue have no paper and open on the fields. */
type CaptureMode = "scan" | "reading" | "confirm" | "manual";

/* What is scanned for each kind that scans, and what it is called. */
const SCAN_COPY = {
  fuel: {
    prompt: "Snap or upload the receipt",
    choose: "Choose a photo",
    read: "Read from the receipt",
    reading: "Tiff is reading the receipt",
    kept: "Receipt filed against this financial year",
    lost: "Couldn't store the photo, so the entry saves without it",
    without: "This entry saves without the receipt photo",
    paper: "Receipt",
    check: "Check the docket.",
    icon: "cam",
    accept: "image/*",
  },
  service: {
    prompt: "Snap or upload the service invoice",
    choose: "Choose a file",
    read: "Read from the invoice",
    reading: "Tiff is reading the invoice",
    kept: "Service record filed against this vehicle",
    lost: "Couldn't store the record, so the entry saves without it",
    without: "This entry saves without the service record",
    paper: "Invoice",
    check: "Check the invoice.",
    icon: "upload",
    accept: "image/*,application/pdf",
  },
} as const;

const UNREAD = "Tiff couldn't read that one";

const lowWords = (km: number) => `Lower than the current ${fmtKm(km)} km. Check the reading.`;

export function LogModal({
  kind,
  today,
  vehicle,
  fleetVehicles,
  seed,
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
  /** A docket already read and stored on the way here — My expenses hands
      fuel to this screen rather than raising a second record for the same
      tank (lib/fleet/fuel-handoff). The fields open on it, the photo is
      already filed, and the only thing left to add is what the docket can't
      say: the litres and the odometer. */
  seed?: FuelHandoff | null;
  onSave: (log: NewLog) => void;
  onClose: () => void;
}) {
  const [vehicleId, setVehicleId] = useState(vehicle.id);
  const [litres, setLitres] = useState(seed?.litres ?? "");
  const [cost, setCost] = useState(seed?.cost ?? "");
  const [odo, setOdo] = useState("");
  const [note, setNote] = useState(seed?.note ?? "");
  /* Company card is the default because it is the common case AND the one that
     raises nothing extra — the path with a consequence has to be chosen. A
     docket handed over from My expenses already carries the answer. */
  const [paidWith, setPaidWith] = useState<FuelPayer>(seed?.paidWith ?? "company");
  const [station, setStation] = useState(seed?.station ?? "");
  const [gst, setGst] = useState(seed?.gst ?? "");
  const [abn, setAbn] = useState(seed?.abn ?? "");
  const [bought, setBought] = useState(seed?.purchasedOn ?? "");
  /* Service only: the itemised work, one line per item, as the invoice lists
     it. `note` stays the one line the history prints. */
  const [workDone, setWorkDone] = useState("");
  const scans = kind === "fuel" || kind === "service";
  // a seeded docket has been read already: the fields, not the scan zone
  const [mode, setMode] = useState<CaptureMode>(seed ? "confirm" : scans ? "scan" : "manual");
  const [thumb, setThumb] = useState<string | null>(null);
  const [scanTag, setScanTag] = useState<"tiff" | null>(null);
  /* A record Tiff could not read is still kept; the fields open empty and
     this says so. Nothing is ever invented in its place. */
  const [readWarn, setReadWarn] = useState<string | null>(null);
  /* The stored docket. Uploaded while Tiff reads it, so by the time the person
     has checked the figures the photo is already in the bucket and Save only
     has to point the log at it. Null means the figures will be saved with
     nothing behind them — allowed, and said out loud on screen. */
  const [receiptId, setReceiptId] = useState<string | null>(seed?.receiptDocumentId ?? null);
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
  /* The plate leads each option, because the plate is what is painted on the
     van in the other hand when the question is "am I logging the right one". */
  const vehiclePicker =
    pickable.length > 1 ? (
      <Field label="Vehicle" className="mk-records-wide">
        <Chooser
          options={pickable.map((v) => ({ value: v.id, label: `${v.plate}, ${v.name || modelLabel(v)}` }))}
          value={target.id}
          onChange={setVehicleId}
        />
      </Field>
    ) : null;

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
        setReadWarn(UNREAD);
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
    else setReceiptWarn(SCAN_COPY.fuel.lost);

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
      /* NOTHING READ, NOTHING INVENTED. This once filled the fields in from
         the image's FILE SIZE and labelled it a demo read; on "My own money"
         those invented figures became a reimbursement and a tax line. The
         docket is still kept either way. */
      setScanTag(null);
      setReadWarn(UNREAD);
    }
    setMode("confirm");
  };

  const rescan = () => {
    setScanTag(null);
    setReadWarn(null);
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

  const scan = scans ? SCAN_COPY[kind] : null;
  const odoLow = odo.trim() !== "" && num(odo) < target.odometer;
  /* The two tax figures get checked HERE as well as on the server, because
     these are the ones somebody types from a photo they are squinting at.
     The server still refuses either one. */
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

  const gstWrong = gstOver ? `More than an eleventh of the total. ${scan?.check ?? ""}`.trim() : null;
  const abnWrong = abnBad ? "An ABN is eleven digits" : null;
  const odoField = (label: string, wide = false) => (
    <Field label={label} error={odoLow ? lowWords(target.odometer) : null} className={wide ? "mk-records-wide" : undefined}>
      <TextInput type="number" placeholder={`Now ${fmtKm(target.odometer)}`} value={odo} onChange={(e) => setOdo(e.target.value)} />
    </Field>
  );
  const dateField = (label: string) => (
    <Field label={label}>
      <DateField clearable today={today} max={today} value={bought || null} onChange={(iso) => setBought(iso ?? "")} />
    </Field>
  );
  const taxFields = (
    <>
      <Field label="GST ($)" error={gstWrong}>
        <TextInput type="number" placeholder={kind === "fuel" ? "14.40" : "43.64"} value={gst} onChange={(e) => setGst(e.target.value)} />
      </Field>
      <Field label="Supplier ABN" error={abnWrong}>
        <TextInput inputMode="numeric" placeholder="51 824 753 556" value={abn} onChange={(e) => setAbn(e.target.value)} />
      </Field>
    </>
  );

  const fuelFields = (
    <>
      {/* FIRST, because it decides what this log produces beyond itself: a
          company card stops at the vehicle log, a personal one also raises a
          reimbursement, which is still saved however the tray words it. */}
      <div className="pt-field mk-records-wide">
        <span className="pt-field-label">Paid with</span>
        <Tray
          options={FUEL_PAYERS.map((p) => ({ value: p, label: FUEL_PAYER_LABEL[p] }))}
          value={paidWith}
          onChange={setPaidWith}
          ariaLabel="Paid with"
        />
      </div>
      <Field label="Litres">
        <TextInput type="number" placeholder="62.4" value={litres} onChange={(e) => setLitres(e.target.value)} />
      </Field>
      <Field label="Cost ($)" error={owingNoCost ? "Add the cost, it's what you're paid back" : null}>
        <TextInput type="number" placeholder="158.40" value={cost} onChange={(e) => setCost(e.target.value)} />
      </Field>
      <Field label="Station">
        <TextInput placeholder="Shell Coburg" value={station} onChange={(e) => setStation(e.target.value)} />
      </Field>
      {/* The docket's own date, not today's. A fill on Friday that gets logged
          on Monday belongs to Friday — and in June that is the difference
          between two financial years. Left blank, it is today. */}
      {dateField("Date on receipt")}
      {taxFields}
      {odoField("Odometer (km)")}
      <Field label="Note">
        <TextInput placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </>
  );

  /* The service, as the workshop's invoice states it: who did it, when, at
     what reading, for how much, the GST and ABN the tax export wants, the one
     line the history prints, and the itemised work under it. */
  const serviceFields = (
    <>
      <Field label="Workshop">
        <TextInput placeholder="Braeside Auto" value={station} onChange={(e) => setStation(e.target.value)} />
      </Field>
      {dateField("Date on invoice")}
      {odoField("Serviced at odo (km)")}
      <Field label="Cost ($)">
        <TextInput type="number" placeholder="480" value={cost} onChange={(e) => setCost(e.target.value)} />
      </Field>
      {taxFields}
      <Field label="Summary" className="mk-records-wide">
        <TextInput placeholder="100,000 km logbook service" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label="Work done" className="mk-records-wide">
        <TextArea rows={5} placeholder="One line per item" value={workDone} onChange={(e) => setWorkDone(e.target.value)} />
      </Field>
    </>
  );

  const fields = kind === "fuel" ? fuelFields : kind === "service" ? serviceFields : null;
  /* With no picker, which vehicle this is still has to be said: the old
     title's line, moved into the body as a fact. */
  const which = vehiclePicker ? null : <p className="mk-records-lead">{`${displayName(target)}, ${modelLabel(target)}`}</p>;
  const grid = (body: React.ReactNode) => <div className="mk-records-grid mk-records-grid--2">{body}</div>;

  /* Escape and the scrim leave it alone while a docket is being read or waits
     to be checked (scanInProgress): closing then threw away a docket already
     stored, owned by nothing. Cancel still closes. */
  const softClose = () => {
    if (!scanInProgress()) onClose();
  };

  const capturing = scan && (mode === "scan" || mode === "reading");

  return (
    <Dialog
      heading={copy.title}
      width={560}
      onClose={softClose}
      foot={
        <>
          {scan && mode === "scan" && (
            <>
              <Button kind="quiet" onClick={() => setMode("manual")}>
                Enter it by hand
              </Button>
              <span className="mk-gap" />
            </>
          )}
          <Button kind="quiet" onClick={onClose}>
            Cancel
          </Button>
          {!capturing && (
            <Button kind="main" disabled={!ready} onClick={save}>
              {copy.title}
            </Button>
          )}
        </>
      }
    >
      <div className="mk-form">
        {which}
        {scan && mode === "scan" && (
          <>
            {vehiclePicker && grid(vehiclePicker)}
            <div
              className="rcw-drop"
              data-over={dragOver ? "" : undefined}
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
                hidden
                accept={scan.accept}
                capture={kind === "fuel" ? "environment" : undefined}
                aria-label={scan.prompt}
                onChange={(e) => void handleFile(e.target.files?.[0])}
              />
              <span className="rcw-drop-ic">
                <Icon name={scan.icon} size={20} />
              </span>
              <p className="rcw-drop-what">{scan.prompt}</p>
              <Button kind="second" onClick={() => fileRef.current?.click()}>
                {scan.choose}
              </Button>
            </div>
          </>
        )}

        {/* Both marked, so a stray Escape can't throw away a docket being read or
            waiting to be checked — see scanInProgress. */}
        {scan && mode === "reading" && (
          <div className="rcw-paper" data-scan-in-progress="">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {thumb ? <img className="rcw-thumb" src={thumb} alt={scan.paper} /> : <span className="rcw-thumb">{scan.paper}</span>}
            <span className="rcw-paper-says rcw-reading">
              <TiffGlyph size={24} working />
              {scan.reading}
            </span>
          </div>
        )}

        {scan && mode === "confirm" && (
          <div className="rcw-paper" data-scan-in-progress="">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {thumb ? <img className="rcw-thumb" src={thumb} alt={scan.paper} /> : <span className="rcw-thumb">{scan.paper}</span>}
            <span className="rcw-paper-says">
              {scanTag ? <StateWord tone="good">{scan.read}</StateWord> : readWarn ? <StateWord tone="look">{readWarn}</StateWord> : null}
              {/* Whether the paper itself was KEPT is a separate fact from whether
                  Tiff could read it, and it is the one that matters at tax time —
                  so it gets said, either way, rather than being assumed. */}
              {receiptId ? (
                <StateWord tone="info">{scan.kept}</StateWord>
              ) : (
                <StateWord tone="look">{receiptWarn ?? scan.without}</StateWord>
              )}
            </span>
            <Button kind="quiet" size={32} onClick={rescan}>
              Scan again
            </Button>
          </div>
        )}

        {scan && (mode === "confirm" || mode === "manual") && grid(<>{vehiclePicker}{fields}</>)}

        {!scan &&
          grid(
            <>
              {vehiclePicker}
              {kind === "odo" && odoField("Odometer (km)", true)}
              <Field label={kind === "issue" ? "What's wrong" : "Note"} className="mk-records-wide">
                <TextArea
                  placeholder={kind === "issue" ? "Sliding door latch sticking" : "Optional"}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </>,
          )}
      </div>
    </Dialog>
  );
}

/* ---------------- correcting an entry ---------------- */

/* Editing a log, and removing one.

   A SEPARATE DIALOG from LogModal, deliberately. That one is a capture flow:
   it opens on a camera, it has a scan step, and its whole shape is "get the
   docket into the app". This is the opposite job — the figures already exist
   and one of them is wrong — so it opens on the fields, filled in, with no
   camera anywhere near it.

   THE RECEIPT IS NOT REPLACEABLE HERE. A stored docket is the evidence for
   this entry; swapping it for a different photo after the fact is not a
   correction, it is a substitution. Wrong photo means remove the entry and log
   it again, which leaves both acts on the record. An entry logged WITHOUT its
   paper can be given it from the entry screen — adding evidence is not
   swapping it.

   DELETE ASKS ONCE, in ConfirmDialog, which says what actually happens:
   "delete" is not quite what this does, and a person about to press it
   deserves the real answer. */
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

  /* What the entry was, in the confirmation's own words: "62.4 L at Shell
     Coburg on 31 July". */
  const day = fmtDay(logIso(log, today));
  const what = isFuel
    ? [log.litres != null ? `${log.litres} L` : "The fill", log.station ? `at ${log.station}` : null, `on ${day}`].filter(Boolean).join(" ")
    : `The ${LOG_WORD[log.kind].toLowerCase()} entry${log.station ? ` at ${log.station}` : ""} on ${day}`;

  return (
    <>
      <Dialog
        heading="Correct this entry"
        width={560}
        onClose={onClose}
        foot={
          <>
            <Button kind="delete" onClick={() => setConfirming(true)}>
              Delete entry
            </Button>
            <span className="mk-gap" />
            <Button kind="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button kind="main" disabled={!ready} onClick={save}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="mk-form">
          <p className="mk-records-lead">{`${LOG_WORD[log.kind]}, ${day}`}</p>
          {/* The fields in the ORDER THE LOG DIALOG ASKS THEM, per kind, so
              correcting reads like logging did — a fill: litres, cost, station,
              date, GST, ABN, odometer, note; a service: workshop, date,
              odometer, cost, GST, ABN, summary, work done. */}
          <div className="mk-records-grid mk-records-grid--2">
            {isFuel && (
              <>
                <Field label="Litres">
                  <TextInput type="number" value={litres} onChange={(e) => setLitres(e.target.value)} />
                </Field>
                <Field label="Cost ($)">
                  <TextInput type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
                </Field>
                <Field label="Station">
                  <TextInput value={station} onChange={(e) => setStation(e.target.value)} />
                </Field>
              </>
            )}
            {isService && (
              <Field label="Workshop">
                <TextInput value={station} onChange={(e) => setStation(e.target.value)} />
              </Field>
            )}
            {purchase && (
              <Field label={isFuel ? "Date on receipt" : "Date on invoice"}>
                <DateField clearable today={today} max={today} value={bought || null} onChange={(iso) => setBought(iso ?? "")} />
              </Field>
            )}
            {isService && (
              <>
                <Field label="Serviced at odo (km)">
                  <TextInput type="number" value={odo} onChange={(e) => setOdo(e.target.value)} />
                </Field>
                <Field label="Cost ($)">
                  <TextInput type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
                </Field>
              </>
            )}
            {purchase && (
              <>
                <Field label="GST ($)" error={gstOver ? `More than an eleventh of the total. Check the ${paper}.` : null}>
                  <TextInput type="number" value={gst} onChange={(e) => setGst(e.target.value)} />
                </Field>
                <Field label="Supplier ABN" error={abnBad ? "An ABN is eleven digits" : null}>
                  <TextInput inputMode="numeric" value={abn} onChange={(e) => setAbn(e.target.value)} />
                </Field>
              </>
            )}
            {(isFuel || log.kind === "odo") && (
              <Field label="Odometer (km)" className={isFuel ? undefined : "mk-records-wide"}>
                <TextInput type="number" value={odo} onChange={(e) => setOdo(e.target.value)} />
              </Field>
            )}
            {isService ? (
              <>
                <Field label="Summary" className="mk-records-wide">
                  <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <Field label="Work done" className="mk-records-wide">
                  <TextArea rows={5} value={workDone} onChange={(e) => setWorkDone(e.target.value)} />
                </Field>
              </>
            ) : (
              <Field label={log.kind === "issue" ? "What's wrong" : "Note"} className={isFuel ? undefined : "mk-records-wide"}>
                {isFuel ? (
                  <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
                ) : (
                  <TextArea value={note} onChange={(e) => setNote(e.target.value)} />
                )}
              </Field>
            )}
          </div>
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        heading={`Delete this ${LOG_WORD[log.kind].toLowerCase()} entry?`}
        confirm="Delete entry"
        onConfirm={onDelete}
        onClose={() => setConfirming(false)}
      >
        <p>
          {`${what} comes off the history, and the odometer is recalculated from what is left. `}
          {log.kind === "fuel" && log.paidWith === "own"
            ? /* The claim outlives the log on purpose — the money still left
                 somebody's account — and the tax screen reads it instead from
                 that moment. */
              "The reimbursement it raised stays, and becomes this purchase's tax line."
            : "It stops counting towards tax."}
          {log.hasReceipt && ` The ${paper} stays on file.`}
        </p>
      </ConfirmDialog>
    </>
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
            <span className="dchip2 ok">
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
