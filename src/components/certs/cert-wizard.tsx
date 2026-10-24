"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, LinkButton } from "@/components/parts/button";
import { ConfirmDialog } from "@/components/parts/dialog";
import { Chooser } from "@/components/parts/chooser";
import { Field, TextArea, TextInput } from "@/components/parts/field";
import { Tray } from "@/components/parts/tabs";
import { Tick } from "@/components/parts/tick";
import { SignaturePad } from "@/components/swms/controls";
import { FootWord, Group, jobLine, Jumps, Q, Radio, WizardDialog } from "@/components/swms/wizard";
import { DateField } from "@/components/ui/date-field";
import {
  certPrevious,
  certListFiles,
  certWizardContext,
  certificatePdfUrl,
  readCertifierEmail,
  readCertifierList,
  readJobDescription,
  saveMySignature,
  type CertListFile,
  type CertWizardContext,
} from "@/app/actions/certificates";
import { cacheJobFiles } from "@/app/actions/workboard-media";
import { fileOnJob } from "@/lib/documents/file-on-job";
import { withCleanup } from "@/lib/ui/with-cleanup";
import { MAX_REASON, MAX_REQUIREMENT_TEXT, MAX_REQUIREMENTS } from "@/lib/certs/input";
import { makeOf, withMakes } from "@/lib/certs/make";
import { hasSerials } from "@/lib/certs/from-quote";
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
  stateFormNote,
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
import { AU_STATES, STATE_NAME, stateFromAddress, type AuState } from "@/lib/swms/library";
import "@/components/swms/swms.css";

/* THE CERTIFICATE WIZARD — five screens on the job card, and the library
   writes the certificate. docs/certificates-plan.md, The wizard.

   MOST OF IT IS ALREADY FILLED IN. The equipment is read off the job's quote
   and the completion date comes from ServiceM8; each says where it came
   from, and the person corrects it. What only they know is asked, never
   assumed: the building (the address only marks a hint), the refrigerant
   and its charge, and what this job was asked to cover, pasted, typed or on a file, from
   whoever asked (a certifier, the builder, an architect).

   IT WEARS THE SWMS WIZARD'S FRAME (swms/wizard): the v2 dialog, the job's
   line, the steps as section tabs, Back and Continue, so the two documents
   HeyTiff writes are asked for the same way (Isaac, 25 October 2026). */

type Tab = "covers" | "equipment" | "list" | "checks" | "sign";
const TABS: { key: Tab; label: string }[] = [
  { key: "covers", label: "The job" },
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

const REFRIGERANTS = ["R32", "R410A", "R454B", "R290"].map((r) => ({ value: r, label: r }));

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

/** The first draft, from the job. */
function startingAnswers(ctx: CertWizardContext): CertAnswers {
  /* the make beside each model, read off its code or the job's own words */
  const r = withMakes(ctx.reading, ctx.job.description ?? "");
  const ac = r.systems.length > 0 || !r.ventilation;
  return {
    ...DEFAULT_CERT_ANSWERS,
    covers: { ac, vent: r.ventilation },
    /* asked, never assumed: the address's guess is shown as a hint */
    building: null,
    /* the site's state: its address's when it names one (a job over the
       border), else the business's own; the person can change it */
    state: stateFromAddress(ctx.job.address) ?? ctx.orgState,
    completedOn: ctx.job.completedOn ?? "",
    systems: r.systems.length > 0 ? r.systems.map((x) => ({ ...x, indoors: x.indoors.length ? x.indoors : [{ ...EMPTY_ROW }] })) : ac ? [blankSystem(r.refrigerant)] : [],
    fans: r.fans,
    installed: { ductwork: r.ductwork, fireRated: r.fireRated, fireStopProduct: "" },
    /* serials read off the units' plates on the job are printed */
    serialsGiven: hasSerials(r),
  };
}

/** A labelled text field, as the equipment's rows hold them. */
function Entry({
  label,
  value,
  onChange,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <Field label={label}>
      <TextInput value={value} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/* A NUMBER FIELD KEEPS WHAT IS TYPED, not the number it reads as. Drawn
   straight from the number, "2." read as 2 and redrew as "2", so the point
   never stayed and 2.8 could not be typed. The text is the field's own; it
   is taken from the number again only when the number changes from
   elsewhere. */
function NumField({ label, value, onChange }: { label: string; value: number | null; onChange: (n: number | null) => void }) {
  const [text, setText] = useState(() => numText(value));
  if (readNum(text) !== value) setText(numText(value));
  return (
    <Entry
      label={label}
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
  /* Tiff reading the job's description; and whether the equipment has been
     changed since the wizard opened, after which her reading isn't swapped in */
  const [readingDescription, setReadingDescription] = useState(false);
  const equipmentEdited = useRef(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

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
          /* A JOB QUOTED BEFORE THE QUOTE BUILDER: the rule reader's draft is
             up at once, and Tiff's reading of the same words (about 5–10s)
             replaces it while nothing in the equipment has been changed */
          if (c.equipmentFrom === "description" && c.job.description?.trim()) {
            equipmentEdited.current = false;
            setReadingDescription(true);
            void readJobDescription(jobUuid)
              .catch(() => ({ ok: false as const }))
              .then((res) => {
                if (!live) return;
                setReadingDescription(false);
                if (!res.ok || equipmentEdited.current) return;
                const read = { ...c, reading: res.reading };
                const fresh = startingAnswers(read);
                setCtx(read);
                setA((cur) => ({ ...cur, covers: fresh.covers, systems: fresh.systems, fans: fresh.fans, installed: fresh.installed }));
              });
          }
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
    if ("covers" in patch || "systems" in patch || "fans" in patch || "installed" in patch) equipmentEdited.current = true;
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

  /* Escape, the scrim and Cancel ask the same question, and close only
     this: the page under it stays open (the overlay stack). */

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

  /* A NEW MODEL BRINGS ITS MAKE, unless the person typed a make of their
     own: one read off the old model, or none, follows the new one */
  const words = live?.job.description ?? "";
  const remade = <R extends { make: string; model: string }>(row: R, patch: Partial<R>): R => {
    const next = { ...row, ...patch };
    if (patch.model === undefined || (row.make.trim() && row.make !== makeOf(row.model, words))) return next;
    return { ...next, make: makeOf(next.model, words) };
  };
  const setSystem = (i: number, next: AcSystem) => set({ systems: a.systems.map((s, j) => (j === i ? next : s)) });
  const setOutdoor = (i: number, patch: Partial<AcRow>) => setSystem(i, { ...a.systems[i], outdoor: remade(a.systems[i].outdoor, patch) });
  const setIndoor = (i: number, j: number, patch: Partial<AcRow>) =>
    setSystem(i, { ...a.systems[i], indoors: a.systems[i].indoors.map((r, k) => (k === j ? remade(r, patch) : r)) });
  const setTest = (i: number, patch: Partial<CircuitTest>) => {
    if (sameTests) set({ systems: a.systems.map((s) => ({ ...s, test: { ...s.test, ...patch } })) });
    else setSystem(i, { ...a.systems[i], test: { ...a.systems[i].test, ...patch } });
  };
  const setFan = (i: number, patch: Partial<FanRow>) => set({ fans: a.fans.map((f, j) => (j === i ? remade(f, patch) : f)) });

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

  const fromAddress = live ? stateFromAddress(live.job.address) : null;
  const coversScreen = live && (
    <div className="wzd-form">
      <Group heading="What are you certifying?">
        <div className="wzd-ticks">
          <Tick
            checked={a.covers.ac}
            onChange={(on) => set({ covers: { ...a.covers, ac: on }, systems: on && a.systems.length === 0 ? [blankSystem()] : a.systems })}
            label="Air conditioning"
          />
          <Tick checked={a.covers.vent} onChange={(on) => set({ covers: { ...a.covers, vent: on }, fans: on && a.fans.length === 0 ? [blankFan()] : a.fans })} label="Ventilation" />
        </div>
      </Group>
      <Q
        label="State"
        htmlFor="cz-state"
        sub={
          a.state === null
            ? "The address doesn't name one, and your company settings don't either."
            : a.state === fromAddress
              ? "From the address"
              : !fromAddress && a.state === live.orgState
                ? "From your company settings"
                : null
        }
      >
        <Chooser
          id="cz-state"
          className="wzd-short"
          placeholder="Choose"
          value={a.state}
          options={AU_STATES.map((st) => ({ value: st, label: STATE_NAME[st] }))}
          onChange={(v) => set({ state: v as AuState })}
        />
      </Q>
      {stateFormNote(a.state) && <p className="wzd-note">{stateFormNote(a.state)}</p>}
      <Group heading="What kind of building is it?" fact={a.building === null ? "Choose one to confirm." : null}>
        <div className="wzd-radios" role="radiogroup" aria-label="What kind of building it is">
          {BUILDINGS.map((b) => (
            <Radio
              key={b.key}
              name="building"
              checked={a.building === b.key}
              onChange={() => set({ building: b.key })}
              label={b.label}
              sub={a.building === null && live.building.building === b.key ? `${b.cls}, suggested ${live.building.because}` : b.cls}
            />
          ))}
        </div>
      </Group>
      <Q label="Date the works were completed" htmlFor="cz-done" sub={live.job.completedOn && a.completedOn === live.job.completedOn ? "From ServiceM8" : null}>
        <DateField
          id="cz-done"
          className="wzd-date"
          aria-label="Date the works were completed"
          max={live.today}
          today={live.today}
          value={a.completedOn || null}
          onChange={(iso) => set({ completedOn: iso ?? "" })}
        />
      </Q>
    </div>
  );

  /* the plate check closes the last list of units on the screen */
  const plateTick = (
    <Tick
      className="wzd-tick"
      checked={a.equipmentConfirmed}
      onChange={(on) => set({ equipmentConfirmed: on })}
      label="I've checked every unit against its rating plate"
    />
  );
  const eqClass = a.serialsGiven ? "wzd-eq wzd-eq--serial" : "wzd-eq";

  const acEditor = (
    <Group heading="Air conditioning" fact={`${fmtKw(indoorTotalKw(a.systems))} indoor in total`}>
      {live && live.quoteToMark > 0 && (
        <p className="wzd-wrong">{`This job's quote has ${live.quoteToMark} options and none is marked accepted. Mark the one the client took on the Quote face, then open the certificate again.`}</p>
      )}
      {readingDescription && <p className="wzd-note">Tiff is reading the job&apos;s description</p>}
      {/* the quote's own total against its rows: a room left off it, or a
          capacity typed wrong, shows here before it reaches the paper */}
      {live?.reading.statedConnectedKw != null && Math.abs(live.reading.statedConnectedKw - indoorTotalKw(a.systems)) > 0.05 && (
        <p className="wzd-text">
          {`The quote says ${fmtKw(live.reading.statedConnectedKw)} connected, but these rows add to ${fmtKw(indoorTotalKw(a.systems))}. Check for a missing room or a wrong capacity. If the rows are right, carry on.`}
        </p>
      )}
      {a.systems.map((s, i) => (
        <div key={i} className="wzd-box">
          <h4 className="wzd-boxt">{`System ${i + 1}`}</h4>
          <div className={eqClass}>
            <Entry label="Outdoor unit location" value={s.outdoor.location} onChange={(v) => setOutdoor(i, { location: v })} />
            <Entry label="Make" value={s.outdoor.make} onChange={(v) => setOutdoor(i, { make: v })} />
            <Entry label="Model" value={s.outdoor.model} onChange={(v) => setOutdoor(i, { model: v })} />
            <NumField label="kW" value={s.outdoor.capacityKw} onChange={(n) => setOutdoor(i, { capacityKw: n })} />
            <span aria-hidden="true" />
            {a.serialsGiven && <Entry label="Serial" value={s.outdoor.serial} onChange={(v) => setOutdoor(i, { serial: v })} />}
            <Button kind="quiet" aria-label={`Clear outdoor unit ${i + 1}`} onClick={() => set({ systems: a.systems.filter((_, j) => j !== i) })}>
              Clear
            </Button>
          </div>
          {s.indoors.map((r, j) => (
            <div key={j} className={eqClass}>
              <Entry label="Room" value={r.location} onChange={(v) => setIndoor(i, j, { location: v })} />
              <Entry label="Make" value={r.make} onChange={(v) => setIndoor(i, j, { make: v })} />
              <Entry label="Model" value={r.model} onChange={(v) => setIndoor(i, j, { model: v })} />
              <NumField label="kW" value={r.capacityKw} onChange={(n) => setIndoor(i, j, { capacityKw: n })} />
              <Entry label="Qty" inputMode="numeric" value={String(r.qty)} onChange={(v) => setIndoor(i, j, { qty: Math.max(1, Math.floor(readNum(v) ?? 1)) })} />
              {a.serialsGiven && <Entry label={r.qty > 1 ? "Serials, comma between" : "Serial"} value={r.serial} onChange={(v) => setIndoor(i, j, { serial: v })} />}
              <Button kind="quiet" aria-label={`Clear ${r.location || `indoor unit ${j + 1}`}`} onClick={() => setSystem(i, { ...s, indoors: s.indoors.filter((_, k) => k !== j) })}>
                Clear
              </Button>
            </div>
          ))}
          <Button kind="quiet" size={32} className="wzd-start" onClick={() => setSystem(i, { ...s, indoors: [...s.indoors, { ...EMPTY_ROW }] })}>
            Add an indoor unit
          </Button>
        </div>
      ))}
      <div className="wzd-between">
        <Button kind="second" onClick={() => set({ systems: [...a.systems, blankSystem(a.systems[0]?.test.refrigerant ?? "")] })}>
          Add equipment
        </Button>
        {!a.covers.vent && plateTick}
      </div>
    </Group>
  );

  const fanEditor = (
    <Group heading="Ventilation">
      {a.fans.map((f, i) => (
        <div key={i} className="wzd-box">
          <div className={a.serialsGiven ? "wzd-eq wzd-eq--fan wzd-eq--serial" : "wzd-eq wzd-eq--fan"}>
            <Entry label="Room" value={f.location} onChange={(v) => setFan(i, { location: v })} />
            <Entry label="Make" value={f.make} onChange={(v) => setFan(i, { make: v })} />
            <Entry label="Model" value={f.model} onChange={(v) => setFan(i, { model: v })} />
            {a.serialsGiven && <Entry label="Serial" value={f.serial} onChange={(v) => setFan(i, { serial: v })} />}
            <Button kind="quiet" aria-label={`Clear the ${f.location || `fan ${i + 1}`} fan`} onClick={() => set({ fans: a.fans.filter((_, j) => j !== i) })}>
              Clear
            </Button>
          </div>
          {/* the airflow is printed only when someone wants it on the certificate */}
          <div className="wzd-airflow">
            <Tick checked={f.airflowGiven} onChange={(on) => setFan(i, { airflowGiven: on })} label="Show its airflow" />
            {f.airflowGiven && (
              <>
                <div className="wzd-num">
                  <NumField label="L/s" value={f.airflowLps} onChange={(n) => setFan(i, { airflowLps: n })} />
                </div>
                <Tray
                  ariaLabel="How the airflow is known"
                  value={f.airflowKind}
                  options={[
                    { value: "rated", label: "Rated" },
                    { value: "measured", label: "Measured" },
                  ]}
                  onChange={(v) => setFan(i, { airflowKind: v })}
                />
              </>
            )}
          </div>
        </div>
      ))}
      <div className="wzd-between">
        <Button kind="second" onClick={() => set({ fans: [...a.fans, blankFan()] })}>
          Add a fan
        </Button>
        {plateTick}
      </div>
      {a.fans.length > 0 && (
        <div className="wzd-radios" role="radiogroup" aria-labelledby="cz-exhaust-l">
          <span className="wzd-ql" id="cz-exhaust-l">
            Does every exhaust fan discharge outdoors?
          </span>
          {a.exhaustTo === "not" && <span className="wzd-qs">{"The certificate won't say where the exhaust goes."}</span>}
          {EXHAUST_TO.map((e) => (
            <Radio key={e.key} name="exhaust-to" checked={a.exhaustTo === e.key} onChange={() => set({ exhaustTo: e.key })} label={e.label} />
          ))}
        </div>
      )}
    </Group>
  );

  const equipmentScreen = (
    <div className="wzd-form">
      {a.covers.ac && acEditor}
      {a.covers.vent && fanEditor}
      {/* serials are optional: off, the certificate prints no serial column */}
      {(a.covers.ac || a.covers.vent) && (
        <Tick checked={a.serialsGiven} onChange={(on) => set({ serialsGiven: on })} label="Show serial numbers on the certificate" />
      )}
      <Group heading="What else was installed?">
        <div className="wzd-ticks">
          <Tick checked={a.installed.ductwork} onChange={(on) => set({ installed: { ...a.installed, ductwork: on } })} label="Ductwork, plenums or flexible duct" />
          <Tick
            checked={a.installed.fireRated}
            onChange={(on) => set({ installed: { ...a.installed, fireRated: on } })}
            label="Penetrations through fire-rated walls or floors"
          />
          {a.installed.fireRated && (
            <TextInput
              className="wzd-short"
              aria-label="Fire-stopping product"
              placeholder="Fire-stopping product, like Promat collars"
              value={a.installed.fireStopProduct}
              onChange={(e) => set({ installed: { ...a.installed, fireStopProduct: e.target.value } })}
            />
          )}
        </div>
      </Group>
    </div>
  );

  const fileOptions = live
    ? [
        { value: "", label: live.files.length ? "No file" : "No files on this job yet" },
        ...live.files.map((f) => ({ value: f.id, label: f.name, hint: f.fromSm8 ? "From ServiceM8" : "Uploaded here" })),
      ]
    : [];

  const listScreen = live && (
    <div className="wzd-form">
      <Q label="What the certificate must cover" htmlFor="cz-asked" sub="Optional">
        <TextArea id="cz-asked" rows={6} placeholder="Paste the email or list from the certifier, builder or architect" value={asked} onChange={(e) => setAsked(e.target.value)} />
      </Q>
      <div className="wzd-pick">
        <Chooser aria-label="A file to read" value={listDoc} options={fileOptions} onChange={setListDoc} />
        <Button kind="second" disabled={uploading || listBusy} onClick={() => listPicker.current?.click()}>
          {uploading ? "Uploading the file" : "Upload a file"}
        </Button>
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
      <p className="wzd-note">
        Files emailed to this job in ServiceM8 are listed.{" "}
        <button type="button" className="wzd-inline" disabled={looking} onClick={() => void lookAgain()}>
          {looking ? "Looking in ServiceM8" : "Look again"}
        </button>
      </p>
      <Button kind="second" className="wzd-start" disabled={!unread || listBusy || uploading} onClick={() => void readAsked()}>
        {listBusy ? "Reading the requirements" : "Read the requirements"}
      </Button>
      {listError && <p className="wzd-wrong">{listError}</p>}
      {!listError && unread && !listBusy && <p className="wzd-note">Not read yet.</p>}
      {lastRead?.found === 0 && !unread && <p className="wzd-note">Tiff found no requirements in it for this certificate.</p>}
      {a.requirements.length === 0 && !asked.trim() && !listDoc && <p className="wzd-note">No requirements? Continue, and the certificate uses the standard statements.</p>}

      {a.requirements.length > 0 && (
        <Group heading="Requirements found" fact={`${a.requirements.length} to check`}>
          <ul className="wzd-rows">
            {a.requirements.map((r, i) => (
              <li key={i} className="wzd-req">
                <TextArea rows={2} aria-label={`Requirement ${i + 1}`} value={r.text} onChange={(e) => setReq(i, { text: e.target.value })} />
                <Chooser
                  aria-label={`How requirement ${i + 1} is answered`}
                  placeholder="Choose a statement"
                  value={r.answer === "clause" ? r.clause : r.answer}
                  options={[
                    ...MATCHABLE.map((k) => ({ value: k, label: CLAUSE_NAME[k] })),
                    { value: "own", label: "Write my own statement" },
                    { value: "na", label: "Doesn't apply" },
                  ]}
                  onChange={(v) => {
                    if (v === "own" || v === "na") setReq(i, { answer: v, reason: v === "na" && !r.reason ? suggestedReason(r.clause, a.building, a.state) : r.reason });
                    else setReq(i, { answer: "clause", clause: v as ClauseKey });
                  }}
                />
                {r.answer === "own" && (
                  <TextArea
                    rows={2}
                    maxLength={MAX_REQUIREMENT_TEXT}
                    aria-label={`Your statement for requirement ${i + 1}`}
                    placeholder="The statement, as it should print"
                    value={r.own}
                    onChange={(e) => setReq(i, { own: e.target.value })}
                  />
                )}
                {r.answer === "na" && (
                  <TextInput maxLength={MAX_REASON} aria-label={`Why requirement ${i + 1} doesn't apply`} placeholder="Why it doesn't apply" value={r.reason} onChange={(e) => setReq(i, { reason: e.target.value })} />
                )}
              </li>
            ))}
          </ul>
          <Button
            kind="quiet"
            size={32}
            className="wzd-start"
            onClick={() => {
              set({ requirements: [] });
              setLastRead(null);
            }}
          >
            Clear these requirements
          </Button>
        </Group>
      )}
    </div>
  );

  const testFor = (s: AcSystem, i: number) => (
    <div key={i} className="wzd-form">
      {!sameTests && <h4 className="wzd-boxt">{s.outdoor.model || s.outdoor.location || `Outdoor unit ${i + 1}`}</h4>}
      <Q label="Refrigerant">
        <Tray ariaLabel="Refrigerant" value={s.test.refrigerant} options={REFRIGERANTS} onChange={(v) => setTest(i, { refrigerant: v })} />
      </Q>
      <div className="wzd-num wzd-num--wide">
        <NumField label="Refrigerant added (kg)" value={s.test.addedKg} onChange={(n) => setTest(i, { addedKg: n })} />
      </div>
    </div>
  );

  const checksScreen = (
    <div className="wzd-form">
      {a.covers.ac && (
        <Group heading="Refrigerant">
          {a.systems.length > 1 && (
            <Tick
              checked={sameTests}
              onChange={(on) => {
                setSameTests(on);
                if (on && a.systems[0]) set({ systems: a.systems.map((s) => ({ ...s, test: { ...a.systems[0].test } })) });
              }}
              label="The same for every outdoor unit"
            />
          )}
          {(sameTests ? a.systems.slice(0, 1) : a.systems).map(testFor)}
        </Group>
      )}

      {clauses.includes("fireMode") && (
        <Group heading="Fire mode" fact="Asked for by the certifier (Specification 21)">
          <div className="wzd-radios" role="radiogroup" aria-label="Fire mode">
            <Radio
              name="fire"
              checked={a.fireMode === "individual"}
              onChange={() => set({ fireMode: "individual" })}
              label="Individual room units, each 1,000 L/s or less"
              sub="Not part of a smoke control system, so no shutdown is needed"
            />
            {a.fireMode === "individual" && (
              <Tick
                className="wzd-indent"
                checked={a.fireModeRatingsChecked}
                onChange={(on) => set({ fireModeRatingsChecked: on })}
                label="I've checked each unit's rated airflow on its spec sheet"
              />
            )}
            <Radio name="fire" checked={a.fireMode === "shutdown"} onChange={() => set({ fireMode: "shutdown" })} label="It shuts down on a fire signal" />
            {a.fireMode === "shutdown" && (
              <div className="wzd-pair wzd-indent">
                <Entry label="Fire signal from" value={a.fireModeInterface} onChange={(v) => set({ fireModeInterface: v })} />
                <Q label="Tested on">
                  <DateField aria-label="Tested on" max={live?.today} today={live?.today} value={a.fireModeTestedOn || null} onChange={(iso) => set({ fireModeTestedOn: iso ?? "" })} />
                </Q>
              </div>
            )}
            <Radio
              name="fire"
              checked={a.fireMode === "smoke"}
              onChange={() => set({ fireMode: "smoke" })}
              label="It's part of a smoke control system"
              sub="That needs the mechanical engineer's certificate, not this one"
            />
          </div>
        </Group>
      )}

      {clauses.includes("airBalance") && (
        <Q label="Air balance report">
          <Tray
            ariaLabel="Air balance report"
            value={a.airBalance ?? ""}
            options={[
              { value: "attached", label: "Attached to this certificate" },
              { value: "others", label: "Provided by others" },
            ]}
            onChange={(v) => set({ airBalance: v === "attached" ? "attached" : "others" })}
          />
        </Q>
      )}

      <Field label="Not covered (optional)" id="cz-notcov">
        <TextInput placeholder="For example, the building's outdoor-air ventilation" value={a.notCoveredExtra} onChange={(e) => set({ notCoveredExtra: e.target.value })} />
      </Field>
    </div>
  );

  const licenceLine = (name: string, l: { number: string | null; expires: string | null; current: boolean } | null) => (
    <div>
      <dt>{name}</dt>
      <dd>
        {l?.number ?? "Not on your staff card"}
        <small className={l?.current ? undefined : "wzd-wrong"}>
          {!l ? "Add it to your staff card to sign certificates" : l.current ? `Current to ${l.expires}` : l.expires ? `Lapsed ${l.expires}` : "No expiry date on file"}
        </small>
      </dd>
    </div>
  );

  const blocking = problems.filter((p) => p.field !== "sign" && p.field !== "approval");
  const signScreen = live && (
    <div className="wzd-form">
      <dl className="wzd-rev">
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
        <Group heading="Your signature" fact={signature ? "Kept on your staff card" : null}>
          {signature && !drawing ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="wzd-sig" src={`data:image/svg+xml;utf8,${encodeURIComponent(signature)}`} alt="Your signature" />
              <Button kind="quiet" size={32} className="wzd-start" onClick={() => setSignature(null)}>
                Draw it again
              </Button>
            </>
          ) : (
            <>
              <SignaturePad label="Draw your signature" onChange={setDrawing} />
              <Button kind="second" className="wzd-start" disabled={!drawing || sigBusy} onClick={() => void keepSignature()}>
                {sigBusy ? "Saving the signature" : "Keep this signature"}
              </Button>
            </>
          )}
        </Group>
      )}
      {!licensed && (
        <p className="wzd-wrong">To issue a certificate you need a current ARC licence and contractor licence on your staff card. This one can be read, but not issued.</p>
      )}
      {!live.approved &&
        (live.canApprove ? (
          <p className="wzd-text">
            The wording needs your approval before the first certificate goes out. <LinkButton href="/dashboard/admin/templates/certificate">Read and approve the wording</LinkButton>
          </p>
        ) : (
          <p className="wzd-look">{`${live.ownerName ?? "The owner"} approves the certificate wording before the first one can be issued.`}</p>
        ))}
      <Jumps items={blocking.map((p) => ({ key: p.field, text: p.text }))} onJump={(_, i) => go(PROBLEM_TAB[blocking[i]!.field])} />
    </div>
  );

  /* ── the frame ───────────────────────────────────────────────────────── */

  let body: ReactNode;
  let foot: ReactNode = null;
  let tabs = false;
  let title = prev ? "Reissue the certificate" : CERT_TITLE;
  const close = (
    <Button kind="main" onClick={onClose}>
      Close
    </Button>
  );

  if (ctx === null) {
    body = <p className="wzd-note">Reading the job</p>;
  } else if (ctx === "failed") {
    body = <p className="wzd-note">Couldn&apos;t open the certificate for this job. Close it and try again.</p>;
    foot = close;
  } else if (issued) {
    title = issued.version > 1 ? `Version ${issued.version} is on the job` : "The certificate is on the job";
    body = (
      <div className="wzd-form">
        <p className="wzd-text">{`Saved to the job's Documents as ${issued.fileName}. It hasn't been sent to anyone yet.`}</p>
        <div className="wzd-after">
          {canSend && (
            <>
              <Button kind="second" onClick={() => onEmail(issued.documentId)}>
                Email to the builder
              </Button>
              <Button kind="second" onClick={() => onSendToSm8(issued.documentId, issued.fileName)}>
                Send to ServiceM8
              </Button>
            </>
          )}
          <Button kind="second" onClick={() => void download(false)}>
            Download PDF
          </Button>
          <Button kind="second" className="wzd-share" onClick={() => void download(true)}>
            Share PDF
          </Button>
        </div>
        {error && <p className="wzd-wrong">{error}</p>}
      </div>
    );
    foot = (
      <>
        <Button kind="second" onClick={() => onOpen(issued.versionId)}>
          Open the certificate
        </Button>
        <Button kind="main" onClick={onClose}>
          Done
        </Button>
      </>
    );
  } else {
    tabs = true;
    const at = TABS.findIndex((t) => t.key === tab);
    const last = at === TABS.length - 1;
    /* the licences and the approval are on the problem list already */
    const canIssue = !!live && problems.length === 0 && !busy;
    foot = (
      <>
        {error ? (
          <FootWord tone="wrong">{error}</FootWord>
        ) : last && problems.length > 0 ? (
          <FootWord tone="look">{problems.length === 1 ? problems[0].text : `${problems.length} things to answer`}</FootWord>
        ) : null}
        {at > 0 ? (
          <Button kind="second" onClick={() => go(TABS[at - 1].key)}>
            Back
          </Button>
        ) : (
          <Button kind="second" onClick={askClose}>
            Cancel
          </Button>
        )}
        {!last ? (
          <Button kind="main" onClick={() => go(TABS[at + 1].key)}>
            Continue
          </Button>
        ) : (
          <Button kind="main" disabled={!canIssue} onClick={() => void issue()}>
            {busy ? "Issuing the certificate" : prev ? `Issue version ${prev.version + 1}` : "Issue the certificate"}
          </Button>
        )}
      </>
    );
  }

  const panels: Record<Tab, ReactNode> = {
    covers: coversScreen,
    equipment: equipmentScreen,
    list: listScreen,
    checks: checksScreen,
    sign: signScreen,
  };

  return (
    <>
      <WizardDialog
        heading={tabs ? CERT_TITLE : title}
        line={jobLine(live?.job ?? null)}
        width={960}
        tall={tabs}
        onClose={askClose}
        foot={foot}
        scrollRef={bodyRef}
        tabs={tabs ? { items: TABS, current: tab, onGo: (k) => go(k as Tab), ariaLabel: "Certificate steps", idPrefix: "cztab", panelPrefix: "czsec" } : null}
      >
        {tabs
          ? TABS.map((t) => (
              <section key={t.key} id={`czsec-${t.key}`} role="tabpanel" aria-labelledby={`cztab-${t.key}`} hidden={tab !== t.key}>
                {panels[t.key]}
              </section>
            ))
          : body}
      </WizardDialog>
      <ConfirmDialog
        open={confirmClose}
        heading="Discard this certificate?"
        confirm="Discard"
        cancel="Keep editing"
        onConfirm={onClose}
        onClose={() => setConfirmClose(false)}
      />
    </>
  );
}
