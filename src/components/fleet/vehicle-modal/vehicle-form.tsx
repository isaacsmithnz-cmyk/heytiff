"use client";

import { useContext, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { removeVehicle, saveVehicle, type RenewalInput } from "@/app/actions/fleet";
import { readPurchaseInvoice, readRegoCertificate, type ReadRegoResult } from "@/app/actions/fleet-ai";
import { uploadFile } from "@/lib/documents/upload-client";
import { fileToUprightBase64 } from "@/lib/images/upright";
import { dateFromDays } from "@/lib/fleet/map";
import { MAKE_NOT_LISTED, VEHICLE_MAKES, canonicalMake } from "@/lib/fleet/makes";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { Field, TextArea, TextInput } from "@/components/parts/field";
import { Fade } from "@/components/parts/fade";
import { Dot } from "@/components/parts/state";
import { Tray } from "@/components/parts/tabs";
import { DateField } from "@/components/ui/date-field";
import { Icon } from "@/components/shell/icon";
import { WindowsContext } from "@/components/records/records-context";
import { scanInProgress } from "@/components/record-modal/scan-card";
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

/* ADD A VEHICLE (v2 forms board, forms 8a and 8), and a vehicle's Edit
   details: one dialog, 720 wide, over the page you're on.

   THE FORM STARTS WITH THE CERTIFICATE. A Certificate of Registration
   carries the plate, state, make, model, variant, year, VIN, engine number,
   weights, seating and the expiry, most of a vehicle in one photo, and
   typing all that off the paper is how a VIN gets a digit wrong. So the
   form opens on the certificate: dropped, photographed or chosen, read by
   today's reader (readRegoCertificate), and every section below filled in
   for checking. Filling it by hand is the same form without the reading.

   EXPIRY DATES ARE RECORDS. Registration, insurance and the green slip are
   a policy row with the paper filed under it, kept on the vehicle. The one
   exception is the FIRST registration on the way in: the certificate that
   filled the form says when the rego runs to, and that becomes the first
   rego record, with the certificate under it, when the vehicle is saved.
   Editing never touches a date.

   The make is picked, not typed (a free-text make is how one register held
   TOYOTA, Toyota and toyota), with Not listed for the trailer whose make no
   list carries. A trailer has no engine, so the engine, odometer and
   distance-service fields go and ATM arrives.

   Saving is today's action, saveVehicle, with the purchase invoice adopted
   and the first rego filed. It keeps you where you were (rule 51), with a
   toast: Undo takes a new vehicle back out (removeVehicle, as Remove
   vehicle does), and puts an edited one back as it was. */

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
       ("TOYOTA", "Byd"). Canonicalise on open so the chooser finds its row,
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

/** What the paper is, in a few words: "PDF, 220 KB". */
function paperOf(file: File): string {
  const kind = file.type === "application/pdf" ? "PDF" : "Photo";
  const size = file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  return `${kind}, ${size}`;
}

type Cert =
  | { state: "idle" }
  | { state: "reading"; name: string }
  | { state: "read"; name: string; paper: string; documentId: string | null; expiresOn: string | null }
  /* stored, but nothing read: filed the same as a read one */
  | { state: "attached"; name: string; paper: string; documentId: string };

type Invoice =
  | { state: "none" }
  | { state: "reading"; name: string }
  | { state: "attached"; name: string; paper: string; documentId: string; read: string | null };

type Wrong = Partial<Record<"plate" | "make" | "regoExpiry", string>>;

const TERMS = [
  { value: "12", label: "12 months" },
  { value: "6", label: "6 months" },
  { value: "3", label: "3 months" },
] as const;

const MAKE_OPTIONS = [...VEHICLE_MAKES.map((m) => ({ value: m as string, label: m as string })), { value: MAKE_NOT_LISTED, label: "Not listed" }];
const STATE_OPTIONS = [{ value: "", label: "Not stated" }, ...AU_STATES.map((st) => ({ value: st as string, label: st as string }))];
const BODY_OPTIONS = BODY_TYPES.map((b) => ({ value: b, label: BODY_TYPE_LABEL[b] }));
const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as VehicleStatus[]).map((k) => ({ value: k, label: STATUS_LABEL[k] }));

export function VehicleForm({
  initial,
  staff,
  today,
  onClose,
  onSaved,
}: {
  /** The vehicle being edited, filled in; null adds one. */
  initial: Vehicle | null;
  staff: FleetStaff[];
  /** The AU calendar date, from the server. The browser's clock is not the
      anchor: the day-counts this form produces are converted back to dates
      server-side against the same day, and the two must agree. */
  today: string;
  onClose: () => void;
  /** After the save landed, with the vehicle's id: where the door goes next. */
  onSaved?: (id: string) => void;
}) {
  const router = useRouter();
  const host = useContext(WindowsContext);
  const adding = initial === null;
  const makeId = useId();
  const [f, setF] = useState<Fields>(() => (initial ? fromVehicle(initial, today) : BLANK));
  /* Whether the make is being typed rather than picked. Not derivable from
     the value: choosing Not listed leaves it empty, which is also what
     not having chosen looks like. */
  const [makeNotListed, setMakeNotListed] = useState(
    () => !!initial && initial.make.trim() !== "" && canonicalMake(initial.make) === null,
  );
  const [cert, setCert] = useState<Cert>({ state: "idle" });
  const [certWarn, setCertWarn] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [invoice, setInvoice] = useState<Invoice>({ state: "none" });
  const [invoiceExtras, setInvoiceExtras] = useState<
    Partial<Pick<Vehicle, "purchaseExGst" | "purchaseGst" | "purchaseOnRoad" | "purchaseDeposit" | "purchaseOdometer">>
  >({});
  const [wrong, setWrong] = useState<Wrong>({});
  const [refused, setRefused] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const certInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const invoiceInput = useRef<HTMLInputElement>(null);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setF((p) => ({ ...p, [k]: value }));
    if (k in wrong) setWrong((w) => ({ ...w, [k]: undefined }));
  };
  const setValue = (k: keyof Fields) => (value: string | null) => {
    setF((p) => ({ ...p, [k]: value ?? "" }));
    if (k in wrong) setWrong((w) => ({ ...w, [k]: undefined }));
  };

  /* Body type decides the engine: a trailer has none, and the odometer and
     distance-service fields go with it. */
  const motorised = f.bodyType === "trailer" ? false : initial && !f.bodyType ? initial.motorised : true;

  /* ---- the certificate ---- */
  const scanCertificate = async (file: File | null | undefined) => {
    if (!file || cert.state === "reading") return;
    setCertWarn(null);
    setCert({ state: "reading", name: file.name });
    const paper = paperOf(file);
    /* On the way IN the certificate is stored, because it will be filed under
       the vehicle's first rego record. On an existing vehicle nothing is
       stored: the read fills the form, and the paper belongs under the
       renewal it actually records. */
    const [stored, result] = await Promise.all([
      adding ? uploadFile(file, "rego_notice").catch(() => ({ ok: false, error: "upload" }) as const) : Promise.resolve(null),
      fileToUprightBase64(file)
        .then((img) => readRegoCertificate(img.data, img.mediaType))
        .catch((): ReadRegoResult => ({ ok: false, reason: "read" })),
    ]);
    const documentId = stored && stored.ok ? stored.file.documentId : null;
    if (adding && stored && !stored.ok) setCertWarn("The certificate couldn't be stored, so the details will save without it.");
    if (!result.ok) {
      /* Nothing read: the fields stay as they were, and the certificate, if
         it landed, is kept and filed under the first rego all the same. */
      setCert(documentId ? { state: "attached", name: file.name, paper, documentId } : { state: "idle" });
      setCertWarn((w) => w ?? "Tiff couldn't read that one. Fill the form in below.");
      return;
    }
    fillFromCertificate(result);
    setCert({ state: "read", name: file.name, paper, documentId, expiresOn: result.expiresOn });
  };

  /* Only what was read lands; a null leaves what was there. A typed plate is
     never overwritten by a read: the plate is what the person is surest of. */
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
    setWrong({});
  };

  /* ---- the purchase invoice (issue #509), read by today's reader ---- */
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
      /* The rest of the invoice has no field here (the vehicle's Money reads
         it), but it was read now, so it is kept and saved. */
      setInvoiceExtras((x) => ({
        purchaseExGst: scan.exGst ?? x.purchaseExGst,
        purchaseGst: scan.gst ?? x.purchaseGst,
        purchaseOnRoad: scan.onRoadCosts ?? x.purchaseOnRoad,
        purchaseDeposit: scan.deposit ?? x.purchaseDeposit,
        purchaseOdometer: scan.odometer ?? x.purchaseOdometer,
      }));
      read = [scan.cost ? fmtMoney(scan.cost) : null, scan.purchasedOn ? fmtDay(scan.purchasedOn) : null, scan.supplier]
        .filter(Boolean)
        .join(", ");
    }
    setInvoice({ state: "attached", name: file.name, paper: paperOf(file), documentId: up.file.documentId, read });
  };

  /* The certificate in hand, stored and waiting to be filed. Its only home is
     the first rego record, and a rego record is its expiry, so while one is
     held the expiry is asked for. Scan another lets go of both. */
  const certificateId = cert.state === "read" || cert.state === "attached" ? cert.documentId : null;

  const build = (): Vehicle => {
    const odometer = motorised ? num(f.odometer) : 0;
    return {
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
      // read off the invoice here, or carried from the record; never typed here
      purchaseExGst: invoiceExtras.purchaseExGst ?? initial?.purchaseExGst ?? null,
      purchaseGst: invoiceExtras.purchaseGst ?? initial?.purchaseGst ?? null,
      purchaseOnRoad: invoiceExtras.purchaseOnRoad ?? initial?.purchaseOnRoad ?? null,
      purchaseDeposit: invoiceExtras.purchaseDeposit ?? initial?.purchaseDeposit ?? null,
      purchaseOdometer: invoiceExtras.purchaseOdometer ?? initial?.purchaseOdometer ?? null,
      /* The dates are the vehicle's records. Editing keeps whatever it had;
         adding files the first rego as a RECORD, and the cache follows. */
      regoDays: initial ? initial.regoDays : f.regoExpiry ? daysUntil(f.regoExpiry, today) : null,
      insuranceDays: initial ? initial.insuranceDays : null,
      ctpDays: initial ? initial.ctpDays : null,
      /* Blank means no distance limit; no motor forces it. */
      serviceIntervalKm: !motorised || !f.intervalKm.trim() ? null : num(f.intervalKm) || null,
      lastServiceOdo: f.lastServiceOdo.trim() ? num(f.lastServiceOdo) : odometer,
      serviceIntervalMonths: f.intervalMonths.trim() ? num(f.intervalMonths) || null : null,
      lastServiceDays: f.lastServiceOn ? -daysUntil(f.lastServiceOn, today) : null,
      serviceDays: serviceDaysUntil(f.lastServiceOn || null, f.intervalMonths.trim() ? num(f.intervalMonths) || null : null, today),
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
  };

  const save = async () => {
    if (saving) return;
    /* What today's form held its button back for, said on the field (rule 33). */
    const missing: Wrong = {};
    if (!f.plate.trim()) missing.plate = "Give the rego plate.";
    if (!f.make.trim()) missing.make = makeNotListed ? "Type the make." : "Pick a make.";
    if (certificateId !== null && !f.regoExpiry) missing.regoExpiry = "The certificate is filed under the first rego, so give its expiry.";
    setWrong(missing);
    if (Object.keys(missing).length > 0) return;

    const vehicle = build();
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
            documentId: certificateId ?? undefined,
            source: cert.state === "read" ? "scan" : "manual",
          }
        : undefined;

    setSaving(true);
    setRefused(null);
    const res = await saveVehicle(vehicle, invoiceId, renewal);
    if (!res.ok) {
      setSaving(false);
      setRefused(res.error);
      return;
    }
    onClose();
    onSaved?.(res.id);
    router.refresh();
    const before = initial;
    host?.toast(adding ? `${vehicle.plate} added` : `${vehicle.plate} saved`, async () => {
      /* a new vehicle goes back out, as Remove vehicle takes one; an edited
         one is put back as it was opened */
      if (before) await saveVehicle(before);
      else await removeVehicle(res.id);
      router.refresh();
    });
  };

  /* Escape and the scrim leave the form alone while the certificate or the
     invoice is being read or is in hand (scanInProgress); Cancel still closes. */
  const softClose = () => {
    if (!scanInProgress()) onClose();
  };

  const pickFile = (input: HTMLInputElement | null) => input?.click();
  const takeDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    void scanCertificate(e.dataTransfer.files?.[0]);
  };

  const team = staff.filter((st) => st.status === "Active" || st.id === f.assignedTo);
  const driverOptions = [{ value: "", label: "Pool, unassigned" }, ...team.map((st) => ({ value: st.id, label: st.name }))];

  return (
    <Dialog
      heading={adding ? "Add a vehicle" : `Edit ${displayName(initial)}`}
      width={720}
      onClose={softClose}
      foot={
        <>
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" onClick={() => void save()} disabled={saving}>
            {saving ? (adding ? "Adding the vehicle" : "Saving the changes") : adding ? "Add vehicle" : "Save changes"}
          </Button>
        </>
      }
    >
      <form
        className="mk-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {/* ---- the certificate ---- */}
        <div className="mk-records-group" data-scan-in-progress={cert.state !== "idle" ? "" : undefined}>
          <p className="mk-records-label">Rego certificate</p>
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
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="Photograph certificate"
            hidden
            onChange={(e) => {
              void scanCertificate(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {cert.state === "idle" && (
            <div
              className="mk-records-drop"
              data-over={over ? "" : undefined}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={takeDrop}
            >
              <p className="mk-records-drop-what">Drop the rego certificate here, a photo or a PDF</p>
              <div className="mk-records-acts">
                <Button kind="main" icon="cam" onClick={() => pickFile(cameraInput.current)}>
                  Take a photo
                </Button>
                <Button kind="second" icon="upload" onClick={() => pickFile(certInput.current)}>
                  Choose a file
                </Button>
              </div>
            </div>
          )}
          {cert.state === "reading" && <Reading name={cert.name} />}
          {cert.state === "read" && (
            <Paper
              name={cert.name}
              line={`${cert.paper}. Read into the form.`}
              end={
                <Button kind="quiet" size={32} onClick={() => setCert({ state: "idle" })}>
                  Scan another
                </Button>
              }
            />
          )}
          {cert.state === "attached" && (
            <Paper
              name={cert.name}
              line={`${cert.paper}. Kept for the first rego record.`}
              end={
                <Button
                  kind="quiet"
                  size={32}
                  onClick={() => {
                    setCert({ state: "idle" });
                    setCertWarn(null);
                    setWrong((w) => ({ ...w, regoExpiry: undefined }));
                  }}
                >
                  Scan another
                </Button>
              }
            />
          )}
          {cert.state === "read" && !adding && cert.expiresOn && (
            <p className="mk-records-sub">
              The certificate shows registration to {fmtDay(cert.expiresOn)}. Record that under Registration on the vehicle.
            </p>
          )}
          {certWarn && (
            <p className="mk-records-res" role="status">
              <Dot hue="orange" />
              {certWarn}
            </p>
          )}
        </div>

        {/* ---- identity ---- */}
        <Section label="Identity">
          <Field label="Rego plate" error={wrong.plate}>
            <TextInput value={f.plate} invalid={!!wrong.plate} autoComplete="off" onChange={set("plate")} />
          </Field>
          <Field label="Registered in">
            <Chooser options={STATE_OPTIONS} value={f.plateState} placeholder="Not stated" onChange={setValue("plateState")} />
          </Field>
          <Field label="Name or fleet number">
            <TextInput value={f.name} autoComplete="off" onChange={set("name")} />
          </Field>
          <Field label="Make" id={makeId} error={wrong.make}>
            <div className="mk-records-make">
              <Chooser
                id={makeId}
                options={MAKE_OPTIONS}
                value={makeNotListed ? MAKE_NOT_LISTED : (canonicalMake(f.make) ?? null)}
                placeholder="Pick a make"
                invalid={!!wrong.make && !makeNotListed}
                onChange={(picked) => {
                  const typing = picked === MAKE_NOT_LISTED;
                  setMakeNotListed(typing);
                  setF((p) => ({ ...p, make: typing ? "" : picked }));
                  if (!typing) setWrong((w) => ({ ...w, make: undefined }));
                }}
              />
              {makeNotListed && (
                <TextInput
                  id={`${makeId}-typed`}
                  aria-label="Make not listed"
                  value={f.make}
                  invalid={!!wrong.make}
                  autoFocus
                  onChange={set("make")}
                />
              )}
            </div>
          </Field>
          <Field label="Model">
            <TextInput value={f.model} onChange={set("model")} />
          </Field>
          <Field label="Variant">
            <TextInput value={f.variant} onChange={set("variant")} />
          </Field>
          <Field label="Year">
            <TextInput type="number" inputMode="numeric" value={f.year} onChange={set("year")} />
          </Field>
          <Field label="Colour">
            <TextInput value={f.colour} onChange={set("colour")} />
          </Field>
          <TrayField label="Body type">
            <Tray<BodyType | "">
              options={BODY_OPTIONS}
              value={f.bodyType}
              onChange={(b) => setF((p) => ({ ...p, bodyType: b }))}
              ariaLabel="Body type"
            />
          </TrayField>
        </Section>

        {/* ---- the certificate's specs ---- */}
        <Section label="Specifications">
          <Field label="VIN or chassis">
            <TextInput value={f.vin} autoComplete="off" onChange={set("vin")} />
          </Field>
          {motorised && (
            <Field label="Engine number">
              <TextInput value={f.engineNumber} autoComplete="off" onChange={set("engineNumber")} />
            </Field>
          )}
          {motorised && (
            <Field label="Engine capacity (cc)">
              <TextInput type="number" inputMode="numeric" value={f.engineCapacityCc} onChange={set("engineCapacityCc")} />
            </Field>
          )}
          {motorised && (
            <Field label="Seating">
              <TextInput type="number" inputMode="numeric" value={f.seating} onChange={set("seating")} />
            </Field>
          )}
          <Field label="Tare (kg)">
            <TextInput type="number" inputMode="numeric" value={f.tareKg} onChange={set("tareKg")} />
          </Field>
          <Field label="GVM (kg)">
            <TextInput type="number" inputMode="numeric" value={f.gvmKg} onChange={set("gvmKg")} />
          </Field>
          {!motorised && (
            <Field label="ATM (kg)">
              <TextInput type="number" inputMode="numeric" value={f.atmKg} onChange={set("atmKg")} />
            </Field>
          )}
          <Field label="Rego customer number">
            <TextInput value={f.regoCustomerNo} autoComplete="off" onChange={set("regoCustomerNo")} />
          </Field>
        </Section>

        {/* ---- the first registration, on the way in ---- */}
        {adding && (
          <Section label="Registration">
            <DateBox label="Rego expiry" today={today} value={f.regoExpiry} error={wrong.regoExpiry} onChange={setValue("regoExpiry")} />
            <Field label="Amount paid">
              <TextInput type="number" inputMode="decimal" value={f.regoPaid} onChange={set("regoPaid")} />
            </Field>
            <Field label="Issued by">
              <TextInput value={f.regoIssuer} onChange={set("regoIssuer")} />
            </Field>
            <TrayField label="Term">
              <Tray options={TERMS} value={f.regoTerm as (typeof TERMS)[number]["value"]} onChange={(t) => setF((p) => ({ ...p, regoTerm: t }))} ariaLabel="Term" />
            </TrayField>
          </Section>
        )}

        {/* ---- service cycle ---- */}
        <Section label="Service cycle">
          {/* Asked only of something that has one: a trailer given an odometer
              box gets a zero typed in, which reads as a measurement after. */}
          {motorised && (
            <Field label="Odometer (km)">
              <TextInput type="number" inputMode="numeric" value={f.odometer} onChange={set("odometer")} />
            </Field>
          )}
          {motorised && (
            <Field label="Service interval (km)">
              <TextInput type="number" inputMode="numeric" value={f.intervalKm} onChange={set("intervalKm")} />
            </Field>
          )}
          {motorised && (
            <Field label="Last service odometer (km)">
              <TextInput type="number" inputMode="numeric" value={f.lastServiceOdo} onChange={set("lastServiceOdo")} />
            </Field>
          )}
          <Field label="Service interval (months)">
            <TextInput type="number" inputMode="numeric" value={f.intervalMonths} onChange={set("intervalMonths")} />
          </Field>
          <DateBox label="Last service date" today={today} value={f.lastServiceOn} onChange={setValue("lastServiceOn")} />
        </Section>

        {/* ---- purchase ---- */}
        <Section label="Purchase">
          <DateBox label="Purchase date" today={today} value={f.purchaseDate} onChange={setValue("purchaseDate")} />
          <Field label="Purchase price">
            <TextInput type="number" inputMode="decimal" value={f.purchasePrice} onChange={set("purchasePrice")} />
          </Field>
          <Field label="Book value">
            <TextInput type="number" inputMode="decimal" value={f.value} onChange={set("value")} />
          </Field>
          <Field label="Supplier">
            <TextInput value={f.purchaseSupplier} onChange={set("purchaseSupplier")} />
          </Field>
          <Field label="Invoice number">
            <TextInput value={f.purchaseInvoiceNo} autoComplete="off" onChange={set("purchaseInvoiceNo")} />
          </Field>
          <div className="mk-records-group mk-records-wide" data-scan-in-progress={invoice.state !== "none" ? "" : undefined}>
            <p className="mk-records-label">Invoice</p>
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
              <Paper
                name={invoice.name}
                line={invoice.read ? `${invoice.paper}. Read: ${invoice.read}.` : `${invoice.paper}. Kept with the vehicle.`}
                end={
                  <Button
                    kind="quiet"
                    size={32}
                    onClick={() => {
                      setInvoice({ state: "none" });
                      setInvoiceExtras({});
                    }}
                  >
                    Remove
                  </Button>
                }
              />
            ) : (
              <div className="mk-records-acts">
                <Button kind="second" icon="upload" disabled={invoice.state === "reading"} onClick={() => pickFile(invoiceInput.current)}>
                  {invoice.state === "reading" ? `Reading ${invoice.name}` : "Attach invoice"}
                </Button>
              </div>
            )}
          </div>
        </Section>

        {/* ---- assignment ---- */}
        <Section label="Assignment">
          <TrayField label="Status">
            <Tray options={STATUS_OPTIONS} value={f.status} onChange={(st) => setF((p) => ({ ...p, status: st }))} ariaLabel="Status" />
          </TrayField>
          <Field label={motorised ? "Assigned driver" : "Towed by"} className="mk-records-wide">
            <Chooser options={driverOptions} value={f.assignedTo} placeholder="Pool, unassigned" onChange={setValue("assignedTo")} />
          </Field>
          <Field label="Notes" className="mk-records-wide">
            <TextArea value={f.notes} rows={2} onChange={set("notes")} />
          </Field>
        </Section>

        {refused && (
          <p className="mk-records-res" role="alert">
            <Dot hue="red" />
            {refused}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/* ---- the form's pieces ---- */

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mk-records-sect" aria-label={label}>
      <h3 className="mk-records-h">{label}</h3>
      <div className="mk-records-grid">{children}</div>
    </section>
  );
}

/** A tray across the row, named like a field. */
function TrayField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pt-field mk-records-wide">
      <span className="pt-field-label">{label}</span>
      <div>{children}</div>
    </div>
  );
}

/** A day, picked: never typed (the date field), and clearable. */
function DateBox({
  label,
  value,
  today,
  error,
  onChange,
}: {
  label: string;
  value: string;
  today: string;
  error?: string;
  onChange: (iso: string | null) => void;
}) {
  const id = useId();
  return (
    <Field label={label} id={id} error={error}>
      <DateField id={id} value={value || null} today={today} clearable placeholder="No date" invalid={!!error} onChange={onChange} />
    </Field>
  );
}

/* The reader at work, as the expense claim's is (form 10a): what it is
   reading, and a skeleton shaped like the lines coming. Still, not a loop. */
function Reading({ name }: { name: string }) {
  return (
    <div className="mk-records-drop" role="status">
      <p className="mk-records-drop-what">Reading {name}</p>
      <div className="mk-records-bars" aria-hidden="true">
        <span className="mk-records-bar" />
        <span className="mk-records-bar" />
        <span className="mk-records-bar" />
      </div>
    </div>
  );
}

/** The paper the form holds: its name, what it is and what became of it. */
function Paper({ name, line, end }: { name: string; line: string; end: ReactNode }) {
  return (
    <div className="mk-records-file">
      <span className="mk-records-file-icon" aria-hidden="true">
        <Icon name="file" size={16} />
      </span>
      <span className="mk-records-file-text">
        <span className="mk-records-file-name">
          <Fade>{name}</Fade>
        </span>
        <span className="mk-records-file-line">{line}</span>
      </span>
      {end}
    </div>
  );
}
