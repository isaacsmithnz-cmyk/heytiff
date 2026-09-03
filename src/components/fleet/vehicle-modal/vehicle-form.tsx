"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { RenewalInput } from "@/app/actions/fleet";
import { readPurchaseInvoice, readRegoCertificate, type ReadRegoResult } from "@/app/actions/fleet-ai";
import { uploadFile } from "@/lib/documents/upload-client";
import { fileToUprightBase64 } from "@/lib/images/upright";
import { dateFromDays } from "@/lib/fleet/map";
import { MAKE_NOT_LISTED, VEHICLE_MAKES, canonicalMake } from "@/lib/fleet/makes";
import { DateField } from "@/components/ui/date-field";
import { Icon } from "@/components/shell/icon";
import { Plate } from "../plate";
import {
  AU_STATES,
  BODY_TYPES,
  BODY_TYPE_LABEL,
  STATUS_LABEL,
  daysUntil,
  displayName,
  fmtMoney,
  serviceDaysUntil,
  type BodyType,
  type FleetStaff,
  type Vehicle,
  type VehicleStatus,
} from "../logic";
import { fmtDay } from "./derive";
import { Btn, Eyebrow, IconBtn, Inline } from "./parts";

/* Adding or editing a vehicle, in the vehicle modal's language.

   THE FORM OPENS ON THE CERTIFICATE. A Certificate of Registration carries
   plate, state, make, model, variant, year, VIN, engine number, weights,
   seating and the expiry — most of a vehicle record in one photo — and typing
   all of that off the paper is how a VIN gets a digit wrong. So the first
   card asks for the certificate; Tiff reads it into the fields below; the
   person checks the form against the paper and saves. Filling the form by hand
   is the same form, just without the reading.

   EXPIRY DATES LEAVE THE FORM. Registration, insurance and the green slip are
   RECORDS — a policy row with the paper filed under it — and the vehicle card
   is where they are read, updated and kept. The one exception is the vehicle's
   FIRST registration on the way in: the certificate that filled the form also
   says when the rego runs to, and that becomes the first rego record, with the
   certificate under it, when the vehicle is saved. Editing an existing vehicle
   never touches a date; the card does.

   The make is picked, not typed (a free-text make is how one register ended up
   holding TOYOTA, Toyota and toyota), with "Not listed" for the trailer whose
   make is a feed code no list carries — the contract the picker tests pin. */

type Fields = {
  name: string;
  plate: string;
  plateState: string;
  make: string;
  model: string;
  variant: string;
  year: string;
  bodyType: BodyType | "";
  colour: string;
  vin: string;
  engineNumber: string;
  engineCapacityCc: string;
  seating: string;
  tareKg: string;
  gvmKg: string;
  atmKg: string;
  regoCustomerNo: string;
  odometer: string;
  intervalKm: string;
  lastServiceOdo: string;
  intervalMonths: string;
  lastServiceOn: string;
  purchaseDate: string;
  purchasePrice: string;
  purchaseSupplier: string;
  purchaseInvoiceNo: string;
  value: string;
  status: VehicleStatus;
  assignedTo: string;
  notes: string;
  /* the first registration, on the way in */
  regoExpiry: string;
  regoTerm: string;
  regoPaid: string;
  regoIssuer: string;
};

const s = (v: unknown): string => (v == null ? "" : String(v));

function fromVehicle(v: Vehicle, today: string): Fields {
  return {
    name: v.name,
    plate: v.plate,
    plateState: v.plateState ?? "",
    /* An existing row may hold a dirty spelling from before the picker
       ("TOYOTA", "Byd"). Canonicalise on open so the select can find its row —
       and so saving an untouched vehicle quietly tidies it. */
    make: canonicalMake(v.make) ?? v.make,
    model: v.model,
    variant: s(v.variant),
    year: v.year ? String(v.year) : "",
    bodyType: v.bodyType ?? "",
    colour: s(v.colour),
    vin: s(v.vin),
    engineNumber: s(v.engineNumber),
    engineCapacityCc: s(v.engineCapacityCc),
    seating: s(v.seating),
    tareKg: s(v.tareKg),
    gvmKg: s(v.gvmKg),
    atmKg: s(v.atmKg),
    regoCustomerNo: s(v.regoCustomerNo),
    odometer: String(v.odometer),
    intervalKm: v.serviceIntervalKm == null ? "" : String(v.serviceIntervalKm),
    lastServiceOdo: String(v.lastServiceOdo),
    intervalMonths: v.serviceIntervalMonths == null ? "" : String(v.serviceIntervalMonths),
    lastServiceOn: v.lastServiceDays == null ? "" : dateFromDays(-v.lastServiceDays, today),
    purchaseDate: v.purchaseDateDays ? dateFromDays(-v.purchaseDateDays, today) : "",
    purchasePrice: v.purchasePrice ? String(v.purchasePrice) : "",
    purchaseSupplier: s(v.purchaseSupplier),
    purchaseInvoiceNo: s(v.purchaseInvoiceNo),
    value: String(v.value),
    status: v.status,
    assignedTo: v.assignedTo ?? "",
    notes: v.notes ?? "",
    regoExpiry: "",
    regoTerm: "12",
    regoPaid: "",
    regoIssuer: "",
  };
}

const BLANK: Fields = {
  name: "",
  plate: "",
  plateState: "",
  make: "",
  model: "",
  variant: "",
  year: "",
  bodyType: "",
  colour: "",
  vin: "",
  engineNumber: "",
  engineCapacityCc: "",
  seating: "",
  tareKg: "",
  gvmKg: "",
  atmKg: "",
  regoCustomerNo: "",
  odometer: "",
  intervalKm: "",
  lastServiceOdo: "",
  intervalMonths: "",
  lastServiceOn: "",
  purchaseDate: "",
  purchasePrice: "",
  purchaseSupplier: "",
  purchaseInvoiceNo: "",
  value: "",
  status: "active",
  assignedTo: "",
  notes: "",
  regoExpiry: "",
  regoTerm: "12",
  regoPaid: "",
  regoIssuer: "",
};

function num(str: string): number {
  const n = parseFloat(str.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
const intOrNull = (str: string): number | null => {
  const n = Math.round(num(str));
  return n > 0 ? n : null;
};
const strOrNull = (str: string): string | null => str.trim() || null;

type Cert =
  | { state: "idle" }
  | { state: "reading"; name: string }
  | { state: "read"; name: string; documentId: string | null; expiresOn: string | null };

type Invoice =
  | { state: "none" }
  | { state: "reading"; name: string }
  | { state: "attached"; name: string; documentId: string; read: string | null };

export function VehicleForm({
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
  onSave: (v: Vehicle, purchaseInvoiceId?: string, initialRenewal?: Omit<RenewalInput, "vehicleId">) => void;
  onClose: () => void;
}) {
  const adding = initial === null;
  const [f, setF] = useState<Fields>(() => (initial ? fromVehicle(initial, today) : BLANK));
  /* Whether the make is being typed rather than picked. This can't be derived
     from the value: choosing "Not listed" leaves the field empty, which is
     indistinguishable from not having chosen anything yet. */
  const [makeNotListed, setMakeNotListed] = useState(
    () => !!initial && initial.make.trim() !== "" && canonicalMake(initial.make) === null,
  );
  const [cert, setCert] = useState<Cert>({ state: "idle" });
  const [certWarn, setCertWarn] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<Invoice>({ state: "none" });
  const [invoiceExtras, setInvoiceExtras] = useState<
    Partial<Pick<Vehicle, "purchaseExGst" | "purchaseGst" | "purchaseOnRoad" | "purchaseDeposit" | "purchaseOdometer">>
  >({});
  const certInput = useRef<HTMLInputElement>(null);
  const invoiceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const setDate = (k: keyof Fields) => (iso: string | null) => setF((p) => ({ ...p, [k]: iso ?? "" }));

  /* Body type decides the engine: a trailer has none, and the odometer, fuel
     and distance-service fields go with it. Nothing else has to be asked. */
  const motorised = f.bodyType === "trailer" ? false : initial && !f.bodyType ? initial.motorised : true;

  /* ---- the certificate ---- */
  const scanCertificate = async (file: File | null | undefined) => {
    if (!file || cert.state === "reading") return;
    setCertWarn(null);
    setCert({ state: "reading", name: file.name });
    /* On the way IN the certificate is stored, because it will be filed under
       the vehicle's first rego record. On an existing vehicle nothing is
       stored: the read fills the form, and the paper belongs under
       Registration on the card, where it can be filed against the record it
       actually renews. */
    const [stored, result] = await Promise.all([
      adding
        ? uploadFile(file, "rego_notice").catch(() => ({ ok: false, error: "upload" }) as const)
        : Promise.resolve(null),
      fileToUprightBase64(file)
        .then((img) => readRegoCertificate(img.data, img.mediaType))
        .catch((): ReadRegoResult => ({ ok: false, reason: "read" })),
    ]);
    const documentId = stored && stored.ok ? stored.file.documentId : null;
    if (adding && stored && !stored.ok) setCertWarn("The certificate couldn't be stored — the details will save without it.");
    if (!result.ok) {
      setCert({ state: "idle" });
      setCertWarn((w) => w ?? "Tiff couldn't read that one — fill the form in below.");
      return;
    }
    fillFromCertificate(result);
    setCert({ state: "read", name: file.name, documentId, expiresOn: result.expiresOn });
  };

  /* Only what was read lands; a null leaves what was there. The plate is the
     exception in one direction only — a blank plate takes the read one, a
     typed plate is never overwritten by a read, because the plate is what the
     person is surest of. */
  const fillFromCertificate = (r: ReadRegoResult & { ok: true }) => {
    setF((p) => ({
      ...p,
      plate: p.plate.trim() ? p.plate : (r.plate ?? p.plate),
      plateState: r.plateState ?? p.plateState,
      make: r.make ?? p.make,
      model: r.model ?? p.model,
      variant: r.variant ?? p.variant,
      year: r.year ? String(r.year) : p.year,
      bodyType: r.bodyType ?? p.bodyType,
      colour: r.colour ?? p.colour,
      vin: r.vin ?? p.vin,
      engineNumber: r.engineNumber ?? p.engineNumber,
      engineCapacityCc: r.engineCapacityCc ? String(r.engineCapacityCc) : p.engineCapacityCc,
      seating: r.seating ? String(r.seating) : p.seating,
      tareKg: r.tareKg ? String(r.tareKg) : p.tareKg,
      gvmKg: r.gvmKg ? String(r.gvmKg) : p.gvmKg,
      atmKg: r.atmKg ? String(r.atmKg) : p.atmKg,
      regoCustomerNo: r.customerNo ?? p.regoCustomerNo,
      regoExpiry: adding ? (r.expiresOn ?? p.regoExpiry) : p.regoExpiry,
      regoPaid: adding && r.renewalAmount != null ? String(r.renewalAmount) : p.regoPaid,
      regoIssuer: adding ? (r.issuer ?? p.regoIssuer) : p.regoIssuer,
    }));
    if (r.make) setMakeNotListed(canonicalMake(r.make) === null);
  };

  /* ---- the purchase invoice (issue #509) — unchanged contract ---- */
  const onInvoicePick = async (file: File | null | undefined) => {
    if (!file || invoice.state === "reading") return;
    setInvoice({ state: "reading", name: file.name });
    const [up, scan] = await Promise.all([
      uploadFile(file, "purchase_invoice").catch(() => ({ ok: false, error: "upload" }) as const),
      fileToUprightBase64(file)
        .then((img) => readPurchaseInvoice(img.data, img.mediaType))
        .catch(() => ({ ok: false, reason: "read" }) as const),
    ]);
    if (!up.ok) {
      setInvoice({ state: "none" });
      return;
    }
    let read: string | null = null;
    if (scan.ok && (scan.cost || scan.purchasedOn || scan.supplier)) {
      setF((p) => ({
        ...p,
        purchasePrice: scan.cost ? String(scan.cost) : p.purchasePrice,
        purchaseDate: scan.purchasedOn ?? p.purchaseDate,
        purchaseSupplier: scan.supplier ?? p.purchaseSupplier,
        purchaseInvoiceNo: scan.invoiceNo ?? p.purchaseInvoiceNo,
      }));
      /* The rest of the invoice has no field on this form — it is read on the
         Financials screen — but it was read now, so it is kept and saved. */
      setInvoiceExtras((x) => ({
        purchaseExGst: scan.exGst ?? x.purchaseExGst,
        purchaseGst: scan.gst ?? x.purchaseGst,
        purchaseOnRoad: scan.onRoadCosts ?? x.purchaseOnRoad,
        purchaseDeposit: scan.deposit ?? x.purchaseDeposit,
        purchaseOdometer: scan.odometer ?? x.purchaseOdometer,
      }));
      read = [scan.cost ? fmtMoney(scan.cost) : null, scan.purchasedOn, scan.supplier].filter(Boolean).join(" · ");
    }
    setInvoice({ state: "attached", name: file.name, documentId: up.file.documentId, read });
  };

  const ready = !!(f.plate.trim() && f.make.trim());

  const save = () => {
    if (!ready) return;
    const odometer = motorised ? num(f.odometer) : 0;
    const vehicle: Vehicle = {
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
      purchaseSupplier: f.purchaseSupplier.trim() || null,
      purchaseInvoiceNo: f.purchaseInvoiceNo.trim() || null,
      // read off the invoice here, or carried from the record — never typed on this form
      purchaseExGst: invoiceExtras.purchaseExGst ?? initial?.purchaseExGst ?? null,
      purchaseGst: invoiceExtras.purchaseGst ?? initial?.purchaseGst ?? null,
      purchaseOnRoad: invoiceExtras.purchaseOnRoad ?? initial?.purchaseOnRoad ?? null,
      purchaseDeposit: invoiceExtras.purchaseDeposit ?? initial?.purchaseDeposit ?? null,
      purchaseOdometer: invoiceExtras.purchaseOdometer ?? initial?.purchaseOdometer ?? null,
      /* The dates are the card's. Editing keeps whatever the vehicle had;
         adding files the first rego as a RECORD below, and the cache follows. */
      regoDays: initial ? initial.regoDays : f.regoExpiry ? daysUntil(f.regoExpiry, today) : null,
      insuranceDays: initial ? initial.insuranceDays : null,
      ctpDays: initial ? initial.ctpDays : null,
      /* Blank means "no distance limit", which is the whole point of the
         column being nullable — defaulting it back to 10,000 would give a
         trailer a cycle it can never reach. No motor forces it either way. */
      serviceIntervalKm: !motorised || !f.intervalKm.trim() ? null : num(f.intervalKm) || null,
      lastServiceOdo: f.lastServiceOdo.trim() ? num(f.lastServiceOdo) : odometer,
      serviceIntervalMonths: f.intervalMonths.trim() ? num(f.intervalMonths) || null : null,
      lastServiceDays: f.lastServiceOn ? -daysUntil(f.lastServiceOn, today) : null,
      serviceDays: serviceDaysUntil(
        f.lastServiceOn || null,
        f.intervalMonths.trim() ? num(f.intervalMonths) || null : null,
        today,
      ),
      motorised,
      notes: f.notes.trim() || undefined,
      // the certificate's facts
      bodyType: f.bodyType || null,
      colour: strOrNull(f.colour),
      vin: strOrNull(f.vin)?.toUpperCase() ?? null,
      engineNumber: strOrNull(f.engineNumber)?.toUpperCase() ?? null,
      engineCapacityCc: motorised ? intOrNull(f.engineCapacityCc) : null,
      seating: motorised ? intOrNull(f.seating) : null,
      tareKg: intOrNull(f.tareKg),
      gvmKg: intOrNull(f.gvmKg),
      atmKg: motorised ? null : intOrNull(f.atmKg),
      variant: strOrNull(f.variant),
      regoCustomerNo: strOrNull(f.regoCustomerNo),
      photoDocumentId: initial?.photoDocumentId ?? null,
    };
    const invoiceId = invoice.state === "attached" ? invoice.documentId : undefined;
    const renewal: Omit<RenewalInput, "vehicleId"> | undefined =
      adding && f.regoExpiry
        ? {
            kind: "rego",
            expiresOn: f.regoExpiry,
            startsOn: null,
            provider: strOrNull(f.regoIssuer),
            premium: f.regoPaid.trim() ? num(f.regoPaid) : null,
            termMonths: intOrNull(f.regoTerm),
            documentId: cert.state === "read" ? (cert.documentId ?? undefined) : undefined,
            source: cert.state === "read" ? "scan" : "manual",
          }
        : undefined;
    onSave(vehicle, invoiceId, renewal);
  };

  const previewType: BodyType = f.bodyType || (motorised ? "van" : "trailer");

  return createPortal(
    <div className="vm-ov" onClick={onClose}>
      <div className="vm" role="dialog" aria-modal="true" aria-label={adding ? "Add vehicle" : "Edit vehicle"} onClick={(e) => e.stopPropagation()}>
        <div className="vm-head">
          <div className="vm-headl">
            <span className="vm-photo static" aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local line drawing */}
              <img src={`/fleet/${previewType}.svg`} alt="" className="placeholder" />
            </span>
            <div className="vm-titles">
              <div className="vm-titlerow">
                <h2 className="vm-title">{adding ? "Add vehicle" : `Edit ${displayName(initial)}`}</h2>
                {f.plate.trim() && <Plate plate={f.plate} state={f.plateState || null} size="sm" />}
              </div>
              <div className="vm-model">
                {adding ? "Scan the rego certificate, or fill the form in." : [f.make, f.model, f.year].filter(Boolean).join(" ")}
              </div>
            </div>
          </div>
          <IconBtn icon="x" label="Close" onClick={onClose} />
        </div>

        <div className="vm-body">
          {/* ---- the certificate ---- */}
          <div className="vm-card vm-record">
            <div className="vm-cardhead">
              <Eyebrow>REGO CERTIFICATE</Eyebrow>
              {cert.state === "read" && (
                <Inline muted onClick={() => setCert({ state: "idle" })}>
                  Scan another
                </Inline>
              )}
            </div>
            <input
              ref={certInput}
              type="file"
              accept="image/*,application/pdf"
              aria-label="Scan certificate"
              hidden
              onChange={(e) => {
                void scanCertificate(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {cert.state === "idle" && (
              <button type="button" className="vm-scan" onClick={() => certInput.current?.click()}>
                <b>Scan or upload the rego certificate</b>
                <span>
                  {adding
                    ? "Plate, make, model, VIN, engine, weights and the rego expiry are read from it and fill the form below. PDF, JPG or photo."
                    : "Fills in the details below from the certificate. Nothing is stored here — file the paper under Registration on the vehicle's card."}
                </span>
              </button>
            )}
            {cert.state === "reading" && (
              <div className="vm-reading" role="status">
                <span className="vm-shimmer" />
                <span>Reading {cert.name}…</span>
              </div>
            )}
            {cert.state === "read" && (
              <div className="vm-scanned">
                <span className="vm-scannedl">
                  <b>{cert.name}</b>
                  <em>Details read from the certificate — check the form before saving</em>
                </span>
                <span className="vm-scannedtag">SCANNED</span>
              </div>
            )}
            {cert.state === "read" && !adding && cert.expiresOn && (
              <div className="vm-note">
                The certificate shows registration to {fmtDay(cert.expiresOn)} — record that under Registration on the card.
              </div>
            )}
            {certWarn && <div className="vm-warnline">{certWarn}</div>}
          </div>

          {/* ---- identity ---- */}
          <Section label="IDENTITY">
            <Field label="Rego plate" req>
              <input className="vm-input" placeholder="e.g. MKT482" value={f.plate} onChange={set("plate")} />
            </Field>
            <Field label="Registered in" hint="Plates are only unique within a state">
              <select className="vm-input" value={f.plateState} onChange={set("plateState")}>
                <option value="">Not stated</option>
                {AU_STATES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name / fleet no.">
              <input className="vm-input" placeholder="Optional — e.g. VRF-09" value={f.name} onChange={set("name")} />
            </Field>
            {/* Picked, not typed — a free-text make is how one register ends up
                holding TOYOTA, Toyota and toyota as three marques. "Not listed"
                still takes anything, because trailers and plant never make a list. */}
            <Field label="Make" req>
              <select
                className="vm-input"
                value={makeNotListed ? MAKE_NOT_LISTED : (canonicalMake(f.make) ?? "")}
                onChange={(e) => {
                  const picked = e.target.value;
                  const typing = picked === MAKE_NOT_LISTED;
                  setMakeNotListed(typing);
                  setF((p) => ({ ...p, make: typing ? "" : picked }));
                }}
              >
                <option value="">Select a make</option>
                {VEHICLE_MAKES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value={MAKE_NOT_LISTED}>Not listed…</option>
              </select>
              {makeNotListed && (
                <input
                  className="vm-input"
                  aria-label="Make not listed"
                  placeholder="e.g. LG Chiv"
                  value={f.make}
                  onChange={set("make")}
                  autoFocus
                />
              )}
            </Field>
            <Field label="Model">
              <input className="vm-input" placeholder="e.g. Hiace ZR" value={f.model} onChange={set("model")} />
            </Field>
            <Field label="Variant">
              <input className="vm-input" placeholder="e.g. MR4W30-" value={f.variant} onChange={set("variant")} />
            </Field>
            <Field label="Year">
              <input className="vm-input" type="number" placeholder="e.g. 2022" value={f.year} onChange={set("year")} />
            </Field>
            <Field label="Body type" hint="A trailer has no engine, odometer or fuel">
              <select className="vm-input" value={f.bodyType} onChange={set("bodyType")}>
                <option value="">Not stated</option>
                {BODY_TYPES.map((b) => (
                  <option key={b} value={b}>
                    {BODY_TYPE_LABEL[b]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Colour">
              <input className="vm-input" placeholder="e.g. White" value={f.colour} onChange={set("colour")} />
            </Field>
          </Section>

          {/* ---- the certificate's specs ---- */}
          <Section label="SPECIFICATIONS">
            <Field label="VIN / chassis" wide>
              <input className="vm-input mono" placeholder="17 characters on the certificate" value={f.vin} onChange={set("vin")} />
            </Field>
            {motorised && (
              <Field label="Engine no.">
                <input className="vm-input" value={f.engineNumber} onChange={set("engineNumber")} />
              </Field>
            )}
            {motorised && (
              <Field label="Engine capacity (cc)">
                <input className="vm-input" type="number" placeholder="e.g. 2442" value={f.engineCapacityCc} onChange={set("engineCapacityCc")} />
              </Field>
            )}
            {motorised && (
              <Field label="Seating">
                <input className="vm-input" type="number" placeholder="e.g. 4" value={f.seating} onChange={set("seating")} />
              </Field>
            )}
            <Field label="Tare (kg)">
              <input className="vm-input" type="number" placeholder="e.g. 2180" value={f.tareKg} onChange={set("tareKg")} />
            </Field>
            <Field label="GVM (kg)">
              <input className="vm-input" type="number" placeholder="e.g. 2900" value={f.gvmKg} onChange={set("gvmKg")} />
            </Field>
            {!motorised && (
              <Field label="ATM (kg)">
                <input className="vm-input" type="number" placeholder="e.g. 2000" value={f.atmKg} onChange={set("atmKg")} />
              </Field>
            )}
            <Field label="Rego customer no." hint="The road authority's number for this registration">
              <input className="vm-input" value={f.regoCustomerNo} onChange={set("regoCustomerNo")} />
            </Field>
          </Section>

          {/* ---- the first registration, on the way in ---- */}
          {adding ? (
            <Section label="REGISTRATION" note="Filed as the vehicle's first rego record, with the certificate under it. Insurance and the green slip are added on the vehicle's card.">
              <Field label="Rego expiry">
                <DateField size="lg" clearable today={today} value={f.regoExpiry || null} onChange={setDate("regoExpiry")} />
              </Field>
              <Field label="Term">
                <select className="vm-input" value={f.regoTerm} onChange={set("regoTerm")}>
                  {[12, 6, 3].map((t) => (
                    <option key={t} value={String(t)}>
                      {t} months
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Amount paid ($)">
                <input className="vm-input" type="number" placeholder="e.g. 1008" value={f.regoPaid} onChange={set("regoPaid")} />
              </Field>
              <Field label="Issued by">
                <input className="vm-input" placeholder="e.g. Transport for NSW" value={f.regoIssuer} onChange={set("regoIssuer")} />
              </Field>
            </Section>
          ) : (
            <div className="vm-card vm-quiet">
              <Icon name="shield" size={15} />
              Registration, insurance and the green slip are managed on the vehicle&apos;s card — open the vehicle and use the compliance list.
            </div>
          )}

          {/* ---- service cycle ---- */}
          <Section label="SERVICE CYCLE">
            {/* Asked only of something that has one. A trailer offered an odometer
                box gets a zero typed into it, and that zero then reads as a
                measurement on every screen downstream. */}
            {motorised && (
              <Field label="Odometer (km)">
                <input className="vm-input" type="number" placeholder="e.g. 84120" value={f.odometer} onChange={set("odometer")} />
              </Field>
            )}
            {motorised && (
              <Field label="Service interval (km)">
                <input className="vm-input" type="number" placeholder="e.g. 10000" value={f.intervalKm} onChange={set("intervalKm")} />
              </Field>
            )}
            {motorised && (
              <Field label="Last service odo (km)">
                <input className="vm-input" type="number" placeholder="Blank = current odo" value={f.lastServiceOdo} onChange={set("lastServiceOdo")} />
              </Field>
            )}
            <Field label="Service interval (months)">
              <input className="vm-input" type="number" placeholder="e.g. 12" value={f.intervalMonths} onChange={set("intervalMonths")} />
            </Field>
            <Field label="Last service date">
              <DateField size="lg" clearable today={today} value={f.lastServiceOn || null} onChange={setDate("lastServiceOn")} />
            </Field>
          </Section>

          {/* ---- purchase ---- */}
          <Section label="PURCHASE">
            <Field label="Purchase date">
              <DateField size="lg" clearable today={today} value={f.purchaseDate || null} onChange={setDate("purchaseDate")} />
            </Field>
            <Field label="Purchase price ($)" hint="What you paid for it. It's history, and it anchors Tiff's estimate.">
              <input className="vm-input" type="number" placeholder="What you paid" value={f.purchasePrice} onChange={set("purchasePrice")} />
            </Field>
            <Field label="Book value ($)" hint="What it's worth today — the fleet total adds these up.">
              <input className="vm-input" type="number" placeholder="What it's worth now" value={f.value} onChange={set("value")} />
            </Field>
            <Field label="Supplier">
              <input className="vm-input" placeholder="Dealer or seller" value={f.purchaseSupplier} onChange={set("purchaseSupplier")} />
            </Field>
            <Field label="Invoice no.">
              <input className="vm-input" placeholder="On the tax invoice" value={f.purchaseInvoiceNo} onChange={set("purchaseInvoiceNo")} />
            </Field>
            <div className="vm-ffield wide3">
              <input
                ref={invoiceInput}
                type="file"
                accept="image/*,application/pdf"
                aria-label="Attach invoice"
                hidden
                onChange={(e) => {
                  void onInvoicePick(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {invoice.state === "attached" ? (
                <span className="vm-attached">
                  <Icon name="file" size={13} />
                  {invoice.name}
                  {invoice.read && <i> — Tiff read {invoice.read}</i>}
                </span>
              ) : (
                <button
                  type="button"
                  className="vm-attachbtn"
                  disabled={invoice.state === "reading"}
                  onClick={() => invoiceInput.current?.click()}
                >
                  <Icon name="upload" size={13} />
                  {invoice.state === "reading" ? "Tiff is reading the invoice…" : "Attach the invoice — Tiff reads the price and date"}
                </button>
              )}
            </div>
          </Section>

          {/* ---- assignment ---- */}
          <Section label="ASSIGNMENT">
            <Field label="Status">
              <select className="vm-input" value={f.status} onChange={set("status")}>
                {(Object.keys(STATUS_LABEL) as VehicleStatus[]).map((k) => (
                  <option key={k} value={k}>
                    {STATUS_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={motorised ? "Assigned driver" : "Towed by"} wide>
              <select className="vm-input" value={f.assignedTo} onChange={set("assignedTo")}>
                <option value="">Pool / unassigned</option>
                {staff
                  .filter((st) => st.status === "Active" || st.id === f.assignedTo)
                  .map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Notes" wide3>
              <textarea className="vm-input vm-textarea" placeholder="e.g. Pool ute — site runs & tip loads" value={f.notes} onChange={set("notes")} />
            </Field>
          </Section>
        </div>

        <div className="vm-foot">
          <Btn kind="outline" onClick={onClose}>
            Cancel
          </Btn>
          <Btn kind="primary" onClick={save} disabled={!ready} icon="check">
            {adding ? "Add vehicle" : "Save changes"}
          </Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---- form atoms ---- */

function Section({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="vm-card">
      <div className="vm-cardhead">
        <Eyebrow>{label}</Eyebrow>
      </div>
      {note && <div className="vm-note">{note}</div>}
      <div className="vm-form">{children}</div>
    </div>
  );
}

function Field({
  label,
  req,
  hint,
  wide,
  wide3,
  children,
}: {
  label: string;
  req?: boolean;
  hint?: string;
  wide?: boolean;
  wide3?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`vm-ffield${wide ? " wide" : ""}${wide3 ? " wide3" : ""}`}>
      <span className="vm-fl">
        {label}
        {req && <i aria-hidden>*</i>}
      </span>
      {children}
      {hint && <em className="vm-hint">{hint}</em>}
    </label>
  );
}
