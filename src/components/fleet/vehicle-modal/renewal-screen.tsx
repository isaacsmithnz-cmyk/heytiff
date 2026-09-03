"use client";

import { useRef, useState } from "react";
import type { RenewalInput } from "@/app/actions/fleet";
import { readRenewalDocument, type ReadRenewalResult } from "@/app/actions/fleet-ai";
import type { StoredDocument } from "@/lib/documents/query";
import { uploadFile } from "@/lib/documents/upload-client";
import { DateField } from "@/components/ui/date-field";
import { Icon } from "@/components/shell/icon";
import { Plate } from "../plate";
import {
  INSURANCE_COVERS,
  INSURANCE_COVER_LABEL,
  RENEWAL_DOC_KIND,
  displayName,
  fmtMoney,
  type InsuranceCover,
  type RenewalKind,
  type Vehicle,
  type VehiclePolicy,
} from "../logic";
import {
  RENEWAL_PAPER,
  RENEWAL_TITLE,
  currentPolicy,
  fmtDay,
  policyDocuments,
  previousPolicies,
  renewalDays,
  renewalState,
  renewalStatusText,
} from "./derive";
import { DocRows } from "./doc-rows";
import { Btn, Card, DetailGrid, Eyebrow, Inline, SubHeader, type DetailItem } from "./parts";
import { ScanCard, type ScanMode } from "./scan-card";

/* One screen for the three renewal kinds — registration, insurance, green
   slip — because they are the same shape: a status, the record in force with
   its paperwork, a way to file the next one, and the history under it. What
   differs is the vocabulary and which fields each paper prints, and both are
   tables here rather than three screens.

   No reminders card. The design draws "REMIND ME" chips beside the history;
   there is nothing yet for a chip to switch on, and a toggle that does nothing
   teaches people the toggles do nothing. It arrives with the delivery. */

const CURRENT_LABEL: Record<RenewalKind, string> = {
  rego: "CURRENT REGISTRATION",
  insurance: "CURRENT POLICY",
  ctp: "CURRENT GREEN SLIP",
};
const HISTORY_LABEL: Record<RenewalKind, string> = {
  rego: "RENEWAL HISTORY",
  insurance: "POLICY HISTORY",
  ctp: "GREEN SLIP HISTORY",
};
const RECORD_LABEL: Record<RenewalKind, { fresh: string; again: string; button: string }> = {
  rego: { fresh: "RECORD RENEWAL", again: "RECORD RENEWAL", button: "Update rego" },
  insurance: { fresh: "RECORD POLICY", again: "UPDATE POLICY", button: "Update policy" },
  ctp: { fresh: "RECORD GREEN SLIP", again: "UPDATE GREEN SLIP", button: "Update green slip" },
};
const SCAN_COPY: Record<RenewalKind, { prompt: string; hint: string; attach: string }> = {
  rego: {
    prompt: "Scan or upload the renewal notice",
    hint: "Expiry date, term and amount are read from the document. PDF, JPG or photo.",
    attach: "Optional: attach the receipt or rego papers",
  },
  insurance: {
    prompt: "Scan or upload the certificate of insurance",
    hint: "Policy details are read from the document and it's filed under Documents for this policy. PDF, JPG or photo.",
    attach: "Optional: attach the certificate or policy schedule",
  },
  ctp: {
    prompt: "Scan or upload the green slip",
    hint: "CTP details are read from the document and it's filed under Documents. PDF, JPG or photo.",
    attach: "Optional: attach the green slip",
  },
};
const SAVE_LABEL: Record<RenewalKind, string> = { rego: "Save renewal", insurance: "Save policy", ctp: "Save green slip" };
const PROVIDER_LABEL: Record<RenewalKind, string> = { rego: "Issued by", insurance: "Insurer", ctp: "CTP insurer" };
const PROVIDER_HINT: Record<RenewalKind, string> = {
  rego: "e.g. Transport for NSW",
  insurance: "e.g. NRMA",
  ctp: "e.g. QBE",
};
/** The NSW CTP market, offered as suggestions rather than a closed list —
    another state's insurer is still an insurer. */
const CTP_INSURERS = ["AAMI", "Allianz", "GIO", "NRMA", "QBE", "Youi"];
const TERMS = [12, 6, 3];

type Fields = {
  provider: string;
  policyNumber: string;
  cover: InsuranceCover | "";
  startsOn: string;
  expiresOn: string;
  premium: string;
  excess: string;
  termMonths: string;
  garagingPostcode: string;
  inspectionOn: string;
};
const EMPTY: Fields = {
  provider: "",
  policyNumber: "",
  cover: "",
  startsOn: "",
  expiresOn: "",
  premium: "",
  excess: "",
  termMonths: "12",
  garagingPostcode: "",
  inspectionOn: "",
};

const num = (s: string): number | null => {
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const dash = "—";

/** The CTP vehicle class, from the weight on the certificate — not from the
    icon. GVM decides it in every state's scheme; a ute with a 2,900 kg GVM is a
    light goods vehicle whatever it looks like. */
function vehicleClass(v: Vehicle): string | null {
  if (!v.motorised) return "Trailer";
  if (v.gvmKg == null) return null;
  return v.gvmKg > 4500 ? "Goods vehicle >4.5t" : "Goods vehicle ≤4.5t";
}

export function RenewalScreen({
  vehicle,
  kind,
  today,
  documents,
  policies,
  pending,
  error,
  onBack,
  onSave,
  onAttach,
}: {
  vehicle: Vehicle;
  kind: RenewalKind;
  today: string;
  documents: StoredDocument[];
  policies: VehiclePolicy[];
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onSave: (input: Omit<RenewalInput, "vehicleId">) => void;
  /** Files another document under an existing renewal. */
  onAttach: (policyId: string, documentId: string) => void;
}) {
  const current = currentPolicy(policies, kind);
  const history = previousPolicies(policies, kind);
  const days = renewalDays(vehicle, kind);
  const state = renewalState(vehicle, kind);
  const recorded = current !== null || days !== null;

  /* The record panel: always open for rego (the design's choice — a rego is
     renewed every year and the panel IS the screen), opened on demand for a
     policy that exists, forced open when nothing has been filed. */
  const [panelOpen, setPanelOpen] = useState(kind === "rego" || !recorded);
  const [mode, setMode] = useState<ScanMode>("idle");
  const [f, setF] = useState<Fields>(EMPTY);
  const [docId, setDocId] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [openHist, setOpenHist] = useState<string | null>(null);
  const attachInput = useRef<HTMLInputElement>(null);

  const set = (k: keyof Fields) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const showFields = mode === "scanned" || mode === "manual";
  const canSave = !!f.expiresOn && (kind === "rego" || !!f.provider.trim()) && !pending;

  const fill = (r: ReadRenewalResult) => {
    if (!r.ok) return;
    setF((p) => ({
      provider: r.provider ?? p.provider,
      policyNumber: r.policyNumber ?? p.policyNumber,
      cover: r.cover ?? p.cover,
      startsOn: r.startsOn ?? p.startsOn,
      expiresOn: r.expiresOn ?? p.expiresOn,
      premium: r.premium != null ? String(r.premium) : p.premium,
      excess: r.excess != null ? String(r.excess) : p.excess,
      termMonths: r.termMonths != null ? String(r.termMonths) : p.termMonths,
      garagingPostcode: r.garagingPostcode ?? p.garagingPostcode,
      inspectionOn: r.inspectionOn ?? p.inspectionOn,
    }));
  };

  const save = () => {
    if (!canSave) return;
    onSave({
      kind,
      expiresOn: f.expiresOn,
      startsOn: f.startsOn || null,
      provider: f.provider.trim() || null,
      premium: num(f.premium),
      documentId: docId ?? undefined,
      policyNumber: f.policyNumber.trim() || null,
      cover: kind === "insurance" && f.cover ? f.cover : null,
      excess: kind === "insurance" ? num(f.excess) : null,
      termMonths: f.termMonths ? Math.round(Number(f.termMonths)) || null : null,
      garagingPostcode: kind === "ctp" ? f.garagingPostcode.trim() || null : null,
      inspectionOn: kind === "rego" ? f.inspectionOn || null : null,
      source: mode === "scanned" ? "scan" : "manual",
    });
  };

  /* ---- status card copy ---- */
  const headline = !recorded
    ? `No ${kind === "rego" ? "registration" : kind === "insurance" ? "policy" : "green slip"} recorded`
    : state === "ok" && kind !== "rego"
      ? "Covered"
      : renewalStatusText(days);
  const expiryIso = current?.expiresOn ?? null;
  const subline = !recorded
    ? `Scan the ${RENEWAL_PAPER[kind].toLowerCase()} or enter the details below.`
    : kind === "rego"
      ? expiryIso
        ? `Expires ${fmtDay(expiryIso)}`
        : renewalStatusText(days)
      : [
          kind === "insurance" ? (current?.cover ? INSURANCE_COVER_LABEL[current.cover] : "Insurance") : "CTP",
          current?.provider,
          expiryIso ? `expires ${fmtDay(expiryIso)}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
  const tone = !recorded ? "neutral" : state === "ok" ? "ok" : state;

  /* ---- the record in force, as a grid ---- */
  const details: DetailItem[] = current ? detailsFor(kind, vehicle, current, state) : [];
  const currentDocs = current ? policyDocuments(documents, current) : [];
  const regoExpiryDays = renewalDays(vehicle, "rego");

  return (
    <>
      <SubHeader
        eyebrow={displayName(vehicle)}
        title={RENEWAL_TITLE[kind]}
        onBack={onBack}
        right={<Plate plate={vehicle.plate} state={vehicle.plateState} size="sm" />}
      />

      <div className="vm-body">
        {error && <div className="vm-err">{error}</div>}

        <div className={`vm-status ${tone}`}>
          <div className="vm-statusl">
            <Eyebrow tone={tone === "ok" ? "accent" : tone === "neutral" ? undefined : "warn"}>STATUS</Eyebrow>
            <span className="vm-headline">{headline}</span>
            <span className="vm-subline">{subline}</span>
          </div>
          {kind !== "rego" && recorded && !panelOpen && (
            <Btn kind="primary" onClick={() => setPanelOpen(true)}>
              {RECORD_LABEL[kind].button}
            </Btn>
          )}
        </div>

        {current && (
          <Card>
            <div className="vm-cardhead">
              <Eyebrow>{CURRENT_LABEL[kind]}</Eyebrow>
              <span className="vm-added">{addedText(current)}</span>
            </div>
            <DetailGrid items={details} />
            <div className="vm-divider">
              <Eyebrow>DOCUMENTS</Eyebrow>
              <Inline onClick={() => attachInput.current?.click()}>Add document</Inline>
              <input
                ref={attachInput}
                type="file"
                accept="image/*,application/pdf"
                aria-label="Add document"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const up = await uploadFile(file, RENEWAL_DOC_KIND[kind]).catch(() => null);
                  if (up?.ok) onAttach(current.id, up.file.documentId);
                }}
              />
            </div>
            <DocRows
              docs={currentDocs}
              openId={openDoc}
              onOpen={(id) => {
                setOpenDoc(id);
                if (id) setOpenHist(null);
              }}
              emptyText="No paperwork filed under this record yet."
            />
          </Card>
        )}

        {panelOpen && (
          <ScanCard<ReadRenewalResult>
            heading={current ? RECORD_LABEL[kind].again : RECORD_LABEL[kind].fresh}
            prompt={SCAN_COPY[kind].prompt}
            hint={SCAN_COPY[kind].hint}
            attachLabel={SCAN_COPY[kind].attach}
            docKind={RENEWAL_DOC_KIND[kind]}
            read={(b64, mt) => readRenewalDocument(b64, mt, kind)}
            onRead={(r, id) => {
              fill(r);
              setDocId(id);
            }}
            onAttached={(id) => setDocId(id)}
            onCancel={kind !== "rego" && recorded ? () => setPanelOpen(false) : undefined}
            mode={mode}
            onMode={(m) => {
              setMode(m);
              if (m === "idle") {
                setF(EMPTY);
                setDocId(null);
              }
            }}
          >
            <div className="vm-fields">
              {kind !== "rego" && (
                <Field label={PROVIDER_LABEL[kind]}>
                  <input
                    className="vm-input"
                    list={kind === "ctp" ? "vm-ctp-insurers" : undefined}
                    placeholder={PROVIDER_HINT[kind]}
                    value={f.provider}
                    onChange={(e) => set("provider")(e.target.value)}
                  />
                  {kind === "ctp" && (
                    <datalist id="vm-ctp-insurers">
                      {CTP_INSURERS.map((i) => (
                        <option key={i} value={i} />
                      ))}
                    </datalist>
                  )}
                </Field>
              )}
              {kind !== "rego" && (
                <Field label="Policy no.">
                  <input className="vm-input" value={f.policyNumber} onChange={(e) => set("policyNumber")(e.target.value)} />
                </Field>
              )}
              {kind === "insurance" && (
                <Field label="Cover">
                  <select className="vm-input" value={f.cover} onChange={(e) => set("cover")(e.target.value)}>
                    <option value="">Select…</option>
                    {INSURANCE_COVERS.map((c) => (
                      <option key={c} value={c}>
                        {INSURANCE_COVER_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {kind !== "insurance" && (
                <Field label="Term">
                  <select className="vm-input" value={f.termMonths} onChange={(e) => set("termMonths")(e.target.value)}>
                    {TERMS.map((t) => (
                      <option key={t} value={String(t)}>
                        {t} months
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label={kind === "rego" ? "Renewed from" : "Starts"}>
                <DateField size="lg" clearable today={today} value={f.startsOn || null} onChange={(iso) => set("startsOn")(iso ?? "")} aria-label="Starts" />
              </Field>
              <Field label={kind === "rego" ? "New expiry" : "Expiry"} req>
                <DateField size="lg" clearable today={today} value={f.expiresOn || null} onChange={(iso) => set("expiresOn")(iso ?? "")} aria-label="Expires" />
              </Field>
              <Field label={kind === "rego" ? "Amount paid" : kind === "insurance" ? "Premium / yr" : "Premium"}>
                <MoneyInput value={f.premium} onChange={set("premium")} placeholder={kind === "rego" ? "1,008" : "945.54"} />
              </Field>
              {kind === "insurance" && (
                <Field label="Excess">
                  <MoneyInput value={f.excess} onChange={set("excess")} />
                </Field>
              )}
              {kind === "ctp" && (
                <Field label="Garaging postcode">
                  <input className="vm-input" inputMode="numeric" maxLength={4} value={f.garagingPostcode} onChange={(e) => set("garagingPostcode")(e.target.value.replace(/\D/g, ""))} />
                </Field>
              )}
              {kind === "rego" && (
                <Field label="Safety check">
                  <DateField size="lg" clearable today={today} value={f.inspectionOn || null} onChange={(iso) => set("inspectionOn")(iso ?? "")} aria-label="Safety check" />
                </Field>
              )}
            </div>
            {kind === "ctp" && regoExpiryDays != null && (
              <div className="vm-note">
                Green slip expiry should match rego expiry
                {currentPolicy(policies, "rego") ? ` (${fmtDay(currentPolicy(policies, "rego")!.expiresOn)})` : ""}.
              </div>
            )}
          </ScanCard>
        )}

        <Card className="vm-histcard">
          <div className="vm-cardhead">
            <Eyebrow>{HISTORY_LABEL[kind]}</Eyebrow>
          </div>
          {history.length === 0 ? (
            <div className="vm-empty">
              {kind === "ctp" ? "No previous green slips recorded." : kind === "insurance" ? "No previous policies recorded." : "No previous renewals recorded."}
            </div>
          ) : (
            history.map((p) => {
              const expanded = openHist === p.id;
              const docs = policyDocuments(documents, p);
              return (
                <div key={p.id} className="vm-hist">
                  <button
                    type="button"
                    className="vm-histrow"
                    aria-expanded={expanded}
                    onClick={() => {
                      setOpenHist(expanded ? null : p.id);
                      setOpenDoc(null);
                    }}
                  >
                    <span className="vm-docl">
                      <b>{historyEvent(kind, p)}</b>
                      <em>{docs.length === 1 ? "1 document" : `${docs.length} documents`}</em>
                    </span>
                    <span className="vm-histr">
                      {p.premium != null && <span>{fmtMoney(p.premium)}</span>}
                      <span className="vm-evdate">{fmtDay(p.expiresOn)}</span>
                      <Icon name={expanded ? "chevU" : "chevR"} size={14} />
                    </span>
                  </button>
                  {expanded && (
                    <div className="vm-histbody">
                      <div className="vm-inset">
                        <DetailGrid dense items={detailsFor(kind, vehicle, p, "ok")} />
                      </div>
                      <span className="vm-fl">DOCUMENTS</span>
                      <DocRows docs={docs} openId={openDoc} onOpen={setOpenDoc} emptyText="No paperwork filed." />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </Card>
      </div>

      <div className="vm-foot">
        <Btn kind="outline" onClick={onBack}>
          Cancel
        </Btn>
        {showFields && (
          <Btn kind="primary" onClick={save} disabled={!canSave}>
            {pending ? "Saving…" : SAVE_LABEL[kind]}
          </Btn>
        )}
      </div>
    </>
  );
}

/* ---- the grids ---- */

/** The record's facts, per kind. Only what a real document prints and the
    table holds — the handoff's "listed drivers", "claims line" and "at-fault
    cover" were hardcoded strings in the prototype, and in production they
    would be blanks or lies. */
function detailsFor(kind: RenewalKind, v: Vehicle, p: VehiclePolicy, state: "ok" | "warn" | "bad"): DetailItem[] {
  const money = (n: number | null | undefined) => (n != null ? fmtMoney(n) : dash);
  const faint = (s: string | null | undefined): DetailItem["tone"] => (s ? undefined : "faint");
  const expiry: DetailItem = {
    label: "EXPIRY",
    value: fmtDay(p.expiresOn),
    tone: state === "ok" ? undefined : "warn",
  };
  if (kind === "rego") {
    const cls = vehicleClass(v);
    return [
      { label: "PLATE", value: v.plate },
      { label: "STATE", value: v.plateState ?? dash, tone: faint(v.plateState) },
      expiry,
      { label: "TERM", value: p.termMonths ? `${p.termMonths} months` : dash, tone: faint(p.termMonths ? "x" : null) },
      { label: "RENEWED FROM", value: p.startsOn ? fmtDay(p.startsOn) : dash, tone: faint(p.startsOn) },
      { label: "SAFETY CHECK", value: p.inspectionOn ? fmtDay(p.inspectionOn) : "Not recorded", tone: faint(p.inspectionOn) },
      { label: "AUTHORITY", value: p.provider ?? dash, tone: faint(p.provider) },
      { label: "PAID", value: money(p.premium), tone: faint(p.premium != null ? "x" : null) },
      ...(cls ? [{ label: "VEHICLE CLASS", value: cls }] : []),
    ];
  }
  if (kind === "insurance") {
    return [
      { label: "INSURER", value: p.provider ?? dash, tone: faint(p.provider) },
      { label: "POLICY NO.", value: p.policyNumber ?? dash, tone: faint(p.policyNumber) },
      { label: "COVER", value: p.cover ? INSURANCE_COVER_LABEL[p.cover] : dash, tone: faint(p.cover) },
      { label: "POLICY START", value: p.startsOn ? fmtDay(p.startsOn) : dash, tone: faint(p.startsOn) },
      expiry,
      { label: "PREMIUM / YR", value: money(p.premium), tone: faint(p.premium != null ? "x" : null) },
      { label: "EXCESS", value: money(p.excess), tone: faint(p.excess != null ? "x" : null) },
    ];
  }
  const cls = vehicleClass(v);
  const regoDays = renewalDays(v, "rego");
  const ctpDays = renewalDays(v, "ctp");
  return [
    { label: "INSURER", value: p.provider ?? dash, tone: faint(p.provider) },
    { label: "POLICY NO.", value: p.policyNumber ?? dash, tone: faint(p.policyNumber) },
    { label: "TERM", value: p.termMonths ? `${p.termMonths} months` : dash, tone: faint(p.termMonths ? "x" : null) },
    { label: "STARTS", value: p.startsOn ? fmtDay(p.startsOn) : dash, tone: faint(p.startsOn) },
    expiry,
    { label: "PREMIUM", value: money(p.premium), tone: faint(p.premium != null ? "x" : null) },
    { label: "GARAGING POSTCODE", value: p.garagingPostcode ?? dash, tone: faint(p.garagingPostcode) },
    ...(cls ? [{ label: "VEHICLE CLASS", value: cls }] : []),
    ...(regoDays != null && ctpDays != null
      ? [{ label: "LINKED TO REGO", value: regoDays === ctpDays ? "Yes · same expiry" : "No · differs from rego" }]
      : []),
  ];
}

function historyEvent(kind: RenewalKind, p: VehiclePolicy): string {
  if (kind === "rego") return p.termMonths ? `Renewed · ${p.termMonths} months` : "Renewed";
  if (kind === "insurance") return `${p.cover ? INSURANCE_COVER_LABEL[p.cover] : "Insurance"}${p.provider ? ` · ${p.provider}` : ""}`;
  return `CTP${p.provider ? ` · ${p.provider}` : ""}`;
}

function addedText(p: VehiclePolicy): string {
  const when = p.createdAt ? `Added ${fmtDay(p.createdAt)}` : "";
  const how = p.source === "scan" ? "scanned from the document" : p.source === "manual" ? "entered manually" : "";
  return [when, how].filter(Boolean).join(" · ");
}

/* ---- form atoms ---- */

function Field({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <label className="vm-ffield">
      <span className="vm-fl">
        {label}
        {req && <i aria-hidden>*</i>}
      </span>
      {children}
    </label>
  );
}

function MoneyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <span className="vm-money-in">
      <span>$</span>
      <input inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}
