"use client";

import { useContext, useEffect, useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/parts/dialog";
import { Button, IconButton } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { Field, TextInput } from "@/components/parts/field";
import { Row, RowList } from "@/components/parts/row";
import { Dot } from "@/components/parts/state";
import { Tick } from "@/components/parts/tick";
import { Tray } from "@/components/parts/tabs";
import { DateField } from "@/components/ui/date-field";
import { NoteToken } from "@/components/notes/note-token";
import { WindowsContext } from "@/components/records/records-context";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { isWeekendISO, rollToBusinessDay } from "@/lib/workboard/board-status";
import { searchJobs } from "@/app/actions/workboard";
import { analyseSm8JobForAgreement, type AgreementProposal } from "@/app/actions/workboard-ai";
import { addPackingItem, createAgreement, createCategory } from "@/app/actions/workboard-maintenance";
import { agreementFormContext, type AgreementFormContext } from "@/app/actions/agreement-form";
import { spawnAgreementFromProject } from "@/app/actions/workboard-projects";
import type { JobSearchHit } from "@/lib/workboard/projects-query";
import type { AllJobRow } from "@/lib/workboard/all-jobs";
import { crewLabel } from "./derive";

/* NEW SERVICE AGREEMENT (v2 forms board, form 11), 720 wide, over the page
   you're on: Maintenance › Service agreements › New, a job card's Create a
   maintenance agreement, and a project's handover.

   Today's form under a new layout, everything kept. From: typed yourself,
   or a ServiceM8 job (the tray only shows with ServiceM8 connected; the
   board never looks broken without it). The job is a field (rule 51):
   filled in when the form opens from a job, clearable, and found by
   number, client or address, as today's search does. Read the job is
   Tiff reading the ServiceM8 job (analyseSm8JobForAgreement): she only
   PROPOSES, into the fields below, and this form is the review; nothing
   writes until Create.

   The duplicate guard fires on the client's name before anything is made,
   with the agreement it would double and a deliberate override. A weekend
   first service is said out loud, with the Monday one press away, and
   keeping the weekend stays allowed (K4/B9).

   From a project's handover the project is the record: the form opens
   filled in from it, and Create is today's handover action
   (spawnAgreementFromProject), which carries the equipment and its serials
   over and remembers the agreement on the project. Cleared, the project
   lets go, and it is an ordinary agreement.

   Saving keeps you where you were with a toast. It has no Undo: no action
   deletes an agreement; an agreement is ended from its own sheet. */

const INTERVALS: [number, string][] = [
  [1, "Monthly"],
  [2, "Every 2 months"],
  [3, "Quarterly"],
  [4, "Every 4 months"],
  [6, "6-monthly"],
  [12, "Annual"],
  [24, "Every 2 years"],
];
const INTERVAL_OPTIONS = INTERVALS.map(([n, word]) => ({ value: String(n), label: word }));
const CREW_OPTIONS = [1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: crewLabel(n) }));
const FROM_OPTIONS = [
  { value: "manual", label: "Enter it myself" },
  { value: "sm8", label: "A ServiceM8 job" },
] as const;

export type AgreementProject = {
  id: string;
  name: string;
  clientName: string | null;
  siteLabel: string | null;
  siteAddress: string | null;
};

/** A job card's row as the job the form opens on: what a search would have
    found for it. The row carries no street, only the suburb the board shows,
    so the address stays null rather than invented. */
export const jobOfRow = (row: Pick<AllJobRow, "id" | "number" | "statusLabel" | "clientName" | "suburb" | "title">): JobSearchHit => ({
  remoteId: row.id,
  jobNumber: row.number,
  status: row.statusLabel,
  clientName: row.clientName,
  companyId: null,
  suburb: row.suburb,
  address: null,
  description: row.title,
  linkedTo: [],
});

const jobLabel = (h: JobSearchHit) =>
  [h.jobNumber ? `Job ${h.jobNumber}` : "Job", h.clientName ?? "Unnamed client", h.suburb].filter(Boolean).join(", ");

export function AgreementForm({
  context: given,
  initialJob = null,
  project: givenProject = null,
  onOpenAgreement,
  onToast,
  onClose,
}: {
  /** The board's own: its agreements for the duplicate guard, its
      categories, whether ServiceM8 is connected, whether Tiff can read a
      job. Left out (a job's page, a project), the form reads them itself. */
  context?: AgreementFormContext | null;
  /** Opened FROM a job: the ServiceM8 leg is pre-answered. */
  initialJob?: JobSearchHit | null;
  /** Opened at a project's handover: the project is the record. */
  project?: AgreementProject | null;
  onOpenAgreement: (agreementId: string) => void;
  /** The screen's own toasts; the frame's otherwise. */
  onToast?: (message: string, undo?: () => void | Promise<void>) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const host = useContext(WindowsContext);
  const toast = onToast ?? host?.toast;
  const [busy, start] = useTransition();
  const jobId = useId();
  const anchorId = useId();
  const [read, setRead] = useState<AgreementFormContext | null>(null);
  const ctx = given ?? read;
  const [err, setErr] = useState<string | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [project, setProject] = useState<AgreementProject | null>(givenProject);
  const [source, setSource] = useState<"manual" | "sm8">(initialJob ? "sm8" : "manual");

  // the sm8 leg
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<JobSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  /* Arriving FROM a job, the picker's own `pick` rules (the client's name,
     the suburb as the site) are applied in the initial state below, so the
     prefill is the same whether the job was searched for or handed over. */
  const [picked, setPicked] = useState<JobSearchHit | null>(initialJob);
  const [analysing, setAnalysing] = useState(false);

  // the form, one review surface for every way in
  const [label, setLabel] = useState(givenProject?.name ?? "");
  const [clientName, setClientName] = useState(initialJob?.clientName ?? givenProject?.clientName ?? givenProject?.name ?? "");
  const [siteLabel, setSiteLabel] = useState(initialJob?.suburb ?? givenProject?.siteLabel ?? "");
  const [siteAddress, setSiteAddress] = useState(givenProject?.siteAddress ?? "");
  const [interval, setInterval_] = useState(givenProject ? 6 : 3);
  const [anchor, setAnchor] = useState("");
  const [hoursText, setHoursText] = useState("");
  const [techsNeeded, setTechsNeeded] = useState(1);
  const [billingContact, setBillingContact] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [newCategoryText, setNewCategoryText] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [bringItems, setBringItems] = useState<string[]>([]);
  const [weInstalled, setWeInstalled] = useState(!!givenProject);
  const [createAnyway, setCreateAnyway] = useState(false);

  /* Away from the board, what the board would have handed over is read once. */
  useEffect(() => {
    if (given) return;
    let live = true;
    void agreementFormContext().then((c) => {
      if (live) setRead(c ?? { agreements: [], categories: [], connected: false, voiceless: true });
    });
    return () => {
      live = false;
    };
  }, [given]);

  /** The duplicate guard: the same client already holding agreements. Case
      falls away; the person decides, open one of theirs or create on purpose. */
  const duplicates = useMemo(() => {
    const name = clientName.trim().toLowerCase();
    if (!name || !ctx) return [];
    return ctx.agreements.filter((a) => a.clientName.trim().toLowerCase() === name);
  }, [ctx, clientName]);

  const search = (text: string) => {
    setQ(text);
    if (text.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    start(async () => {
      const found = await searchJobs(text);
      setHits(found);
      setSearching(false);
    });
  };

  const pick = (hit: JobSearchHit) => {
    setPicked(hit);
    setHits([]);
    setQ("");
    if (hit.clientName) setClientName(hit.clientName);
    if (hit.suburb) setSiteLabel(hit.suburb);
    setCreateAnyway(false);
  };

  const applyProposal = (p: AgreementProposal) => {
    if (p.label) setLabel(p.label);
    if (p.intervalMonths) setInterval_(p.intervalMonths);
    if (p.hoursEstimate) setHoursText(String(p.hoursEstimate));
    if (p.techsNeeded) setTechsNeeded(p.techsNeeded);
    if (p.accessNotes) setAccessNotes(p.accessNotes);
    setBringItems(p.bringItems);
  };

  /* IT SAYS NOTHING WHEN IT WORKS: the proposal landing in the fields is the
     whole message. The failure says so, because that is a fact you can't see. */
  const analyse = () => {
    if (!picked) return;
    setAnalysing(true);
    setReadErr(null);
    start(async () => {
      const res = await analyseSm8JobForAgreement(picked.remoteId);
      setAnalysing(false);
      if (!res.ok) {
        setReadErr(res.reason === "no-key" ? "Tiff is offline, so fill the rest in yourself." : res.reason);
        return;
      }
      applyProposal(res.proposal);
    });
  };

  const create = () => {
    setErr(null);
    start(async () => {
      let catId: string | null = categoryId || null;
      if (newCategoryText.trim()) {
        const made = await createCategory(newCategoryText.trim());
        if (!made.ok || !made.id) {
          setErr(made.ok ? "Couldn't create the category." : made.error);
          return;
        }
        catId = made.id;
      }
      const fields = {
        label,
        clientName,
        siteLabel: siteLabel || undefined,
        siteAddress: siteAddress || undefined,
        intervalMonths: interval,
        anchorDate: anchor,
        accessNotes: accessNotes || undefined,
        billingContact: billingContact || undefined,
        techsNeeded,
        hoursEstimate: hoursText.trim() === "" ? undefined : Number(hoursText),
        categoryId: catId,
        weInstalled,
      };
      /* From a project, today's handover action: the equipment and serials
         carry over and the project remembers its agreement. */
      const res = project
        ? await spawnAgreementFromProject(project.id, fields)
        : await createAgreement({ ...fields, clientRemoteId: picked?.companyId ?? undefined });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      // the packing list rides the proposal (D5): items land on the fresh agreement
      if (res.id) {
        for (const item of bringItems) {
          await addPackingItem(res.id, item);
        }
      }
      onClose();
      router.refresh();
      toast?.(`Agreement created for ${clientName.trim()}`);
    });
  };

  const weekendAnchor = anchor && isWeekendISO(anchor);
  const canCreate = !!ctx && label.trim() && clientName.trim() && anchor && (!duplicates.length || createAnyway);
  const connected = !!ctx?.connected && !project;
  const voiceless = ctx?.voiceless ?? true;

  return (
    <Dialog
      heading="New agreement"
      width={720}
      onClose={onClose}
      foot={
        <>
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" disabled={busy || !canCreate} onClick={create}>
            {busy && !analysing && !searching ? "Creating the agreement" : "Create the agreement"}
          </Button>
        </>
      }
    >
      <form
        className="mk-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canCreate && !busy) create();
        }}
      >
        {project && (
          <Field label="Project">
            <div className="mk-job">
              <span className="mk-job-name">{project.name}</span>
              <IconButton glyph="clear" label="Clear the project" size={32} onClick={() => setProject(null)} />
            </div>
          </Field>
        )}

        {connected && (
          <div className="pt-field">
            <span className="pt-field-label">From</span>
            <div>
              <Tray options={FROM_OPTIONS} value={source} onChange={setSource} ariaLabel="From" />
            </div>
          </div>
        )}

        {connected && source === "sm8" && (
          <div className="mk-records-group">
            <div className="pt-field">
              <label className="pt-field-label" htmlFor={jobId}>
                Job
              </label>
              <div className="mk-records-jobrow">
                {picked ? (
                  <div className="mk-job">
                    <span className="mk-job-name">{jobLabel(picked)}</span>
                    <IconButton glyph="clear" label="Clear the job" size={32} onClick={() => setPicked(null)} />
                  </div>
                ) : (
                  <div className="mk-jobfind">
                    <TextInput
                      id={jobId}
                      value={q}
                      autoComplete="off"
                      placeholder="Job number, client or address"
                      onChange={(e) => search(e.target.value)}
                    />
                    {searching && (
                      <p className="mk-records-sub" role="status">
                        Searching the jobs
                      </p>
                    )}
                    {!searching && hits.length > 0 && (
                      <ul className="mk-jobhits" aria-label="Jobs">
                        {hits.map((h) => (
                          <li key={h.remoteId}>
                            <button type="button" className="mk-jobhit" onClick={() => pick(h)}>
                              {jobLabel(h)}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {!voiceless && (
                  <Button kind="second" disabled={!picked || busy || analysing} onClick={analyse}>
                    {analysing ? "Reading the job" : "Read the job"}
                  </Button>
                )}
              </div>
            </div>
            {readErr && (
              <p className="mk-records-res" role="alert">
                <Dot hue="orange" />
                {readErr}
              </p>
            )}
          </div>
        )}

        <div className="mk-records-grid mk-records-grid--2">
          <Field label="Service label">
            <TextInput value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Client">
            <TextInput
              value={clientName}
              onChange={(e) => {
                setClientName(e.target.value);
                setCreateAnyway(false);
              }}
            />
          </Field>

          {duplicates.length > 0 && (
            <div className="mk-records-group mk-records-wide">
              <p className="mk-records-res">
                <Dot hue="orange" />
                {clientName.trim()} already has {duplicates.length === 1 ? "an agreement" : "agreements"} here
              </p>
              <RowList label={`${clientName.trim()}'s agreements`}>
                {duplicates.map((d) => (
                  <Row
                    key={d.id}
                    name={d.label}
                    line={`${d.siteLabel ?? "No site label"}, ${d.status === "paused" ? "paused" : "active"}`}
                    end={
                      <Button
                        kind="quiet"
                        size={32}
                        onClick={() => {
                          onClose();
                          onOpenAgreement(d.id);
                        }}
                      >
                        Open it instead
                      </Button>
                    }
                  />
                ))}
              </RowList>
              <Tick
                label="This is genuinely a separate agreement, so create it anyway"
                checked={createAnyway}
                onChange={setCreateAnyway}
              />
            </div>
          )}

          <Field label="Site label">
            <TextInput value={siteLabel} onChange={(e) => setSiteLabel(e.target.value)} />
          </Field>
          <Field label="Site address">
            <TextInput value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
          </Field>
          <Field label="How often">
            <Chooser options={INTERVAL_OPTIONS} value={String(interval)} onChange={(v) => setInterval_(Number(v))} />
          </Field>
          <Field label="First service due" id={anchorId}>
            <DateField id={anchorId} value={anchor || null} placeholder="No date" onChange={(iso) => setAnchor(iso ?? "")} />
          </Field>

          {weekendAnchor && (
            <p className="mk-records-res mk-records-res--act mk-records-wide">
              <Dot hue="orange" />
              {`${fmtAuWeekdayDayMonth(anchor)} is a ${new Date(`${anchor}T12:00:00Z`).getUTCDay() === 6 ? "Saturday" : "Sunday"} — every visit will fall due on a weekend.`}
              <Button kind="second" size={32} onClick={() => setAnchor(rollToBusinessDay(anchor))}>
                Anchor on {fmtAuWeekdayDayMonth(rollToBusinessDay(anchor))} instead
              </Button>
            </p>
          )}

          {/* The two estimates the job card shows by these names: how long one
              visit takes and how many it takes. Written once here; every visit
              of the agreement inherits them. */}
          <Field label="Estimated service time (hours)">
            <TextInput type="number" min={0.5} max={24} step={0.5} value={hoursText} onChange={(e) => setHoursText(e.target.value)} />
          </Field>
          <Field label="Estimated crew size">
            <Chooser options={CREW_OPTIONS} value={String(techsNeeded)} onChange={(v) => setTechsNeeded(Number(v))} />
          </Field>
          <Field label="Billing contact">
            <TextInput value={billingContact} onChange={(e) => setBillingContact(e.target.value)} />
          </Field>
          <Field label="Category">
            <Chooser
              options={[{ value: "", label: "Uncategorised" }, ...(ctx?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))]}
              value={categoryId}
              onChange={setCategoryId}
            />
          </Field>
          <Field label="New category">
            <TextInput value={newCategoryText} onChange={(e) => setNewCategoryText(e.target.value)} />
          </Field>
          <div className="mk-records-tickcell">
            <Tick label="We installed this system" checked={weInstalled} onChange={setWeInstalled} />
          </div>
          <label className="pt-field mk-records-wide">
            <span className="pt-field-label">Access notes</span>
            <NoteToken as="field" label="access notes" value={accessNotes} onChange={setAccessNotes} rows={2} />
          </label>
        </div>

        {bringItems.length > 0 && (
          <div className="mk-records-group">
            <p className="mk-records-label">Packing list</p>
            <RowList label="Packing list">
              {bringItems.map((item) => (
                <Row
                  key={item}
                  name={item}
                  end={
                    <Button kind="quiet" size={32} aria-label={`Remove ${item}`} onClick={() => setBringItems(bringItems.filter((x) => x !== item))}>
                      Remove
                    </Button>
                  }
                />
              ))}
            </RowList>
          </div>
        )}

        {err && (
          <p className="mk-records-res" role="alert">
            <Dot hue="red" />
            {err}
          </p>
        )}
      </form>
    </Dialog>
  );
}
