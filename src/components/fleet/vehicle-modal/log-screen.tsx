"use client";

import { useState } from "react";
import { readFuelReceipt, readServiceRecord, type ReadReceiptResult, type ReadServiceResult } from "@/app/actions/fleet-ai";
import { Button } from "@/components/parts/button";
import { Field, TextArea, TextInput } from "@/components/parts/field";
import { Tray } from "@/components/parts/tabs";
import { Plate } from "../plate";
import { VehicleLead } from "./event-row";
import {
  FUEL_PAYERS,
  FUEL_PAYER_LABEL,
  displayName,
  fmtKm,
  type FuelPayer,
  type LogKind,
  type NewLog,
  type Vehicle,
} from "../logic";
import { DateIn, FrameFoot, FrameTitle, RecordError } from "@/components/record-modal/parts";
import { ScanCard, type ScanMode } from "@/components/record-modal/scan-card";

/* Logging, as a screen of the card.

   Log fuel and Log service used to open in the older, narrower modal kit over
   the 1200px card — two dresses in one flow (found walking the card,
   2026-09-15). They are screens of the card now, like the renewals: the same
   scan panel the renewal and finance screens use (ScanCard), the same fields,
   the same footer, and Back returns to whichever screen asked — the card or
   the services screen. Update odometer and Report an issue came with them, so
   the + menu opens one kind of thing.

   The staff lens (my-vehicle.tsx) keeps LogModal: it has no card, its driver
   may be fuelling a borrowed pool ute (the vehicle picker), and its scan
   opens the phone's camera. Here the vehicle is the one on the card.

   A refusal keeps the screen. The server may still say no — the vehicle was
   sold, the reading runs backwards — and the old modal had already closed
   by then, so the reason landed on the card and the typing was gone. Save
   waits for the outcome; the screen leaves only once the entry has landed.

   What is READ is a convenience; what is KEPT is the record. A docket or an
   invoice Tiff can't read is still stored and filed against the entry, and
   the fields open empty — nothing is invented (the staff lens's demo read
   stays there). The date is the paper's, not today's. */

const TITLE: Record<LogKind, string> = {
  fuel: "Log fuel",
  service: "Log service",
  odo: "Update odometer",
  issue: "Report an issue",
};
const SAVE: Record<LogKind, string> = {
  fuel: "Log fuel",
  service: "Log service",
  odo: "Update odometer",
  issue: "Report issue",
};
const SCAN = {
  fuel: {
    heading: "Receipt",
    prompt: "Snap or upload the receipt",
    paper: "the receipt",
    attach: "Attach the receipt",
    docKind: "fuel_receipt",
  },
  service: {
    heading: "Invoice",
    prompt: "Snap or upload the service invoice",
    paper: "the invoice",
    attach: "Attach the invoice",
    docKind: "service_record",
  },
} as const;

type Fields = {
  litres: string;
  cost: string;
  odo: string;
  note: string;
  station: string;
  gst: string;
  abn: string;
  on: string;
  workDone: string;
  paidWith: FuelPayer;
};
const EMPTY: Fields = { litres: "", cost: "", odo: "", note: "", station: "", gst: "", abn: "", on: "", workDone: "", paidWith: "company" };

const num = (s: string): number => {
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function LogScreen({
  vehicle,
  kind,
  today,
  pending,
  error,
  backWord = "Back",
  onBack,
  onSave,
  onSaved,
}: {
  vehicle: Vehicle;
  kind: LogKind;
  /** The server's AU calendar date — the ceiling on a receipt date. */
  today: string;
  pending: boolean;
  error: string | null;
  /** "Close" when the screen was opened on its own, from the vehicle's page. */
  backWord?: string;
  onBack: () => void;
  /** Resolves to whether the entry landed. */
  onSave: (log: NewLog) => Promise<boolean> | void;
  /** Where to go once it has — the screen that asked. On a refusal the
      screen stays, with the typing intact and the reason above the fields. */
  onSaved: () => void;
}) {
  const scans = kind === "fuel" || kind === "service";
  const [mode, setMode] = useState<ScanMode>(scans ? "idle" : "manual");
  const [f, setF] = useState<Fields>(EMPTY);
  const [docId, setDocId] = useState<string | null>(null);
  const set = (k: keyof Fields) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const fillFuel = (r: ReadReceiptResult) => {
    if (!r.ok) return;
    setF((p) => ({
      ...p,
      litres: r.litres != null ? String(r.litres) : p.litres,
      cost: r.cost != null ? r.cost.toFixed(2) : p.cost,
      station: r.station ?? p.station,
      gst: r.gst != null ? r.gst.toFixed(2) : p.gst,
      abn: r.abn ?? p.abn,
      on: r.date ?? p.on,
    }));
  };
  const fillService = (r: ReadServiceResult) => {
    if (!r.ok) return;
    setF((p) => ({
      ...p,
      station: r.workshop ?? p.station,
      cost: r.cost != null ? r.cost.toFixed(2) : p.cost,
      gst: r.gst != null ? r.gst.toFixed(2) : p.gst,
      abn: r.abn ?? p.abn,
      on: r.servicedOn ?? p.on,
      odo: r.odometer != null ? String(r.odometer) : p.odo,
      note: r.summary ?? p.note,
      workDone: r.workDone.length > 0 ? r.workDone.join("\n") : p.workDone,
    }));
  };

  /* The same checks the server makes, said here before Save is pressed. */
  const odoLow = f.odo.trim() !== "" && num(f.odo) < vehicle.odometer;
  const gstOver = f.gst.trim() !== "" && f.cost.trim() !== "" && num(f.gst) > num(f.cost) / 11 + 0.01;
  const abnBad = f.abn.trim() !== "" && f.abn.replace(/\D/g, "").length !== 11;
  const owingNoCost = kind === "fuel" && f.paidWith === "own" && f.cost.trim() === "";
  const showFields = !scans || mode === "scanned" || mode === "manual";
  const ready =
    !pending &&
    showFields &&
    (kind === "fuel"
      ? f.litres.trim() !== "" && !gstOver && !abnBad && !owingNoCost
      : kind === "service"
        ? f.odo.trim() !== "" && !gstOver && !abnBad
        : kind === "odo"
          ? f.odo.trim() !== ""
          : f.note.trim() !== "");

  const save = async () => {
    if (!ready) return;
    const ok = await onSave({
      vehicleId: vehicle.id,
      kind,
      litres: kind === "fuel" ? num(f.litres) : undefined,
      cost: scans && f.cost.trim() ? num(f.cost) : undefined,
      odo: kind !== "issue" && f.odo.trim() ? num(f.odo) : undefined,
      note: f.note.trim() || undefined,
      station: scans && f.station.trim() ? f.station.trim() : undefined,
      source: scans ? (mode === "scanned" ? "scan" : "manual") : undefined,
      gst: scans && f.gst.trim() ? num(f.gst) : undefined,
      abn: scans && f.abn.trim() ? f.abn.trim() : undefined,
      purchasedOn: scans && f.on.trim() ? f.on.trim() : undefined,
      receiptDocumentId: scans ? (docId ?? undefined) : undefined,
      paidWith: kind === "fuel" ? f.paidWith : undefined,
      workDone: kind === "service" && f.workDone.trim() ? f.workDone.trim() : undefined,
    });
    if (ok !== false) onSaved();
  };

  /* The same checks the server makes, each said under its own field. */
  const odoField = (label: string) => (
    <Field label={label} error={odoLow ? `Lower than the current ${fmtKm(vehicle.odometer)} km. Check the reading.` : null}>
      <TextInput inputMode="numeric" placeholder={`Now ${fmtKm(vehicle.odometer)}`} value={f.odo} onChange={(e) => set("odo")(e.target.value)} />
    </Field>
  );
  const dateField = (label: string) => <DateIn label={label} today={today} max={today} value={f.on} onChange={set("on")} />;
  const taxFields = (
    <>
      <Field
        label="GST ($)"
        error={gstOver ? `More than an eleventh of the total. Check the ${kind === "fuel" ? "receipt" : "invoice"}.` : null}
      >
        <TextInput inputMode="decimal" value={f.gst} onChange={(e) => set("gst")(e.target.value)} />
      </Field>
      <Field label="Supplier ABN" error={abnBad ? "An ABN is eleven digits" : null}>
        <TextInput inputMode="numeric" placeholder="51 824 753 556" value={f.abn} onChange={(e) => set("abn")(e.target.value)} />
      </Field>
    </>
  );

  /* Odometer readings are written in place on the card's Odometer; the
     branch stays so a `add:odo` screen still renders if something names it. */
  const fields =
    kind === "fuel" ? (
      <div className="mk-records-grid mk-records-grid--2">
        {/* FIRST, because it decides what this log produces beyond itself: a
            company card stops at the vehicle log, a personal one also raises
            a reimbursement, which is still saved however the tray words it. */}
        <div className="pt-field mk-records-wide">
          <span className="pt-field-label">Paid with</span>
          <Tray<FuelPayer>
            options={FUEL_PAYERS.map((p) => ({ value: p, label: FUEL_PAYER_LABEL[p] }))}
            value={f.paidWith}
            onChange={(p) => setF((prev) => ({ ...prev, paidWith: p }))}
            ariaLabel="Paid with"
          />
        </div>
        <Field label="Litres">
          <TextInput inputMode="decimal" placeholder="62.4" value={f.litres} onChange={(e) => set("litres")(e.target.value)} />
        </Field>
        <Field label="Cost ($)" error={owingNoCost ? "Add the cost, it's what you're paid back" : null}>
          <TextInput inputMode="decimal" placeholder="158.40" value={f.cost} onChange={(e) => set("cost")(e.target.value)} />
        </Field>
        <Field label="Station">
          <TextInput placeholder="Shell Coburg" value={f.station} onChange={(e) => set("station")(e.target.value)} />
        </Field>
        {dateField("Date on receipt")}
        {taxFields}
        {odoField("Odometer (km)")}
        <Field label="Note">
          <TextInput placeholder="Optional" value={f.note} onChange={(e) => set("note")(e.target.value)} />
        </Field>
      </div>
    ) : kind === "service" ? (
      <div className="mk-records-grid mk-records-grid--2">
        <Field label="Workshop">
          <TextInput placeholder="Braeside Auto" value={f.station} onChange={(e) => set("station")(e.target.value)} />
        </Field>
        {dateField("Date on invoice")}
        {odoField("Odometer at service (km)")}
        <Field label="Cost ($)">
          <TextInput inputMode="decimal" placeholder="480" value={f.cost} onChange={(e) => set("cost")(e.target.value)} />
        </Field>
        {taxFields}
        <Field label="Summary" className="mk-records-wide">
          <TextInput placeholder="100,000 km logbook service" value={f.note} onChange={(e) => set("note")(e.target.value)} />
        </Field>
        <Field label="Work done" className="mk-records-wide">
          <TextArea rows={5} placeholder="One line per item" value={f.workDone} onChange={(e) => set("workDone")(e.target.value)} />
        </Field>
      </div>
    ) : kind === "odo" ? (
      <div className="mk-records-grid mk-records-grid--2">
        {odoField("Odometer (km)")}
        <Field label="Note">
          <TextInput placeholder="Optional" value={f.note} onChange={(e) => set("note")(e.target.value)} />
        </Field>
      </div>
    ) : (
      <Field label="What's wrong">
        <TextArea placeholder="Sliding door latch sticking" value={f.note} onChange={(e) => set("note")(e.target.value)} />
      </Field>
    );

  return (
    <>
      <FrameTitle>{TITLE[kind]}</FrameTitle>
      <VehicleLead name={displayName(vehicle)} plate={<Plate plate={vehicle.plate} state={vehicle.plateState} size="sm" />} />
      {error && <RecordError>{error}</RecordError>}

      {kind === "fuel" && (
        <ScanCard<ReadReceiptResult>
          heading={SCAN.fuel.heading}
          prompt={SCAN.fuel.prompt}
          paper={SCAN.fuel.paper}
          attachLabel={SCAN.fuel.attach}
          docKind={SCAN.fuel.docKind}
          read={(b64, mt) => readFuelReceipt(b64, mt)}
          onRead={(r, id) => {
            fillFuel(r);
            setDocId(id);
          }}
          onAttached={(id) => setDocId(id)}
          mode={mode}
          onMode={(m) => {
            setMode(m);
            if (m === "idle") {
              setF(EMPTY);
              setDocId(null);
            }
          }}
        >
          {fields}
        </ScanCard>
      )}
      {kind === "service" && (
        <ScanCard<ReadServiceResult>
          heading={SCAN.service.heading}
          prompt={SCAN.service.prompt}
          paper={SCAN.service.paper}
          attachLabel={SCAN.service.attach}
          docKind={SCAN.service.docKind}
          read={(b64, mt) => readServiceRecord(b64, mt)}
          onRead={(r, id) => {
            fillService(r);
            setDocId(id);
          }}
          onAttached={(id) => setDocId(id)}
          mode={mode}
          onMode={(m) => {
            setMode(m);
            if (m === "idle") {
              setF(EMPTY);
              setDocId(null);
            }
          }}
        >
          {fields}
        </ScanCard>
      )}
      {!scans && fields}

      <FrameFoot>
        <Button kind="quiet" onClick={onBack}>
          {backWord}
        </Button>
        {showFields && (
          <Button kind="main" onClick={() => void save()} disabled={!ready}>
            {pending ? "Saving the entry" : SAVE[kind]}
          </Button>
        )}
      </FrameFoot>
    </>
  );
}
