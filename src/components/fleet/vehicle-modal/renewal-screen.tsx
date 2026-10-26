"use client";

import { useRef, useState } from "react";
import type { RenewalInput } from "@/app/actions/fleet";
import { readRenewalDocument, type ReadRenewalResult } from "@/app/actions/fleet-ai";
import type { StoredDocument } from "@/lib/documents/query";
import { uploadFile } from "@/lib/documents/upload-client";
import { Button } from "@/components/parts/button";
import { Field, TextInput } from "@/components/parts/field";
import { Chooser } from "@/components/parts/chooser";
import { Plate } from "../plate";
import { VehicleLead } from "./event-row";
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
  RecordStatus,
  type DetailItem,
} from "@/components/record-modal/parts";
import { ScanCard, type ScanMode } from "@/components/record-modal/scan-card";

/* One screen for the three renewal kinds — registration, insurance, green
   slip — because they are the same shape: a status, the record in force with
   its paperwork, a way to file the next one, and the history under it. What
   differs is the vocabulary and which fields each paper prints, and both are
   tables here rather than three screens.

   The REMIND ME chips arrived with their delivery (phase 3). Each one is a
   task of the viewer's own — due that many days before the expiry, nudged by
   the bell that morning and carried in the day's reminder email — so a chip
   that is on means something is actually going to happen. */

const CURRENT_LABEL: Record<RenewalKind, string> = {
  rego: "Current registration",
  insurance: "Current policy",
  ctp: "Current green slip",
};
const HISTORY_LABEL: Record<RenewalKind, string> = {
  rego: "Renewal history",
  insurance: "Policy history",
  ctp: "Green slip history",
};
const RECORD_LABEL: Record<RenewalKind, { fresh: string; again: string; button: string }> = {
  rego: { fresh: "Record registration", again: "Update rego", button: "Update rego" },
  insurance: { fresh: "Record policy", again: "Update policy", button: "Update policy" },
  ctp: { fresh: "Record green slip", again: "Update green slip", button: "Update green slip" },
};
const SCAN_COPY: Record<RenewalKind, { prompt: string; paper: string; attach: string }> = {
  rego: {
    prompt: "Scan or upload the renewal notice",
    paper: "the notice",
    attach: "Attach the receipt or rego papers",
  },
  insurance: {
    prompt: "Scan or upload the certificate of insurance",
    paper: "the certificate",
    attach: "Attach the certificate or policy schedule",
  },
  ctp: {
    prompt: "Scan or upload the green slip",
    paper: "the green slip",
    attach: "Attach the green slip",
  },
};
const SAVE_LABEL: Record<RenewalKind, string> = { rego: "Save renewal", insurance: "Save policy", ctp: "Save green slip" };
const PROVIDER_LABEL: Record<RenewalKind, string> = { rego: "Issued by", insurance: "Insurer", ctp: "CTP insurer" };
const PROVIDER_HINT: Record<RenewalKind, string> = {
  rego: "Transport for NSW",
  insurance: "NRMA",
  ctp: "QBE",
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
  warnDays,
  documents,
  policies,
  pending,
  error,
  backWord = "Back",
  onBack,
  onSave,
  onSaved,
  onAttach,
}: {
  vehicle: Vehicle;
  kind: RenewalKind;
  today: string;
  warnDays: number;
  documents: StoredDocument[];
  policies: VehiclePolicy[];
  pending: boolean;
  error: string | null;
  /** "Close" when the screen was opened on its own, from the vehicle's page. */
  backWord?: string;
  onBack: () => void;
  /** Resolves to whether the renewal landed. */
  onSave: (input: Omit<RenewalInput, "vehicleId">) => Promise<boolean> | void;
  /** Where to go once it has. On a refusal the screen stays, with the
      typing intact and the reason above the fields — a renewal the server
      would not file used to vanish with the error landing on the card. */
  onSaved: () => void;
  /** Files another document under an existing renewal. */
  onAttach: (policyId: string, documentId: string) => void;
}) {
  const current = currentPolicy(policies, kind);
  const history = previousPolicies(policies, kind);
  const days = renewalDays(vehicle, kind);
  const state = renewalState(vehicle, kind, warnDays);
  const recorded = current !== null || days !== null;

  /* The record panel opens on the visit that came to renew: forced open when
     nothing has been filed, open when the record in force is inside the
     warning window (the amber bar and the compliance row both lead here
     then), and closed behind the status card's button otherwise — the same
     rule for all three kinds. Rego used to keep its panel open always, so a
     look at a registration renewed last month opened on a scan zone, while
     an insurance row reading "Renews in 3 weeks" opened on a closed panel and
     asked for one more press. */
  const [panelOpen, setPanelOpen] = useState(!recorded || state !== "ok");
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

  const save = async () => {
    if (!canSave) return;
    const ok = await onSave({
      kind,
      expiresOn: f.expiresOn,
      startsOn: f.startsOn || null,
      provider: f.provider.trim() || null,
      premium: num(f.premium),
      documentId: docId ?? undefined,
      policyNumber: f.policyNumber.trim() || null,
      cover: kind === "insurance" && f.cover ? f.cover : null,
      excess: kind === "insurance" ? num(f.excess) : null,
      /* NOT FOR INSURANCE. The Term select is not rendered for a motor policy
         and the insurance fact grid never shows one back, so an ungated save
         stored EMPTY's "12" — a twelve-month term nobody typed, saw, or could
         correct from this screen. The table's own law: a figure the document
         did not print must not be invented (docs/migrations/vehicle_policies.sql).
         A policy's period is its two dates; costToRun already annualises a
         null term over 12 months, which is what "Premium / yr" means. */
      termMonths: kind === "insurance" ? null : f.termMonths ? Math.round(Number(f.termMonths)) || null : null,
      garagingPostcode: kind === "ctp" ? f.garagingPostcode.trim() || null : null,
      inspectionOn: kind === "rego" ? f.inspectionOn || null : null,
      source: mode === "scanned" ? "scan" : "manual",
    });
    if (ok !== false) onSaved();
  };

  /* ---- status card copy ---- */
  /* A record in force and clear reads as its state — "Registered", "Covered"
     — with the expiry under it; inside the window it reads as the countdown,
     and the date under it. The headline and the subline never say the same
     fact twice (a rego clear of its window used to read "Renews in 11 months"
     over "Expires 29 Sep 2027"). */
  const headline = !recorded
    ? `No ${kind === "rego" ? "registration" : kind === "insurance" ? "policy" : "green slip"} recorded`
    : state === "ok"
      ? kind === "rego"
        ? "Registered"
        : "Covered"
      : renewalStatusText(days);
  const expiryIso = current?.expiresOn ?? null;
  const subline = !recorded
    ? `Nothing filed for this ${RENEWAL_PAPER[kind].toLowerCase()} yet`
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
          .join(", ");
  const status = !recorded ? "none" : state;

  /* ---- the record in force, as a grid ---- */
  const details: DetailItem[] = current ? detailsFor(kind, vehicle, current, state) : [];
  const currentDocs = current ? policyDocuments(documents, current) : [];
  const regoExpiryDays = renewalDays(vehicle, "rego");

  const regoNow = currentPolicy(policies, "rego");

  return (
    <>
      <FrameTitle>{RENEWAL_TITLE[kind]}</FrameTitle>
      <VehicleLead name={displayName(vehicle)} plate={<Plate plate={vehicle.plate} state={vehicle.plateState} size="sm" />} />
      {error && <RecordError>{error}</RecordError>}

      <RecordStatus state={status} word={headline} line={subline} />

      {current && (
        <Group name={CURRENT_LABEL[kind]} aside={addedText(current)}>
          <DetailGrid items={details} />
        </Group>
      )}

      {current && (
        <Group
          name="Documents"
          action={
            <>
              <Button kind="second" size={32} onClick={() => attachInput.current?.click()}>
                Add document
              </Button>
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
            </>
          }
        >
          <DocRows
            docs={currentDocs}
            openId={openDoc}
            onOpen={(id) => {
              setOpenDoc(id);
              if (id) setOpenHist(null);
            }}
            emptyText="No paperwork filed under this record yet."
          />
        </Group>
      )}

      {panelOpen && (
        <ScanCard<ReadRenewalResult>
          heading={current ? RECORD_LABEL[kind].again : RECORD_LABEL[kind].fresh}
          prompt={SCAN_COPY[kind].prompt}
          paper={SCAN_COPY[kind].paper}
          attachLabel={SCAN_COPY[kind].attach}
          docKind={RENEWAL_DOC_KIND[kind]}
          read={(b64, mt) => readRenewalDocument(b64, mt, kind)}
          onRead={(r, id) => {
            fill(r);
            setDocId(id);
          }}
          onAttached={(id) => setDocId(id)}
          onCancel={recorded ? () => setPanelOpen(false) : undefined}
          mode={mode}
          onMode={(m) => {
            setMode(m);
            if (m === "idle") {
              setF(EMPTY);
              setDocId(null);
            }
          }}
        >
          <div className="mk-records-grid">
            {kind !== "rego" && (
              <Field label={PROVIDER_LABEL[kind]}>
                <TextInput
                  list={kind === "ctp" ? "vm-ctp-insurers" : undefined}
                  placeholder={PROVIDER_HINT[kind]}
                  value={f.provider}
                  onChange={(e) => set("provider")(e.target.value)}
                />
              </Field>
            )}
            {kind === "ctp" && (
              <datalist id="vm-ctp-insurers">
                {CTP_INSURERS.map((i) => (
                  <option key={i} value={i} />
                ))}
              </datalist>
            )}
            {kind !== "rego" && (
              <Field label="Policy no.">
                <TextInput value={f.policyNumber} onChange={(e) => set("policyNumber")(e.target.value)} />
              </Field>
            )}
            {kind === "insurance" && (
              <Field label="Cover">
                <Chooser
                  placeholder="Choose the cover"
                  options={INSURANCE_COVERS.map((c) => ({ value: c, label: INSURANCE_COVER_LABEL[c] }))}
                  value={f.cover || null}
                  onChange={set("cover")}
                />
              </Field>
            )}
            {kind !== "insurance" && (
              <Field label="Term">
                <Chooser
                  options={TERMS.map((t) => ({ value: String(t), label: `${t} months` }))}
                  value={f.termMonths || null}
                  onChange={set("termMonths")}
                />
              </Field>
            )}
            <DateIn label="Starts" today={today} value={f.startsOn} onChange={set("startsOn")} />
            <DateIn label="Expires" today={today} value={f.expiresOn} onChange={set("expiresOn")} />
            <Field label={kind === "rego" ? "Amount paid ($)" : kind === "insurance" ? "Premium a year ($)" : "Premium ($)"}>
              <TextInput inputMode="decimal" placeholder={kind === "rego" ? "1,008" : "945.54"} value={f.premium} onChange={(e) => set("premium")(e.target.value)} />
            </Field>
            {kind === "insurance" && (
              <Field label="Excess ($)">
                <TextInput inputMode="decimal" value={f.excess} onChange={(e) => set("excess")(e.target.value)} />
              </Field>
            )}
            {kind === "ctp" && (
              <Field label="Garaging postcode">
                <TextInput
                  inputMode="numeric"
                  maxLength={4}
                  value={f.garagingPostcode}
                  onChange={(e) => set("garagingPostcode")(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            )}
            {kind === "rego" && <DateIn label="Safety check" today={today} value={f.inspectionOn} onChange={set("inspectionOn")} />}
          </div>
          {kind === "ctp" && regoExpiryDays != null && (
            <p className="mk-records-sub">
              {`The green slip's expiry matches the rego's${regoNow ? `, ${fmtDay(regoNow.expiresOn)}` : ""}.`}
            </p>
          )}
        </ScanCard>
      )}

      <Group name={HISTORY_LABEL[kind]}>
        {history.length === 0 ? (
          <Nothing>
            {kind === "ctp" ? "No previous green slips recorded." : kind === "insurance" ? "No previous policies recorded." : "No previous renewals recorded."}
          </Nothing>
        ) : (
          history.map((p) => {
            const expanded = openHist === p.id;
            const docs = policyDocuments(documents, p);
            return (
              <HistoryRow
                key={p.id}
                name={historyEvent(kind, p)}
                line={docs.length === 1 ? "1 document" : `${docs.length} documents`}
                aside={[p.premium != null ? fmtMoney(p.premium) : null, fmtDay(p.expiresOn)]}
                open={expanded}
                onToggle={() => {
                  setOpenHist(expanded ? null : p.id);
                  setOpenDoc(null);
                }}
              >
                <DetailGrid dense items={detailsFor(kind, vehicle, p, "ok")} />
                <DocRows docs={docs} openId={openDoc} onOpen={setOpenDoc} emptyText="No paperwork filed." />
              </HistoryRow>
            );
          })
        )}
      </Group>

      {/* THE FOOT IS THE SAVE (Isaac, 2026-09-16: "drop the cancel button,
          back is enough"), and the update that opens the panel. */}
      <FrameFoot>
        <Button kind="quiet" onClick={onBack}>
          {backWord}
        </Button>
        {showFields ? (
          <Button kind="main" onClick={() => void save()} disabled={!canSave}>
            {pending ? "Saving the renewal" : SAVE_LABEL[kind]}
          </Button>
        ) : (
          recorded &&
          !panelOpen && (
            <Button kind="main" onClick={() => setPanelOpen(true)}>
              {RECORD_LABEL[kind].button}
            </Button>
          )
        )}
      </FrameFoot>
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
    label: "Expiry",
    value: fmtDay(p.expiresOn),
    tone: state === "ok" ? undefined : "warn",
  };
  if (kind === "rego") {
    const cls = vehicleClass(v);
    return [
      { label: "Plate", value: v.plate },
      { label: "State", value: v.plateState ?? dash, tone: faint(v.plateState) },
      expiry,
      { label: "Term", value: p.termMonths ? `${p.termMonths} months` : dash, tone: faint(p.termMonths ? "x" : null) },
      { label: "Starts", value: p.startsOn ? fmtDay(p.startsOn) : dash, tone: faint(p.startsOn) },
      { label: "Safety check", value: p.inspectionOn ? fmtDay(p.inspectionOn) : "Not recorded", tone: faint(p.inspectionOn) },
      { label: "Authority", value: p.provider ?? dash, tone: faint(p.provider) },
      { label: "Paid", value: money(p.premium), tone: faint(p.premium != null ? "x" : null) },
      ...(cls ? [{ label: "Vehicle class", value: cls }] : []),
    ];
  }
  if (kind === "insurance") {
    return [
      { label: "Insurer", value: p.provider ?? dash, tone: faint(p.provider) },
      { label: "Policy no.", value: p.policyNumber ?? dash, tone: faint(p.policyNumber) },
      { label: "Cover", value: p.cover ? INSURANCE_COVER_LABEL[p.cover] : dash, tone: faint(p.cover) },
      { label: "Policy start", value: p.startsOn ? fmtDay(p.startsOn) : dash, tone: faint(p.startsOn) },
      expiry,
      { label: "Premium / yr", value: money(p.premium), tone: faint(p.premium != null ? "x" : null) },
      { label: "Excess", value: money(p.excess), tone: faint(p.excess != null ? "x" : null) },
    ];
  }
  const cls = vehicleClass(v);
  const regoDays = renewalDays(v, "rego");
  const ctpDays = renewalDays(v, "ctp");
  return [
    { label: "Insurer", value: p.provider ?? dash, tone: faint(p.provider) },
    { label: "Policy no.", value: p.policyNumber ?? dash, tone: faint(p.policyNumber) },
    { label: "Term", value: p.termMonths ? `${p.termMonths} months` : dash, tone: faint(p.termMonths ? "x" : null) },
    { label: "Starts", value: p.startsOn ? fmtDay(p.startsOn) : dash, tone: faint(p.startsOn) },
    expiry,
    { label: "Premium", value: money(p.premium), tone: faint(p.premium != null ? "x" : null) },
    { label: "Garaging postcode", value: p.garagingPostcode ?? dash, tone: faint(p.garagingPostcode) },
    ...(cls ? [{ label: "Vehicle class", value: cls }] : []),
    ...(regoDays != null && ctpDays != null
      ? [{ label: "Linked to rego", value: regoDays === ctpDays ? "Yes, same expiry" : "No, differs from rego" }]
      : []),
  ];
}

function historyEvent(kind: RenewalKind, p: VehiclePolicy): string {
  if (kind === "rego") return p.termMonths ? `Renewed, ${p.termMonths} months` : "Renewed";
  if (kind === "insurance") return `${p.cover ? INSURANCE_COVER_LABEL[p.cover] : "Insurance"}${p.provider ? `, ${p.provider}` : ""}`;
  return `CTP${p.provider ? `, ${p.provider}` : ""}`;
}

function addedText(p: VehiclePolicy): string {
  const when = p.createdAt ? `Added ${fmtDay(p.createdAt)}` : "";
  const how = p.source === "scan" ? "scanned from the document" : p.source === "manual" ? "entered manually" : "";
  return [when, how].filter(Boolean).join(", ");
}
