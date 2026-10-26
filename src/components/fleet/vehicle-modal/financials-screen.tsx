"use client";

import { useRef, useState } from "react";
import type { FinanceInput } from "@/app/actions/fleet";
import { readFinanceAgreement, type ReadFinanceResult } from "@/app/actions/fleet-ai";
import type { StoredDocument } from "@/lib/documents/query";
import { uploadFile } from "@/lib/documents/upload-client";
import { dateFromDays } from "@/lib/fleet/map";
import { Button } from "@/components/parts/button";
import { Field, TextInput } from "@/components/parts/field";
import { Chooser } from "@/components/parts/chooser";
import { Plate } from "../plate";
import { VehicleLead } from "./event-row";
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
import { DocRows } from "@/components/record-modal/doc-rows";
import {
  DateIn,
  DetailGrid,
  FrameFoot,
  FrameTitle,
  Group,
  HistoryRow,
  Nothing,
  RecordError,
  type DetailItem,
} from "@/components/record-modal/parts";
import { ScanCard, type ScanMode } from "@/components/record-modal/scan-card";

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
  return [when, how].filter(Boolean).join(", ");
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
  backWord = "Back",
  onBack,
  onSaveVehicle,
  onRecordFinance,
  onRecorded,
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
  /** "Close" when the screen was opened on its own, from the vehicle's page. */
  backWord?: string;
  onBack: () => void;
  /** The purchase fields and the book value are the vehicle's own columns. */
  onSaveVehicle: (v: Vehicle) => void;
  /** Resolves to whether the agreement landed. */
  onRecordFinance: (input: Omit<FinanceInput, "vehicleId">) => Promise<boolean> | void;
  /** Where to go once it has. On a refusal the screen stays, typing intact,
      the reason above the fields. */
  onRecorded: () => void;
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

  const saveFinance = async () => {
    if (!canSave) return;
    const ok = await onRecordFinance({
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
    if (ok !== false) onRecorded();
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

  const showFields = panelOpen && (mode === "scanned" || mode === "manual");
  const money = (label: string, value: string, onChange: (v: string) => void, placeholder?: string) => (
    <Field label={`${label} ($)`}>
      <TextInput inputMode="decimal" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );

  return (
    <>
      <FrameTitle>Financials</FrameTitle>
      <VehicleLead name={displayName(vehicle)} plate={<Plate plate={vehicle.plate} state={vehicle.plateState} size="sm" />} />
      {error && <RecordError>{error}</RecordError>}

      {/* ---- value: Tiff's estimate, and the book value beside it ---- */}
      <Group
        name={valuation ? "Tiff value" : "Value"}
        action={
          !editingValue && (
            <Button
              kind="quiet"
              size={32}
              onClick={() => {
                setValueDraft(String(vehicle.value));
                setEditingValue(true);
              }}
            >
              Edit book value
            </Button>
          )
        }
      >
        <div className="rcw-value">
          <div className="rcw-value-l">
            {valuation ? (
              <>
                <span className={`rcw-fig${valuationIsStale ? " rcw-fig--stale" : ""}`}>{fmtMoney(valuation.point)}</span>
                <span className="rcw-value-line">
                  {fmtMoney(valuation.low)}–{fmtMoney(valuation.high)}
                </span>
                <ul className="rcw-value-notes">
                  {notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                <span className="rcw-value-line">Estimate only. Does not account for modifications, accessories or condition.</span>
              </>
            ) : (
              <>
                <span className="rcw-fig">{fmtMoney(vehicle.value)}</span>
                <span className="rcw-value-line">Book value, as entered. Run “Value with Tiff” in the register for a market estimate.</span>
              </>
            )}
          </div>
          <div className="rcw-value-r">
            {editingValue ? (
              <>
                <Field label="Book value ($)">
                  <TextInput inputMode="decimal" placeholder={String(vehicle.value)} value={valueDraft} onChange={(e) => setValueDraft(e.target.value)} />
                </Field>
                <div className="rcw-acts">
                  <Button kind="quiet" size={32} onClick={() => setEditingValue(false)}>
                    Cancel
                  </Button>
                  <Button kind="second" size={32} onClick={saveValue}>
                    Save book value
                  </Button>
                </div>
              </>
            ) : (
              <DetailGrid
                items={[{ label: "Book value", value: valuation ? fmtMoney(vehicle.value) : "Used in the fleet total" }]}
              />
            )}
          </div>
        </div>
      </Group>

      {/* ---- the purchase, as the invoice prints it ---- */}
      <Group
        name="Purchase"
        action={
          !editingPurchase && (
            <Button
              kind="quiet"
              size={32}
              onClick={() => {
                setP(purchaseFields(vehicle, today));
                setEditingPurchase(true);
              }}
            >
              Edit purchase
            </Button>
          )
        }
      >
        {editingPurchase ? (
          <>
            <div className="mk-records-grid">
              <Field label="Supplier">
                <TextInput placeholder="Dealer or seller" value={p.supplier} onChange={(e) => setP1("supplier")(e.target.value)} />
              </Field>
              <Field label="Invoice no.">
                <TextInput value={p.invoiceNo} onChange={(e) => setP1("invoiceNo")(e.target.value)} />
              </Field>
              <DateIn label="Purchase date" today={today} value={p.date} onChange={setP1("date")} />
              {money("Price ex GST", p.exGst, setP1("exGst"))}
              {money("GST", p.gst, setP1("gst"))}
              {money("On-road costs", p.onRoad, setP1("onRoad"))}
              {money("Total price", p.total, setP1("total"), "What you paid")}
              {money(current ? "Deposit paid" : "Paid up front", p.deposit, setP1("deposit"))}
              <Field label="Odometer at purchase (km)">
                <TextInput inputMode="numeric" value={p.odometer} onChange={(e) => setP1("odometer")(e.target.value)} />
              </Field>
            </div>
            <div className="rcw-acts">
              <Button kind="quiet" size={32} onClick={() => setEditingPurchase(false)}>
                Cancel
              </Button>
              <Button kind="second" size={32} onClick={savePurchase} disabled={pending}>
                Save purchase
              </Button>
            </div>
          </>
        ) : (
          <DetailGrid items={toItems(purchaseRows(vehicle, today, current))} />
        )}
      </Group>

      <Group
        name="Invoices"
        action={
          <>
            <Button kind="second" size={32} onClick={() => invoiceInput.current?.click()}>
              Add invoice
            </Button>
            <input
              ref={invoiceInput}
              type="file"
              accept="image/*,application/pdf"
              aria-label="Add invoice"
              hidden
              onChange={attach("purchase_invoice")}
            />
          </>
        }
      >
        <DocRows
          docs={invoices}
          openId={openDoc}
          onOpen={(id) => {
            setOpenDoc(id);
            if (id) setOpenHist(null);
          }}
          emptyText="No invoice filed yet."
        />
      </Group>

      {/* ---- finance: the agreement in force, or the absence of one ---- */}
      {current ? (
        <>
          <Group
            name="Finance agreement"
            aside={addedText(current)}
            action={
              !panelOpen && (
                <Button kind="quiet" size={32} onClick={() => setPanelOpen(true)}>
                  Replace agreement
                </Button>
              )
            }
          >
            <DetailGrid items={toItems(financeRows(current))} />
          </Group>

          {position && (
            <Group name="Estimated position">
              <div
                className="rcw-meter"
                role="progressbar"
                aria-label="Repayments fallen due"
                aria-valuemin={0}
                aria-valuemax={position.total}
                aria-valuenow={position.made}
              >
                <span style={{ width: `${Math.round(position.progress * 100)}%` }} />
              </div>
              {/* FALLEN DUE, not made. Nothing here tracks a payment — the
                  line under it says so — and "Payments to date" read as
                  "payments you have made", which contradicted it. */}
              <DetailGrid
                items={[
                  { label: "Fallen due", value: `${position.made} of ${position.total}` },
                  { label: "Still to fall due", value: String(position.remaining) },
                  {
                    label: "Indicative payout",
                    value: position.payout != null ? fmtMoney(position.payout) : "—",
                    tone: position.payout != null ? undefined : "faint",
                  },
                ]}
              />
              <p className="mk-records-sub">
                {`This is the schedule, not a payment record: confirm the payout figure with ${current.lender} before you sell or trade.`}
              </p>
            </Group>
          )}

          <Group
            name="Agreement documents"
            action={
              <>
                <Button kind="second" size={32} onClick={() => agreementInput.current?.click()}>
                  Add document
                </Button>
                <input
                  ref={agreementInput}
                  type="file"
                  accept="image/*,application/pdf"
                  aria-label="Add agreement document"
                  hidden
                  onChange={attach("finance_agreement")}
                />
              </>
            }
          >
            <DocRows
              docs={financeDocuments(documents, current)}
              openId={openDoc}
              onOpen={(id) => {
                setOpenDoc(id);
                if (id) setOpenHist(null);
              }}
              emptyText="No paperwork filed under this agreement yet."
            />
          </Group>
        </>
      ) : (
        !panelOpen && (
          <Group
            name="Finance"
            action={
              <Button kind="second" size={32} onClick={() => setPanelOpen(true)}>
                Add finance agreement
              </Button>
            }
          >
            <Nothing>No finance agreement recorded</Nothing>
          </Group>
        )
      )}

      {panelOpen && (
        <ScanCard<ReadFinanceResult>
          heading={current ? "Replace agreement" : "Add finance agreement"}
          prompt="Scan or upload the finance agreement"
          paper="the agreement"
          attachLabel="Attach the agreement"
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
          <div className="mk-records-grid">
            <Field label="Lender">
              <TextInput placeholder="Macquarie Leasing" value={f.lender} onChange={(e) => set("lender")(e.target.value)} />
            </Field>
            <Field label="Agreement no.">
              <TextInput value={f.agreementNo} onChange={(e) => set("agreementNo")(e.target.value)} />
            </Field>
            <Field label="Agreement type">
              <Chooser
                options={[{ value: "", label: "Not stated" }, ...FINANCE_KINDS.map((k) => ({ value: k, label: FINANCE_KIND_LABEL[k] }))]}
                value={f.kind}
                onChange={(v) => setF((prev) => ({ ...prev, kind: v as FinanceKind | "" }))}
              />
            </Field>
            <DateIn label="Agreement start" today={today} value={f.startsOn} onChange={set("startsOn")} />
            <Field label="Term">
              <Chooser
                options={termOptions.map((t) => ({ value: String(t), label: `${t} months` }))}
                value={f.termMonths || null}
                onChange={set("termMonths")}
              />
            </Field>
            {money("Repayment", f.repayment, set("repayment"), "742")}
            <Field label="Repayment frequency">
              <Chooser
                options={PAYMENT_FREQUENCIES.map((q) => ({ value: q, label: PAYMENT_FREQUENCY_LABEL[q] }))}
                value={f.frequency}
                onChange={(v) => setF((prev) => ({ ...prev, frequency: v as PaymentFrequency }))}
              />
            </Field>
            <Field label="Interest rate (% a year)">
              <TextInput inputMode="decimal" placeholder="7.45" value={f.ratePct} onChange={(e) => set("ratePct")(e.target.value)} />
            </Field>
            {money("Balloon", f.balloon, set("balloon"))}
            {money("Amount financed", f.amountFinanced, set("amountFinanced"))}
          </div>
        </ScanCard>
      )}

      {previous.length > 0 && (
        <Group name="Previous agreements">
          {previous.map((agreement) => {
            const expanded = openHist === agreement.id;
            const docs = financeDocuments(documents, agreement);
            return (
              <HistoryRow
                key={agreement.id}
                name={`${agreement.lender}${agreement.kind ? `, ${FINANCE_KIND_LABEL[agreement.kind]}` : ""}`}
                line={docs.length === 1 ? "1 document" : `${docs.length} documents`}
                aside={[repaymentLabel(agreement), `${fmtDay(agreement.startsOn)} – ${fmtDay(financeEndsOn(agreement))}`]}
                open={expanded}
                onToggle={() => {
                  setOpenHist(expanded ? null : agreement.id);
                  setOpenDoc(null);
                }}
              >
                <DetailGrid dense items={toItems(financeRows(agreement))} />
                <DocRows docs={docs} openId={openDoc} onOpen={setOpenDoc} emptyText="No paperwork filed." />
              </HistoryRow>
            );
          })}
        </Group>
      )}

      {/* ---- cost to run: actuals, never a forecast ---- */}
      <Group name={`Cost to run, since ${fmtDay(costs.sinceIso)}`}>
        <DetailGrid
          cols={4}
          items={[
            ...costs.items.map((i) => ({
              label: i.label,
              value: i.value != null ? fmtMoney(i.value) : "—",
              tone: i.value != null ? undefined : ("faint" as const),
            })),
            {
              label: "Total",
              value: costs.known > 0 ? fmtMoney(costs.total) : "—",
              tone: costs.known > 0 ? undefined : ("faint" as const),
            },
          ]}
        />
        <p className="mk-records-sub">
          {costs.known === 0
            ? "Nothing logged yet"
            : costs.perKm != null
              ? `${fmtCost(costs.perKm)} per km over ${fmtKm(costs.kmDriven ?? 0)} km`
              : `${costs.known} of ${costs.items.length} categories known`}
        </p>
      </Group>

      <FrameFoot>
        <Button kind="quiet" onClick={onBack}>
          {backWord}
        </Button>
        {showFields && (
          <Button kind="main" onClick={() => void saveFinance()} disabled={!canSave || pending}>
            {pending ? "Saving the agreement" : current ? "Replace agreement" : "Add agreement"}
          </Button>
        )}
      </FrameFoot>
    </>
  );
}
