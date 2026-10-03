"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { ViewTabs } from "@/components/shell/view-tabs";
import { Choice, Seg, SignaturePad } from "@/components/swms/controls";
import { DateField } from "@/components/ui/date-field";
import {
  certPrevious,
  certListFiles,
  certWizardContext,
  certificatePdfUrl,
  readCertifierEmail,
  readCertifierList,
  saveMySignature,
  type CertListFile,
  type CertWizardContext,
} from "@/app/actions/certificates";
import { cacheJobFiles } from "@/app/actions/workboard-media";
import { attachJobDocument } from "@/app/actions/job-documents";
import { uploadFile } from "@/lib/documents/upload-client";
import { withCleanup } from "@/lib/ui/with-cleanup";
import { thrownWords } from "@/lib/stale-deploy";
import { MAX_REASON, MAX_REQUIREMENT_TEXT, MAX_REQUIREMENTS } from "@/lib/certs/input";
import type { IssueCertResult } from "@/app/api/certificates/issue/route";
import {
  BUILDINGS,
  CERT_TITLE,
  CLAUSE_NAME,
  DEFAULT_CERT_ANSWERS,
  EMPTY_FAN,
  EMPTY_ROW,
  EMPTY_TEST,
  EXHAUST_TO,
  MATCHABLE,
  NOT_OURS_REASON,
  certProblemList,
  clausesFor,
  fmtKw,
  indoorTotalKw,
  suggestedReason,
  type AcRow,
  type AcSystem,
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
   assumed: the building (the address only marks a hint), the refrigerant
   and its charge, and what this job was asked to cover, pasted, typed or on a file, from
   whoever asked (a certifier, the builder, an architect).

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
const blankFan = (): FanRow => ({ ...EMPTY_FAN });

/** A number field's text, and back: blank is null, never zero. */
const numText = (n: number | null) => (n === null ? "" : String(n));
const readNum = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** What the units are, without their refrigerant and charge: the
    confirmation holds while this stays the same. */
const unitsKey = (a: CertAnswers) =>
  JSON.stringify([a.covers, a.systems.map((s) => [s.outdoor, s.indoors]), a.fans]);

/** The issue, posted; null when the server couldn't be reached or answered
    with nothing readable. */
async function postIssue(body: Record<string, unknown>): Promise<IssueCertResult | null> {
  try {
    const res = await fetch("/api/certificates/issue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return ((await res.json().catch(() => null)) as IssueCertResult | null) ?? null;
  } catch {
    return null;
  }
}

/** The PDF through the phone's share sheet. False when it can't be shared
    (a desktop, or the person cancelled), and the caller opens it instead. */
async function sharePdf(url: string, fileName: string): Promise<boolean> {
  if (typeof navigator.share !== "function") return false;
  try {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], fileName, { type: "application/pdf" });
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], title: fileName });
    return true;
  } catch {
    return false;
  }
}

/* A FILE ONTO THE JOB'S DOCUMENTS, as the Documents face's own upload files
   it. Out here, as a plain function, because React Compiler 1.0 can't lower
   a throw, an `&&` or a ternary inside a component's try. */
async function fileOnJob(file: File, jobUuid: string): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  try {
    const up = await uploadFile(file, "job_document");
    if (!up.ok) return { ok: false, error: up.error };
    if (up.file.previewUrl) URL.revokeObjectURL(up.file.previewUrl);
    const put = await attachJobDocument(up.file.documentId, jobUuid);
    if (!put.ok) return { ok: false, error: put.error };
    return { ok: true, documentId: up.file.documentId };
  } catch (e) {
    return { ok: false, error: thrownWords(e, "That upload didn't finish.") };
  }
}

/** The first draft, from the job. */
function startingAnswers(ctx: CertWizardContext): CertAnswers {
  const r = ctx.reading;
  const ac = r.systems.length > 0 || !r.ventilation;
  return {
    ...DEFAULT_CERT_ANSWERS,
    covers: { ac, vent: r.ventilation },
    /* asked, never assumed: the address's guess is shown as a hint */
    building: null,
    completedOn: ctx.job.completedOn ?? "",
    systems: r.systems.length > 0 ? r.systems.map((x) => ({ ...x, indoors: x.indoors.length ? x.indoors : [{ ...EMPTY_ROW }] })) : ac ? [blankSystem(r.refrigerant)] : [],
    fans: r.fans,
    installed: { ductwork: r.ductwork, fireRated: r.fireRated, fireStopProduct: "" },
  };
}

function Field({
  label,
  value,
  onChange,
  width,
  list,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width?: "s" | "m";
  list?: string;
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <label className={`cz-f${width ? ` ${width}` : ""}`}>
      <span>{label}</span>
      <input className="wb2-fi" type="text" value={value} list={list} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/* A NUMBER FIELD KEEPS WHAT IS TYPED, not the number it reads as. Drawn
   straight from the number, "2." read as 2 and redrew as "2", so the point
   never stayed and 2.8 could not be typed. The text is the field's own; it
   is taken from the number again only when the number changes from
   elsewhere. */
function NumField({
  label,
  value,
  onChange,
  width,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  width?: "s" | "m";
}) {
  const [text, setText] = useState(() => numText(value));
  if (readNum(text) !== value) setText(numText(value));
  return (
    <Field
      label={label}
      width={width}
      inputMode="decimal"
      value={text}
      onChange={(v) => {
        setText(v);
        onChange(readNum(v));
      }}
    />
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
  /* what was asked, as pasted or typed; and what was last read (the file,
     the text, how much Tiff found), so an edit since says it hasn't been read
     and the issue knows which file the requirements came from */
  const [asked, setAsked] = useState("");
  const [lastRead, setLastRead] = useState<{ doc: string; text: string; found: number } | null>(null);
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
          /* a reissue is a change: the equipment is confirmed again */
          setA({ ...p.answers, equipmentConfirmed: false });
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
    /* a change to a unit takes back "every unit is listed"; the refrigerant
       and charge, which ride on the same rows, don't */
    setA((cur) => {
      const next = { ...cur, ...patch };
      const units = "covers" in patch || "systems" in patch || "fans" in patch;
      return units && !("equipmentConfirmed" in patch) && unitsKey(next) !== unitsKey(cur) ? { ...next, equipmentConfirmed: false } : next;
    });
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
  const setFan = (i: number, patch: Partial<FanRow>) => set({ fans: a.fans.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

  /* ── the requirements: whatever says what the certificate must cover ──── */

  const unread = (!!listDoc || !!asked.trim()) && (lastRead?.doc !== listDoc || lastRead?.text !== asked.trim());

  /* ONE BUTTON READS WHAT'S THERE: the text, the file, or both. Tiff takes
     out each thing asked for; the person checks every line below. */
  const readAsked = async () => {
    const text = asked.trim();
    if (!listDoc && !text) return;
    setListBusy(true);
    setListError(null);
    const fail = { ok: false as const, error: "Couldn't reach Tiff. Try again." };
    const [fromFile, fromText] = await Promise.all([
      listDoc ? readCertifierList(jobUuid, listDoc).catch(() => fail) : Promise.resolve(null),
      text ? readCertifierEmail(jobUuid, text).catch(() => fail) : Promise.resolve(null),
    ]);
    setListBusy(false);
    for (const r of [fromFile, fromText]) {
      if (r && !r.ok) {
        setListError(r.error);
        return;
      }
    }
    const found = [fromFile, fromText].flatMap((r) => (r && r.ok ? r.requirements : []));
    /* a certificate holds so many: past that, say so rather than drop some at issue */
    if (found.length > MAX_REQUIREMENTS) {
      setListError(`Tiff found ${found.length} things asked for. A certificate holds ${MAX_REQUIREMENTS}, so the first ${MAX_REQUIREMENTS} are listed.`);
    }
    set({
      requirements: found.slice(0, MAX_REQUIREMENTS).map((r) => ({
        text: r.text,
        answer: r.notOurs ? "na" : "clause",
        clause: r.clause,
        own: "",
        reason: r.notOurs ? NOT_OURS_REASON : "",
      })),
    });
    setLastRead({ doc: listDoc, text, found: found.length });
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
     files it, and chosen: Read it reads it with whatever is typed. */
  const uploadList = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setListError(null);
    await withCleanup(
      async () => {
        const filed = await fileOnJob(file, jobUuid);
        if (!filed.ok) {
          setListError(filed.error);
          return;
        }
        const files = await certListFiles(jobUuid).catch(() => null);
        if (files) setFiles(files);
        if (onFilesChanged) onFilesChanged();
        setListDoc(filed.documentId);
      },
      () => setUploading(false)
    );
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
    const out = await postIssue({
      jobUuid,
      answers: a,
      certificateId: prev?.certificateId,
      reason: prev ? "Reissued" : undefined,
      requirementsDocumentId: a.requirements.length > 0 ? lastRead?.doc || undefined : undefined,
    });
    setBusy(false);
    if (!out) {
      setError("Couldn't reach HeyTiff, so nothing was issued. Try again.");
      return;
    }
    if (!out.ok) {
      setError(out.error);
      return;
    }
    setIssued(out);
    onIssued({ versionId: out.versionId, documentId: out.documentId, fileName: out.fileName });
  };

  const download = async (share: boolean) => {
    if (!issued) return;
    const url = await certificatePdfUrl(issued.versionId).catch(() => null);
    if (!url) {
      setError("Couldn't open the PDF. Try again.");
      return;
    }
    if (share && (await sharePdf(url, issued.fileName))) return;
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
              onChange={() => set({ building: b.key })}
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
      {live && live.quoteToMark > 0 && (
        <p className="sw-state bad">{`This job's quote has ${live.quoteToMark} options and none is marked accepted. Mark the one the client took on the Quote face, then open the certificate again.`}</p>
      )}
      {live?.reading.systems.length ? (
        <p className="sw-note">
          {live.equipmentFrom === "quote" ? "Filled in from the accepted quote. Check every row." : "Filled in from the job's description. Check every row against what was installed."}
        </p>
      ) : null}
      {/* the quote's own total against its rows: a room left off it, or a
          capacity typed wrong, shows here before it reaches the paper */}
      {live?.reading.statedConnectedKw != null && Math.abs(live.reading.statedConnectedKw - indoorTotalKw(a.systems)) > 0.05 && (
        <p className="sw-state bad">
          {`The quote says ${fmtKw(live.reading.statedConnectedKw)} connected, but these rows add to ${fmtKw(indoorTotalKw(a.systems))}. Check for a missing room or a wrong capacity. If the rows are right, carry on.`}
        </p>
      )}
      {a.systems.map((s, i) => (
        <div key={i} className="cz-sys">
          <div className="cz-row out">
            <Field label="Outdoor unit, where" value={s.outdoor.location} onChange={(v) => setOutdoor(i, { location: v })} />
            <Field label="Model" value={s.outdoor.model} onChange={(v) => setOutdoor(i, { model: v })} />
            <NumField label="kW" width="s" value={s.outdoor.capacityKw} onChange={(n) => setOutdoor(i, { capacityKw: n })} />
            <Field label="Serial" width="m" value={s.outdoor.serial} onChange={(v) => setOutdoor(i, { serial: v })} />
            <button type="button" className="wb2-ico cz-x" aria-label={`Clear outdoor unit ${i + 1}`} onClick={() => set({ systems: a.systems.filter((_, j) => j !== i) })}>
              <Icon name="x" size={14} />
            </button>
          </div>
          {s.indoors.map((r, j) => (
            <div key={j} className="cz-row">
              <Field label="Room" value={r.location} onChange={(v) => setIndoor(i, j, { location: v })} />
              <Field label="Model" value={r.model} onChange={(v) => setIndoor(i, j, { model: v })} />
              <NumField label="kW each" width="s" value={r.capacityKw} onChange={(n) => setIndoor(i, j, { capacityKw: n })} />
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
      {a.fans.map((f, i) => (
        <div key={i} className="cz-sys">
          <div className="cz-row fan">
            <Field label="Room" value={f.location} onChange={(v) => setFan(i, { location: v })} />
            <Field label="Model" value={f.model} onChange={(v) => setFan(i, { model: v })} />
            <button type="button" className="wb2-ico cz-x" aria-label={`Clear the ${f.location || `fan ${i + 1}`} fan`} onClick={() => set({ fans: a.fans.filter((_, j) => j !== i) })}>
              <Icon name="x" size={14} />
            </button>
          </div>
          {/* the airflow is printed only when someone wants it on the certificate */}
          <div className="cz-fanfoot">
            <label className="cz-tick">
              <input type="checkbox" checked={f.airflowGiven} onChange={(e) => setFan(i, { airflowGiven: e.target.checked })} />
              Add its airflow
            </label>
            {f.airflowGiven && (
              <>
                <NumField label="L/s" width="s" value={f.airflowLps} onChange={(n) => setFan(i, { airflowLps: n })} />
                <Seg label="How the airflow is known" value={f.airflowKind} options={[["rated", "Rated"], ["measured", "Measured"]] as const} onChange={(v) => setFan(i, { airflowKind: v })} />
              </>
            )}
          </div>
        </div>
      ))}
      <button type="button" className="pbtn ghost sm cz-add" onClick={() => set({ fans: [...a.fans, blankFan()] })}>
        Add a fan
      </button>
      {a.fans.length > 0 && (
        <>
          <div className="sw-gh">
            <b>Does every exhaust fan discharge outdoors?</b>
            {a.exhaustTo === "not" && <span>{"The certificate won't say where the exhaust goes."}</span>}
          </div>
          <div className="sw-opts">
            {EXHAUST_TO.map((e) => (
              <Choice key={e.key} name="exhaust-to" checked={a.exhaustTo === e.key} onChange={() => set({ exhaustTo: e.key })} title={e.label} />
            ))}
          </div>
        </>
      )}
    </div>
  );

  const equipmentScreen = (
    <>
      {a.covers.ac && acEditor}
      {a.covers.vent && fanEditor}
      {(a.covers.ac || a.covers.vent) && (
        <div className="sw-grp">
          <Choice
            kind="checkbox"
            name="confirmed"
            checked={a.equipmentConfirmed}
            onChange={(on) => set({ equipmentConfirmed: on })}
            title="Every unit installed is listed, with its model off the plate"
            sub="Changing a unit takes this off again"
          />
        </div>
      )}
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
        </div>
      </div>
    </>
  );

  const fileOptions = (fromSm8: boolean) =>
    live?.files
      .filter((f) => f.fromSm8 === fromSm8)
      .map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ));

  const listScreen = live && (
    <>
      <div className="sw-grp">
        <div className="sw-gh">
          <b>
            <label htmlFor="cz-asked">What you&apos;ve been asked to cover</label>
          </b>
          <span>Optional</span>
        </div>
        <textarea
          id="cz-asked"
          className="wb2-notes"
          rows={6}
          placeholder="Paste an email or a list, or type a few lines"
          value={asked}
          onChange={(e) => setAsked(e.target.value)}
        />
        <div className="cz-pick">
          <select className="wb2-sel" aria-label="A file to read" value={listDoc} onChange={(e) => setListDoc(e.target.value)}>
            <option value="">{live.files.length ? "No file" : "No files on this job yet"}</option>
            {live.files.some((f) => f.fromSm8) && <optgroup label="From ServiceM8">{fileOptions(true)}</optgroup>}
            {live.files.some((f) => !f.fromSm8) && <optgroup label="Uploaded here">{fileOptions(false)}</optgroup>}
          </select>
          <button type="button" className="pbtn ghost" disabled={uploading || listBusy} onClick={() => listPicker.current?.click()}>
            {uploading ? "Uploading…" : "Upload a file"}
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
        <p className="sw-note">
          Files emailed onto this job in ServiceM8 are in the list.{" "}
          <button type="button" className="sw-more cz-inline" disabled={looking} onClick={() => void lookAgain()}>
            {looking ? "Looking…" : "Look again"}
          </button>
        </p>
        <button type="button" className="pbtn cz-read" disabled={!unread || listBusy || uploading} onClick={() => void readAsked()}>
          {listBusy ? "Reading…" : "Read it"}
        </button>
        {listError && <p className="sw-state bad">{listError}</p>}
        {!listError && unread && !listBusy && <p className="sw-note">Not read yet. Read it, and Tiff takes out each thing asked for.</p>}
        {lastRead?.found === 0 && !unread && <p className="sw-note">Tiff found nothing in it for this certificate to cover.</p>}
        {a.requirements.length === 0 && !asked.trim() && !listDoc && <p className="sw-note">Nothing asked for? Continue, and the certificate makes the standard statements.</p>}
      </div>

      {a.requirements.length > 0 && (
        <div className="sw-grp">
          <div className="sw-gh">
            <b>What Tiff took out</b>
            <span>Check each line</span>
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
                <textarea className="wb2-notes" rows={2} maxLength={MAX_REQUIREMENT_TEXT} aria-label={`Your statement for requirement ${i + 1}`} placeholder="The statement, as it should print" value={r.own} onChange={(e) => setReq(i, { own: e.target.value })} />
              )}
              {r.answer === "na" && (
                <input className="wb2-fi" maxLength={MAX_REASON} aria-label={`Why requirement ${i + 1} doesn't apply`} placeholder="Why it doesn't apply" value={r.reason} onChange={(e) => setReq(i, { reason: e.target.value })} />
              )}
            </div>
          ))}
          <button
            type="button"
            className="sw-more"
            onClick={() => {
              set({ requirements: [] });
              setLastRead(null);
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
        <NumField label="Added, kg" value={s.test.addedKg} onChange={(n) => setTest(i, { addedKg: n })} />
      </div>
    </div>
  );

  const checksScreen = (
    <>
      {a.covers.ac && (
        <div className="sw-grp">
          <div className="sw-gh">
            <b>Refrigerant</b>
            <span>The pressure test and vacuum print as passed. 0 kg when nothing was added.</span>
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
              title="The same for every outdoor unit"
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
            <Choice name="fire" checked={a.fireMode === "individual"} onChange={() => set({ fireMode: "individual" })} title="Individual room units, each 1,000 L/s or less" sub="Not part of a smoke control system, so no shutdown is needed" />
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
            <Choice name="balance" checked={a.airBalance === "others"} onChange={() => set({ airBalance: "others" })} title="Provided by others" />
          </div>
        </div>
      )}

      <div className="sw-qas">
        <div className="sw-qa">
          <span>
            <label htmlFor="cz-notcov">Not covered</label>
            <em>Optional. Printed only when filled in</em>
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
          <dd>{CERT_TITLE}</dd>
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
            The wording needs your approval before the first certificate goes out. <Link href="/dashboard/admin/templates?sec=certificate">Read and approve the wording</Link>
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
  let title = prev ? "Reissue the certificate" : CERT_TITLE;
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
    /* the licences and the approval are on the problem list already */
    const canIssue = !!live && problems.length === 0 && !busy;
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
              <h2 className="wb2-shname">{tabs ? CERT_TITLE : title}</h2>
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
