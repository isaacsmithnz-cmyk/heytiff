"use client";

import { useContext, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/parts/dialog";
import { Button, IconButton } from "@/components/parts/button";
import { Field, TextArea, TextInput } from "@/components/parts/field";
import { Chooser } from "@/components/parts/chooser";
import { Tray } from "@/components/parts/tabs";
import { Loading } from "@/components/parts/states";
import { DateField } from "@/components/ui/date-field";
import { Icon } from "@/components/shell/icon";
import { WindowsContext } from "@/components/records/records-context";
import { todayInAu } from "@/lib/au-dates";
import { uploadFile } from "@/lib/documents/upload-client";
import { fileToUprightBase64, type UprightImage } from "@/lib/images/upright";
import { withCleanup } from "@/lib/ui/with-cleanup";
import { writeFuelHandoff } from "@/lib/fleet/fuel-handoff";
import { describeJob, searchJobs, type JobCandidate } from "@/lib/workboard/note-match";
import { costDescription } from "@/lib/workboard/note-cost";
import {
  CATEGORY_LABEL,
  EXPENSE_CATEGORIES,
  RECEIPT_ACCEPT,
  RECEIPT_IMAGE_TYPES,
  RECEIPT_PDF_TYPE,
  type ExpenseCategory,
  type JobKind,
  type PaidWith,
} from "@/lib/expenses/claim";
import { cancelClaim, claimFormFacts, submitClaim } from "@/app/actions/expenses";
import { readExpenseReceipt, type ReadExpenseResult } from "@/app/actions/expense-ai";
import { readFuelReceipt, type ReadReceiptResult } from "@/app/actions/fleet-ai";

/* CLAIM AN EXPENSE, and a job's Add › Cost (v2 forms, boards 10 and 4).

   One form, because a job's cost IS an expense claim: there is no other
   cost record (`expense_claims.job_kind`). Opened from your name ›
   Expense claims it is "Claim an expense"; from a job's Add › Cost it is
   "Add a cost", with the job filled in (rule 51), clearable, and searchable
   as today's job picker searched (`searchJobs`).

   TODAY'S ENGINE, A NEW LAYOUT (6-revisions.md, "The forms keep today's
   engines"). What this does is what My expenses' form did:

   THE RECEIPT COMES FIRST. Almost every claim starts as a photo in someone's
   hand, so the form opens on the drop zone, reads the receipt with today's
   reader (`readExpenseReceipt`) and shows the fields filled for checking.
   Typing it by hand is "Enter it myself". What Tiff reads is a draft, never
   a submission; a failed read leaves the receipt and an empty form.

   THE FILE UPLOADS ON SAVE, not on scan, so an abandoned scan leaves nothing
   in the bucket. A receipt can be attached at any point, and ATTACHING FROM
   THE FORM DOES NOT RE-SCAN: by then the person has typed, and Tiff's
   figures must never overwrite theirs.

   WHOSE MONEY decides what saving means: a claim sent for approval, or a
   company-card docket that nobody approves. The door you came through
   answers it (My expenses' Company card face opens on the card), and the
   tray is there to change it.

   FUEL HAS ONE RECORD, AND IT IS THE VEHICLE'S (lib/fleet/fuel-handoff).
   Choosing Fuel turns Save into "Log it on the vehicle", which hands every
   figure and the photo to the vehicle's Log fuel, exactly as it did. Fuel
   also reads the receipt with the fuel log's own reader (`readFuelReceipt`),
   so the litres and the ABN fill in too and go across with the rest; the
   vehicle and its odometer are asked there, where they always were.

   A SERVICEM8 JOB. A claim links only to a project, a visit or an
   agreement. A ServiceM8 job is named in the claim's words instead, as the
   job conversation's cost lane names it (note-cost-file's `claimCost`, through
   the same `costDescription`).

   SAVING KEEPS YOU WHERE YOU WERE (rule 51), with a toast whose Undo
   cancels the claim (`cancelClaim`, the cost lane's Undo too). */

/** The job a cost is for: one a claim can link (`JobKind`), or a ServiceM8
    job, named in the claim's words. */
export type CostJob = { kind: JobKind | "sm8"; id: string; label: string };

/* HOW A JOB READS, in the same shape `resolveJobLink` will store: a label
   that changed the moment you saved would look like the wrong job. */
function describe(j: JobCandidate): string {
  const named = !j.clientName || j.clientName === j.label ? j.label || j.clientName : `${j.clientName}, ${j.label}`;
  return j.jobNumber ? `#${j.jobNumber}, ${named}` : named;
}

type Draft = {
  expenseDate: string;
  description: string;
  category: ExpenseCategory;
  amount: string;
  gstAmount: string;
  supplier: string;
  /* fuel's, for the vehicle's log */
  litres: string;
  abn: string;
  note: string;
};

const emptyDraft = (today: string): Draft => ({
  expenseDate: today,
  description: "",
  category: "materials",
  amount: "",
  gstAmount: "",
  supplier: "",
  litres: "",
  abn: "",
  note: "",
});

/* The read laid over a blank draft. Out here, not in the scan's try, because
   React Compiler 1.0 cannot lower a value block (a `??`, a ternary) inside a
   try and gives up on the whole component when it meets one. */
const draftFromRead = (base: Draft, res: Extract<ReadExpenseResult, { ok: true }>): Draft => ({
  ...base,
  expenseDate: res.date ?? base.expenseDate,
  description: res.description ?? "",
  category: res.category ?? "materials",
  amount: res.total !== null ? String(res.total) : "",
  gstAmount: res.gst !== null ? String(res.gst) : "",
  supplier: res.supplier ?? "",
});

/* The fuel reader's litres and ABN, into the fields still empty: what the
   person typed is never overwritten. */
const fuelFill = (d: Draft | null, res: Extract<ReadReceiptResult, { ok: true }>): Draft | null =>
  d ? { ...d, litres: d.litres || (res.litres !== null ? String(res.litres) : ""), abn: d.abn || (res.abn ?? "") } : d;

const UNREAD = "Couldn't read that receipt — fill it in below.";

const isPdf = (f: File) => f.type === RECEIPT_PDF_TYPE;
const sizeOf = (f: File) => `${Math.max(0.1, f.size / 1_000_000).toFixed(1)} MB`;

const PAYERS = [
  { value: "own", label: "I did" },
  { value: "company", label: "Company card" },
] as const;

export function ExpenseForm({
  job = null,
  jobs: givenJobs,
  today: givenToday,
  payer = "own",
  onClose,
  onSaved,
  onUndone,
}: {
  /** The job it opens on, from a job's Add › Cost: "Add a cost". */
  job?: CostJob | null;
  /** The open work a receipt can go on (`jobCandidates`); read here when not given. */
  jobs?: JobCandidate[];
  /** The AU calendar day, the ceiling on a receipt's date; read here when not given. */
  today?: string;
  /** Whose money it starts as: the face you came from. */
  payer?: PaidWith;
  onClose: () => void;
  /** Saved: who paid, so the screen can show where it went. */
  onSaved?: (paidWith: PaidWith) => void;
  /** Its Undo went through. */
  onUndone?: () => void;
}) {
  const router = useRouter();
  const host = useContext(WindowsContext);
  const payId = useId();
  const dateId = useId();
  const fromJob = job !== null;
  const [facts, setFacts] = useState<{ today: string; jobs: JobCandidate[] } | null>(
    givenJobs && givenToday ? { today: givenToday, jobs: givenJobs } : null,
  );
  const [paidWith, setPaidWith] = useState<PaidWith>(payer);
  const [forJob, setForJob] = useState<CostJob | null>(job);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [read, setRead] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  /* the file the fuel reader has read, so it reads each one once */
  const fuelReadFor = useRef<File | null>(null);

  useEffect(() => {
    if (facts) return;
    let live = true;
    void claimFormFacts()
      .then((f) => live && setFacts(f))
      .catch(() => live && setFacts({ today: todayInAu(), jobs: [] }));
    return () => {
      live = false;
    };
  }, [facts]);

  const today = facts?.today ?? todayInAu();
  const jobs = facts?.jobs ?? [];
  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  /* THE FUEL LOG'S OWN READER, for the litres and the ABN. */
  const readFuel = async (img: UprightImage) => {
    const res = await readFuelReceipt(img.data, img.mediaType);
    if (res.ok) setDraft((d) => fuelFill(d, res));
  };

  /* The start screen's file: read, then shown filled for checking. */
  const onPick = async (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    setFile(picked);
    setScanning(true);
    await withCleanup(async () => {
      try {
        const img = await fileToUprightBase64(picked);
        const res = await readExpenseReceipt(img.data, img.mediaType);
        const base = emptyDraft(today);
        if (res.ok) {
          const filled = draftFromRead(base, res);
          setDraft(filled);
          setRead(true);
          if (filled.category === "fuel") {
            fuelReadFor.current = picked;
            await readFuel(img).catch(() => undefined);
          }
        } else {
          setDraft(base);
          if (res.reason !== "no-key") setError(UNREAD);
        }
      } catch {
        setDraft(emptyDraft(today));
        setError(UNREAD);
      }
    }, () => setScanning(false));
  };

  /* Attaching from inside the form: no scan (see the header). */
  const onAttach = (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    setFile(picked);
    setRead(false);
    fuelReadFor.current = null;
  };

  const detach = () => {
    setFile(null);
    setRead(false);
    fuelReadFor.current = null;
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  };

  const onCategory = (c: ExpenseCategory) => {
    set({ category: c });
    /* fuel reads the receipt again, for its two figures, into empty fields */
    if (c !== "fuel" || !file || fuelReadFor.current === file) return;
    fuelReadFor.current = file;
    void fileToUprightBase64(file)
      .then(readFuel)
      .catch(() => undefined);
  };

  const company = paidWith === "company";
  const fuel = draft?.category === "fuel";

  /* WHAT THE FORM ALREADY KNOWS it doesn't ask the server; `buildClaim`
     still re-checks every rule. */
  const missing = !draft
    ? null
    : !draft.description.trim()
      ? "Say what it was for"
      : !(Number(draft.amount) > 0)
        ? "Add how much it cost"
        : null;

  /* FUEL: to the vehicle's Log fuel, with the figures and the photo. */
  const toVehicle = async () => {
    if (!draft) return;
    setError(null);
    setSaving(true);
    let receiptDocumentId: string | null = null;
    if (file) {
      // stored as the LOG's paper, which is what it is about to become
      const up = await uploadFile(file, "fuel_receipt");
      if (!up.ok) {
        setSaving(false);
        setError(up.error);
        return;
      }
      receiptDocumentId = up.file.documentId;
    }
    writeFuelHandoff({
      cost: draft.amount,
      gst: draft.gstAmount,
      abn: draft.abn,
      station: draft.supplier,
      purchasedOn: draft.expenseDate,
      paidWith: company ? "company" : "own",
      receiptDocumentId,
      litres: draft.litres,
      note: draft.note,
    });
    router.push("/dashboard/my-vehicle");
    onClose();
  };

  const submit = async () => {
    if (!draft || missing) return;
    setError(null);
    setSaving(true);
    let documentIds: string[] = [];
    if (file) {
      const up = await uploadFile(file, "receipt");
      if (!up.ok) {
        setSaving(false);
        setError(up.error);
        return;
      }
      documentIds = [up.file.documentId];
    }
    /* kind + id only: the label that gets STORED is built on the server
       (resolveJobLink). A ServiceM8 job is named in the words. */
    const linked = forJob && forJob.kind !== "sm8" ? { kind: forJob.kind, id: forJob.id } : null;
    const named = forJob && forJob.kind === "sm8" ? forJob.label : null;
    const res = await submitClaim({
      job: linked,
      expenseDate: draft.expenseDate,
      description: named ? costDescription({ whatFor: draft.description, supplier: draft.supplier }, named) : draft.description,
      category: draft.category,
      amount: Number(draft.amount),
      gstAmount: draft.gstAmount ? Number(draft.gstAmount) : null,
      supplier: draft.supplier || null,
      paidWith,
      documentIds,
    });
    if (!res.ok) {
      setSaving(false);
      setError(res.error);
      return;
    }
    onClose();
    onSaved?.(paidWith);
    const what = fromJob && company ? "Cost added" : company ? "Receipt saved" : "Claim sent";
    host?.toast(forJob ? `${what} for ${forJob.label}` : what, async () => {
      const undone = await cancelClaim(res.id);
      if (!undone.ok) host?.toast(undone.error);
      else onUndone?.();
    });
  };

  const action = fuel
    ? { word: saving ? "Logging it on the vehicle" : "Log it on the vehicle", go: toVehicle, held: false }
    : {
        word: saving
          ? company
            ? fromJob
              ? "Adding the cost"
              : "Saving the receipt"
            : "Sending the claim"
          : company
            ? fromJob
              ? "Add cost"
              : "Save the receipt"
            : "Send claim",
        go: submit,
        held: !!missing,
      };

  /* the job field: on a job's form first, as its record; else after the receipt */
  const showJob = fromJob || jobs.length > 0;
  const jobField = showJob && <CostJobField job={forJob} jobs={jobs} onChange={setForJob} />;
  const payerField = (
    <div className="pt-field">
      <span className="pt-field-label" id={payId}>
        Who paid for it
      </span>
      <Tray options={PAYERS} value={paidWith} onChange={setPaidWith} ariaLabel="Who paid for it" />
    </div>
  );

  return (
    <Dialog
      heading={fromJob ? "Add a cost" : "Claim an expense"}
      width={560}
      onClose={onClose}
      foot={
        draft ? (
          <>
            <Button kind="second" onClick={onClose}>
              Cancel
            </Button>
            <Button kind="main" icon={fuel ? "fuel" : undefined} onClick={() => void action.go()} disabled={saving || action.held}>
              {action.word}
            </Button>
          </>
        ) : (
          <>
            <Button kind="second" onClick={onClose}>
              Cancel
            </Button>
            <Button kind="second" onClick={() => setDraft(emptyDraft(today))} disabled={scanning}>
              Enter it myself
            </Button>
          </>
        )
      }
    >
      <form
        className="mk-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft && !saving && !action.held) void action.go();
        }}
      >
        {fromJob && jobField}
        {payerField}

        {!draft ? (
          /* THE RECEIPT FIRST: dropped, snapped or chosen, then read */
          <div
            className={`mk-money-drop${over ? " mk-money-drop--over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              if (!scanning) setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              if (!scanning) void onPick(e.dataTransfer.files?.[0]);
            }}
          >
            {scanning && file ? (
              <>
                <p className="mk-money-dropk">Reading {file.name}</p>
                <Loading what="Reading the receipt" shape="text" />
              </>
            ) : (
              <>
                <p className="mk-money-dropk">Drop the receipt here, a photo or a PDF</p>
                <div className="mk-money-dropb">
                  <Button kind="main" icon="cam" onClick={() => cameraRef.current?.click()}>
                    Take a photo
                  </Button>
                  <Button kind="second" icon="upload" onClick={() => fileRef.current?.click()}>
                    Choose a file
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            {/* THE RECEIPT, and the way to change it */}
            <div className="pt-field">
              <span className="pt-field-label">Receipt</span>
              <div className="mk-money-rec">
                <Icon name="file" size={18} />
                {file ? (
                  <span className="mk-money-reck">
                    <b>{file.name}</b>
                    <em>
                      {isPdf(file) ? "PDF" : "Photo"}, {sizeOf(file)}.{read ? " Read into the form." : ""}
                    </em>
                  </span>
                ) : (
                  <span className="mk-money-reck">
                    <b>No receipt attached</b>
                  </span>
                )}
                <span className="mk-money-recb">
                  {file ? (
                    <>
                      <Button kind="quiet" onClick={() => fileRef.current?.click()} disabled={saving}>
                        Replace
                      </Button>
                      <Button kind="quiet" onClick={detach} disabled={saving}>
                        Remove
                      </Button>
                    </>
                  ) : (
                    <Button kind="second" icon="upload" onClick={() => fileRef.current?.click()} disabled={saving}>
                      Attach a receipt
                    </Button>
                  )}
                </span>
              </div>
            </div>

            {!fromJob && jobField}

            <Field label="What was it for">
              <TextInput
                value={draft.description}
                placeholder="Copper fittings and flux"
                data-autofocus
                onChange={(e) => set({ description: e.target.value })}
              />
            </Field>
            <div className="mk-pair">
              <Field label="Supplier">
                <TextInput value={draft.supplier} placeholder="Reece" onChange={(e) => set({ supplier: e.target.value })} />
              </Field>
              <Field label="Date" id={dateId}>
                <DateField
                  id={dateId}
                  value={draft.expenseDate || null}
                  today={today}
                  max={today}
                  onChange={(iso) => set({ expenseDate: iso ?? "" })}
                />
              </Field>
            </div>
            <div className="mk-money-trio">
              <Field label="Category">
                <Chooser
                  options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
                  value={draft.category}
                  onChange={(v) => onCategory(v as ExpenseCategory)}
                />
              </Field>
              <Field label="Total paid">
                <TextInput inputMode="decimal" value={draft.amount} placeholder="0.00" onChange={(e) => set({ amount: e.target.value })} />
              </Field>
              <Field label="GST">
                <TextInput inputMode="decimal" value={draft.gstAmount} onChange={(e) => set({ gstAmount: e.target.value })} />
              </Field>
            </div>

            {fuel && (
              <section className="mk-money-fuel" aria-labelledby={`${payId}-fuel`}>
                <h3 className="mk-money-head" id={`${payId}-fuel`}>
                  Fuel
                </h3>
                <div className="mk-pair">
                  <Field label="Litres">
                    <TextInput inputMode="decimal" value={draft.litres} onChange={(e) => set({ litres: e.target.value })} />
                  </Field>
                  <Field label="Supplier ABN">
                    <TextInput inputMode="numeric" value={draft.abn} onChange={(e) => set({ abn: e.target.value })} />
                  </Field>
                </div>
                <Field label="Note">
                  <TextArea rows={2} value={draft.note} onChange={(e) => set({ note: e.target.value })} />
                </Field>
              </section>
            )}

            {!fuel && missing && !saving && <p className="mk-money-need">{missing}</p>}
          </>
        )}
        {error && (
          <p className="pt-field-error" role="alert">
            {error}
          </p>
        )}
      </form>

      {/* the start screen's file is read; one picked from the form is attached */}
      <input
        ref={fileRef}
        type="file"
        accept={RECEIPT_ACCEPT}
        hidden
        aria-label="Choose a receipt"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (draft) onAttach(picked);
          else void onPick(picked);
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept={RECEIPT_IMAGE_TYPES.join(",")}
        capture="environment"
        hidden
        aria-label="Photograph a receipt"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
    </Dialog>
  );
}

/* THE JOB (rule 51): a field, filled in, that you can change or clear.
   Empty, it narrows the open work by any word on it, client, service, site
   or job number, as today's job picker did (`searchJobs`). */
function CostJobField({ job, jobs, onChange }: { job: CostJob | null; jobs: JobCandidate[]; onChange: (j: CostJob | null) => void }) {
  const [q, setQ] = useState("");
  const hits = q.trim() ? searchJobs(q, jobs).slice(0, 6) : [];

  if (job) {
    return (
      <Field label="Job">
        <div className="mk-job">
          <span className="mk-job-name">{job.label}</span>
          <IconButton glyph="clear" label="Clear the job" size={32} onClick={() => onChange(null)} />
        </div>
      </Field>
    );
  }
  return (
    <Field label="Job">
      <div className="mk-jobfind">
        <TextInput value={q} placeholder="Not for a job" onChange={(e) => setQ(e.target.value)} />
        {hits.length > 0 && (
          <ul className="mk-jobhits" aria-label="Jobs">
            {hits.map((h) => (
              <li key={`${h.kind}:${h.id}`}>
                <button
                  type="button"
                  className="mk-jobhit"
                  onClick={() => {
                    onChange({ kind: h.kind, id: h.id, label: describe(h) });
                    setQ("");
                  }}
                >
                  {describeJob(h)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}
