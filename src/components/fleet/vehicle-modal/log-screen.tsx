"use client";

import { useState, type ReactNode } from "react";
import { readFuelReceipt, readServiceRecord, type ReadReceiptResult, type ReadServiceResult } from "@/app/actions/fleet-ai";
import { DateField } from "@/components/ui/date-field";
import { Plate } from "../plate";
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
import { Btn, MoneyInput, Segmented, SubHeader } from "@/components/record-modal/parts";
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
    prompt: "Scan or upload the receipt",
    hint: "PDF, JPG or photo. Tiff reads the litres, cost and servo.",
    attach: "Optional: attach the receipt",
    docKind: "fuel_receipt",
  },
  service: {
    heading: "Invoice",
    prompt: "Scan or upload the service invoice",
    hint: "PDF, JPG or photo. Tiff reads the work done, the cost and the workshop.",
    attach: "Optional: attach the invoice",
    docKind: "service_record",
  },
} as const;

/* Whose money bought the fuel, and what follows from it. The two answers have
   different consequences, so the consequence is said beside the choice. */
const PAYER_NOTE: Record<FuelPayer, string> = {
  company: "Logged against the vehicle.",
  own: "Also claimed back to you as an expense.",
};

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

  const warnings = [
    odoLow ? `Lower than the current ${fmtKm(vehicle.odometer)} km — check the reading.` : null,
    gstOver ? `GST is more than an eleventh of the total — check the ${kind === "fuel" ? "receipt" : "invoice"}.` : null,
    abnBad ? "An ABN is eleven digits." : null,
    owingNoCost ? "Enter what it cost — that is what gets reimbursed." : null,
  ].filter((w): w is string => w !== null);

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

  const odoField = (label: string, req: boolean) => (
    <Field label={label} req={req}>
      <input
        className="vm-input"
        inputMode="numeric"
        placeholder={`Currently ${fmtKm(vehicle.odometer)}`}
        aria-label={label}
        value={f.odo}
        onChange={(e) => set("odo")(e.target.value)}
      />
    </Field>
  );
  const dateField = (label: string) => (
    <Field label={label}>
      <DateField size="lg" clearable today={today} max={today} value={f.on || null} onChange={(iso) => set("on")(iso ?? "")} aria-label={label} />
    </Field>
  );
  const taxFields = (
    <>
      <Field label="GST">
        <MoneyInput value={f.gst} onChange={set("gst")} placeholder="Only if printed" ariaLabel="GST" />
      </Field>
      <Field label="Supplier ABN">
        <input className="vm-input" inputMode="numeric" placeholder="e.g. 51 824 753 556" aria-label="Supplier ABN" value={f.abn} onChange={(e) => set("abn")(e.target.value)} />
      </Field>
    </>
  );

  /* Odometer readings are written in place on the card's Odometer card; the
     branch stays so a `add:odo` screen still renders if something names it. */
  const fields =
    kind === "fuel" ? (
      <>
        {/* FIRST, because it decides what this log produces beyond itself: a
            company card stops at the vehicle log, a personal one also raises
            a reimbursement. */}
        <div className="vm-typerow">
          <span className="vm-fl">Paid with</span>
          <Segmented
            items={FUEL_PAYERS.map((p) => ({ key: p, label: FUEL_PAYER_LABEL[p] }))}
            active={f.paidWith}
            onSelect={(p) => setF((prev) => ({ ...prev, paidWith: p }))}
            ariaLabel="Paid with"
          />
          <span className="vm-note">{PAYER_NOTE[f.paidWith]}</span>
        </div>
        <div className="vm-fields">
          <Field label="Litres" req>
            <input className="vm-input" inputMode="decimal" placeholder="e.g. 62.4" aria-label="Litres" value={f.litres} onChange={(e) => set("litres")(e.target.value)} />
          </Field>
          <Field label="Cost" req={f.paidWith === "own"}>
            <MoneyInput value={f.cost} onChange={set("cost")} placeholder="e.g. 158.40" ariaLabel="Cost" />
          </Field>
          <Field label="Station">
            <input className="vm-input" placeholder="e.g. Shell Coburg" aria-label="Station" value={f.station} onChange={(e) => set("station")(e.target.value)} />
          </Field>
          {dateField("Date on receipt")}
          {taxFields}
          {odoField("Odometer (km)", false)}
          <Field label="Note" wide>
            <input className="vm-input" placeholder="Optional" aria-label="Note" value={f.note} onChange={(e) => set("note")(e.target.value)} />
          </Field>
        </div>
      </>
    ) : kind === "service" ? (
      <div className="vm-fields">
        <Field label="Workshop">
          <input className="vm-input" placeholder="e.g. Braeside Auto" aria-label="Workshop" value={f.station} onChange={(e) => set("station")(e.target.value)} />
        </Field>
        {dateField("Date on invoice")}
        {odoField("Odometer at service (km)", true)}
        <Field label="Cost">
          <MoneyInput value={f.cost} onChange={set("cost")} placeholder="e.g. 480" ariaLabel="Cost" />
        </Field>
        {taxFields}
        <Field label="Summary" wide3>
          <input className="vm-input" placeholder="e.g. 100,000 km logbook service" aria-label="Summary" value={f.note} onChange={(e) => set("note")(e.target.value)} />
        </Field>
        <Field label="Work done" wide3>
          <textarea className="vm-input vm-textarea" placeholder="One line per item, as the invoice lists them" aria-label="Work done" value={f.workDone} onChange={(e) => set("workDone")(e.target.value)} />
        </Field>
      </div>
    ) : kind === "odo" ? (
      <div className="vm-fields">
        {odoField("Odometer (km)", true)}
        <Field label="Note" wide>
          <input className="vm-input" placeholder="Optional" aria-label="Note" value={f.note} onChange={(e) => set("note")(e.target.value)} />
        </Field>
      </div>
    ) : (
      <div className="vm-fields">
        <Field label="What's wrong" req wide3>
          <textarea className="vm-input vm-textarea" placeholder="e.g. Sliding door latch sticking — needs adjustment" aria-label="What's wrong" value={f.note} onChange={(e) => set("note")(e.target.value)} />
        </Field>
      </div>
    );

  return (
    <>
      <SubHeader
        eyebrow={displayName(vehicle)}
        title={TITLE[kind]}
        onBack={onBack}
        right={<Plate plate={vehicle.plate} state={vehicle.plateState} size="sm" />}
      />

      <div className="vm-body">
        {error && <div className="vm-err">{error}</div>}

        {kind === "fuel" && (
          <ScanCard<ReadReceiptResult>
            heading={SCAN.fuel.heading}
            prompt={SCAN.fuel.prompt}
            hint={SCAN.fuel.hint}
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
            hint={SCAN.service.hint}
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
        {!scans && <div className="vm-card vm-record">{fields}</div>}

        {showFields && warnings.length > 0 && (
          <div className="vm-warnline" role="status">
            {warnings.join(" ")}
          </div>
        )}
      </div>

      <div className="fl-foot bar">
        <Btn kind="outline" onClick={onBack}>
          Cancel
        </Btn>
        {showFields && (
          <Btn kind="primary" onClick={save} disabled={!ready}>
            {pending ? "Saving…" : SAVE[kind]}
          </Btn>
        )}
      </div>
    </>
  );
}

function Field({ label, req, wide, wide3, children }: { label: string; req?: boolean; wide?: boolean; wide3?: boolean; children: ReactNode }) {
  return (
    <label className={`vm-ffield${wide ? " wide" : ""}${wide3 ? " wide3" : ""}`}>
      <span className="vm-fl">
        {label}
        {req && <i aria-hidden>*</i>}
      </span>
      {children}
    </label>
  );
}
