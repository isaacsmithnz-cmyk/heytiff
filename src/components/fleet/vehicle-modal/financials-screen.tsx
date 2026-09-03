"use client";

import { useRef, useState } from "react";
import type { FinanceInput } from "@/app/actions/fleet";
import { readFinanceAgreement, type ReadFinanceResult } from "@/app/actions/fleet-ai";
import type { StoredDocument } from "@/lib/documents/query";
import { uploadFile } from "@/lib/documents/upload-client";
import { dateFromDays } from "@/lib/fleet/map";
import { DateField } from "@/components/ui/date-field";
import { Icon } from "@/components/shell/icon";
import { Plate } from "../plate";
import {
  FINANCE_KINDS,
  FINANCE_KIND_LABEL,
  PAYMENT_FREQUENCIES,
  PAYMENT_FREQUENCY_LABEL,
  daysUntil,
  displayName,
  fmtCost,
  fmtKm,
  fmtMoney,
  type AiValuation,
  type FinanceKind,
  type PaymentFrequency,
  type Vehicle,
  type VehicleFinance,
  type VehicleLog,
  type VehiclePolicy,
} from "../logic";
import {
  costToRun,
  currentFinance,
  financeDocuments,
  financeEndsOn,
  financePosition,
  financeRows,
  fmtDay,
  previousFinance,
  purchaseRows,
  repaymentLabel,
  valueNotes,
  type FactRow,
} from "./derive";
import { DocRows } from "./doc-rows";
import { Btn, Card, DetailGrid, Eyebrow, Field, Inline, MoneyInput, SubHeader, type DetailItem } from "./parts";
import { ScanCard, type ScanMode } from "./scan-card";

/* The Financials screen: what the vehicle is worth, what it cost, what is owed
   on it, and what it costs to keep on the road.

   Four things the design's prototype showed that this one deliberately does
   not: a loading shimmer for a valuation that "arrives" (Tiff's value is
   whatever the register last ran, or nothing); an "Owned outright" claim
   where no agreement is recorded (an absent record is an absent record); a
   full-year forecast of running costs (the figures here are what was logged
   and what the policies in force cost, per year); and a payout figure without
   its caveat. The estimated position IS shown — it is arithmetic on the
   schedule the agreement states — and it says so, and sends you to the lender.

   Two kinds of edit live here rather than in Edit vehicle: the purchase as
   the invoice prints it, and the book value. Both are the vehicle's own
   columns, saved through the same action the form uses. */

type FinFields = {
  lender: string;
  agreementNo: string;
  kind: FinanceKind | "";
  startsOn: string;
  termMonths: string;
  repayment: string;
  frequency: PaymentFrequency;
  ratePct: string;
  balloon: string;
  amountFinanced: string;
};

const EMPTY_FIN: FinFields = {
  lender: "",
  agreementNo: "",
  kind: "",
  startsOn: "",
  termMonths: "60",
  repayment: "",
  frequency: "monthly",
  ratePct: "",
  balloon: "",
  amountFinanced: "",
};

/** The terms lenders actually write. A read that says 42 is offered as 42. */
const TERMS = [12, 24, 36, 48, 60, 72, 84];

type PurchaseFields = {
  supplier: string;
  invoiceNo: string;
  date: string;
  exGst: string;
  gst: string;
  onRoad: string;
  total: string;
  deposit: string;
  odometer: string;
};

const s = (v: number | string | null | undefined): string => (v == null || v === 0 ? "" : String(v));

function purchaseFields(v: Vehicle, today: string): PurchaseFields {
  return {
    supplier: v.purchaseSupplier ?? "",
    invoiceNo: v.purchaseInvoiceNo ?? "",
    date: v.purchaseDateDays ? dateFromDays(-v.purchaseDateDays, today) : "",
    exGst: s(v.purchaseExGst),
    gst: s(v.purchaseGst),
    onRoad: s(v.purchaseOnRoad),
    total: s(v.purchasePrice),
    deposit: s(v.purchaseDeposit),
    odometer: s(v.purchaseOdometer),
  };
}

/** A typed figure, or null for blank and for anything that isn't a number. */
const num = (str: string): number | null => {
  if (!str.trim()) return null;
  const n = Number(str.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const toItems = (rows: FactRow[]): DetailItem[] =>
  rows.map((r) => ({ label: r.label, value: r.value, tone: r.faint ? "faint" : undefined }));

function addedText(f: VehicleFinance): string {
  const when = f.createdAt ? `Added ${fmtDay(f.createdAt)}` : "";
  const how = f.source === "scan" ? "scanned from the agreement" : f.source === "manual" ? "entered manually" : "";
  return [when, how].filter(Boolean).join(" · ");
}

export function FinancialsScreen({
  vehicle,
  today,
  valuation,
  valuationIsStale = false,
  documents,
  policies,
  logs,
  finance,
  pending,
  error,
  onBack,
  onSaveVehicle,
  onRecordFinance,
  onAttachFinance,
  onAttachInvoice,
}: {
  vehicle: Vehicle;
  today: string;
  valuation?: AiValuation;
  valuationIsStale?: boolean;
  documents: StoredDocument[];
  policies: VehiclePolicy[];
  logs: VehicleLog[];
  finance: VehicleFinance[];
  pending: boolean;
  error: string | null;
  onBack: () => void;
  /** The purchase fields and the book value are the vehicle's own columns. */
  onSaveVehicle: (v: Vehicle) => void;
  onRecordFinance: (input: Omit<FinanceInput, "vehicleId">) => void;
  onAttachFinance: (financeId: string, documentId: string) => void;
  onAttachInvoice: (documentId: string) => void;
}) {
  const current = currentFinance(finance);
  const previous = previousFinance(finance);
  const position = current ? financePosition(current, today) : null;
  const costs = costToRun(vehicle, logs, policies, finance, today);
  const notes = valueNotes(valuation, vehicle, valuationIsStale);
  const invoices = documents.filter((d) => d.kind === "purchase_invoice");

  const [panelOpen, setPanelOpen] = useState(false);
  const [mode, setMode] = useState<ScanMode>("idle");
  const [f, setF] = useState<FinFields>(EMPTY_FIN);
  const [docId, setDocId] = useState<string | null>(null);
  const [editingPurchase, setEditingPurchase] = useState(false);
  const [p, setP] = useState<PurchaseFields>(() => purchaseFields(vehicle, today));
  const [editingValue, setEditingValue] = useState(false);
  const [valueDraft, setValueDraft] = useState("");
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [openHist, setOpenHist] = useState<string | null>(null);
  const invoiceInput = useRef<HTMLInputElement>(null);
  const agreementInput = useRef<HTMLInputElement>(null);

  const set = (k: keyof FinFields) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const setP1 = (k: keyof PurchaseFields) => (v: string) => setP((prev) => ({ ...prev, [k]: v }));

  /* ---- the record panel ---- */

  const fill = (r: ReadFinanceResult) => {
    if (!r.ok) return;
    setF((prev) => ({
      lender: r.lender ?? prev.lender,
      agreementNo: r.agreementNo ?? prev.agreementNo,
      kind: r.kind ?? prev.kind,
      startsOn: r.startsOn ?? prev.startsOn,
      termMonths: r.termMonths != null ? String(r.termMonths) : prev.termMonths,
      repayment: r.repayment != null ? String(r.repayment) : prev.repayment,
      frequency: r.frequency ?? prev.frequency,
      ratePct: r.ratePct != null ? String(r.ratePct) : prev.ratePct,
      balloon: r.balloon != null ? String(r.balloon) : prev.balloon,
      amountFinanced: r.amountFinanced != null ? String(r.amountFinanced) : prev.amountFinanced,
    }));
  };

  const closePanel = () => {
    setPanelOpen(false);
    setMode("idle");
    setF(EMPTY_FIN);
    setDocId(null);
  };

  const termN = Math.round(Number(f.termMonths));
  const termOptions = Number.isFinite(termN) && termN > 0 && !TERMS.includes(termN) ? [...TERMS, termN].sort((a, b) => a - b) : TERMS;
  const canSave = f.lender.trim() !== "" && f.startsOn !== "" && Number.isFinite(termN) && termN > 0;

  const saveFinance = () => {
    if (!canSave) return;
    onRecordFinance({
      lender: f.lender.trim(),
      agreementNo: f.agreementNo.trim() || null,
      kind: f.kind || null,
      startsOn: f.startsOn,
      termMonths: termN,
      repayment: num(f.repayment),
      frequency: f.frequency,
      ratePct: num(f.ratePct),
      balloon: num(f.balloon),
      amountFinanced: num(f.amountFinanced),
      documentId: docId ?? undefined,
      source: mode === "scanned" ? "scan" : "manual",
    });
  };

  /* ---- the purchase, edited in place ---- */

  const savePurchase = () => {
    const odo = num(p.odometer);
    onSaveVehicle({
      ...vehicle,
      purchaseSupplier: p.supplier.trim() || null,
      purchaseInvoiceNo: p.invoiceNo.trim() || null,
      purchaseDateDays: p.date ? Math.max(0, -daysUntil(p.date, today)) : 0,
      purchaseExGst: num(p.exGst),
      purchaseGst: num(p.gst),
      purchaseOnRoad: num(p.onRoad),
      purchasePrice: num(p.total) ?? 0,
      purchaseDeposit: num(p.deposit),
      purchaseOdometer: odo == null ? null : Math.round(odo),
    });
    setEditingPurchase(false);
  };

  const saveValue = () => {
    const n = num(valueDraft);
    if (n != null) onSaveVehicle({ ...vehicle, value: Math.round(n) });
    setEditingValue(false);
  };

  const attach = (kind: "purchase_invoice" | "finance_agreement") => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const up = await uploadFile(file, kind).catch(() => null);
    if (!up?.ok) return;
    if (kind === "purchase_invoice") onAttachInvoice(up.file.documentId);
    else if (current) onAttachFinance(current.id, up.file.documentId);
  };

  const costCaption = [
    `Fuel and servicing as logged since ${fmtDay(costs.sinceIso)}`,
    "rego, green slip and insurance from the policies in force, per year",
    current ? "finance at the agreement’s own schedule" : null,
  ]
    .filter(Boolean)
    .join("; ");

  return (
    <>
      <SubHeader
        eyebrow={displayName(vehicle)}
        title="Financials"
        onBack={onBack}
        right={<Plate plate={vehicle.plate} state={vehicle.plateState} size="sm" />}
      />

      <div className="vm-body">
        {error && <div className="vm-err">{error}</div>}

        {/* ---- value: Tiff's estimate, and the book value beside it ---- */}
        <div className={`vm-value${valuation ? "" : " plain"}`}>
          <div className="vm-valuel">
            <Eyebrow tone={valuation ? "accent" : undefined}>{valuation ? "TIFF VALUE" : "VALUE"}</Eyebrow>
            {valuation ? (
              <>
                <span className={`vm-valuefig${valuationIsStale ? " stale" : ""}`}>{fmtMoney(valuation.point)}</span>
                <span className="vm-valuerange">
                  {fmtMoney(valuation.low)}–{fmtMoney(valuation.high)}
                </span>
                <ul className="vm-notes">
                  {notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                <span className="vm-valuefoot">Estimate only. Does not account for modifications, accessories or condition.</span>
              </>
            ) : (
              <>
                <span className="vm-valuefig">{fmtMoney(vehicle.value)}</span>
                <span className="vm-valuerange">Book value, as entered. Run “Value with Tiff” in the register for a market estimate.</span>
              </>
            )}
          </div>
          <div className="vm-book">
            <span className="vm-fl">BOOK VALUE</span>
            {editingValue ? (
              <>
                <MoneyInput value={valueDraft} onChange={setValueDraft} ariaLabel="Book value" placeholder={String(vehicle.value)} />
                <div className="vm-bookacts">
                  <Inline onClick={saveValue}>Save</Inline>
                  <Inline muted onClick={() => setEditingValue(false)}>
                    Cancel
                  </Inline>
                </div>
              </>
            ) : (
              <>
                {valuation && <b>{fmtMoney(vehicle.value)}</b>}
                <em>Manual · what the fleet total adds up</em>
                <Inline
                  onClick={() => {
                    setValueDraft(String(vehicle.value));
                    setEditingValue(true);
                  }}
                >
                  Edit
                </Inline>
              </>
            )}
          </div>
        </div>

        {/* ---- the purchase, as the invoice prints it ---- */}
        <Card>
          <div className="vm-cardhead">
            <Eyebrow>PURCHASE</Eyebrow>
            {!editingPurchase && (
              <Inline
                onClick={() => {
                  setP(purchaseFields(vehicle, today));
                  setEditingPurchase(true);
                }}
              >
                Edit
              </Inline>
            )}
          </div>
          {editingPurchase ? (
            <>
              <div className="vm-fields">
                <Field label="Supplier">
                  <input className="vm-input" placeholder="Dealer or seller" value={p.supplier} onChange={(e) => setP1("supplier")(e.target.value)} />
                </Field>
                <Field label="Invoice no.">
                  <input className="vm-input" value={p.invoiceNo} onChange={(e) => setP1("invoiceNo")(e.target.value)} />
                </Field>
                <Field label="Date">
                  <DateField size="lg" clearable today={today} value={p.date || null} onChange={(iso) => setP1("date")(iso ?? "")} aria-label="Purchase date" />
                </Field>
                <Field label="Price ex GST">
                  <MoneyInput value={p.exGst} onChange={setP1("exGst")} ariaLabel="Price ex GST" />
                </Field>
                <Field label="GST">
                  <MoneyInput value={p.gst} onChange={setP1("gst")} ariaLabel="GST" />
                </Field>
                <Field label="On-road costs">
                  <MoneyInput value={p.onRoad} onChange={setP1("onRoad")} ariaLabel="On-road costs" />
                </Field>
                <Field label="Total price" req>
                  <MoneyInput value={p.total} onChange={setP1("total")} ariaLabel="Total price" placeholder="What you paid" />
                </Field>
                <Field label={current ? "Deposit paid" : "Paid up front"}>
                  <MoneyInput value={p.deposit} onChange={setP1("deposit")} ariaLabel="Deposit paid" />
                </Field>
                <Field label="Odometer at purchase">
                  <input className="vm-input" inputMode="numeric" placeholder="km" value={p.odometer} onChange={(e) => setP1("odometer")(e.target.value)} />
                </Field>
              </div>
              <div className="vm-acts">
                <Btn kind="outline" onClick={() => setEditingPurchase(false)}>
                  Cancel
                </Btn>
                <Btn kind="primary" onClick={savePurchase} disabled={pending}>
                  Save purchase
                </Btn>
              </div>
            </>
          ) : (
            <DetailGrid items={toItems(purchaseRows(vehicle, today, current))} />
          )}
          <div className="vm-divider">
            <Eyebrow>INVOICES</Eyebrow>
            <Inline onClick={() => invoiceInput.current?.click()}>Add document</Inline>
            <input
              ref={invoiceInput}
              type="file"
              accept="image/*,application/pdf"
              aria-label="Add invoice"
              hidden
              onChange={attach("purchase_invoice")}
            />
          </div>
          <DocRows
            docs={invoices}
            openId={openDoc}
            onOpen={(id) => {
              setOpenDoc(id);
              if (id) setOpenHist(null);
            }}
            emptyText="No invoice filed yet."
          />
        </Card>

        {/* ---- finance: the agreement in force, or the absence of one ---- */}
        {current ? (
          <Card>
            <div className="vm-cardhead">
              <Eyebrow>FINANCE AGREEMENT</Eyebrow>
              <span className="vm-recordtools">
                <span className="vm-added">{addedText(current)}</span>
                {!panelOpen && <Inline onClick={() => setPanelOpen(true)}>Update</Inline>}
              </span>
            </div>
            <DetailGrid items={toItems(financeRows(current))} />

            {position && (
              <div className="vm-position">
                <div className="vm-poshead">
                  <Eyebrow tone="accent">ESTIMATED POSITION</Eyebrow>
                  <span className="vm-caption">Assumes every payment made as scheduled</span>
                </div>
                <div
                  className="vm-progress"
                  role="progressbar"
                  aria-label="Repayments fallen due"
                  aria-valuemin={0}
                  aria-valuemax={position.total}
                  aria-valuenow={position.made}
                >
                  <span style={{ width: `${Math.round(position.progress * 100)}%` }} />
                </div>
                <div className="vm-posgrid">
                  <div>
                    <span className="vm-fl">PAYMENTS TO DATE</span>
                    <b>
                      {position.made} of {position.total}
                    </b>
                  </div>
                  <div>
                    <span className="vm-fl">REMAINING ON SCHEDULE</span>
                    <b>{position.remaining}</b>
                  </div>
                  <div>
                    <span className="vm-fl">INDICATIVE PAYOUT</span>
                    {position.payout != null ? <b>~{fmtMoney(position.payout)}</b> : <b className="faint">—</b>}
                  </div>
                </div>
                <div className="vm-posnote">
                  Payments aren’t tracked here — confirm the payout figure with {current.lender} before you sell or trade.
                </div>
              </div>
            )}

            <div className="vm-divider">
              <Eyebrow>DOCUMENTS</Eyebrow>
              <Inline onClick={() => agreementInput.current?.click()}>Add document</Inline>
              <input
                ref={agreementInput}
                type="file"
                accept="image/*,application/pdf"
                aria-label="Add agreement document"
                hidden
                onChange={attach("finance_agreement")}
              />
            </div>
            <DocRows
              docs={financeDocuments(documents, current)}
              openId={openDoc}
              onOpen={(id) => {
                setOpenDoc(id);
                if (id) setOpenHist(null);
              }}
              emptyText="No paperwork filed under this agreement yet."
            />
          </Card>
        ) : (
          !panelOpen && (
            <Card>
              <div className="vm-nofin">
                <div className="vm-statusl">
                  <Eyebrow>FINANCE</Eyebrow>
                  <span className="vm-headline">No finance agreement recorded</span>
                  <span className="vm-subline">
                    If the vehicle is financed, scan the agreement or enter it below. Owned outright? There’s nothing to add.
                  </span>
                </div>
                <Btn kind="outline" onClick={() => setPanelOpen(true)}>
                  Add finance agreement
                </Btn>
              </div>
            </Card>
          )
        )}

        {panelOpen && (
          <ScanCard<ReadFinanceResult>
            heading={current ? "RECORD NEW AGREEMENT" : "RECORD FINANCE AGREEMENT"}
            prompt="Scan or upload the finance agreement"
            hint="Lender, repayments, term, rate and balloon are read from the document. PDF, JPG or photo."
            attachLabel="Optional: attach the agreement"
            docKind="finance_agreement"
            read={(b64, mt) => readFinanceAgreement(b64, mt)}
            onRead={(r, id) => {
              fill(r);
              setDocId(id);
            }}
            onAttached={(id) => setDocId(id)}
            onCancel={closePanel}
            mode={mode}
            onMode={(m) => {
              setMode(m);
              if (m === "idle") {
                setF(EMPTY_FIN);
                setDocId(null);
              }
            }}
          >
            <div className="vm-fields">
              <Field label="Lender" req>
                <input className="vm-input" placeholder="e.g. Macquarie Leasing" value={f.lender} onChange={(e) => set("lender")(e.target.value)} />
              </Field>
              <Field label="Agreement no.">
                <input className="vm-input" value={f.agreementNo} onChange={(e) => set("agreementNo")(e.target.value)} />
              </Field>
              <Field label="Type">
                <select
                  className="vm-input"
                  aria-label="Agreement type"
                  value={f.kind}
                  onChange={(e) => setF((prev) => ({ ...prev, kind: e.target.value as FinanceKind | "" }))}
                >
                  <option value="">Not stated</option>
                  {FINANCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {FINANCE_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Start" req>
                <DateField size="lg" clearable today={today} value={f.startsOn || null} onChange={(iso) => set("startsOn")(iso ?? "")} aria-label="Agreement start" />
              </Field>
              <Field label="Term" req>
                <select className="vm-input" aria-label="Term" value={f.termMonths} onChange={(e) => set("termMonths")(e.target.value)}>
                  {termOptions.map((t) => (
                    <option key={t} value={String(t)}>
                      {t} months
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Repayment">
                <MoneyInput value={f.repayment} onChange={set("repayment")} placeholder="742" ariaLabel="Repayment" />
              </Field>
              <Field label="Frequency">
                <select
                  className="vm-input"
                  aria-label="Repayment frequency"
                  value={f.frequency}
                  onChange={(e) => setF((prev) => ({ ...prev, frequency: e.target.value as PaymentFrequency }))}
                >
                  {PAYMENT_FREQUENCIES.map((q) => (
                    <option key={q} value={q}>
                      {PAYMENT_FREQUENCY_LABEL[q]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Rate (p.a.)">
                <span className="vm-pct-in">
                  <input inputMode="decimal" placeholder="7.45" aria-label="Interest rate" value={f.ratePct} onChange={(e) => set("ratePct")(e.target.value)} />
                  <span>%</span>
                </span>
              </Field>
              <Field label="Balloon">
                <MoneyInput value={f.balloon} onChange={set("balloon")} ariaLabel="Balloon" />
              </Field>
              <Field label="Amount financed">
                <MoneyInput value={f.amountFinanced} onChange={set("amountFinanced")} ariaLabel="Amount financed" />
              </Field>
            </div>
            <div className="vm-acts">
              <Btn kind="primary" onClick={saveFinance} disabled={!canSave || pending}>
                {pending ? "Saving…" : "Save agreement"}
              </Btn>
            </div>
          </ScanCard>
        )}

        {previous.length > 0 && (
          <Card className="vm-histcard">
            <div className="vm-cardhead">
              <Eyebrow>PREVIOUS AGREEMENTS</Eyebrow>
            </div>
            {previous.map((agreement) => {
              const expanded = openHist === agreement.id;
              const docs = financeDocuments(documents, agreement);
              const repayment = repaymentLabel(agreement);
              return (
                <div key={agreement.id} className="vm-hist">
                  <button
                    type="button"
                    className="vm-histrow"
                    aria-expanded={expanded}
                    onClick={() => {
                      setOpenHist(expanded ? null : agreement.id);
                      setOpenDoc(null);
                    }}
                  >
                    <span className="vm-docl">
                      <b>
                        {agreement.lender}
                        {agreement.kind ? ` · ${FINANCE_KIND_LABEL[agreement.kind]}` : ""}
                      </b>
                      <em>{docs.length === 1 ? "1 document" : `${docs.length} documents`}</em>
                    </span>
                    <span className="vm-histr">
                      {repayment && <span>{repayment}</span>}
                      <span className="vm-evdate">
                        {fmtDay(agreement.startsOn)} – {fmtDay(financeEndsOn(agreement))}
                      </span>
                      <Icon name={expanded ? "chevU" : "chevR"} size={14} />
                    </span>
                  </button>
                  {expanded && (
                    <div className="vm-histbody">
                      <div className="vm-inset">
                        <DetailGrid dense items={toItems(financeRows(agreement))} />
                      </div>
                      <span className="vm-fl">DOCUMENTS</span>
                      <DocRows docs={docs} openId={openDoc} onOpen={setOpenDoc} emptyText="No paperwork filed." />
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        )}

        {/* ---- cost to run: actuals, never a forecast ---- */}
        <Card>
          <div className="vm-cardhead">
            <Eyebrow>COST TO RUN · LAST 12 MONTHS</Eyebrow>
          </div>
          <span className="vm-caption">{costCaption}.</span>
          <div className="vm-costrow">
            <div className="vm-costgrid">
              {costs.items.map((i) => (
                <div key={i.key}>
                  <span className="vm-fl">{i.label}</span>
                  {i.value != null ? <b>{fmtMoney(i.value)}</b> : <b className="faint">—</b>}
                </div>
              ))}
            </div>
            <div className="vm-total">
              <span className="vm-fl">TOTAL</span>
              <b>{costs.known > 0 ? fmtMoney(costs.total) : "—"}</b>
              <em>
                {costs.known === 0
                  ? "Nothing logged yet"
                  : costs.perKm != null
                    ? `${fmtCost(costs.perKm)} per km over ${fmtKm(costs.kmDriven ?? 0)} km`
                    : `${costs.known} of ${costs.items.length} categories known`}
              </em>
            </div>
          </div>
        </Card>
      </div>

      <div className="vm-foot">
        <Btn kind="outline" onClick={onBack}>
          Cancel
        </Btn>
      </div>
    </>
  );
}
