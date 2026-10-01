"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { ViewTabs } from "@/components/shell/view-tabs";
import { Choice, Seg, SignaturePad } from "@/components/swms/controls";
import { DateField } from "@/components/ui/date-field";
import {
  addFanModel,
  certPrevious,
  certListFiles,
  certWizardContext,
  certificatePdfUrl,
  readCertifierEmail,
  readCertifierList,
  saveMySignature,
  type CertListFile,
  type CertWizardContext,
  type ReadListResult,
} from "@/app/actions/certificates";
import { cacheJobFiles } from "@/app/actions/workboard-media";
import { attachJobDocument } from "@/app/actions/job-documents";
import { uploadFile } from "@/lib/documents/upload-client";
import type { IssueCertResult } from "@/app/api/certificates/issue/route";
import {
  BUILDINGS,
  CLAUSE_NAME,
  DEFAULT_CERT_ANSWERS,
  EMPTY_ROW,
  EMPTY_TEST,
  MATCHABLE,
  buildingSuggests,
  certProblemList,
  certTitle,
  clausesFor,
  fmtKw,
  indoorTotalKw,
  suggestedReason,
  type AcRow,
  type AcSystem,
  type Building,
  type CertAnswers,
  type CertProblemField,
  type CircuitTest,
  type ClauseKey,
  type FanRow,
  type Requirement,
} from "@/lib/certs/mechanical";
import "@/components/swms/swms.css";
import "./cert-wizard.css";

/* THE CERTIFICATE WIZARD — five screens on the job card, and the library
   writes the certificate. docs/certificates-plan.md, The wizard.

   MOST OF IT IS ALREADY FILLED IN. The equipment is read off the job's quote
   and the completion date comes from ServiceM8; each says where it came
   from, and the person corrects it. What only they know is asked, never
   assumed: the building (the address only marks a hint), the test figures,
   what this job was asked to cover (from whoever asked: a certifier, the
   builder, an architect), and any certifier, who changes from job to job and
   so comes off this job's own paperwork or is typed.

   IT WEARS THE SWMS WIZARD'S DRESS (swms.css): the same panel over the card,
   the same tabs, questions, options and footer, so the two documents HeyTiff
   writes are asked for the same way. */

type Tab = "covers" | "equipment" | "list" | "checks" | "sign";
const TABS: { key: Tab; label: string }[] = [
  { key: "covers", label: "What it covers" },
  { key: "equipment", label: "Equipment" },
  { key: "list", label: "Requirements" },
  { key: "checks", label: "Checks" },
  { key: "sign", label: "Sign" },
];
const PROBLEM_TAB: Record<CertProblemField, Tab> = {
  covers: "covers",
  building: "covers",
  completedOn: "covers",
  equipment: "equipment",
  fans: "equipment",
  installed: "equipment",
  requirements: "list",
  tests: "checks",
  fireMode: "checks",
  airBalance: "checks",
  sign: "sign",
  approval: "sign",
};

const REFRIGERANTS = ["R32", "R410A", "R454B", "R290"] as const;

const blankSystem = (refrigerant = ""): AcSystem => ({
  outdoor: { ...EMPTY_ROW },
  indoors: [{ ...EMPTY_ROW }],
  test: { ...EMPTY_TEST, refrigerant },
});
const blankFan = (): FanRow => ({ location: "", model: "", qty: 1, airflowLps: null, airflowKind: "rated", serial: "" });

/** A number field's text, and back: blank is null, never zero. */
const numText = (n: number | null) => (n === null ? "" : String(n));
const readNum = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** The first draft, from the job. */
function startingAnswers(ctx: CertWizardContext): CertAnswers {
  const r = ctx.reading;
  const fanRated = (model: string) => ctx.fanModels.find((f) => f.model.toLowerCase() === model.trim().toLowerCase())?.ratedLps ?? null;
  const ac = r.systems.length > 0 || !r.ventilation;
  return {
    ...DEFAULT_CERT_ANSWERS,
    covers: { ac, vent: r.ventilation },
    /* asked, never assumed: the address's guess is shown as a hint */
    building: null,
    completedOn: ctx.job.completedOn ?? "",
    systems: r.systems.length > 0 ? r.systems.map((x) => ({ ...x, indoors: x.indoors.length ? x.indoors : [{ ...EMPTY_ROW }] })) : ac ? [blankSystem(r.refrigerant)] : [],
    fans: r.fans.map((f) => ({ ...f, airflowLps: f.airflowLps ?? fanRated(f.model) })),
    installed: { ductwork: r.ductwork, fireRated: r.fireRated, fireStopProduct: "", condensatePump: r.condensatePump },
    ventAs16682: false,
  };
}

function Field({
  label,
  value,
  onChange,
  width,
  list,
  id,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width?: "s" | "m";
  list?: string;
  id?: string;
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <label className={`cz-f${width ? ` ${width}` : ""}`}>
      <span>{label}</span>
      <input id={id} className="wb2-fi" type="text" value={value} list={list} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function CertWizard({
  jobUuid,
  reviseVersionId = null,
  onClose,
  onIssued,
  onEmail,
  onSendToSm8,
  onOpen,
  canSend,
  onFilesChanged,
}: {
  jobUuid: string;
  /** Set to reissue: the latest version this one replaces. */
  reviseVersionId?: string | null;
  onClose: () => void;
  /** The certificate is on the job: read the files and the list again. */
  onIssued: (issued: { versionId: string; documentId: string; fileName: string }) => void;
  /** Open the card's email with this PDF ticked. */
  onEmail: (documentId: string) => void;
  /** Send this PDF to the job in ServiceM8. */
  onSendToSm8: (documentId: string, fileName: string) => void;
  /** Show the issued certificate in the card's viewer. */
  onOpen: (versionId: string) => void;
  /** Whether this viewer may email and send from the job (`workboard_manage`):
      someone who may issue but not send is offered the PDF only. */
  canSend: boolean;
  /** A file was uploaded onto the job from here: the card reads its files. */
  onFilesChanged?: () => void;
}) {
  const [ctx, setCtx] = useState<CertWizardContext | null | "failed">(null);
  const [a, setA] = useState<CertAnswers>(DEFAULT_CERT_ANSWERS);
  const [prev, setPrev] = useState<{ certificateId: string; version: number } | null>(null);
  const [tab, setTab] = useState<Tab>("covers");
  const [listDoc, setListDoc] = useState("");
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [listRead, setListRead] = useState<string | null>(null);
  /* the file this version's requirements were read from; null after an email */
  const [readFrom, setReadFrom] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailText, setEmailText] = useState("");
  const [looking, setLooking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const listPicker = useRef<HTMLInputElement | null>(null);
  const [sameTests, setSameTests] = useState(true);
  const [signature, setSignature] = useState<string | null>(null);
  const [drawing, setDrawing] = useState("");
  const [sigBusy, setSigBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Extract<IssueCertResult, { ok: true }> | null>(null);
  const [fanNote, setFanNote] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([certWizardContext(jobUuid), reviseVersionId ? certPrevious(reviseVersionId) : Promise.resolve(null)])
      .then(([c, p]) => {
        if (!live) return;
        if (!c) {
          setCtx("failed");
          return;
        }
        setCtx(c);
        setSignature(c.signatory?.signatureSvg ?? null);
        if (p) {
          setPrev({ certificateId: p.certificateId, version: p.version });
          setA(p.answers);
        } else {
          setA(startingAnswers(c));
        }
      })
      .catch(() => {
        if (live) setCtx("failed");
      });
    return () => {
      live = false;
    };
  }, [jobUuid, reviseVersionId]);

  const set = (patch: Partial<CertAnswers>) => {
    setA((cur) => ({ ...cur, ...patch }));
    setTouched(true);
    setError(null);
  };
  const go = (t: Tab) => {
    setTab(t);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  };
  const askClose = () => {
    if (issued || !touched) onClose();
    else setConfirmClose(true);
  };

  /* Escape closes, through the same question as the cross */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        askClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const live = ctx && ctx !== "failed" ? ctx : null;
  const signer = live?.signatory ?? null;
  const facts = useMemo(
    () => ({
      today: live?.today ?? "",
      approved: !!live?.approved,
      hasSignature: !!signature,
      arcCurrent: !!signer?.arc?.current,
      contractorCurrent: !!signer?.contractor?.current,
    }),
    [live, signature, signer]
  );
  const problems = useMemo(() => (live ? certProblemList(a, facts) : []), [a, facts, live]);
  const clauses = clausesFor(a);
  const licensed = !!signer?.arc?.current && !!signer?.contractor?.current;

  /* ── editing the equipment ───────────────────────────────────────────── */

  const setSystem = (i: number, next: AcSystem) => set({ systems: a.systems.map((s, j) => (j === i ? next : s)) });
  const setOutdoor = (i: number, patch: Partial<AcRow>) => setSystem(i, { ...a.systems[i], outdoor: { ...a.systems[i].outdoor, ...patch } });
  const setIndoor = (i: number, j: number, patch: Partial<AcRow>) =>
    setSystem(i, { ...a.systems[i], indoors: a.systems[i].indoors.map((r, k) => (k === j ? { ...r, ...patch } : r)) });
  const setTest = (i: number, patch: Partial<CircuitTest>) => {
    if (sameTests) set({ systems: a.systems.map((s) => ({ ...s, test: { ...s.test, ...patch } })) });
    else setSystem(i, { ...a.systems[i], test: { ...a.systems[i].test, ...patch } });
  };
  const setFan = (i: number, patch: Partial<FanRow>) => {
    const next = { ...a.fans[i], ...patch };
    /* a model on the fan list brings its rated figure with it */
    if (patch.model !== undefined && next.airflowKind === "rated") {
      const known = live?.fanModels.find((f) => f.model.toLowerCase() === patch.model!.trim().toLowerCase());
      if (known) next.airflowLps = known.ratedLps;
    }
    set({ fans: a.fans.map((f, j) => (j === i ? next : f)) });
  };
  const saveFan = async (f: FanRow) => {
    if (!f.model.trim() || f.airflowLps === null) return;
    const res = await addFanModel(f.model, f.airflowLps).catch(() => ({ ok: false as const, error: "Couldn't save that fan." }));
    if (!res.ok) {
      setFanNote(res.error);
      return;
    }
    setCtx((c) => (c && c !== "failed" ? { ...c, fanModels: [...c.fanModels.filter((m) => m.id !== res.fan.id), res.fan] } : c));
    setFanNote(`${res.fan.model} is on the fan list at ${res.fan.ratedLps} L/s.`);
  };

  /* ── the requirements: whatever says what the certificate must cover ──── */

  /** What Tiff read, onto the certificate. A certifier the reading didn't
      name keeps whatever was typed: an email often doesn't name one. */
  const applyReading = (res: Extract<ReadListResult, { ok: true }>, from: string | null, nothing: string) => {
    const reqs: Requirement[] = res.requirements.map((r) => ({
      text: r.text,
      answer: r.clause ? "clause" : r.notOurs ? "na" : "clause",
      clause: r.clause,
      own: "",
      reason: r.notOurs ? "Not part of these works: a smoke control system is certified by the mechanical engineer." : r.clause ? "" : suggestedReason(null, a.building),
    }));
    const was = a.certifier;
    const certifier =
      res.certifier || res.projectNumber || res.consentAuthority || was
        ? {
            name: res.certifier || was?.name || "",
            projectNumber: res.projectNumber || was?.projectNumber || "",
            consentAuthority: res.consentAuthority || was?.consentAuthority || "",
          }
        : null;
    set({ requirements: reqs, certifier });
    setReadFrom(from);
    setListRead(res.requirements.length === 0 ? nothing : null);
  };

  const readList = async (docId = listDoc) => {
    if (!docId) return;
    setListBusy(true);
    setListError(null);
    const res = await readCertifierList(jobUuid, docId).catch(() => ({ ok: false as const, error: "Couldn't reach Tiff. Try again." }));
    setListBusy(false);
    if (!res.ok) {
      setListError(res.error);
      return;
    }
    applyReading(res, docId, "Tiff found nothing in it for this certificate to cover.");
  };

  const readEmail = async () => {
    setListBusy(true);
    setListError(null);
    const res = await readCertifierEmail(jobUuid, emailText).catch(() => ({ ok: false as const, error: "Couldn't reach Tiff. Try again." }));
    setListBusy(false);
    if (!res.ok) {
      setListError(res.error);
      return;
    }
    applyReading(res, null, "Tiff found nothing in it for this certificate to cover.");
    setEmailOpen(false);
  };

  const setFiles = (files: CertListFile[]) => setCtx((c) => (c && c !== "failed" ? { ...c, files } : c));

  /* A FILE FILED IN SERVICEM8 A MINUTE AGO isn't on the card yet: the card
     brings ServiceM8's files across a few at a time, so this asks for one
     more round and then lists the job's files again. */
  const lookAgain = async () => {
    setLooking(true);
    setListError(null);
    await cacheJobFiles(jobUuid).catch(() => null);
    const files = await certListFiles(jobUuid).catch(() => null);
    setLooking(false);
    if (!files) {
      setListError("Couldn't read the job's files. Try again.");
      return;
    }
    setFiles(files);
  };

  /* Uploaded here, filed on the job's Documents as the face's own upload
     files it, then read at once: choosing the file was the decision. */
  const uploadList = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setListError(null);
    try {
      const up = await uploadFile(file, "job_document");
      if (!up.ok) throw new Error(up.error);
      if (up.file.previewUrl) URL.revokeObjectURL(up.file.previewUrl);
      const put = await attachJobDocument(up.file.documentId, jobUuid);
      if (!put.ok) throw new Error(put.error);
      const files = await certListFiles(jobUuid).catch(() => null);
      if (files) setFiles(files);
      onFilesChanged?.();
      setListDoc(up.file.documentId);
      setUploading(false);
      await readList(up.file.documentId);
    } catch (e) {
      setUploading(false);
      setListError(e instanceof Error && e.message ? e.message : "That upload didn't finish.");
    }
  };

  const setReq = (i: number, patch: Partial<Requirement>) => set({ requirements: a.requirements.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  /* ── signing and issuing ─────────────────────────────────────────────── */

  const keepSignature = async () => {
    setSigBusy(true);
    const res = await saveMySignature(drawing).catch(() => ({ ok: false as const, error: "Couldn't save your signature." }));
    setSigBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSignature(res.svg);
    setDrawing("");
  };

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/certificates/issue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jobUuid,
          answers: a,
          certificateId: prev?.certificateId,
          reason: prev ? "Reissued" : undefined,
          requirementsDocumentId: a.requirements.length > 0 ? readFrom ?? undefined : undefined,
        }),
      });
      const out = (await res.json().catch(() => null)) as IssueCertResult | null;
      if (!out) throw new Error("no answer");
      if (!out.ok) {
        setError(out.error);
        return;
      }
      setIssued(out);
      onIssued({ versionId: out.versionId, documentId: out.documentId, fileName: out.fileName });
    } catch {
      setError("Couldn't reach HeyTiff, so nothing was issued. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const download = async (share: boolean) => {
    if (!issued) return;
    const url = await certificatePdfUrl(issued.versionId).catch(() => null);
    if (!url) {
      setError("Couldn't open the PDF. Try again.");
      return;
    }
    if (share && typeof navigator.share === "function") {
      try {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], issued.fileName, { type: "application/pdf" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: issued.fileName });
          return;
        }
      } catch {
        /* a share the person cancelled, or a phone that can't: open it instead */
      }
    }
    window.open(url, "_blank", "noopener");
  };

  /* ── the screens ─────────────────────────────────────────────────────── */

  const coversScreen = live && (
    <>
      <div className="sw-grp">
        <div className="sw-gh">
          <b>What are you certifying?</b>
        </div>
        <div className="sw-opts row cz-big">
          <Choice kind="checkbox" name="covers-ac" checked={a.covers.ac} onChange={(on) => set({ covers: { ...a.covers, ac: on }, systems: on && a.systems.length === 0 ? [blankSystem()] : a.systems })} title="Air conditioning" sub="Splits, multis, ducted, VRF" />
          <Choice kind="checkbox" name="covers-vent" checked={a.covers.vent} onChange={(on) => set({ covers: { ...a.covers, vent: on }, fans: on && a.fans.length === 0 ? [blankFan()] : a.fans })} title="Ventilation" sub="Exhaust fans, ERVs, fresh air" />
        </div>
      </div>
      <div className="sw-grp">
        <div className="sw-gh">
          <b>What kind of building?</b>
          {a.building === null && <span>{`${live.building.because} Pick one to confirm.`}</span>}
        </div>
        <div className="sw-opts row cz-big">
          {BUILDINGS.map((b) => (
            <Choice
              key={b.key}
              name="building"
              checked={a.building === b.key}
              onChange={() => {
                const s = buildingSuggests(b.key as Building);
                set({ building: b.key, ventAs16682: a.covers.vent && s.ventAs16682, installed: { ...a.installed, fireRated: a.installed.fireRated || s.fireRated } });
              }}
              title={b.label}
              sub={[b.cls, a.building === null && live.building.building === b.key ? "The address suggests this" : null].filter(Boolean).join(", ") || null}
            />
          ))}
        </div>
      </div>
      <div className="sw-qas">
        <div className="sw-qa">
          <span>
            <label htmlFor="cz-done">Works completed</label>
            {live.job.completedOn && a.completedOn === live.job.completedOn && <em>From ServiceM8</em>}
          </span>
          <DateField id="cz-done" className="wb2-fi cz-date" aria-label="Works completed" max={live.today} today={live.today} value={a.completedOn || null} onChange={(iso) => set({ completedOn: iso ?? "" })} />
        </div>
      </div>
    </>
  );

  const acEditor = (
    <div className="sw-grp">
      <div className="sw-gh">
        <b>Air conditioning</b>
        <span>{`${fmtKw(indoorTotalKw(a.systems))} indoor in total`}</span>
      </div>
      {live?.reading.systems.length ? <p className="sw-note">Filled in from the job&apos;s quote. Check every row.</p> : null}
      {a.systems.map((s, i) => (
        <div key={i} className="cz-sys">
          <div className="cz-row out">
            <Field label="Outdoor unit, where" value={s.outdoor.location} onChange={(v) => setOutdoor(i, { location: v })} />
            <Field label="Model" value={s.outdoor.model} onChange={(v) => setOutdoor(i, { model: v })} />
            <Field label="kW" width="s" inputMode="decimal" value={numText(s.outdoor.capacityKw)} onChange={(v) => setOutdoor(i, { capacityKw: readNum(v) })} />
            <Field label="Serial" width="m" value={s.outdoor.serial} onChange={(v) => setOutdoor(i, { serial: v })} />
            <button type="button" className="wb2-ico cz-x" aria-label={`Clear outdoor unit ${i + 1}`} onClick={() => set({ systems: a.systems.filter((_, j) => j !== i) })}>
              <Icon name="x" size={14} />
            </button>
          </div>
          {s.indoors.map((r, j) => (
            <div key={j} className="cz-row">
              <Field label="Room" value={r.location} onChange={(v) => setIndoor(i, j, { location: v })} />
              <Field label="Model" value={r.model} onChange={(v) => setIndoor(i, j, { model: v })} />
              <Field label="kW each" width="s" inputMode="decimal" value={numText(r.capacityKw)} onChange={(v) => setIndoor(i, j, { capacityKw: readNum(v) })} />
              <Field label="How many" width="s" inputMode="numeric" value={String(r.qty)} onChange={(v) => setIndoor(i, j, { qty: Math.max(1, Math.floor(readNum(v) ?? 1)) })} />
              <button
                type="button"
                className="wb2-ico cz-x"
                aria-label={`Clear ${r.location || `indoor unit ${j + 1}`}`}
                onClick={() => setSystem(i, { ...s, indoors: s.indoors.filter((_, k) => k !== j) })}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="sw-more" onClick={() => setSystem(i, { ...s, indoors: [...s.indoors, { ...EMPTY_ROW }] })}>
            Add an indoor unit
          </button>
        </div>
      ))}
      <button type="button" className="pbtn ghost sm cz-add" onClick={() => set({ systems: [...a.systems, blankSystem(a.systems[0]?.test.refrigerant ?? "")] })}>
        Add an outdoor unit
      </button>
    </div>
  );

  const fanEditor = (
    <div className="sw-grp">
      <div className="sw-gh">
        <b>Ventilation</b>
      </div>
      <datalist id="cz-fans">
        {live?.fanModels.map((f) => (
          <option key={f.id} value={f.model} />
        ))}
      </datalist>
      {a.fans.map((f, i) => {
        const known = live?.fanModels.some((m) => m.model.toLowerCase() === f.model.trim().toLowerCase());
        return (
          <div key={i} className="cz-sys">
            <div className="cz-row fan">
              <Field label="Room" value={f.location} onChange={(v) => setFan(i, { location: v })} />
              <Field label="Model" list="cz-fans" value={f.model} onChange={(v) => setFan(i, { model: v })} />
              <Field label="L/s" width="s" inputMode="decimal" value={numText(f.airflowLps)} onChange={(v) => setFan(i, { airflowLps: readNum(v) })} />
              <button type="button" className="wb2-ico cz-x" aria-label={`Clear the ${f.location || `fan ${i + 1}`} fan`} onClick={() => set({ fans: a.fans.filter((_, j) => j !== i) })}>
                <Icon name="x" size={14} />
              </button>
            </div>
            <div className="cz-fanfoot">
              <Seg label="How the airflow is known" value={f.airflowKind} options={[["rated", "Rated"], ["measured", "Measured"]] as const} onChange={(v) => setFan(i, { airflowKind: v })} />
              {f.airflowKind === "rated" && f.model.trim() && f.airflowLps !== null && !known && (
                <button type="button" className="sw-more" onClick={() => void saveFan(f)}>
                  Save this fan to the list
                </button>
              )}
            </div>
          </div>
        );
      })}
      {fanNote && <p className="sw-note">{fanNote}</p>}
      <button type="button" className="pbtn ghost sm cz-add" onClick={() => set({ fans: [...a.fans, blankFan()] })}>
        Add a fan
      </button>
    </div>
  );

  const equipmentScreen = (
    <>
      {a.covers.ac && acEditor}
      {a.covers.vent && fanEditor}
      <div className="sw-grp">
        <div className="sw-gh">
          <b>What else was installed</b>
        </div>
        <div className="sw-opts">
          <Choice kind="checkbox" name="duct" checked={a.installed.ductwork} onChange={(on) => set({ installed: { ...a.installed, ductwork: on } })} title="Ductwork, plenums or flexible duct" />
          <Choice kind="checkbox" name="fire" checked={a.installed.fireRated} onChange={(on) => set({ installed: { ...a.installed, fireRated: on } })} title="Penetrations through fire-rated walls or floors" />
          {a.installed.fireRated && (
            <input
              className="wb2-fi"
              aria-label="Fire-stopping product"
              placeholder="Fire-stopping product, like Promat collars"
              value={a.installed.fireStopProduct}
              onChange={(e) => set({ installed: { ...a.installed, fireStopProduct: e.target.value } })}
            />
          )}
          <Choice kind="checkbox" name="pump" checked={a.installed.condensatePump} onChange={(on) => set({ installed: { ...a.installed, condensatePump: on } })} title="A condensate pump" />
          {a.covers.vent && (
            <Choice kind="checkbox" name="as16682" checked={a.ventAs16682} onChange={(on) => set({ ventAs16682: on })} title="Ventilation the building relies on, to AS 1668.2" sub="Offices, shops, car parks and common areas" />
          )}
        </div>
      </div>
    </>
  );

  const listScreen = live && (
    <>
      <div className="sw-grp">
        <div className="sw-gh">
          <b>What you&apos;ve been asked to cover</b>
          <span>Optional</span>
        </div>
        <p className="sw-note">
          A certifier&apos;s list, an email from the builder or architect, a spec: anything that says what this certificate has to cover. Tiff takes out each item for you to check. Files emailed onto this job in ServiceM8 show here.
        </p>
        <div className="cz-pick">
          <select className="wb2-sel" aria-label="The file to read" value={listDoc} onChange={(e) => setListDoc(e.target.value)}>
            <option value="">{live.files.length ? "Choose a file" : "No PDFs on this job yet"}</option>
            {live.files.some((f) => f.fromSm8) && (
              <optgroup label="From ServiceM8">
                {live.files.filter((f) => f.fromSm8).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            )}
            {live.files.some((f) => !f.fromSm8) && (
              <optgroup label="Uploaded here">
                {live.files.filter((f) => !f.fromSm8).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button type="button" className="pbtn" disabled={!listDoc || listBusy || uploading} onClick={() => void readList()}>
            {listBusy && !emailOpen ? "Reading…" : "Read it"}
          </button>
        </div>
        <div className="cz-ways">
          <button type="button" className="sw-more" disabled={looking} onClick={() => void lookAgain()}>
            {looking ? "Looking…" : "Look again"}
          </button>
          <button type="button" className="sw-more" disabled={uploading || listBusy} onClick={() => listPicker.current?.click()}>
            {uploading ? "Uploading…" : "Upload a file"}
          </button>
          <button type="button" className="sw-more" aria-expanded={emailOpen} onClick={() => setEmailOpen((o) => !o)}>
            Paste an email or text
          </button>
          <input
            ref={listPicker}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
            hidden
            aria-label="Choose a file to upload"
            onChange={(e) => {
              const file = e.target.files?.[0];
              /* cleared now, so choosing the same file again still fires */
              e.target.value = "";
              void uploadList(file);
            }}
          />
        </div>
        {emailOpen && (
          <div className="cz-email">
            <textarea
              className="wb2-notes"
              rows={8}
              aria-label="The text to read"
              placeholder="Paste the whole email or text. Tiff takes out what the certificate has to cover."
              value={emailText}
              onChange={(e) => setEmailText(e.target.value)}
            />
            <button type="button" className="pbtn" disabled={listBusy || emailText.trim().length < 20} onClick={() => void readEmail()}>
              {listBusy ? "Reading…" : "Read the text"}
            </button>
          </div>
        )}
        {listError && <p className="sw-state bad">{listError}</p>}
        {listRead && <p className="sw-note">{listRead}</p>}
        {a.requirements.length === 0 && !listRead && <p className="sw-note">Nothing asked for? Continue, and the certificate makes the standard statements.</p>}
      </div>

      <div className="sw-grp">
        <div className="sw-gh">
          <b>Certifier</b>
          <span>Only if there is one. It prints on the certificate</span>
        </div>
        {a.certifier ? (
          <>
            <div className="cz-row cert">
              <Field label="Certifier" list="cz-certifiers" value={a.certifier?.name ?? ""} onChange={(v) => set({ certifier: { name: v, projectNumber: a.certifier?.projectNumber ?? "", consentAuthority: a.certifier?.consentAuthority ?? "" } })} />
              <Field label="Project no." width="m" value={a.certifier?.projectNumber ?? ""} onChange={(v) => set({ certifier: { name: a.certifier?.name ?? "", projectNumber: v, consentAuthority: a.certifier?.consentAuthority ?? "" } })} />
              <Field label="Consent authority" value={a.certifier?.consentAuthority ?? ""} onChange={(v) => set({ certifier: { name: a.certifier?.name ?? "", projectNumber: a.certifier?.projectNumber ?? "", consentAuthority: v } })} />
            </div>
            {/* names already used, so one is spelled the same way twice; never chosen for the person */}
            <datalist id="cz-certifiers">
              {live.certifiers.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </>
        ) : (
          <button type="button" className="sw-more" onClick={() => set({ certifier: { name: "", projectNumber: "", consentAuthority: "" } })}>
            Add a certifier
          </button>
        )}
      </div>

      {a.requirements.length > 0 && (
        <div className="sw-grp">
          <div className="sw-gh">
            <b>What&apos;s been asked for</b>
            <span>Check each line against the original</span>
          </div>
          {a.requirements.map((r, i) => (
            <div key={i} className="cz-req">
              <textarea className="wb2-notes" rows={2} aria-label={`Requirement ${i + 1}`} value={r.text} onChange={(e) => setReq(i, { text: e.target.value })} />
              <select
                className="wb2-sel"
                aria-label={`How requirement ${i + 1} is answered`}
                value={r.answer === "clause" ? r.clause ?? "" : r.answer}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "own" || v === "na") setReq(i, { answer: v, reason: v === "na" && !r.reason ? suggestedReason(r.clause, a.building) : r.reason });
                  else setReq(i, { answer: "clause", clause: (v || null) as ClauseKey | null });
                }}
              >
                <option value="">Choose a statement</option>
                {MATCHABLE.map((k) => (
                  <option key={k} value={k}>
                    {CLAUSE_NAME[k]}
                  </option>
                ))}
                <option value="own">Write my own statement</option>
                <option value="na">Doesn&apos;t apply</option>
              </select>
              {r.answer === "own" && (
                <textarea className="wb2-notes" rows={2} aria-label={`Your statement for requirement ${i + 1}`} placeholder="The statement, as it should print" value={r.own} onChange={(e) => setReq(i, { own: e.target.value })} />
              )}
              {r.answer === "na" && (
                <input className="wb2-fi" aria-label={`Why requirement ${i + 1} doesn't apply`} placeholder="Why it doesn't apply" value={r.reason} onChange={(e) => setReq(i, { reason: e.target.value })} />
              )}
            </div>
          ))}
          <button
            type="button"
            className="sw-more"
            onClick={() => {
              set({ requirements: [], certifier: null });
              setReadFrom(null);
            }}
          >
            Clear these requirements
          </button>
        </div>
      )}
    </>
  );

  const testFor = (s: AcSystem, i: number) => (
    <div key={i} className="cz-sys">
      {!sameTests && <b className="cz-for">{s.outdoor.model || s.outdoor.location || `Outdoor unit ${i + 1}`}</b>}
      <div className="cz-row test">
        <Field label="Test pressure, kPa" inputMode="decimal" value={numText(s.test.pressureKpa)} onChange={(v) => setTest(i, { pressureKpa: readNum(v) })} />
        <Field label="Held, minutes" inputMode="decimal" value={numText(s.test.holdMinutes)} onChange={(v) => setTest(i, { holdMinutes: readNum(v) })} />
        <Field label="Vacuum, microns" inputMode="decimal" value={numText(s.test.vacuumMicrons)} onChange={(v) => setTest(i, { vacuumMicrons: readNum(v) })} />
        <label className="cz-f">
          <span>Refrigerant</span>
          <select className="wb2-sel" value={s.test.refrigerant} onChange={(e) => setTest(i, { refrigerant: e.target.value })}>
            <option value="">Choose</option>
            {REFRIGERANTS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <Field label="Added, kg" inputMode="decimal" value={numText(s.test.addedKg)} onChange={(v) => setTest(i, { addedKg: readNum(v) })} />
      </div>
      {s.test.vacuumMicrons !== null && s.test.vacuumMicrons > 500 && (
        <div className="cz-row">
          <Field label="Manufacturer's vacuum figure, microns" inputMode="decimal" value={numText(s.test.manufacturerMicrons)} onChange={(v) => setTest(i, { manufacturerMicrons: readNum(v) })} />
        </div>
      )}
    </div>
  );

  const checksScreen = (
    <>
      {a.covers.ac && (
        <div className="sw-grp">
          <div className="sw-gh">
            <b>Refrigerant tests</b>
            <span>Typed from the gauges, never assumed. 0 kg when nothing was added.</span>
          </div>
          {a.systems.length > 1 && (
            <Choice
              kind="checkbox"
              name="same"
              checked={sameTests}
              onChange={(on) => {
                setSameTests(on);
                if (on && a.systems[0]) set({ systems: a.systems.map((s) => ({ ...s, test: { ...a.systems[0].test } })) });
              }}
              title="The same figures for every outdoor unit"
            />
          )}
          {(sameTests ? a.systems.slice(0, 1) : a.systems).map(testFor)}
        </div>
      )}

      {clauses.includes("fireMode") && (
        <div className="sw-grp">
          <div className="sw-gh">
            <b>Fire mode</b>
            <span>Asked for: Specification 21</span>
          </div>
          <div className="sw-opts">
            <Choice name="fire" checked={a.fireMode === "individual"} onChange={() => set({ fireMode: "individual" })} title="Individual room units, each 1000 L/s or less" sub="Not part of a smoke control system, so no shutdown is needed" />
            {a.fireMode === "individual" && (
              <Choice kind="checkbox" name="rated" checked={a.fireModeRatingsChecked} onChange={(on) => set({ fireModeRatingsChecked: on })} title="I've checked each unit's rated airflow on its spec sheet" />
            )}
            <Choice name="fire" checked={a.fireMode === "shutdown"} onChange={() => set({ fireMode: "shutdown" })} title="It shuts down on a fire signal" />
            {a.fireMode === "shutdown" && (
              <div className="cz-row cert">
                <Field label="The fire signal interface" value={a.fireModeInterface} onChange={(v) => set({ fireModeInterface: v })} />
                <label className="cz-f">
                  <span>Tested on</span>
                  <DateField className="wb2-fi" aria-label="Tested on" max={live?.today} today={live?.today} value={a.fireModeTestedOn || null} onChange={(iso) => set({ fireModeTestedOn: iso ?? "" })} />
                </label>
              </div>
            )}
            <Choice name="fire" checked={a.fireMode === "smoke"} onChange={() => set({ fireMode: "smoke" })} title="It's part of a smoke control system" sub="That needs the mechanical engineer's certificate, not this one" />
          </div>
        </div>
      )}

      {clauses.includes("airBalance") && (
        <div className="sw-grp">
          <div className="sw-gh">
            <b>The air balance report</b>
          </div>
          <div className="sw-opts row">
            <Choice name="balance" checked={a.airBalance === "attached"} onChange={() => set({ airBalance: "attached" })} title="Sent with the certificate" />
            <Choice name="balance" checked={a.airBalance === "others"} onChange={() => set({ airBalance: "others" })} title="By others" />
          </div>
        </div>
      )}

      <div className="sw-qas">
        <div className="sw-qa">
          <span>
            <label htmlFor="cz-notcov">Also not covered</label>
            <em>Electrical work is always listed</em>
          </span>
          <input id="cz-notcov" className="wb2-fi" placeholder="Like the building's outdoor-air ventilation" value={a.notCoveredExtra} onChange={(e) => set({ notCoveredExtra: e.target.value })} />
        </div>
      </div>
    </>
  );

  const licenceLine = (name: string, l: { number: string | null; expires: string | null; current: boolean } | null) => (
    <div>
      <dt>{name}</dt>
      <dd>
        {l?.number ?? "Not on your staff card"}
        <small className={l?.current ? undefined : "sw-state bad"}>
          {!l ? "Add it to your staff card to sign certificates" : l.current ? `Current to ${l.expires}` : l.expires ? `Lapsed ${l.expires}` : "No expiry date on file"}
        </small>
      </dd>
    </div>
  );

  const blocking = problems.filter((p) => p.field !== "sign" && p.field !== "approval");
  const signScreen = live && (
    <>
      <dl className="sw-rev">
        <div>
          <dt>Certificate</dt>
          <dd>{certTitle(a.covers)}</dd>
        </div>
        <div>
          <dt>Signed by</dt>
          <dd>{signer?.name ?? "You"}</dd>
        </div>
        {licenceLine("ARC licence", signer?.arc ?? null)}
        {licenceLine("Contractor licence", signer?.contractor ?? null)}
      </dl>

      {licensed && (
        <div className="sw-grp">
          <div className="sw-gh">
            <b>Your signature</b>
            {signature && <span>Kept on your staff card</span>}
          </div>
          {signature && !drawing ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="cz-sig" src={`data:image/svg+xml;utf8,${encodeURIComponent(signature)}`} alt="Your signature" />
              <button type="button" className="sw-more" onClick={() => setSignature(null)}>
                Draw it again
              </button>
            </>
          ) : (
            <>
              <SignaturePad label="Draw your signature" onChange={setDrawing} />
              <button type="button" className="pbtn ghost sm cz-add" disabled={!drawing || sigBusy} onClick={() => void keepSignature()}>
                {sigBusy ? "Saving…" : "Keep this signature"}
              </button>
            </>
          )}
        </div>
      )}
      {!licensed && (
        <p className="sw-state bad">
          Anyone with their own current ARC licence and contractor licence can sign a certificate. Yours aren&apos;t both current on your staff card, so this one can be read but not issued.
        </p>
      )}
      {!live.approved &&
        (live.canApprove ? (
          <p className="sw-text">
            The wording needs your approval before the first certificate goes out. <Link href="/dashboard/certificates/template">Read and approve the wording</Link>
          </p>
        ) : (
          <p className="sw-state warn">{`${live.ownerName ?? "The owner"} approves the certificate wording before the first one can be issued.`}</p>
        ))}
      {blocking.length > 0 && (
        <ul className="sw-problems">
          {blocking.map((p, i) => (
            <li key={i}>
              <button type="button" onClick={() => go(PROBLEM_TAB[p.field])}>
                {p.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  /* ── the frame ───────────────────────────────────────────────────────── */

  let body: React.ReactNode;
  let foot: React.ReactNode = null;
  let tabs = false;
  let title = prev ? "Reissue the certificate" : "Compliance certificate";
  const close = (
    <>
      <span />
      <button type="button" className="pbtn" onClick={onClose}>
        Close
      </button>
    </>
  );

  if (ctx === null) {
    body = <p className="sw-note">Reading the job…</p>;
  } else if (ctx === "failed") {
    body = <p className="sw-note">Couldn&apos;t open the certificate for this job. Close it and try again.</p>;
    foot = close;
  } else if (issued) {
    title = issued.version > 1 ? `Version ${issued.version} is on the job` : "The certificate is on the job";
    body = (
      <div className="sw-grp">
        <p className="sw-text">{`${issued.fileName} is filed under Documents. Nothing has been sent yet.`}</p>
        <div className="cz-after">
          {canSend && (
            <>
              <button type="button" className="pbtn" onClick={() => onEmail(issued.documentId)}>
                Email to the builder
              </button>
              <button type="button" className="pbtn ghost" onClick={() => onSendToSm8(issued.documentId, issued.fileName)}>
                Send to ServiceM8
              </button>
            </>
          )}
          <button type="button" className="pbtn ghost" onClick={() => void download(false)}>
            Download PDF
          </button>
          <button type="button" className="pbtn ghost cz-share" onClick={() => void download(true)}>
            Share PDF
          </button>
        </div>
        {error && <p className="sw-state bad">{error}</p>}
      </div>
    );
    foot = (
      <>
        <span />
        <button type="button" className="pbtn ghost" onClick={() => onOpen(issued.versionId)}>
          Open the certificate
        </button>
        <button type="button" className="pbtn" onClick={onClose}>
          Done
        </button>
      </>
    );
  } else {
    tabs = true;
    const at = TABS.findIndex((t) => t.key === tab);
    const last = at === TABS.length - 1;
    const canIssue = licensed && live?.approved && problems.length === 0 && !busy;
    foot = confirmClose ? (
      <>
        <span>Discard this certificate?</span>
        <button type="button" className="pbtn ghost" onClick={() => setConfirmClose(false)}>
          Keep editing
        </button>
        <button type="button" className="pbtn" onClick={onClose}>
          Discard
        </button>
      </>
    ) : (
      <>
        <span className={error || (last && problems.length > 0) ? "sw-state bad" : undefined}>
          {error ?? (last && problems.length > 0 ? (problems.length === 1 ? problems[0].text : `${problems.length} things to answer`) : "")}
        </span>
        {at > 0 && (
          <button type="button" className="pbtn ghost" onClick={() => go(TABS[at - 1].key)}>
            Back
          </button>
        )}
        {!last ? (
          <button type="button" className="pbtn" onClick={() => go(TABS[at + 1].key)}>
            Continue
          </button>
        ) : (
          <button type="button" className="pbtn" disabled={!canIssue} onClick={() => void issue()}>
            {busy ? "Issuing…" : prev ? `Issue version ${prev.version + 1}` : "Issue the certificate"}
          </button>
        )}
      </>
    );
  }

  const panels: Record<Tab, React.ReactNode> = {
    covers: coversScreen,
    equipment: equipmentScreen,
    list: listScreen,
    checks: checksScreen,
    sign: signScreen,
  };
  const job = live?.job ?? null;

  return (
    <>
      <div className="swz-scrim" onClick={askClose} />
      <aside className={`swz${tabs ? " tall" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className={`wb2-jcband${tabs ? "" : " bare"}`}>
          <div className="wb2-shtop">
            {job?.number && <span className="wb2-shno">{`#${job.number}`}</span>}
            <span className="wb2-jcid">
              <h2 className="wb2-shname">{tabs ? certTitle(a.covers) : title}</h2>
              <p className="wb2-jcaddr">{job?.address ?? (ctx === null ? "Reading the job…" : "No address on the job")}</p>
            </span>
          </div>
          <button type="button" className="wb2-ico" aria-label="Close the certificate" onClick={askClose}>
            <Icon name="x" size={14} />
          </button>
          {tabs && <ViewTabs items={TABS} active={tab} onGo={(k) => go(k as Tab)} ariaLabel="Certificate steps" idPrefix="cztab" panelPrefix="czsec" />}
        </div>
        <div className="wb2-jcbody swz-body" ref={bodyRef}>
          {tabs
            ? TABS.map((t) => (
                <section key={t.key} className="wb2-jcface" id={`czsec-${t.key}`} role="tabpanel" aria-labelledby={`cztab-${t.key}`} hidden={tab !== t.key}>
                  {panels[t.key]}
                </section>
              ))
            : body}
        </div>
        {foot && <div className="wb2-shft">{foot}</div>}
      </aside>
    </>
  );
}
